import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readResearchedUnsuccessfullyBatch,
  stillNeedsResearchRecommendation,
} from '@/lib/stewardship/research-record'
import { readUnusableChannelsByCustomer } from '@/lib/stewardship/attempt-history'
import type { OutreachChannel } from '@/lib/stewardship/outreach-attempts'
import { activeProjectsWithWorkflow, isPermanentPolicyReviewTypeName } from '@/lib/projects/workflows'
import { type EmailAvailability } from '@/lib/email-availability'

/**
 * Effective contact usability folds the recorded-UNUSABLE fact into mere
 * presence, exactly as the contact-options ZEN boundary does for outreach:
 *   - a phone is usable only when present AND the number has not been recorded
 *     unusable (a bad/disconnected number, recorded via a 'call' or 'voicemail'
 *     unusable outcome — both ride the same number);
 *   - an email is usable only when present AND the email channel has not been
 *     recorded unusable (a bounced/invalid address).
 * A present-but-unusable value therefore does NOT keep a customer out of the No
 * Usable Contact Information exception: they genuinely cannot be reached.
 */
function emailUsable(email: string | null, unusable: Set<OutreachChannel>): boolean {
  return !!email && email.trim().length > 0 && !unusable.has('email')
}
function phoneUsable(phone: string | null, unusable: Set<OutreachChannel>): boolean {
  if (!phone || phone.trim().length === 0) return false
  return !unusable.has('call') && !unusable.has('voicemail')
}
/**
 * A mailing address is usable only when all four parts are on file, mirroring
 * the shared CustomerContactCard's addressUsable. Mailing address is an
 * independent contact method (postal mail), so a missing/incomplete address is
 * a research gap even for a customer who already has a usable email or phone.
 * It is pure presence: there is no recorded-unusable concept for a street
 * address the way there is for a bounced email or a disconnected number.
 */
function addressUsable(c: {
  street: string | null; address_line1: string | null
  city: string | null; state: string | null; zip: string | null
}): boolean {
  const hasStreet = usable(c.street) || usable(c.address_line1)
  return hasStreet && usable(c.city) && usable(c.state) && usable(c.zip)
}

/**
 * Contact Research — project-scoped read model (the single consolidated
 * contact-finding activity).
 *
 * The Cassidy import left many customers with incomplete contact information.
 * Contact Research is a fast look-up-and-complete pass over a project's
 * population: it lists every project customer who is missing EITHER a usable
 * email OR a usable phone (including customers who already have one usable
 * method), each customer once regardless of how many policies they hold. This
 * one list is the whole contact-research surface — there is no longer a separate
 * "research exception" board activity and a separate "contact review" project
 * activity; a customer missing both methods (the exception) and a customer
 * missing just one are the same research work, surfaced together here.
 *
 * This read is deliberately thin. It does NOT touch stewardship_outreach,
 * customer_prereviews, or any workflow status — contact facts live only on the
 * customers row, and that is the single thing this workflow reads and (via its
 * sibling write route) corrects. Membership is exactly project_customers, the
 * same Step 1 population every other project surface reads; nothing here is
 * hardcoded.
 *
 * Durable research suppression, with a visible exception. A customer whose every
 * still-missing method has already been researched unsuccessfully (recorded in
 * case_touches, read via the shared research-record helper) is no longer
 * ACTIVELY RECOMMENDED — the look-up was done and nothing was found, so Contact
 * Research stops re-presenting it as outstanding work on every pass. This
 * replaces the former session-only, in-memory suppression with a durable fact
 * that survives reloads and sessions. It is self-healing: a method that later
 * gets a value is no longer missing, so the customer returns to the active list
 * if the other method is still outstanding; a fully completed customer (both
 * methods present) was never in the list to begin with. Re-research stays
 * possible by opening the customer deliberately.
 *
 * The one deliberate exception, required by the business rule: a customer with
 * NO usable contact method at all (missing BOTH email and phone) is NEVER
 * silently dropped. Even after unsuccessful research, they remain visible in a
 * "No Usable Contact Information" exception list — the agency must keep seeing
 * who it cannot reach — but flagged researched-unsuccessfully so they are not
 * re-recommended as fresh outstanding work. A customer missing just ONE method
 * whose missing method is settled by research still leaves the active list (they
 * are reachable by the method they have, and the deliberate reopen path remains).
 */

export interface ContactReviewCustomer {
  customer_id: string
  first_name: string | null
  last_name: string | null
  /** Stored date of birth; used only to derive the displayed age (the day is
   * never shown). Carried so the card header can show the customer's age. */
  date_of_birth: string | null
  /** Current stored contact facts, shown so the worker can see what exists. */
  email: string | null
  phone: string | null
  has_email: boolean
  has_phone: boolean
  /** Whether a usable mailing address is on file (all of street, city, state,
   * ZIP). Mailing address is an independent contact method researched alongside
   * email and phone. */
  has_address: boolean
  /** Full mailing address + verification timestamps, so the shared editable
   * CustomerContactCard can render and correct the whole contact surface (not
   * just email/phone) straight from this one read. All live on the customers
   * row; nothing new is introduced. */
  street: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  /** Durable email-availability fact (customers.email_availability). Carried so
   * the shared CustomerContactCard can show the current state. Informational
   * only: it does not affect research recommendation or any workflow routing. */
  email_availability: EmailAvailability | null
  /** The customer's single alert (customers.contact_alert). Carried so the
   * shared CustomerContactCard shows the same alert banner here. Informational
   * only; no effect on research or routing. */
  contact_alert: string | null
  /** Do Not Text — the durable customer opt-out (customers.sms_opt_out). Carried
   * so the shared card shows the texting status on first render. Disables
   * texting only; never calling. */
  sms_opt_out: boolean
  /** Text Undeliverable — whether the NUMBER on file has a recorded text-delivery
   * failure (the value-scoped text unusable fact, already resolved against the
   * current number in `unusableByCustomer`). Restores on a number change. */
  text_undeliverable: boolean
  /** Any one policy number already on file for this customer, shown so the
   * worker can search Gateway by last name + policy number. null when the
   * customer has no policy on file. */
  policy_number: string | null
  /**
   * REACHABILITY, which keys the two surfaces (research state sub-labels within,
   * via researched_unsuccessfully):
   *   - 'needs_research'      Reachable: exactly one method is missing (reachable
   *                           by the other). Routine active-list work; shown only
   *                           while its one missing method is still outstanding.
   *   - 'no_usable_contact'   No usable email AND no usable phone: cannot be
   *                           reached at all. ALWAYS shown in the "No Usable
   *                           Contact Information" section — whether research is
   *                           still outstanding or already came up empty.
   */
  status: 'needs_research' | 'no_usable_contact'
  /** True when every STILL-MISSING method has a recorded unsuccessful-research
   * outcome, i.e. research is exhausted and should NOT be recommended again. A
   * 'needs_research' (reachable) row is always false here (a settled one is
   * dropped). A 'no_usable_contact' row is true when previously unsuccessful and
   * false when research is still outstanding — the distinction the No Usable
   * Contact Information section surfaces. */
  researched_unsuccessfully: boolean
}

export interface ContactReviewSummary {
  /** Project members (non-test) surfaced by Contact Research — the list length
   * (actively-recommended rows PLUS visible no-usable-contact exceptions). */
  total: number
  /** Of the list, how many are missing both methods (nothing usable). */
  missing_both: number
  /** Of the list, how many already have exactly one usable method (reachable). */
  one_usable: number
  /** Of the list, how many are classified reachable (missing exactly one
   * method) — the routine active-list population. */
  needs_research: number
  /** Of the list, how many have NO usable contact at all (the No Usable Contact
   * Information section) — both the outstanding and the previously-unsuccessful. */
  no_usable_contact: number
  /** Of the list, how many are OUTSTANDING ("not yet researched"): research not
   * yet exhausted (researched_unsuccessfully === false). This is the outstanding
   * figure that drives the My Work recommendation band and the "not yet
   * researched" breakdown. The full incomplete population is `total`; the
   * previously-researched-unsuccessfully subset is `total - actionable`, read
   * from actual customer history. Every incomplete customer still counts as
   * available work via the unresolved/total figure. */
  actionable: number
}

type ProjectCustomerRow = { customer_id: string }
type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  street: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  email_availability: EmailAvailability | null
  contact_alert: string | null
  sms_opt_out: boolean | null
  date_of_birth: string | null
  is_test: boolean
}

/** The columns both loaders read for a Contact Review row. Includes the mailing
 * address and verification timestamps the shared CustomerContactCard needs. */
const CUSTOMER_SELECT =
  'id, first_name, last_name, email, phone, street, address_line1, city, state, zip, ' +
  'email_verified_at, phone_verified_at, address_verified_at, email_availability, contact_alert, sms_opt_out, date_of_birth, is_test'

const usable = (v: string | null): boolean => !!v && v.trim().length > 0

async function chunked<T>(
  items: T[],
  size: number,
  run: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await run(items.slice(i, i + size))
  }
}

type ServicePolicyRow = { customer_id: string | null; policy_number: string | null }

/**
 * Map each given customer to ANY ONE policy number on file, read in a batched
 * pass over service_policies (non-test). Gateway look-up only needs a single
 * policy number to pair with the last name, so the first usable one wins and
 * additional policies are ignored. Customers with no policy are simply absent
 * from the map (surfaced as "no policy number" in the UI).
 */
async function loadOnePolicyNumberPerCustomer(
  supabase: SupabaseClient,
  customerIds: string[],
): Promise<Map<string, string>> {
  const byCustomer = new Map<string, string>()
  if (customerIds.length === 0) return byCustomer
  await chunked(customerIds, 300, async chunk => {
    const { data } = await supabase
      .from('service_policies')
      .select('customer_id, policy_number')
      .in('customer_id', chunk)
      .eq('is_test', false)
    for (const p of (data ?? []) as ServicePolicyRow[]) {
      if (!p.customer_id || !usable(p.policy_number)) continue
      if (!byCustomer.has(p.customer_id)) byCustomer.set(p.customer_id, p.policy_number!.trim())
    }
  })
  return byCustomer
}

/**
 * Build the Contact Review list for a project: project members whose customer
 * record is missing a usable email or a usable phone. One batched pass over
 * project_customers -> customers; test rows excluded; each customer once.
 * Sorted by last name then first name for a stable, workable order.
 */
export async function buildContactReview(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ContactReviewCustomer[]> {
  const { data: members } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)

  const customerIds = Array.from(
    new Set(((members ?? []) as ProjectCustomerRow[]).map(m => m.customer_id)),
  )
  if (customerIds.length === 0) return []

  const customers: CustomerRow[] = []
  await chunked(customerIds, 300, async chunk => {
    const { data } = await supabase
      .from('customers')
      .select(CUSTOMER_SELECT)
      .in('id', chunk)
    customers.push(...((data ?? []) as unknown as CustomerRow[]))
  })

  // Recorded-unusable channels per project customer, read in one batched pass.
  // Folded into usability below so a present-but-unusable value (a bad number, a
  // bounced email) does NOT count as a usable method — the same recorded fact
  // the outreach contact-options boundary subtracts. Read for the whole
  // (non-test) project population BEFORE the incomplete filter, because a
  // customer with both values PRESENT but BOTH recorded unusable has no usable
  // contact and must reach the exception, which a raw-presence filter would miss.
  const realCustomers = customers.filter((c) => !c.is_test)
  // Current contact values per customer, so an unusable mark only applies while
  // the value that failed is still on file (a replacement restores eligibility).
  const currentByCustomer = new Map<string, { email: string | null; phone: string | null }>(
    realCustomers.map((c) => [c.id, { email: c.email, phone: c.phone }]),
  )
  const unusableByCustomer = await readUnusableChannelsByCustomer(
    supabase,
    realCustomers.map((c) => c.id),
    currentByCustomer,
  )
  const noneUnusable: Set<OutreachChannel> = new Set()

  // Customers still missing a USABLE method (effective usability), before the
  // durable research suppression. Email, phone, and mailing address are the
  // three independent contact methods; a customer is incomplete when any one is
  // missing, so a customer with a usable email and phone but no mailing address
  // is still research work (postal mail is an independent method).
  const incomplete = realCustomers.filter((c) => {
    const u = unusableByCustomer.get(c.id) ?? noneUnusable
    return !(emailUsable(c.email, u) && phoneUsable(c.phone, u) && addressUsable(c))
  })

  // Which of those have a recorded unsuccessful-research outcome, read in one
  // batched pass. A customer whose every still-missing method is settled by
  // research is dropped below.
  const researchedByCustomer = await readResearchedUnsuccessfullyBatch(
    supabase,
    incomplete.map((c) => c.id),
  )

  // One policy number per customer for the Gateway look-up (last name + policy).
  const policyByCustomer = await loadOnePolicyNumberPerCustomer(
    supabase,
    incomplete.map((c) => c.id),
  )

  const out: ContactReviewCustomer[] = []
  for (const c of incomplete) {
    const u = unusableByCustomer.get(c.id) ?? noneUnusable
    const hasEmail = emailUsable(c.email, u)
    const hasPhone = phoneUsable(c.phone, u)
    const hasAddress = addressUsable(c)
    const researched = researchedByCustomer.get(c.id) ?? { email: false, phone: false, address: false }
    const stillRecommend = stillNeedsResearchRecommendation({ hasEmail, hasPhone, hasAddress }, researched)

    // Reachability keys the two surfaces (NOT the research state, which only
    // sub-labels within each). Reachability is about a usable email or phone —
    // the ways the agency actually reaches out; mailing address is an
    // independent method that does not by itself make a customer reachable:
    //   - noUsableContact (no usable email AND no usable phone): the customer
    //     cannot be reached at all. ALWAYS shown in the "No Usable Contact
    //     Information" section so the agency never loses sight of anyone it
    //     cannot reach — whether research is still outstanding or already came
    //     up empty. researched_unsuccessfully distinguishes the two there.
    //   - reachable by email or phone but missing something (the other method
    //     or a mailing address): routine outstanding research in the active
    //     list. Once every missing method is settled by research it leaves the
    //     active list durably (still reachable; the deliberate reopen path
    //     allows a re-check).
    const noUsableContact = !hasEmail && !hasPhone

    // Every incomplete customer stays in the list until the gap is actually
    // resolved (a usable email, phone, and complete mailing address on file).
    // Previously unsuccessful research is recorded in customer history and
    // surfaces here only as a sub-label (researched_unsuccessfully); it NEVER
    // removes the customer from Contact Research. A found value self-heals the
    // method (it is no longer missing), so a completed customer leaves the list
    // naturally. There is no research-history suppression.
    out.push({
      customer_id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      date_of_birth: c.date_of_birth,
      email: c.email,
      phone: c.phone,
      has_email: hasEmail,
      has_phone: hasPhone,
      has_address: hasAddress,
      street: c.street,
      address_line1: c.address_line1,
      city: c.city,
      state: c.state,
      zip: c.zip,
      email_verified_at: c.email_verified_at,
      phone_verified_at: c.phone_verified_at,
      address_verified_at: c.address_verified_at,
      email_availability: c.email_availability,
      contact_alert: c.contact_alert,
      sms_opt_out: c.sms_opt_out === true,
      // Value-scoped text delivery failure for the number on file (onboarding or
      // card-recorded). `u` is already resolved against the current phone, so a
      // replaced number has already dropped out of the set.
      text_undeliverable: u.has('text'),
      policy_number: policyByCustomer.get(c.id) ?? null,
      // Status is reachability: no usable method at all vs missing one. The
      // No Usable Contact Information section shows every 'no_usable_contact'
      // row; researched_unsuccessfully sub-labels outstanding vs previously
      // unsuccessful. 'needs_research' is the reachable, active-list population.
      status: noUsableContact ? 'no_usable_contact' : 'needs_research',
      // History sub-label only: true when every still-missing method has a
      // recorded unsuccessful-research outcome. It no longer gates inclusion or
      // the count — the customer stays in Contact Research regardless — it only
      // tells the worker that earlier research came up empty (a re-check, not
      // fresh work).
      researched_unsuccessfully: !stillRecommend,
    })
  }

  // Active research first, then the No Usable Contact Information exception —
  // each group ordered by name. The exception stays visible but sits below the
  // outstanding work so the recommended list reads first.
  const statusRank = (r: ContactReviewCustomer): number =>
    r.status === 'needs_research' ? 0 : 1
  out.sort((a, b) => {
    const sr = statusRank(a) - statusRank(b)
    if (sr !== 0) return sr
    const al = (a.last_name ?? '').toLowerCase()
    const bl = (b.last_name ?? '').toLowerCase()
    if (al !== bl) return al < bl ? -1 : 1
    const af = (a.first_name ?? '').toLowerCase()
    const bf = (b.first_name ?? '').toLowerCase()
    return af < bf ? -1 : af > bf ? 1 : 0
  })

  return out
}

/**
 * Load ONE project customer as a Contact Review row, bypassing the durable
 * research suppression. This is the deliberate "research again" path: a customer
 * who has been researched-not-found is dropped from buildContactReview, so the
 * routine list cannot reach them, but an employee can still choose to re-check
 * them. The customer must belong to the project (membership = project_customers)
 * and not be a test record. Returns null when they are not a project member, do
 * not exist, or already have both methods (nothing to review). Does not consult
 * the research record at all — the whole point is to reopen regardless of it.
 */
export async function loadContactReviewCustomer(
  supabase: SupabaseClient,
  projectId: string,
  customerId: string,
): Promise<ContactReviewCustomer | null> {
  const { data: member } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!member) return null

  const { data: c } = await supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('id', customerId)
    .maybeSingle()
  if (!c || (c as unknown as CustomerRow).is_test) return null

  const row = c as unknown as CustomerRow
  // Effective usability (folds recorded-unusable channels, value-scoped to the
  // current values), the same basis the routine list uses, so a reopened
  // customer classifies identically.
  const unusable = (await readUnusableChannelsByCustomer(
    supabase,
    [row.id],
    new Map([[row.id, { email: row.email, phone: row.phone }]]),
  )).get(row.id) ?? new Set<OutreachChannel>()
  const hasEmail = emailUsable(row.email, unusable)
  const hasPhone = phoneUsable(row.phone, unusable)
  const hasAddress = addressUsable(row)
  // Every method usable: there is nothing to review or research.
  if (hasEmail && hasPhone && hasAddress) return null

  const policyByCustomer = await loadOnePolicyNumberPerCustomer(supabase, [row.id])

  // A deliberately-reopened customer: report the same status the active list
  // would, read from the durable research record, so the task screen can label a
  // No Usable Contact Information exception consistently. This path bypasses the
  // active-list suppression (that is its purpose), but the status itself is the
  // honest current classification.
  const researched = (await readResearchedUnsuccessfullyBatch(supabase, [row.id])).get(row.id)
    ?? { email: false, phone: false, address: false }
  const stillRecommend = stillNeedsResearchRecommendation({ hasEmail, hasPhone, hasAddress }, researched)
  const noUsableContact = !hasEmail && !hasPhone

  return {
    customer_id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    date_of_birth: row.date_of_birth,
    email: row.email,
    phone: row.phone,
    has_email: hasEmail,
    has_phone: hasPhone,
    has_address: hasAddress,
    street: row.street,
    address_line1: row.address_line1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    email_verified_at: row.email_verified_at,
    phone_verified_at: row.phone_verified_at,
    address_verified_at: row.address_verified_at,
    email_availability: row.email_availability,
    contact_alert: row.contact_alert,
    sms_opt_out: row.sms_opt_out === true,
    // Value-scoped text delivery failure for the number on file (onboarding or
    // card-recorded), already resolved against the current phone.
    text_undeliverable: unusable.has('text'),
    policy_number: policyByCustomer.get(row.id) ?? null,
    status: !stillRecommend && noUsableContact ? 'no_usable_contact' : 'needs_research',
    researched_unsuccessfully: !stillRecommend,
  }
}

/**
 * The deliberate "research again" entry point for a customer, if one applies.
 *
 * Returns the id of an active 1035 project the customer belongs to WHEN the
 * customer is currently settled by research — missing a usable email or phone
 * AND every still-missing method already researched unsuccessfully — i.e.
 * exactly the state in which they have been dropped from the routine Contact
 * Review list. In that state the customer page offers a direct link back into
 * that project's Contact Review task (?customer_id=) so an employee can choose
 * to look again. Returns null when the customer is not in such a project, has no
 * missing method, or still has an outstanding (never-researched) method (they
 * are already in the routine list and need no special reopen).
 */
export async function researchAgainProjectId(
  supabase: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data: c } = await supabase
    .from('customers')
    .select('email, phone, street, address_line1, city, state, zip, email_availability, is_test')
    .eq('id', customerId)
    .maybeSingle()
  if (!c || (c as CustomerRow).is_test) return null
  // Effective usability (folds recorded-unusable channels, value-scoped to the
  // current values), the same basis the Contact Research list uses.
  const cRow = c as CustomerRow
  const unusable = (await readUnusableChannelsByCustomer(
    supabase,
    [customerId],
    new Map([[customerId, { email: cRow.email, phone: cRow.phone }]]),
  )).get(customerId) ?? new Set<OutreachChannel>()
  const hasEmail = emailUsable(cRow.email, unusable)
  const hasPhone = phoneUsable(cRow.phone, unusable)
  const hasAddress = addressUsable(cRow)
  if (hasEmail && hasPhone && hasAddress) return null // nothing missing

  // Only when the customer is settled by research (dropped from the active list)
  // does a special reopen link apply; an outstanding method keeps them in the
  // list. The durable email-availability fact settles the email method the same
  // way recorded research does ('no_address' / 'refused'; not 'undeliverable').
  const recordedResearch = await readResearchedUnsuccessfullyBatch(supabase, [customerId])
  const research = recordedResearch.get(customerId) ?? { email: false, phone: false, address: false }
  if (stillNeedsResearchRecommendation({ hasEmail, hasPhone, hasAddress }, research)) return null

  return activeContactResearchProjectForCustomer(supabase, customerId)
}

/**
 * The active 1035 (review-preparation) project a customer belongs to, if any —
 * the project whose Contact Research task owns this customer. Resolved from the
 * project_workflows wiring (the review_preparation workflow), with a fallback to
 * the project-type name when the workflow tables are absent (pre-migration),
 * mirroring how My Work and the Contact Research page gate. Returns the FIRST
 * active match; a customer is normally in exactly one active 1035 project.
 *
 * Used to route the shared Stewardship "Research Needed" task to the SAME
 * consolidated Contact Research screen, so there is one contact-finding surface
 * rather than a separate board correction screen.
 */
export async function activeContactResearchProjectForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data: memberships } = await supabase
    .from('project_customers')
    .select('project_id')
    .eq('customer_id', customerId)
  const projectIds = Array.from(
    new Set(((memberships ?? []) as { project_id: string }[]).map(m => m.project_id)),
  )
  if (projectIds.length === 0) return null

  // Prefer the workflow wiring: an active project containing review_preparation.
  const wfProjects = await activeProjectsWithWorkflow(supabase, 'review_preparation')
  if (wfProjects !== null) {
    const wfIds = new Set(wfProjects.map((p) => p.id))
    const match = projectIds.find((pid) => wfIds.has(pid))
    if (match) return match
    // Workflow tables present but the customer's projects are not wired for
    // review_preparation: fall through to the type-name check below as a safety
    // net (a 1035 project may predate its wiring).
  }

  // Fallback / safety net: an active Permanent Policy Review project (the type
  // formerly named "1035 Exchange"; the test still matches that legacy name).
  const { data: projects } = await supabase
    .from('projects')
    .select('id, status, project_types ( name )')
    .in('id', projectIds)
  for (const p of (projects ?? []) as { id: string; status: string | null; project_types: { name: string } | { name: string }[] | null }[]) {
    const typeRaw = p.project_types
    const typeName = (Array.isArray(typeRaw) ? typeRaw[0]?.name : typeRaw?.name) ?? ''
    if (p.status !== 'archived' && isPermanentPolicyReviewTypeName(typeName)) return p.id
  }
  return null
}

export function summarizeContactReview(
  rows: ContactReviewCustomer[],
): ContactReviewSummary {
  let missingBoth = 0
  let oneUsable = 0
  let needsResearch = 0
  let noUsableContact = 0
  let actionable = 0
  for (const r of rows) {
    const count = (r.has_email ? 1 : 0) + (r.has_phone ? 1 : 0)
    if (count === 0) missingBoth++
    else if (count === 1) oneUsable++
    if (r.status === 'no_usable_contact') noUsableContact++
    else needsResearch++
    // Outstanding ("not yet researched") work: a customer whose research is not
    // yet exhausted. This is the OUTSTANDING figure that drives the
    // recommendation band and the "not yet researched" breakdown. The FULL
    // incomplete population is carried separately as `total` (and surfaced to My
    // Work as unresolvedCount), so every incomplete customer still counts as
    // available work; `total - actionable` is the previously-researched-
    // unsuccessfully subset, read from actual customer history.
    if (!r.researched_unsuccessfully) actionable++
  }
  return {
    total: rows.length,
    missing_both: missingBoth,
    one_usable: oneUsable,
    needs_research: needsResearch,
    no_usable_contact: noUsableContact,
    actionable,
  }
}
