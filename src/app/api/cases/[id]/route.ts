import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const ALLOWED_FIELDS = new Set([
  'internal_status',
  'agency_id',
  'agent_id',
  'product_id',
  'face_amount',
  'annual_premium',
  'rate_class_id',
  'premium_mode_id',
  'policy_number',
  'appointment_date',
  'follow_up_date',
  'placed_at',
  'notes',
  'lost_reason_id',
  'snooze_reason_id',
  'snooze_until',
  'table_rating',
])

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
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) updates[key] = val
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  if (updates.internal_status !== undefined) {
    const { data: stage, error: stageErr } = await supabase
      .from('stage_translations')
      .select('internal_status')
      .eq('internal_status', updates.internal_status)
      .single()

    if (stageErr || !stage) {
      return Response.json({ error: 'Invalid internal_status' }, { status: 400 })
    }

    // Record status history + notification on placed
    const { data: current } = await supabase
      .from('cases')
      .select('internal_status, face_amount, submitted_at, customers(first_name, last_name)')
      .eq('id', id)
      .single()

    if (current && current.internal_status !== updates.internal_status) {
      await supabase.from('case_status_history').insert({
        case_id:     id,
        from_status: current.internal_status,
        to_status:   updates.internal_status as string,
      })
    }

    updates.status_entered_at = new Date().toISOString()

    // Stamp submitted_at the first time a case reaches app_submitted
    if (updates.internal_status === 'app_submitted' && !current?.submitted_at) {
      updates.submitted_at = new Date().toISOString()
    }

    if (updates.internal_status === 'placed' && !updates.placed_at) {
      updates.placed_at = new Date().toISOString()
      const cust = current?.customers as unknown as { first_name: string; last_name: string } | null
      const clientName = cust ? `${cust.first_name} ${cust.last_name}` : 'Unknown'
      const faceAmt = (updates.face_amount ?? current?.face_amount) as number | null
      await supabase.from('notifications').insert({
        type:  'case_placed',
        title: `Policy placed: ${clientName}`,
        body:  faceAmt
          ? `Face amount: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(faceAmt)}`
          : null,
        link:  `/cases/${id}`,
      })
    }
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('cases')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Case update error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
