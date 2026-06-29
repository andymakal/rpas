import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/service-policies/[id]
 *
 * Update policy fields. When sa_status is set to 'confirmed' and the policy has
 * actionable flags, auto-queues a policy review if none is already open.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [
    'client_name', 'policy_number', 'carrier', 'product_type',
    'issue_date', 'term_length', 'face_amount', 'death_benefit_amount',
    'cash_value_amount', 'cash_value_as_of_date', 'cost_basis',
    'annual_premium', 'premium_mode', 'rate_class', 'riders',
    'insured_first_name', 'insured_last_name', 'primary_beneficiary',
    'coverage_status', 'sa_status', 'sa_form_sent_at', 'notes',
    'agency_id', 'agent_id', 'customer_id',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('service_policies')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('service_policy patch error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
