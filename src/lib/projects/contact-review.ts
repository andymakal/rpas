import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readResearchedUnsuccessfullyBatch,
  stillNeedsResearchRecommendation,
} from '@/lib/stewardship/research-record'

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
  /** Current stored contact facts, shown so the worker can see what exists. */
  email: string | null
  phone: string | null
  has_email: boolean
  has_phone: boolean
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
  /** Any one policy number already on file for this customer, shown so the
   * worker can search Gateway by last name + policy number. null when the
   * customer has no policy on file. */
  policy_number: string | null
  /**
   * How this customer sits in the consolidated Contact Research list:
   *   - 'needs_research'      Outstanding research: at least one still-missing
   *                           method has NOT yet been researched unsuccessfully.
   *                           Actively recommended.
   *   - 'no_usable_contact'   The exception: no usable contact method at all AND
   *                           every missing method already researched
   *                           unsuccessfully. Kept visible (the agency must see
   *                           who it cannot reach) but NOT re-recommended.
   */
  status: 'needs_research' | 'no_usable_contact'
  /** True when every STILL-MISSING method has a recorded unsuccessful-research
   * outcome. For a 'needs_research' row this is always false; for a
   * 'no_usable_contact' exception row it is always true. Carried explicitly so
   * the UI can label the exception without re-deriving it. */
  researched_unsuccessfully: boolean
}

export interface ContactReviewSummary {
  /** Project members (non-test) surfaced by Contact Research — the list length
   * (actively-recommended rows PLUS visible no-usable-contact exceptions). */
  total: number
  /** Of the list, how many are missing both methods (nothing usable). */
  missing_both: number
  /** Of the list, how many already have exactly one usable method. */
  one_usable: number
  /** Of the list, how many are actively recommended outstanding research. */
  needs_research: number
  /** Of the list, how many are the No Usable Contact Information exception
   * (kept visible after unsuccessful research, not re-recommended). */
  no_usable_contact: number
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
  is_test: boolean
}

/** The columns both loaders read for a Contact Review row. Includes the mailing
 * address and verification timestamps the shared CustomerContactCard needs. */
const CUSTOMER_SELECT =
  'id, first_name, last_name, email, phone, street, address_line1, city, state, zip, ' +
  'email_verified_at, phone_verified_at, address_verified_at, is_test'

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

  // Customers still missing a method, before the durable research suppression.
  const incomplete = customers.filter((c) => !c.is_test && !(usable(c.email) && usable(c.phone)))

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
    const hasEmail = usable(c.email)
    const hasPhone = usable(c.phone)
    const researched = researchedByCustomer.get(c.id) ?? { email: false, phone: false }
    const stillRecommend = stillNeedsResearchRecommendation({ hasEmail, hasPhone }, researched)

    // Settled-by-research customers (no still-missing method is outstanding).
    // The business rule splits them:
    //   - No usable contact at all (missing BOTH): keep VISIBLE as the "No
    //     Usable Contact Information" exception so the agency never loses sight
    //     of who it cannot reach; flag it so it is not re-recommended.
    //   - Missing just ONE method, that method settled: drop from the active
    //     list durably (reachable by the method on file; the deliberate reopen
    //     path via loadContactReviewCustomer still allows a re-check).
    const noUsableContact = !hasEmail && !hasPhone
    if (!stillRecommend && !noUsableContact) continue

    out.push({
      customer_id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      has_email: hasEmail,
      has_phone: hasPhone,
      street: c.street,
      address_line1: c.address_line1,
      city: c.city,
      state: c.state,
      zip: c.zip,
      email_verified_at: c.email_verified_at,
      phone_verified_at: c.phone_verified_at,
      address_verified_at: c.address_verified_at,
      policy_number: policyByCustomer.get(c.id) ?? null,
      status: stillRecommend ? 'needs_research' : 'no_usable_contact',
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
  const hasEmail = usable(row.email)
  const hasPhone = usable(row.phone)
  // Both methods present: there is nothing to review or research.
  if (hasEmail && hasPhone) return null

  const policyByCustomer = await loadOnePolicyNumberPerCustomer(supabase, [row.id])

  // A deliberately-reopened customer: report the same status the active list
  // would, read from the durable research record, so the task screen can label a
  // No Usable Contact Information exception consistently. This path bypasses the
  // active-list suppression (that is its purpose), but the status itself is the
  // honest current classification.
  const researched = (await readResearchedUnsuccessfullyBatch(supabase, [row.id])).get(row.id)
    ?? { email: false, phone: false }
  const stillRecommend = stillNeedsResearchRecommendation({ hasEmail, hasPhone }, researched)
  const noUsableContact = !hasEmail && !hasPhone

  return {
    customer_id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    has_email: hasEmail,
    has_phone: hasPhone,
    street: row.street,
    address_line1: row.address_line1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    email_verified_at: row.email_verified_at,
    phone_verified_at: row.phone_verified_at,
    address_verified_at: row.address_verified_at,
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
    .select('email, phone, is_test')
    .eq('id', customerId)
    .maybeSingle()
  if (!c || (c as CustomerRow).is_test) return null
  const hasEmail = usable((c as CustomerRow).email)
  const hasPhone = usable((c as CustomerRow).phone)
  if (hasEmail && hasPhone) return null // nothing missing

  // Only when the customer is settled by research (dropped from the list) does a
  // special reopen link apply; an outstanding method keeps them in the list.
  const researched = await readResearchedUnsuccessfullyBatch(supabase, [customerId])
  const research = researched.get(customerId) ?? { email: false, phone: false }
  if (stillNeedsResearchRecommendation({ hasEmail, hasPhone }, research)) return null

  // Find an active 1035 project the customer belongs to (Contact Review runs on
  // 1035 projects, gated the same way the Contact Review page is).
  const { data: memberships } = await supabase
    .from('project_customers')
    .select('project_id')
    .eq('customer_id', customerId)
  const projectIds = Array.from(
    new Set(((memberships ?? []) as { project_id: string }[]).map(m => m.project_id)),
  )
  if (projectIds.length === 0) return null

  const { data: projects } = await supabase
    .from('projects')
    .select('id, status, project_types ( name )')
    .in('id', projectIds)
  for (const p of (projects ?? []) as { id: string; status: string | null; project_types: { name: string } | { name: string }[] | null }[]) {
    const typeRaw = p.project_types
    const typeName = (Array.isArray(typeRaw) ? typeRaw[0]?.name : typeRaw?.name) ?? ''
    if (p.status !== 'archived' && /1035/.test(typeName)) return p.id
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
  for (const r of rows) {
    const count = (r.has_email ? 1 : 0) + (r.has_phone ? 1 : 0)
    if (count === 0) missingBoth++
    else if (count === 1) oneUsable++
    if (r.status === 'no_usable_contact') noUsableContact++
    else needsResearch++
  }
  return {
    total: rows.length,
    missing_both: missingBoth,
    one_usable: oneUsable,
    needs_research: needsResearch,
    no_usable_contact: noUsableContact,
  }
}
