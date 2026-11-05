/**
 * Derived Servicing-Agent Onboarding population (server-only) — Right Path.
 *
 * Servicing Agent Onboarding is evaluated FROM FACTS: when a project contains
 * the onboarding workflow, every member whose applicable servicing access is
 * not yet confirmed is actionable outreach work — even if no stewardship_outreach
 * record exists for them yet. A freshly populated project (e.g. a newly
 * duplicated 1035 sweep) therefore has real, workable first-touch outreach
 * (introductory emails, phone calls) and contact research the moment it is
 * populated, before anyone has acted.
 *
 * This module is the SINGLE place that derivation lives. It takes a project's
 * members, subtracts the ones already represented by a real outreach row and
 * the ones whose onboarding is already complete, and returns each remaining
 * member's RECOMMENDED opening action resolved exactly the way a created record
 * would resolve it — reusing resolveContactOptions + initialQueueFromOptions
 * (the ZEN contact-options decision) and the shared callPopulationOf /
 * isIntroductoryEmail predicates. It performs READS ONLY and creates no record:
 * a durable stewardship_outreach row is materialized only when an operator acts
 * on the customer (POST /api/stewardship/ensure-one).
 *
 * Both the stewardship board route (GET /api/stewardship) and the My Work
 * composition consume this, so the board list and the My Work counts are built
 * from one derivation and can never disagree.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  callPopulationOf,
  isIntroductoryEmail,
  type OutreachQueue,
  type CallReason,
  type ResearchReason,
  type CallPopulation,
} from '@/lib/stewardship/queues'
import { initialQueueFromOptions, resolveContactOptions } from '@/lib/stewardship/contact-options'
import { loadHandsOffCustomerIds } from '@/lib/customers/other-specialist'
import {
  getProjectWorkflows,
  projectContainsWorkflow,
  onboardingCompleteForPolicies,
} from '@/lib/projects/workflows'

/** One record-less onboarding member's derived opening state. Mirrors the
 * fields the board route needs to render a virtual item and the facts My Work
 * needs to count the first-touch populations — nothing more. */
export interface DerivedOnboardingItem {
  customerId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  /** The recommended opening queue, derived from contact facts. */
  queue: OutreachQueue
  callReason: CallReason | null
  researchReason: ResearchReason | null
  /** Callability-based population (null when not callable), for Available to
   * Call / Calls Due. A derived item is never Calls Due (no due signal yet). */
  callPopulation: CallPopulation | null
  /** First-touch introductory email: true when the opening queue is
   * ready-to-email (untouched by construction — no email sent, no call, no
   * callback). */
  isIntroEmail: boolean
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size))
  }
}

/**
 * Whether a project runs the Servicing-Agent Onboarding workflow (so its
 * members are evaluated for the derived population). Resolved from the workflow
 * wiring, never the project name.
 */
export async function projectRunsOnboarding(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  return projectContainsWorkflow(await getProjectWorkflows(supabase, projectId), 'servicing_agent_onboarding')
}

/**
 * Derive the record-less onboarding population for a project.
 *
 * Returns the project members who are actionable onboarding outreach from facts
 * alone: they have at least one known non-test policy, their applicable
 * permanent servicing access is NOT yet confirmed (onboarding still open), they
 * are not in `excludeCustomerIds` (already represented by a real OPEN outreach
 * row), they have NOT explicitly declined (a refused outreach row is a
 * deliberate stop and is excluded here, not just by the caller), and they are
 * not a test record. Each carries its recommended opening action.
 *
 * Empty array when the project does not run onboarding, has no members, or every
 * member is already recorded / complete. No writes.
 */
export async function deriveOnboardingPopulation(
  supabase: SupabaseClient,
  projectId: string,
  options: {
    /** Project member customer ids (the Step-1 population). */
    memberCustomerIds: Iterable<string>
    /** Customers already represented by a real open outreach row — excluded so
     * shared work is never duplicated across the recorded and derived sources. */
    excludeCustomerIds?: Iterable<string>
  },
): Promise<DerivedOnboardingItem[]> {
  const exclude = new Set(options.excludeCustomerIds ?? [])
  const candidateIds = Array.from(new Set(options.memberCustomerIds)).filter((id) => !exclude.has(id))
  if (candidateIds.length === 0) return []
  // Hands-off customers (working with another active specialist) are never
  // derived as onboarding work, for every consumer of this derivation.
  const handsOff = await loadHandsOffCustomerIds(supabase, candidateIds)
  const memberIds = candidateIds.filter((id) => !handsOff.has(id))
  if (memberIds.length === 0) return []

  // REFUSED members are a deliberate dead stop, not derivable work. A declined
  // customer keeps a real stewardship_outreach row with refused_at set; that row
  // is (correctly) filtered out of the recorded/open board set, which means it
  // is also absent from the caller's excludeCustomerIds. Without this guard the
  // derivation would treat the member as "no record yet" and REGENERATE them as
  // a fresh virtual opening item (e.g. Ready to Email when an email is on file),
  // resurfacing a customer who explicitly said no. Reading the refused rows for
  // the member set here — the one place every consumer (board list, board
  // counts, My Work) shares — makes the refusal hold everywhere and can never
  // drift. Reopening clears refused_at, so a reopened customer derives normally.
  const refusedMemberIds = new Set<string>()
  await chunked(memberIds, 300, async (chunk) => {
    // Filter on customer_prereviews' own customer_id column (a direct column, so
    // a plain .in works), and read each member's outreach refused_at through the
    // embedded row. A member is refused when any of their outreach rows carries a
    // refused_at. Prereviews with no outreach row (embed null) are simply not
    // refused.
    const { data: preRows } = await supabase
      .from('customer_prereviews')
      .select('customer_id, stewardship_outreach ( refused_at )')
      .in('customer_id', chunk)
    for (const p of (preRows ?? []) as unknown as {
      customer_id: string
      stewardship_outreach: { refused_at: string | null } | { refused_at: string | null }[] | null
    }[]) {
      const outreach = p.stewardship_outreach
      const rows = Array.isArray(outreach) ? outreach : outreach ? [outreach] : []
      if (rows.some((o) => o.refused_at != null)) refusedMemberIds.add(p.customer_id)
    }
  })
  const activeMemberIds = memberIds.filter((id) => !refusedMemberIds.has(id))
  if (activeMemberIds.length === 0) return []

  // Policy facts (onboarding completion + nothing-to-pursue guard) and contact
  // facts (the derived opening action), in batched passes. Test rows excluded.
  const policiesByCustomer = new Map<string, { product_type: string | null; sa_status: string | null }[]>()
  const contactByCustomer = new Map<
    string,
    { email: string | null; phone: string | null; first_name: string | null; last_name: string | null }
  >()
  await chunked(activeMemberIds, 300, async (chunk) => {
    const [{ data: pols }, { data: custs }] = await Promise.all([
      supabase
        .from('service_policies')
        .select('customer_id, product_type, sa_status, is_test')
        .in('customer_id', chunk)
        .eq('is_test', false),
      supabase
        .from('customers')
        .select('id, first_name, last_name, email, phone, is_test')
        .in('id', chunk)
        .eq('is_test', false),
    ])
    for (const p of (pols ?? []) as { customer_id: string; product_type: string | null; sa_status: string | null }[]) {
      const list = policiesByCustomer.get(p.customer_id) ?? []
      list.push({ product_type: p.product_type, sa_status: p.sa_status })
      policiesByCustomer.set(p.customer_id, list)
    }
    for (const c of (custs ?? []) as {
      id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null
    }[]) {
      contactByCustomer.set(c.id, { email: c.email, phone: c.phone, first_name: c.first_name, last_name: c.last_name })
    }
  })

  const out: DerivedOnboardingItem[] = []
  for (const cid of activeMemberIds) {
    const contact = contactByCustomer.get(cid)
    if (!contact) continue // test record or missing — not surfaced
    const policies = policiesByCustomer.get(cid) ?? []
    if (policies.length === 0) continue // no known policy: nothing to pursue
    // Already complete (applicable access confirmed): advanced past onboarding.
    if (onboardingCompleteForPolicies(policies)) continue

    // The recommended opening action, derived from live contact facts exactly
    // the way a created record resolves it (resolveContactOptions reuses the ZEN
    // contact-options decision; initialQueueFromOptions picks the opener). This
    // is the source of the independent, non-exclusive first-touch populations:
    // a usable email yields an introductory email AND, when a phone is also
    // present, a callable item — neither method blocks the other.
    const resolvedOptions = await resolveContactOptions({ email: contact.email, phone: contact.phone })
    const route = initialQueueFromOptions(resolvedOptions)
    const queue = route.queue as OutreachQueue
    const hasUsablePhone = !!contact.phone?.trim()
    const callPopulation = callPopulationOf({
      effectiveQueue: queue,
      callReason: route.call_reason as CallReason | null,
      hasUsablePhone,
      // A derived onboarding item is untouched: no promised callback, no lapsed
      // cadence retry, so it is never Calls Due — only Available to Call.
      callbackDue: false,
    })
    const isIntroEmail = isIntroductoryEmail({
      effectiveQueue: queue,
      emailSentAt: null,
      lastCallOutcome: null,
      callbackDate: null,
    })

    out.push({
      customerId: cid,
      firstName: contact.first_name,
      lastName: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      queue,
      callReason: route.call_reason as CallReason | null,
      researchReason: route.research_reason as ResearchReason | null,
      callPopulation,
      isIntroEmail,
    })
  }
  return out
}
