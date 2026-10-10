import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { initialQueue } from '@/lib/stewardship/queues'
import { isPermanent } from '@/lib/policies/product-type'

/**
 * POST /api/stewardship/start
 *
 * Start capture / stewardship work for the customers in a selected agency book.
 * No campaign table: the agency/book selection is the source cohort, and
 * source_agency_id on customer_prereviews records where the work originated.
 *
 * Body (exactly one of agency_id / project_id):
 *   { agency_id: string, customer_ids?: string[] }
 *   - agency_id: the book to start capture for.
 *   - customer_ids (optional): a subset to start; when omitted, every customer
 *     in the agency that does not already have an OPEN pre-review is considered.
 *
 *   { project_id: string }
 *   - project_id: start capture for the project population. The customers are
 *     exactly the project_customers for that project; this does not create a
 *     new workflow, it feeds the same capture flow scoped to the project. The
 *     SOURCE COHORT is the project's own qualifying policies, taken from
 *     project_matches for the project's runs (policy_id not null), NOT the
 *     customer's whole agency book. Only the policies the project matched enter
 *     the servicing request, so a new project's request is never broadened to
 *     unrelated permanent policies that merely share the agency book. Customers
 *     that already have OPEN stewardship work are reused (skipped), never
 *     duplicated.
 *
 * Request-policy membership (agency path) is established from the SOURCE COHORT:
 * the permanent policies that belong to the selected agency book
 * (service_policies.agency_id = that agency) AND to the customer. Only those
 * enter the servicing request. Other policies the customer holds outside this
 * book remain visible as relationship context and are NOT added to the request.
 * A customer with no policy in the source cohort is NOT started.
 *
 * Returns { data: { started, skipped, skipped_no_cohort_policy } }.
 */
// Permanent-vs-term classification is shared with the 1035 project workflow via
// @/lib/policies/product-type so the two always agree.

export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: { agency_id?: string; project_id?: string; customer_ids?: string[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const agencyId = body.agency_id?.trim()
  const projectId = body.project_id?.trim()

  if (agencyId && projectId) {
    return Response.json({ error: 'Provide agency_id or project_id, not both' }, { status: 400 })
  }
  if (!agencyId && !projectId) {
    return Response.json({ error: 'agency_id or project_id is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Resolve the target customers. source_agency_id is only the ORIGIN STAMP on
  // the pre-review (where the work came from); it does NOT define request-policy
  // membership.
  //   - Agency path: every customer stamped with the selected agency.
  //   - Project path: stamped with the customer's own agency when known. Much of
  //     this book-of-business has no agency_id, so it may be null; the column is
  //     nullable and the request cohort comes from project_matches, not the
  //     agency book, so a missing agency does not block or distort the start.
  type Target = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; source_agency_id: string | null }

  let targets: Target[]

  if (projectId) {
    // Membership is exactly the project_customers for this project.
    const { data: members, error: memberErr } = await supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', projectId)
    if (memberErr) {
      console.error('stewardship start: project membership query error', memberErr)
      return Response.json({ error: memberErr.message }, { status: 500 })
    }
    const memberIds = (members ?? []).map((m: { customer_id: string }) => m.customer_id)
    if (!memberIds.length) {
      return Response.json({ data: { started: 0, skipped: 0, skipped_no_cohort_policy: 0 } })
    }

    const { data: custs, error: custErr } = await supabase
      .from('customers')
      .select('id, first_name, last_name, email, phone, agency_id')
      .in('id', memberIds)
      .eq('is_test', false)
    if (custErr) {
      console.error('stewardship start: customer query error', custErr)
      return Response.json({ error: custErr.message }, { status: 500 })
    }
    targets = ((custs ?? []) as (Target & { agency_id: string })[]).map(c => ({
      id: c.id, first_name: c.first_name, last_name: c.last_name,
      email: c.email, phone: c.phone, source_agency_id: c.agency_id,
    }))
  } else {
    let custQuery = supabase
      .from('customers')
      .select('id, first_name, last_name, email, phone')
      .eq('agency_id', agencyId as string)
      .eq('is_test', false)

    if (body.customer_ids?.length) {
      custQuery = custQuery.in('id', body.customer_ids)
    }

    const { data: customers, error: custErr } = await custQuery
    if (custErr) {
      console.error('stewardship start: customer query error', custErr)
      return Response.json({ error: custErr.message }, { status: 500 })
    }
    targets = ((customers ?? []) as Omit<Target, 'source_agency_id'>[]).map(c => ({
      ...c, source_agency_id: agencyId as string,
    }))
  }

  if (!targets.length) {
    return Response.json({ data: { started: 0, skipped: 0, skipped_no_cohort_policy: 0 } })
  }

  const customerIds = targets.map(c => c.id)

  // Which of these already have an OPEN pre-review? Skip those (one open per
  // customer). This is how existing open stewardship work is REUSED rather than
  // duplicated, including work started earlier from the agency book.
  const { data: openPrereviews } = await supabase
    .from('customer_prereviews')
    .select('customer_id')
    .in('customer_id', customerIds)
    .is('decision', null)
  const alreadyOpen = new Set((openPrereviews ?? []).map((r: { customer_id: string }) => r.customer_id))

  // Source cohort: the policies that define each customer's servicing request.
  //   - Project path: the project's OWN qualifying policies, taken from
  //     project_matches for the project's runs (policy_id not null). This is the
  //     evidence the project itself produced, so the request is never broadened
  //     to unrelated permanent policies that merely share the agency book.
  //   - Agency path: the permanent policies in the SELECTED AGENCY BOOK held by
  //     the customer (service_policies.agency_id = that agency).
  // Either way the result is a per-customer list of candidate request policies.
  const cohortByCustomer = new Map<string, { id: string; product_type: string | null }[]>()

  if (projectId) {
    // Resolve the project's runs, then the matched policies for this population.
    const { data: projRuns } = await supabase
      .from('project_runs')
      .select('id')
      .eq('project_id', projectId)
    const runIds = (projRuns ?? []).map((r: { id: string }) => r.id)

    if (runIds.length) {
      const { data: matches } = await supabase
        .from('project_matches')
        .select('customer_id, policy_id')
        .in('run_id', runIds)
        .in('customer_id', customerIds)
        .not('policy_id', 'is', null)

      // Resolve product_type for the matched policies so the permanent-policy
      // filter below still applies uniformly across both paths.
      const matchPolicyIds = Array.from(new Set(
        (matches ?? []).map((m: { policy_id: string | null }) => m.policy_id).filter((p): p is string => !!p),
      ))
      const productTypeById = new Map<string, string | null>()
      if (matchPolicyIds.length) {
        const { data: pols } = await supabase
          .from('service_policies')
          .select('id, product_type')
          .in('id', matchPolicyIds)
        for (const p of (pols ?? []) as { id: string; product_type: string | null }[]) {
          productTypeById.set(p.id, p.product_type)
        }
      }

      // Dedupe per (customer, policy): a policy can match in several runs.
      const seen = new Set<string>()
      for (const m of (matches ?? []) as { customer_id: string; policy_id: string }[]) {
        const key = `${m.customer_id}:${m.policy_id}`
        if (seen.has(key)) continue
        seen.add(key)
        const list = cohortByCustomer.get(m.customer_id) ?? []
        list.push({ id: m.policy_id, product_type: productTypeById.get(m.policy_id) ?? null })
        cohortByCustomer.set(m.customer_id, list)
      }
    }
  } else {
    // Agency book cohort: policies in the selected agency held by the customer.
    const { data: cohortPolicies } = await supabase
      .from('service_policies')
      .select('id, customer_id, product_type')
      .eq('agency_id', agencyId as string)
      .in('customer_id', customerIds)
      .eq('is_test', false)
    for (const p of (cohortPolicies ?? []) as { id: string; customer_id: string; product_type: string | null }[]) {
      const list = cohortByCustomer.get(p.customer_id) ?? []
      list.push({ id: p.id, product_type: p.product_type })
      cohortByCustomer.set(p.customer_id, list)
    }
  }

  let started = 0
  let skipped = 0
  let skippedNoCohortPolicy = 0

  for (const c of targets) {
    if (alreadyOpen.has(c.id)) { skipped++; continue }

    // Request membership = permanent policies in the source cohort for this
    // customer. A customer with no cohort policy is not started at all.
    const cohort = cohortByCustomer.get(c.id) ?? []
    const requestPolicies = cohort.filter(p => isPermanent(p.product_type))
    if (requestPolicies.length === 0) { skippedNoCohortPolicy++; continue }

    // 1. Create the open pre-review work item.
    const { data: pre, error: preErr } = await supabase
      .from('customer_prereviews')
      .insert({ customer_id: c.id, source_agency_id: c.source_agency_id })
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
