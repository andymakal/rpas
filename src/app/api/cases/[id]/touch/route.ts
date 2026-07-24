import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

const TOUCH_TYPES = new Set(['call', 'voicemail', 'text', 'email'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { touch_type?: string; touch_types?: string[]; notes?: string } = {}
  try { body = await request.json() } catch { /* no body is fine */ }

  // Accept either a single touch_type or a batch touch_types array
  const rawTypes = Array.isArray(body.touch_types)
    ? body.touch_types
    : [body.touch_type ?? 'call']
  const touchTypes = rawTypes.filter(t => TOUCH_TYPES.has(t))
  if (touchTypes.length === 0) {
    return Response.json({ error: 'Invalid touch_type' }, { status: 400 })
  }

  // Resolve the current user's display name for the touch log
  let touched_by: string | null = null
  try {
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('staff_profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle()
      touched_by = profile?.display_name ?? user.email?.split('@')[0] ?? null
    }
  } catch { /* non-fatal — touch still logs without attribution */ }

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
  const [caseResult] = await Promise.all([
    supabase
      .from('cases')
      .update({
        touches:         (current.touches ?? 0) + touchTypes.length,
        last_contact_at: now,
        follow_up_date,
        updated_at:      now,
      })
      .eq('id', id)
      .select('touches, last_contact_at, internal_status')
      .single(),
    supabase
      .from('case_touches')
      .insert(
        touchTypes.map(touch_type => ({
          case_id:    id,
          touch_type,
          notes:      touchTypes.length === 1 ? (body.notes?.trim() || null) : null,
          touched_at: now,
          touched_by,
        }))
      ),
  ])

  if (caseResult.error) {
    return Response.json({ error: caseResult.error.message }, { status: 500 })
  }

  return Response.json({
    data: {
      touches:            caseResult.data.touches,
      last_contact_at:    caseResult.data.last_contact_at,
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
    .select('id, touch_type, notes, touched_at, touched_by')
    .eq('case_id', id)
    .order('touched_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
