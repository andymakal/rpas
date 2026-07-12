import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const TOUCH_TYPES = new Set(['call', 'voicemail', 'text', 'email'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { touch_type?: string; notes?: string } = {}
  try { body = await request.json() } catch { /* no body is fine */ }

  const touch_type = body.touch_type ?? 'call'
  if (!TOUCH_TYPES.has(touch_type)) {
    return Response.json({ error: 'Invalid touch_type' }, { status: 400 })
  }

  const { data: current, error: fetchErr } = await supabase
    .from('cases')
    .select('touches, internal_status')
    .eq('id', id)
    .single()

  if (fetchErr || !current) {
    return Response.json({ error: 'Case not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const followUpDate = new Date()
  followUpDate.setDate(followUpDate.getDate() + 2)
  const follow_up_date = followUpDate.toISOString().slice(0, 10)

  // Touches only increment the counter and record last contact — they never
  // change internal_status. Status transitions are deliberate actions only
  // (Live Transfer, Appointment Set, Not Interested, etc.).
  const [caseResult, touchResult] = await Promise.all([
    supabase
      .from('cases')
      .update({
        touches:         (current.touches ?? 0) + 1,
        last_contact_at: now,
        follow_up_date,
        updated_at:      now,
      })
      .eq('id', id)
      .select('touches, last_contact_at, internal_status')
      .single(),
    supabase
      .from('case_touches')
      .insert({
        case_id:    id,
        touch_type,
        notes:      body.notes?.trim() || null,
        touched_at: now,
      })
      .select()
      .single(),
  ])

  if (caseResult.error) {
    return Response.json({ error: caseResult.error.message }, { status: 500 })
  }

  return Response.json({
    data: {
      touches:            caseResult.data.touches,
      last_contact_at:    caseResult.data.last_contact_at,
      touch:              touchResult.data,
      advanced_to_active: false,
    },
  })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('case_touches')
    .select('id, touch_type, notes, touched_at')
    .eq('case_id', id)
    .order('touched_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
