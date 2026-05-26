import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/cases/[id]/missed-appointment
 *
 * Logs a no-show at the scheduled appointment time and sends the case back
 * to the triage queue so someone can re-work it from scratch.
 *
 * Actions (atomic as possible):
 *   1. Logs a `missed_appointment` touch in case_touches
 *   2. Moves internal_status: appointment_set → triage
 *   3. Clears appointment_date
 *   4. Increments touches count, sets last_contact_at
 *   5. Logs transition in case_status_history
 *
 * Only valid when the case is currently in `appointment_set`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { notes?: string } = {}
  try { body = await request.json() } catch { /* no body is fine */ }

  // Verify case exists and is in the right status
  const { data: current, error: fetchErr } = await supabase
    .from('cases')
    .select('id, internal_status, touches')
    .eq('id', id)
    .eq('is_test', false)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  if (current.internal_status !== 'appointment_set') {
    return NextResponse.json(
      { error: `Case is in '${current.internal_status}', not 'appointment_set'` },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()

  const [caseResult, touchResult] = await Promise.all([
    supabase
      .from('cases')
      .update({
        internal_status:   'triage',
        appointment_date:  null,
        touches:           (current.touches ?? 0) + 1,
        last_contact_at:   now,
        status_entered_at: now,
        updated_at:        now,
      })
      .eq('id', id)
      .select('id, internal_status, touches, last_contact_at')
      .single(),

    supabase
      .from('case_touches')
      .insert({
        case_id:    id,
        touch_type: 'missed_appointment',
        notes:      body.notes?.trim() || null,
        touched_at: now,
      })
      .select()
      .single(),
  ])

  if (caseResult.error) {
    return NextResponse.json({ error: caseResult.error.message }, { status: 500 })
  }

  // Log the status transition — best effort, don't fail the request if this errors
  await supabase.from('case_status_history').insert({
    case_id:     id,
    from_status: 'appointment_set',
    to_status:   'triage',
    changed_at:  now,
  })

  return NextResponse.json({
    data: {
      touches:         caseResult.data.touches,
      last_contact_at: caseResult.data.last_contact_at,
      touch:           touchResult.data,
    },
  })
}
