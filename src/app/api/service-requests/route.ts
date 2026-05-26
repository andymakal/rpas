import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * POST /api/service-requests
 *
 * Creates a service request, optionally creating a new service_policy first.
 *
 * Body variants:
 *   A) Existing policy  — { policy_id, request_type, notes?, date_received? }
 *   B) New policy first — { new_policy: { ... }, request_type, notes?, date_received? }
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: {
    policy_id?:    string
    new_policy?: {
      client_name:           string
      policy_number:         string
      carrier:               string
      product_type?:         string | null
      issue_date?:           string | null
      term_length?:          string | null
      face_amount?:          number | null
      death_benefit_amount?: number | null
      cash_value_amount?:    number | null
      cost_basis?:           number | null
      annual_premium?:       number | null
      premium_mode?:         string | null
      rate_class?:           string | null
      riders?:               string | null
      insured_first_name?:   string | null
      insured_last_name?:    string | null
      primary_beneficiary?:  string | null
      agency_id?:            string | null
      agent_id?:             string | null
      customer_id?:          string | null
      notes?:                string | null
    }
    request_type:   string
    notes?:         string | null
    date_received?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.request_type?.trim()) {
    return Response.json({ error: 'request_type is required' }, { status: 400 })
  }

  let policyId = body.policy_id

  // ── If creating a new policy alongside this SR ──────────────────────────
  if (!policyId) {
    const np = body.new_policy
    if (!np?.client_name?.trim()) {
      return Response.json({ error: 'client_name is required for new policies' }, { status: 400 })
    }
    if (!np?.policy_number?.trim()) {
      return Response.json({ error: 'policy_number is required' }, { status: 400 })
    }
    if (!np?.carrier?.trim()) {
      return Response.json({ error: 'carrier is required' }, { status: 400 })
    }

    // Find-or-create: if a policy with this number already exists, use it
    // rather than inserting a duplicate (policy_number has a unique constraint).
    const { data: existing } = await supabase
      .from('service_policies')
      .select('id')
      .eq('policy_number', np.policy_number.trim())
      .maybeSingle()

    if (existing) {
      // Policy is already in the system — just attach the SR to it.
      policyId = existing.id
    } else {
      const { data: policy, error: pErr } = await supabase
        .from('service_policies')
        .insert({
          client_name:           np.client_name.trim(),
          policy_number:         np.policy_number.trim(),
          carrier:               np.carrier.trim(),
          product_type:          np.product_type          ?? null,
          issue_date:            np.issue_date             ?? null,
          term_length:           np.term_length?.trim()    ?? null,
          face_amount:           np.face_amount            ?? null,
          death_benefit_amount:  np.death_benefit_amount   ?? null,
          cash_value_amount:     np.cash_value_amount      ?? null,
          cost_basis:            np.cost_basis             ?? null,
          annual_premium:        np.annual_premium         ?? null,
          premium_mode:          np.premium_mode           ?? null,
          rate_class:            np.rate_class             ?? null,
          riders:                np.riders                 ?? null,
          insured_first_name:    np.insured_first_name     ?? null,
          insured_last_name:     np.insured_last_name      ?? null,
          primary_beneficiary:   np.primary_beneficiary    ?? null,
          agency_id:             np.agency_id              ?? null,
          agent_id:              np.agent_id               ?? null,
          customer_id:           np.customer_id            ?? null,
          notes:                 np.notes                  ?? null,
          sa_status:             'unknown',
        })
        .select('id')
        .single()

      if (pErr || !policy) {
        console.error('service_policy insert error:', pErr)
        return Response.json({ error: pErr?.message ?? 'Failed to create policy' }, { status: 500 })
      }
      policyId = policy.id
    }
  }

  // ── Generate SR number: SR-YYYY-NNN ──────────────────────────────────────
  const year = new Date().getFullYear()
  const prefix = `SR-${year}-`

  const { data: maxRow } = await supabase
    .from('service_requests')
    .select('sr_number')
    .like('sr_number', `${prefix}%`)
    .order('sr_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let seq = 1
  if (maxRow?.sr_number) {
    const parts = maxRow.sr_number.split('-')
    const last  = parseInt(parts[2] ?? '0', 10)
    if (!isNaN(last)) seq = last + 1
  }
  const srNumber = `${prefix}${String(seq).padStart(3, '0')}`

  // ── Insert the service request ────────────────────────────────────────────
  const { data: sr, error: srErr } = await supabase
    .from('service_requests')
    .insert({
      sr_number:       srNumber,
      policy_id:       policyId,
      request_type:    body.request_type.trim(),
      workflow_status: 'open',
      date_received:   body.date_received ?? new Date().toISOString().split('T')[0],
      notes:           body.notes?.trim() ?? null,
    })
    .select('id, sr_number, policy_id')
    .single()

  if (srErr || !sr) {
    console.error('service_request insert error:', srErr)
    return Response.json({ error: srErr?.message ?? 'Failed to create service request' }, { status: 500 })
  }

  return Response.json({ data: sr }, { status: 201 })
}
