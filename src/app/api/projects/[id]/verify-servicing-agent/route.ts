import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { isEverlakeCarrier } from '@/lib/policies/everlake-carrier'

/**
 * Step 1 of servicing-agent capture — VERIFY whether we are the servicing agent,
 * per policy, in the Everlake Agent Portal.
 *
 * GET  /api/projects/[id]/verify-servicing-agent
 *   The project's Everlake-eligible policy worklist: every non-test policy of a
 *   project customer whose carrier is verified in Everlake (see
 *   isEverlakeCarrier). Each row carries the status so the client can show
 *   what is still to check vs already checked. Non-Everlake carriers are never
 *   returned (they are not looked up in Everlake). Read-only.
 *
 * PATCH /api/projects/[id]/verify-servicing-agent  { policy_id, is_servicing_agent }
 *   Record the Everlake result for ONE policy:
 *     is_servicing_agent === true  -> sa_status 'confirmed'  (we are the SA)
 *     is_servicing_agent === false -> sa_status 'not_on_file' (verified not SA)
 *   Per policy only; never touches any other policy. No schema beyond the
 *   existing sa_status value (the status IS the record — no who/when fact). The
 *   policy must belong to a customer in this project AND be an Everlake carrier,
 *   so an operator can never flip a non-eligible policy through this surface.
 */

type WorklistPolicy = {
  id: string
  policy_number: string | null
  carrier: string | null
  product_type: string | null
  coverage_status: string | null
  insured_name: string | null
  customer_id: string
  customer_name: string | null
  sa_status: string
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  // The project's customers.
  const { data: members, error: memErr } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', id)
  if (memErr) {
    return Response.json({ error: memErr.message }, { status: 500 })
  }
  const customerIds = Array.from(
    new Set((members ?? []).map((m: { customer_id: string }) => m.customer_id).filter(Boolean)),
  )
  if (customerIds.length === 0) {
    return Response.json({ data: { policies: [], summary: { total: 0, verified: 0, remaining: 0 } } })
  }

  // Their non-test policies, plus the customer name for context. Join the
  // customer so each policy shows whose it is.
  const { data: rows, error: polErr } = await supabase
    .from('service_policies')
    .select('id, policy_number, carrier, product_type, coverage_status, insured_first_name, insured_last_name, sa_status, customer_id, customers!customer_id ( first_name, last_name )')
    .in('customer_id', customerIds)
    .eq('is_test', false)
  if (polErr) {
    return Response.json({ error: polErr.message }, { status: 500 })
  }

  // Everlake-eligible carriers only. A non-Everlake policy is never verified
  // here, so it is filtered out of the worklist entirely.
  const policies: WorklistPolicy[] = ((rows ?? []) as Record<string, unknown>[])
    .filter((p) => isEverlakeCarrier(p.carrier as string | null))
    .map((p) => {
      const cust = (Array.isArray(p.customers) ? p.customers[0] : p.customers) as
        | { first_name: string | null; last_name: string | null }
        | null
      const customerName = cust
        ? [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() || null
        : null
      const insuredName =
        [p.insured_first_name, p.insured_last_name].filter(Boolean).join(' ').trim() || null
      return {
        id: p.id as string,
        policy_number: (p.policy_number as string | null) ?? null,
        carrier: (p.carrier as string | null) ?? null,
        product_type: (p.product_type as string | null) ?? null,
        coverage_status: (p.coverage_status as string | null) ?? null,
        insured_name: insuredName,
        customer_id: p.customer_id as string,
        customer_name: customerName,
        sa_status: (p.sa_status as string | null) ?? 'unknown',
      }
    })
    // Stable order: unchecked first (the work), then by customer name, then
    // policy number, so the operator moves through the remaining items in a
    // predictable sequence and already-checked items settle to the end.
    .sort((a, b) => {
      const aUnknown = a.sa_status === 'unknown' ? 0 : 1
      const bUnknown = b.sa_status === 'unknown' ? 0 : 1
      if (aUnknown !== bUnknown) return aUnknown - bUnknown
      const an = (a.customer_name ?? '').toLowerCase()
      const bn = (b.customer_name ?? '').toLowerCase()
      if (an !== bn) return an < bn ? -1 : 1
      return (a.policy_number ?? '').localeCompare(b.policy_number ?? '')
    })

  const verified = policies.filter((p) => p.sa_status !== 'unknown').length
  const summary = {
    total: policies.length,
    verified,
    remaining: policies.length - verified,
  }

  return Response.json({ data: { policies, summary } })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  let body: { policy_id?: string; is_servicing_agent?: boolean }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const policyId = typeof body.policy_id === 'string' ? body.policy_id.trim() : ''
  if (!policyId) {
    return Response.json({ error: 'policy_id is required' }, { status: 400 })
  }
  if (typeof body.is_servicing_agent !== 'boolean') {
    return Response.json({ error: 'is_servicing_agent (true/false) is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // The policy must belong to a customer IN this project, and its carrier must
  // be Everlake-eligible. Both guards prevent flipping a policy that should
  // never be verified through this surface.
  const { data: policy, error: readErr } = await supabase
    .from('service_policies')
    .select('id, carrier, customer_id')
    .eq('id', policyId)
    .eq('is_test', false)
    .maybeSingle()
  if (readErr) {
    return Response.json({ error: readErr.message }, { status: 500 })
  }
  if (!policy) {
    return Response.json({ error: 'Policy not found' }, { status: 404 })
  }

  // Confirm project membership explicitly (the embedded join above is not a
  // reliable filter across the FK, so verify the customer is in this project).
  const { data: membership } = await supabase
    .from('project_customers')
    .select('id')
    .eq('project_id', id)
    .eq('customer_id', (policy as { customer_id: string }).customer_id)
    .maybeSingle()
  if (!membership) {
    return Response.json({ error: 'That policy is not part of this project.' }, { status: 409 })
  }

  if (!isEverlakeCarrier((policy as { carrier: string | null }).carrier)) {
    return Response.json(
      { error: 'That policy is not an Everlake carrier, so it is not verified here.' },
      { status: 409 },
    )
  }

  const nextStatus = body.is_servicing_agent ? 'confirmed' : 'not_on_file'
  const { error: updErr } = await supabase
    .from('service_policies')
    .update({ sa_status: nextStatus })
    .eq('id', policyId)
  if (updErr) {
    return Response.json({ error: updErr.message }, { status: 500 })
  }

  return Response.json({ data: { policy_id: policyId, sa_status: nextStatus } })
}
