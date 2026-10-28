import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/cases/[id]/resubmit
// Creates a new case at a new carrier, linking both cases to each other.
// The original case must be in a lost/withdrawn state.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: original, error: fetchErr } = await supabase
    .from('cases')
    .select(`
      id, customer_id, agency_id, agent_id, producer_id, lead_source,
      face_amount, annual_premium, product_id, rate_class_id, premium_mode_id,
      is_1035, exchange_carrier, exchange_policy_number, exchange_product_type,
      exchange_cash_value, exchange_cost_basis, exchange_surrender_charges, exchange_net_transfer,
      replaced_by_case_id,
      stage_translations ( is_lost )
    `)
    .eq('id', id)
    .single()

  if (fetchErr || !original) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const orig = original as typeof original & {
    stage_translations: { is_lost: boolean } | null
    replaced_by_case_id: string | null
  }

  if (!orig.stage_translations?.is_lost) {
    return NextResponse.json({ error: 'Only lost/withdrawn cases can be resubmitted' }, { status: 422 })
  }

  if (orig.replaced_by_case_id) {
    return NextResponse.json({ error: 'Case has already been resubmitted', existing_case_id: orig.replaced_by_case_id }, { status: 409 })
  }

  // Determine initial status — use the earliest active stage
  const { data: firstStage } = await supabase
    .from('stage_translations')
    .select('internal_status')
    .eq('is_active_case', true)
    .order('tier')
    .order('stage_order')
    .limit(1)
    .single()

  if (!firstStage) {
    return NextResponse.json({ error: 'No active stage found' }, { status: 500 })
  }

  // Create the replacement case — copy key fields, clear carrier/product
  const { data: newCase, error: insertErr } = await supabase
    .from('cases')
    .insert({
      customer_id:      orig.customer_id,
      agency_id:        orig.agency_id,
      agent_id:         orig.agent_id,
      producer_id:      orig.producer_id,
      lead_source:      orig.lead_source,
      face_amount:      orig.face_amount,
      annual_premium:   orig.annual_premium,
      internal_status:  firstStage.internal_status,
      is_test:          false,
      replaces_case_id: id,
      // Copy 1035 exchange info if applicable
      is_1035:                     orig.is_1035,
      exchange_carrier:            orig.exchange_carrier,
      exchange_policy_number:      orig.exchange_policy_number,
      exchange_product_type:       orig.exchange_product_type,
      exchange_cash_value:         orig.exchange_cash_value,
      exchange_cost_basis:         orig.exchange_cost_basis,
      exchange_surrender_charges:  orig.exchange_surrender_charges,
      exchange_net_transfer:       orig.exchange_net_transfer,
    })
    .select('id')
    .single()

  if (insertErr || !newCase) {
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to create case' }, { status: 500 })
  }

  // Link the original case forward to the new one
  const { error: updateErr } = await supabase
    .from('cases')
    .update({ replaced_by_case_id: newCase.id })
    .eq('id', id)

  if (updateErr) {
    // Best-effort cleanup — delete the new case we just created
    await supabase.from('cases').delete().eq('id', newCase.id)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ data: { new_case_id: newCase.id } }, { status: 201 })
}
