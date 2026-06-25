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

  // Auto-advance: only a connected call (not voicemail/text/email) moves a
  // triage case to active_referral. Unanswered attempts stay in triage so
  // Gabe and Dulce can see them in the queue with a touch count.
  const advanceToActive = current.internal_status === 'triage' && touch_type === 'call'

  const caseUpdate: Record<string, unknown> = {
    touches: (current.touches ?? 0) + 1,
    last_contact_at: now,
    updated_at: now,
  }
  if (advanceToActive) {
    caseUpdate.internal_status  = 'active_referral'
    caseUpdate.status_entered_at = now
  }

  const [caseResult, touchResult] = await Promise.all([
    supabase
      .from('cases')
      .update(caseUpdate)
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

  // Log the status transition to history if we auto-advanced
  if (advanceToActive) {
    await supabase.from('case_status_history').insert({
      case_id:     id,
      from_status: 'triage',
      to_status:   'active_referral',
      changed_at:  now,
    })
  }

  return Response.json({
    data: {
      touches:            caseResult.data.touches,
      last_contact_at:    caseResult.data.last_contact_at,
      touch:              touchResult.data,
      advanced_to_active: advanceToActive,
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
