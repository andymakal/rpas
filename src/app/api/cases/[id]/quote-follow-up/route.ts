import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { action?: string; note?: string } = {}
  try { body = await request.json() } catch { /* no body */ }

  if (body.action !== 'no_contact' && body.action !== 'rewarm') {
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  }

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
  } catch { /* non-fatal */ }

  const { data: current, error: fetchErr } = await supabase
    .from('cases')
    .select('touches, internal_status')
    .eq('id', id)
    .single()

  if (fetchErr || !current) {
    return Response.json({ error: 'Case not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const optionalNote = body.note?.trim() || null

  if (body.action === 'no_contact') {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    const follow_up_date = d.toISOString().slice(0, 10)
    const autoNote = 'Quote follow-up call attempted — no answer.'
    const fullNote = optionalNote ? `${autoNote} ${optionalNote}` : autoNote

    const [caseResult] = await Promise.all([
      supabase
        .from('cases')
        .update({
          internal_status:  'quote_no_contact',
          follow_up_date,
          last_contact_at:  now,
          touches:          (current.touches ?? 0) + 1,
          status_entered_at: now,
          updated_at:       now,
        })
        .eq('id', id)
        .select()
        .single(),
      supabase.from('case_touches').insert({
        case_id:    id,
        touch_type: 'call',
        notes:      fullNote,
        touched_at: now,
        touched_by,
      }),
      supabase.from('case_status_history').insert({
        case_id:     id,
        from_status: current.internal_status,
        to_status:   'quote_no_contact',
      }),
    ])

    if (caseResult.error) {
      return Response.json({ error: caseResult.error.message }, { status: 500 })
    }
    return Response.json({ data: caseResult.data })
  }

  // rewarm
  const autoNote = 'Quote follow-up — sending back to warm queue.'
  const fullNote = optionalNote ? `${autoNote} ${optionalNote}` : autoNote

  const [caseResult] = await Promise.all([
    supabase
      .from('cases')
      .update({
        internal_status:  'lsp_contact_needed',
        follow_up_date:   null,
        status_entered_at: now,
        updated_at:       now,
      })
      .eq('id', id)
      .select()
      .single(),
    supabase.from('case_touches').insert({
      case_id:    id,
      touch_type: 'call',
      notes:      fullNote,
      touched_at: now,
      touched_by,
    }),
    supabase.from('case_status_history').insert({
      case_id:     id,
      from_status: current.internal_status,
      to_status:   'lsp_contact_needed',
    }),
  ])

  if (caseResult.error) {
    return Response.json({ error: caseResult.error.message }, { status: 500 })
  }
  return Response.json({ data: caseResult.data })
}
