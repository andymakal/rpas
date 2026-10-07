import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { initialQueue } from '@/lib/stewardship/queues'

/**
 * POST /api/stewardship/start
 *
 * Start capture / stewardship work for customers in a selected agency book.
 * No campaign table: the agency/book selection drives which customers get a
 * work item, and source_agency_id on customer_prereviews records where the
 * work originated.
 *
 * Body:
 *   { agency_id: string, customer_ids?: string[] }
 *   - agency_id (required): the book to start capture for.
 *   - customer_ids (optional): a subset to start; when omitted, every customer
 *     in the agency that does not already have an OPEN pre-review is started.
 *
 * For each selected customer this creates (idempotently):
 *   - a customer_prereviews row (decision null = open), if none open exists
 *   - a stewardship_outreach row with the initial queue derived from the
 *     customer's contact info (trust-but-verify)
 *   - a stewardship_outreach_policies row for each permanent / cash-value
 *     service_policy the customer holds (these are the request policies; term /
 *     non-cash-value policies remain context and are not added to the request).
 *
 * Returns { data: { started: number, skipped: number } }.
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

/** A permanent policy with any cash value is in the request; so is any permanent policy. */
function inRequest(p: { product_type: string | null; cash_value_amount: number | null }): boolean {
  return isPermanent(p.product_type)
}

export async function POST(request: NextRequest) {
  // Auth: internal staff only.
  const sessionClient = await createClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
    return Response.json({ data: { started: 0, skipped: 0 } })
  }

  const customerIds = customers.map(c => c.id)

  // Which of these already have an OPEN pre-review? Skip those (one open per customer).
  const { data: openPrereviews } = await supabase
    .from('customer_prereviews')
    .select('customer_id')
    .in('customer_id', customerIds)
    .is('decision', null)
  const alreadyOpen = new Set((openPrereviews ?? []).map((r: { customer_id: string }) => r.customer_id))

  // Preload each customer's service_policies to seed the request-policy set.
  const { data: policies } = await supabase
    .from('service_policies')
    .select('id, customer_id, product_type, cash_value_amount')
    .in('customer_id', customerIds)
    .eq('is_test', false)
  const policiesByCustomer = new Map<string, { id: string; product_type: string | null; cash_value_amount: number | null }[]>()
  for (const p of (policies ?? []) as { id: string; customer_id: string; product_type: string | null; cash_value_amount: number | null }[]) {
    const list = policiesByCustomer.get(p.customer_id) ?? []
    list.push(p)
    policiesByCustomer.set(p.customer_id, list)
  }

  let started = 0
  let skipped = 0

  for (const c of customers) {
    if (alreadyOpen.has(c.id)) { skipped++; continue }

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
      skipped++
      continue
    }

    // 3. Seed the request-policy set with the customer's permanent policies.
    const custPolicies = policiesByCustomer.get(c.id) ?? []
    const requestPolicies = custPolicies.filter(inRequest)
    if (requestPolicies.length > 0) {
      await supabase
        .from('stewardship_outreach_policies')
        .insert(requestPolicies.map(p => ({ outreach_id: outreach.id, policy_id: p.id })))
    }

    started++
  }

  return Response.json({ data: { started, skipped } }, { status: 201 })
}
