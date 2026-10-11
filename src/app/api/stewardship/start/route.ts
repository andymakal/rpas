import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import { initialQueue } from '@/lib/stewardship/queues'

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
 *     new workflow, it feeds the same capture flow scoped to the project.
 *
 * Request-policy membership — capture EVERY known policy of the customer.
 * A servicing-agent authorization is pursued for every policy Right Path knows
 * the customer holds: permanent AND term, including policies that did not meet
 * the project's original selection criteria. The project identifies WHICH
 * customers to work; it must not artificially narrow WHICH of their policies we
 * capture. Each captured policy carries its own sa_status, so confirmed access
 * is distinguished from access still to be established per policy. The
 * permanent-vs-term distinction does NOT gate capture here — it only governs
 * 1035 evaluation blocking downstream (missing access on a permanent policy
 * blocks evaluation; a term policy does not block, yet we still pursue its
 * access). A customer with no known policy at all is NOT started.
 *
 *   - Project path: every known non-test policy the customer holds.
 *   - Agency path: every known non-test policy the customer holds in the
 *     selected agency book (service_policies.agency_id = that agency), the book
 *     being the origin of the work.
 *
 * Returns { data: { started, skipped, skipped_no_cohort_policy } }.
 */
// Permanent-vs-term no longer filters capture here: every known policy is
// captured for servicing. The distinction lives in the 1035 read model, which
// gates evaluation on permanent policies only.

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
    // Archived projects are read-only: an archived project cannot launch new
    // stewardship work. This gates ONLY the project-scoped start. It does not
    // restrict the shared servicing records themselves, the agency-book start
    // path below, or starting these same customers from any other project —
    // normal relationship and policy operations continue independently.
    const active = await assertProjectActive(supabase, projectId)
    if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

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

  // Source cohort: EVERY known non-test policy the customer holds. We capture
  // all of them for servicing-agent authorization — term and permanent alike,
  // including policies outside the project's original selection criteria.
  //   - Project path: all of the customer's known policies (no project_matches
  //     narrowing — the project chose the customers, not the policy subset).
  //   - Agency path: the customer's known policies within the selected agency
  //     book (service_policies.agency_id = that agency), the book being the
  //     origin of the work.
  const cohortByCustomer = new Map<string, { id: string; product_type: string | null }[]>()

  {
    let cohortQuery = supabase
      .from('service_policies')
      .select('id, customer_id, product_type')
      .in('customer_id', customerIds)
      .eq('is_test', false)
    // The agency path keeps the book boundary (where the work originated); the
    // project path takes every known policy of the customer.
    if (!projectId) {
      cohortQuery = cohortQuery.eq('agency_id', agencyId as string)
    }
    const { data: cohortPolicies } = await cohortQuery
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

    // Request membership = EVERY known policy in the source cohort for this
    // customer (term and permanent). A customer with no known policy at all is
    // not started. isPermanent is used only to describe the request, not to
    // filter it.
    const cohort = cohortByCustomer.get(c.id) ?? []
    const requestPolicies = cohort
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
