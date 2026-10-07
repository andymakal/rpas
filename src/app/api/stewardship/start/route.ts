import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { initialQueue } from '@/lib/stewardship/queues'

/**
 * POST /api/stewardship/start
 *
 * Start capture / stewardship work for the customers in a selected agency book.
 * No campaign table: the agency/book selection is the source cohort, and
 * source_agency_id on customer_prereviews records where the work originated.
 *
 * Body:
 *   { agency_id: string, customer_ids?: string[] }
 *   - agency_id (required): the book to start capture for.
 *   - customer_ids (optional): a subset to start; when omitted, every customer
 *     in the agency that does not already have an OPEN pre-review is considered.
 *
 * Request-policy membership is established from the SOURCE COHORT: the policies
 * that belong to the selected agency book (service_policies.agency_id = the
 * selected agency) AND to the customer. Only those enter the servicing request.
 * Other policies the customer holds outside this book remain visible as
 * relationship context and are NOT added to the request. A customer with no
 * policy in the selected book cohort is NOT started.
 *
 * Returns { data: { started, skipped, skipped_no_cohort_policy } }.
 */

const PERMANENT_PRODUCT_TYPES = new Set(['UL', 'VUL', 'IUL', 'GUL', 'SUL', 'SVUL', 'WL', 'PERM', 'FA', 'MVA'])

function isPermanent(productType: string | null): boolean {
  if (!productType) return false
  const p = productType.toUpperCase().replace(/[\s_-]/g, '')
  if (p === 'TERM' || p.startsWith('TERM')) return false
  if (PERMANENT_PRODUCT_TYPES.has(p)) return true
  if (p.includes('UNIVERSAL') || p.includes('WHOLE') || p.includes('PERMANENT')) return true
  // Unknown non-term product: treat as context, not auto-added to the request.
  return false
}

export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: { agency_id?: string; customer_ids?: string[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const agencyId = body.agency_id?.trim()
  if (!agencyId) {
    return Response.json({ error: 'agency_id is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Resolve the target customers for this agency book.
  let custQuery = supabase
    .from('customers')
    .select('id, first_name, last_name, email, phone')
    .eq('agency_id', agencyId)
    .eq('is_test', false)

  if (body.customer_ids?.length) {
    custQuery = custQuery.in('id', body.customer_ids)
  }

  const { data: customers, error: custErr } = await custQuery
  if (custErr) {
    console.error('stewardship start: customer query error', custErr)
    return Response.json({ error: custErr.message }, { status: 500 })
  }
  if (!customers?.length) {
    return Response.json({ data: { started: 0, skipped: 0, skipped_no_cohort_policy: 0 } })
  }

  const customerIds = customers.map(c => c.id)

  // Which of these already have an OPEN pre-review? Skip those (one open per customer).
  const { data: openPrereviews } = await supabase
    .from('customer_prereviews')
    .select('customer_id')
    .in('customer_id', customerIds)
    .is('decision', null)
  const alreadyOpen = new Set((openPrereviews ?? []).map((r: { customer_id: string }) => r.customer_id))

  // Source cohort: policies that belong to the SELECTED AGENCY BOOK and to these
  // customers. This is the smallest existing book/source evidence that defines
  // which policies are in the servicing request. Policies the customer holds
  // under a different agency are not part of this request.
  const { data: cohortPolicies } = await supabase
    .from('service_policies')
    .select('id, customer_id, product_type')
    .eq('agency_id', agencyId)
    .in('customer_id', customerIds)
    .eq('is_test', false)

  const cohortByCustomer = new Map<string, { id: string; product_type: string | null }[]>()
  for (const p of (cohortPolicies ?? []) as { id: string; customer_id: string; product_type: string | null }[]) {
    const list = cohortByCustomer.get(p.customer_id) ?? []
    list.push(p)
    cohortByCustomer.set(p.customer_id, list)
  }

  let started = 0
  let skipped = 0
  let skippedNoCohortPolicy = 0

  for (const c of customers) {
    if (alreadyOpen.has(c.id)) { skipped++; continue }

    // Request membership = permanent policies in the source cohort for this
    // customer. A customer with no cohort policy is not started at all.
    const cohort = cohortByCustomer.get(c.id) ?? []
    const requestPolicies = cohort.filter(p => isPermanent(p.product_type))
    if (requestPolicies.length === 0) { skippedNoCohortPolicy++; continue }

    // 1. Create the open pre-review work item.
    const { data: pre, error: preErr } = await supabase
      .from('customer_prereviews')
      .insert({ customer_id: c.id, source_agency_id: agencyId })
      .select('id')
      .single()
    if (preErr || !pre) {
      // Unique-violation on the partial index means another open item appeared
      // concurrently; treat as skip rather than failing the whole batch.
      skipped++
      continue
    }

    // 2. Create the outreach row with the derived initial queue.
    // If any required write below fails, compensate by deleting the pre-review
    // we just created (which cascades to the outreach row and its policy links),
    // so a failed start never leaves an orphan open pre-review or a partial
    // outreach item. There is no cross-table transaction available to the client,
    // so compensation is the smallest safe consistency approach here.
    const route = initialQueue({ email: c.email, phone: c.phone })
    const { data: outreach, error: outErr } = await supabase
      .from('stewardship_outreach')
      .insert({
        prereview_id: pre.id,
        queue: route.queue,
        call_reason: route.call_reason,
        research_reason: route.research_reason,
      })
      .select('id')
      .single()
    if (outErr || !outreach) {
      console.error('stewardship start: outreach insert error', outErr)
      await supabase.from('customer_prereviews').delete().eq('id', pre.id)
      skipped++
      continue
    }

    // 3. Record the request-policy set from the source cohort. This is a
    // required part of a started item (an outreach with no request policies is
    // incomplete), so roll back the whole item if it fails.
    const { error: linkErr } = await supabase
      .from('stewardship_outreach_policies')
      .insert(requestPolicies.map(p => ({ outreach_id: outreach.id, policy_id: p.id })))
    if (linkErr) {
      console.error('stewardship start: request-policy insert error', linkErr)
      await supabase.from('customer_prereviews').delete().eq('id', pre.id)
      skipped++
      continue
    }

    started++
  }

  return Response.json(
    { data: { started, skipped, skipped_no_cohort_policy: skippedNoCohortPolicy } },
    { status: 201 },
  )
}
