import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/cases/[id]/appointment
 *
 * Sets an appointment on a triage case and transitions it to appointment_set.
 * Body: { appointment_date: string (ISO local datetime e.g. "2024-01-15T14:00") }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { appointment_date?: string } = {}
  try { body = await request.json() } catch {}

  if (!body.appointment_date) {
    return NextResponse.json({ error: 'appointment_date required' }, { status: 400 })
  }

  const { data: current, error: fetchErr } = await supabase
    .from('cases')
    .select('id, internal_status')
    .eq('id', id)
    .eq('is_test', false)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const now = new Date().toISOString()

  const { data: updated, error: updateErr } = await supabase
    .from('cases')
    .update({
      internal_status:   'appointment_set',
      appointment_date:  body.appointment_date,
      status_entered_at: now,
      updated_at:        now,
    })
    .eq('id', id)
    .select('id, internal_status, appointment_date')
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  await supabase.from('case_status_history').insert({
    case_id:     id,
    from_status: current.internal_status,
    to_status:   'appointment_set',
    changed_at:  now,
  })

  return NextResponse.json({ data: updated })
}
