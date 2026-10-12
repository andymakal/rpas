import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Contact Review — project-scoped read model.
 *
 * The Cassidy import left many customers with incomplete contact information.
 * Contact Review is a fast look-up-and-complete pass over a project's
 * population: it lists every project customer who is missing EITHER a usable
 * email OR a usable phone (including customers who already have one usable
 * method), each customer once regardless of how many policies they hold.
 *
 * This read is deliberately thin. It does NOT touch stewardship_outreach,
 * customer_prereviews, or any workflow status — contact facts live only on the
 * customers row, and that is the single thing this workflow reads and (via its
 * sibling write route) corrects. Membership is exactly project_customers, the
 * same Step 1 population every other project surface reads; nothing here is
 * hardcoded.
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
}

export interface ContactReviewSummary {
  /** Project members (non-test) missing email or phone — the list length. */
  total: number
  /** Of the list, how many are missing both methods (nothing usable). */
  missing_both: number
  /** Of the list, how many already have exactly one usable method. */
  one_usable: number
}

type ProjectCustomerRow = { customer_id: string }
type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  is_test: boolean
}

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
      .select('id, first_name, last_name, email, phone, is_test')
      .in('id', chunk)
    customers.push(...((data ?? []) as CustomerRow[]))
  })

  const out: ContactReviewCustomer[] = []
  for (const c of customers) {
    if (c.is_test) continue
    const hasEmail = usable(c.email)
    const hasPhone = usable(c.phone)
    // The list is exactly those missing EITHER method. A customer with both
    // usable methods has complete contact info and is not reviewed here.
    if (hasEmail && hasPhone) continue
    out.push({
      customer_id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      has_email: hasEmail,
      has_phone: hasPhone,
    })
  }

  out.sort((a, b) => {
    const al = (a.last_name ?? '').toLowerCase()
    const bl = (b.last_name ?? '').toLowerCase()
    if (al !== bl) return al < bl ? -1 : 1
    const af = (a.first_name ?? '').toLowerCase()
    const bf = (b.first_name ?? '').toLowerCase()
    return af < bf ? -1 : af > bf ? 1 : 0
  })

  return out
}

export function summarizeContactReview(
  rows: ContactReviewCustomer[],
): ContactReviewSummary {
  let missingBoth = 0
  let oneUsable = 0
  for (const r of rows) {
    const count = (r.has_email ? 1 : 0) + (r.has_phone ? 1 : 0)
    if (count === 0) missingBoth++
    else if (count === 1) oneUsable++
  }
  return { total: rows.length, missing_both: missingBoth, one_usable: oneUsable }
}
