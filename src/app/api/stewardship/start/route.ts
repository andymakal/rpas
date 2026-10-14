import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import { ensureOnboardingForCustomers } from '@/lib/stewardship/ensure-onboarding'

/**
 * POST /api/stewardship/start
 *
 * Explicitly create Servicing-Agent Onboarding records for a selected cohort.
 *
 * This is an OPERATOR-INITIATED action, not a prerequisite for onboarding to be
 * evaluated: a project member who needs access is already actionable from the
 * facts (membership + policy servicing-access), with no record required and no
 * record created on read. This route exists for the cases where an operator
 * wants to create the durable outreach records up front for a cohort — an
 * agency book, a project population, or a single customer. It is idempotent
 * (ensureOnboardingForCustomers): it never duplicates an existing open
 * onboarding record and preserves any existing outreach history.
 *
 * Body (exactly one of agency_id / project_id / customer_id):
 *   { agency_id: string, customer_ids?: string[] }
 *     Start the agency book (optionally a subset). source_agency_id records the
 *     origin; request-policy membership is the customer's known policies within
 *     that agency book.
 *   { project_id: string }
 *     Start the project population (project_customers). Request-policy
 *     membership is every known non-test policy the customer holds.
 *   { customer_id: string }
 *     Start one customer. Same creation flow scoped to a single customer.
 *
 * Request-policy membership captures EVERY known non-test policy of the
 * customer (permanent AND term); the permanent-vs-term distinction gates only
 * downstream 1035 evaluation, never which policies we pursue servicing access
 * for. A customer with no known policy is not started.
 *
 * Returns { data: { started, skipped, skipped_no_cohort_policy } }.
 */
export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: { agency_id?: string; project_id?: string; customer_id?: string; customer_ids?: string[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const agencyId = body.agency_id?.trim()
  const projectId = body.project_id?.trim()
  const customerId = body.customer_id?.trim()

  const scopes = [agencyId, projectId, customerId].filter(Boolean)
  if (scopes.length > 1) {
    return Response.json({ error: 'Provide exactly one of agency_id, project_id, or customer_id' }, { status: 400 })
  }
  if (scopes.length === 0) {
    return Response.json({ error: 'agency_id, project_id, or customer_id is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Resolve the target customers (candidates for the shared ensure helper).
  // source_agency_id is only the ORIGIN STAMP on the pre-review; it does not
  // define request-policy membership.
  type Candidate = { id: string; email: string | null; phone: string | null; source_agency_id: string | null }
  let candidates: Candidate[]
  // Only the agency-book path narrows captured policies to that agency; the
  // project and single-customer paths capture every known policy.
  let policyFilterAgencyId: string | null = null

  if (customerId) {
    const { data: cust, error: custErr } = await supabase
      .from('customers')
      .select('id, email, phone, agency_id')
      .eq('id', customerId)
      .eq('is_test', false)
      .maybeSingle()
    if (custErr) {
      console.error('stewardship start: single-customer query error', custErr)
      return Response.json({ error: custErr.message }, { status: 500 })
    }
    if (!cust) {
      return Response.json({ error: 'Customer not found' }, { status: 404 })
    }
    const c = cust as { id: string; email: string | null; phone: string | null; agency_id: string | null }
    candidates = [{ id: c.id, email: c.email, phone: c.phone, source_agency_id: c.agency_id }]
  } else if (projectId) {
    // Archived projects are read-only: an archived project cannot launch new
    // onboarding work. Gates ONLY the project-scoped start.
    const active = await assertProjectActive(supabase, projectId)
    if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

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
      .select('id, email, phone, agency_id')
      .in('id', memberIds)
      .eq('is_test', false)
    if (custErr) {
      console.error('stewardship start: customer query error', custErr)
      return Response.json({ error: custErr.message }, { status: 500 })
    }
    candidates = ((custs ?? []) as { id: string; email: string | null; phone: string | null; agency_id: string | null }[]).map((c) => ({
      id: c.id, email: c.email, phone: c.phone, source_agency_id: c.agency_id,
    }))
  } else {
    policyFilterAgencyId = agencyId as string
    let custQuery = supabase
      .from('customers')
      .select('id, email, phone')
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
    candidates = ((customers ?? []) as { id: string; email: string | null; phone: string | null }[]).map((c) => ({
      id: c.id, email: c.email, phone: c.phone, source_agency_id: agencyId as string,
    }))
  }

  if (!candidates.length) {
    return Response.json({ data: { started: 0, skipped: 0, skipped_no_cohort_policy: 0 } })
  }

  const res = await ensureOnboardingForCustomers(supabase, candidates, { policyFilterAgencyId })

  return Response.json(
    { data: { started: res.started, skipped: res.skipped, skipped_no_cohort_policy: res.skippedNoPolicy } },
    { status: 201 },
  )
}
