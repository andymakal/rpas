/**
 * Servicing-Agent Onboarding membership — the ONE place an onboarding work
 * record is created for a customer.
 *
 * Servicing Agent Onboarding is objective-driven, not a manual campaign: a
 * customer belongs in onboarding because of who they are and what work the
 * business owes them (a 1035 project member whose servicing access is not yet
 * established), NOT because an operator clicked "Start". The durable
 * `stewardship_outreach` + open `customer_prereviews` pair still has to exist,
 * because it holds the non-derivable outreach HISTORY (claim, form receipt,
 * carrier submission, scheduled follow-ups) that cannot be recomputed from
 * customer facts. So "accounted for in onboarding" means that record exists.
 *
 * This module makes creating that record an IDEMPOTENT, reusable step so both
 * the (legacy) manual Start route and the automatic membership-driven ensure
 * run identical logic — there is no second code path and no parallel system:
 *
 *   - A customer who already has an OPEN pre-review is REUSED, never
 *     duplicated. Existing outreach records and their history are preserved
 *     untouched.
 *   - A customer with no known non-test policy is not started (there is nothing
 *     to pursue servicing access for).
 *   - The opening action (the stored `queue`) is only the RECOMMENDED first
 *     step, resolved by the ZEN contact-options decision over the customer's
 *     real contact facts. The reads (board / My Work / Daily Direction) derive
 *     the full set of available actions and populations live from current
 *     facts + history + rules; the stored queue never restricts the employee to
 *     a single channel.
 *
 * The per-customer creation below is the exact logic the manual Start route
 * used, lifted here verbatim so the two entry points cannot diverge.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveContactOptions, initialQueueFromOptions } from '@/lib/stewardship/contact-options'

/**
 * The per-customer onboarding decision, from the two facts that matter:
 * whether the customer has an OPEN pre-review, and (if so) whether that
 * pre-review already has an outreach row.
 *   - 'skip'     fully onboarded already (open pre-review + outreach row) —
 *                leave it untouched so existing records/history are preserved.
 *   - 'backfill' an open pre-review exists but has NO outreach row — reuse the
 *                pre-review and create only the missing outreach row (never a
 *                second pre-review).
 *   - 'create'   no open pre-review — create the full onboarding record.
 * Pure and exported so the idempotency rule is directly testable.
 */
export type OnboardingDecision = 'skip' | 'backfill' | 'create'

export function onboardingDecision(input: {
  hasOpenPrereview: boolean
  openPrereviewHasOutreach: boolean
}): OnboardingDecision {
  if (!input.hasOpenPrereview) return 'create'
  return input.openPrereviewHasOutreach ? 'skip' : 'backfill'
}

export interface EnsureResult {
  /** New onboarding records created on this run. */
  started: number
  /** Customers skipped because they already had an open onboarding record. */
  skipped: number
  /** Customers skipped because they hold no known non-test policy. */
  skippedNoPolicy: number
}

type Candidate = {
  id: string
  email: string | null
  phone: string | null
  source_agency_id: string | null
}

/**
 * Create the open onboarding record (pre-review + outreach + request-policy
 * links) for each candidate that does not already have one. Idempotent and
 * safe to call repeatedly: a customer with an open pre-review is skipped, so
 * existing records and their history are never duplicated or disturbed.
 *
 * Request-policy membership captures EVERY known non-test policy the customer
 * holds (permanent and term alike); the permanent-vs-term distinction gates
 * only downstream 1035 evaluation, never which policies we pursue servicing
 * access for. `policyFilterAgencyId`, when provided, narrows the captured
 * policies to one agency book (the agency-book Start path); the project and
 * membership paths pass null to take all of the customer's known policies.
 */
export async function ensureOnboardingForCustomers(
  supabase: SupabaseClient,
  candidates: Candidate[],
  opts?: { policyFilterAgencyId?: string | null },
): Promise<EnsureResult> {
  const result: EnsureResult = { started: 0, skipped: 0, skippedNoPolicy: 0 }
  if (candidates.length === 0) return result

  const policyFilterAgencyId = opts?.policyFilterAgencyId ?? null
  const customerIds = candidates.map((c) => c.id)

  // Resolve each customer's OPEN pre-review (one open per customer). A customer
  // is "accounted for in onboarding" only when the open pre-review ALSO has a
  // stewardship_outreach row (the board/My Work read outreach rows, so an open
  // pre-review with no outreach row is invisible work). So we track two sets:
  //   - openPrereviewByCustomer: an existing open pre-review to REUSE (never
  //     create a second one).
  //   - prereviewsWithOutreach: which of those already have an outreach row.
  // A customer with a complete record (open pre-review + outreach row) is
  // skipped untouched; a customer with an open pre-review but NO outreach row
  // is backfilled by reusing the pre-review and creating the missing outreach
  // row — not duplicated.
  const openPrereviewByCustomer = new Map<string, string>()
  await chunked(customerIds, 200, async (chunk) => {
    const { data } = await supabase
      .from('customer_prereviews')
      .select('id, customer_id')
      .in('customer_id', chunk)
      .is('decision', null)
    for (const r of (data ?? []) as { id: string; customer_id: string }[]) {
      // At most one open pre-review per customer (partial unique index); keep
      // the first seen defensively.
      if (!openPrereviewByCustomer.has(r.customer_id)) openPrereviewByCustomer.set(r.customer_id, r.id)
    }
  })
  const openPrereviewIds = Array.from(openPrereviewByCustomer.values())
  const prereviewsWithOutreach = new Set<string>()
  await chunked(openPrereviewIds, 200, async (chunk) => {
    const { data } = await supabase
      .from('stewardship_outreach')
      .select('prereview_id')
      .in('prereview_id', chunk)
    for (const r of (data ?? []) as { prereview_id: string }[]) prereviewsWithOutreach.add(r.prereview_id)
  })

  // Source cohort: EVERY known non-test policy each customer holds (term and
  // permanent). Narrowed to one agency book only when policyFilterAgencyId is
  // set (the agency-book Start path).
  const cohortByCustomer = new Map<string, { id: string }[]>()
  await chunked(customerIds, 200, async (chunk) => {
    let query = supabase
      .from('service_policies')
      .select('id, customer_id')
      .in('customer_id', chunk)
      .eq('is_test', false)
    if (policyFilterAgencyId) query = query.eq('agency_id', policyFilterAgencyId)
    const { data } = await query
    for (const p of (data ?? []) as { id: string; customer_id: string }[]) {
      const list = cohortByCustomer.get(p.customer_id) ?? []
      list.push({ id: p.id })
      cohortByCustomer.set(p.customer_id, list)
    }
  })

  for (const c of candidates) {
    const existingPrereviewId = openPrereviewByCustomer.get(c.id) ?? null
    const decision = onboardingDecision({
      hasOpenPrereview: existingPrereviewId != null,
      openPrereviewHasOutreach: existingPrereviewId != null && prereviewsWithOutreach.has(existingPrereviewId),
    })

    // Fully onboarded already (open pre-review + outreach row): leave untouched.
    if (decision === 'skip') {
      result.skipped++
      continue
    }

    const requestPolicies = cohortByCustomer.get(c.id) ?? []
    if (requestPolicies.length === 0) {
      result.skippedNoPolicy++
      continue
    }

    // 1. The capture work item (pre-review). Reuse the existing OPEN pre-review
    // when there is one (so a second is never created); otherwise create it. A
    // pre-review that already exists but lacks an outreach row is the backfill
    // case — reuse it and only create the missing outreach row below.
    let prereviewId = existingPrereviewId
    let createdPrereview = false
    if (!prereviewId) {
      const { data: pre, error: preErr } = await supabase
        .from('customer_prereviews')
        .insert({ customer_id: c.id, source_agency_id: c.source_agency_id })
        .select('id')
        .single()
      if (preErr || !pre) {
        // A unique-violation on the open-pre-review partial index means another
        // open item appeared concurrently; treat as a skip, not a failure.
        result.skipped++
        continue
      }
      prereviewId = pre.id
      createdPrereview = true
    }

    // 2. Outreach row with the ZEN-resolved opening action. The stored queue is
    // only the recommended first step; the reads surface every applicable
    // action from this single workflow. On any failure below, compensate ONLY
    // for what THIS run created: a pre-review we just created is deleted
    // (cascading its links) so a partial record is never left behind; a REUSED
    // existing pre-review is never deleted (its history must be preserved).
    const options = await resolveContactOptions({ email: c.email, phone: c.phone })
    const route = initialQueueFromOptions(options)
    const { data: outreach, error: outErr } = await supabase
      .from('stewardship_outreach')
      .insert({
        prereview_id: prereviewId,
        queue: route.queue,
        call_reason: route.call_reason,
        research_reason: route.research_reason,
      })
      .select('id')
      .single()
    if (outErr || !outreach) {
      if (createdPrereview) await supabase.from('customer_prereviews').delete().eq('id', prereviewId)
      result.skipped++
      continue
    }

    // 3. Request-policy set (required part of a started item).
    const { error: linkErr } = await supabase
      .from('stewardship_outreach_policies')
      .insert(requestPolicies.map((p) => ({ outreach_id: outreach.id, policy_id: p.id })))
    if (linkErr) {
      // Roll back the outreach row we just created; delete the pre-review only
      // if THIS run created it (a reused one keeps its history).
      await supabase.from('stewardship_outreach').delete().eq('id', outreach.id)
      if (createdPrereview) await supabase.from('customer_prereviews').delete().eq('id', prereviewId)
      result.skipped++
      continue
    }

    result.started++
  }

  return result
}

// NOTE: there is deliberately NO "ensure every project member has an onboarding
// record" function here anymore. Servicing Agent Onboarding is evaluated from
// facts (membership + policy servicing-access), so a member who needs access is
// surfaced as actionable WITHOUT a pre-created record and WITHOUT any read-time
// write (see src/lib/projects/workflows.ts and the stewardship board). A durable
// stewardship_outreach record is created only when an operator actually acts on
// a customer, through ensureOnboardingForCustomers (the explicit Start route)
// or ensureOneCustomerOutreach below (the lazy create-on-first-action path).
// This is the correction of the earlier "create records on page read" behavior.

/**
 * Lazily ensure the onboarding record for ONE customer and return the id of
 * their OPEN stewardship_outreach row. This is the create-on-first-action seam:
 * when an operator opens or acts on a derived (not-yet-recorded) onboarding
 * item, the durable record is created at that moment — never on a plain page
 * read. Idempotent: if the customer already has an open outreach row, its id is
 * returned and nothing is created.
 *
 * Returns { outreachId } on success, or { error } when the customer cannot be
 * started (not found, test record, or no known policy to pursue).
 */
export async function ensureOneCustomerOutreach(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{ outreachId: string } | { error: string }> {
  const { data: cust, error: custErr } = await supabase
    .from('customers')
    .select('id, email, phone, agency_id, is_test')
    .eq('id', customerId)
    .maybeSingle()
  if (custErr) return { error: custErr.message }
  if (!cust) return { error: 'Customer not found' }
  const c = cust as { id: string; email: string | null; phone: string | null; agency_id: string | null; is_test: boolean }
  if (c.is_test) return { error: 'Customer is a test record' }

  await ensureOnboardingForCustomers(
    supabase,
    [{ id: c.id, email: c.email, phone: c.phone, source_agency_id: c.agency_id }],
    { policyFilterAgencyId: null },
  )

  // Resolve the OPEN outreach row for this customer (whether created just now or
  // pre-existing). open pre-review -> its outreach row.
  const { data: pre } = await supabase
    .from('customer_prereviews')
    .select('id')
    .eq('customer_id', customerId)
    .is('decision', null)
    .maybeSingle()
  if (!pre) return { error: 'Could not start onboarding for this customer (no open work item).' }
  const { data: outreach } = await supabase
    .from('stewardship_outreach')
    .select('id')
    .eq('prereview_id', (pre as { id: string }).id)
    .maybeSingle()
  if (!outreach) return { error: 'Could not start onboarding for this customer (no outreach record; the customer may have no known policy).' }
  return { outreachId: (outreach as { id: string }).id }
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size))
  }
}
