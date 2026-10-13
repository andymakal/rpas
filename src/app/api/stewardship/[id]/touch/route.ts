import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'

/**
 * POST /api/stewardship/[id]/touch
 *
 * Record an ad-hoc outreach touch against the customer of a stewardship work
 * item. This is how calls, voicemails, Hearsay texts, emails, and their
 * conversation outcomes get into the customer's durable history (case_touches)
 * when the worker is doing onboarding outreach outside the specific workflow
 * transitions that already auto-log a touch (recorded call outcomes, the SA
 * email, the form-sent step).
 *
 * It writes ONLY history — it never changes the outreach queue or any workflow
 * state. The touch is customer-scoped (case_id null), so it surfaces on the
 * customer record's shared communication log exactly like the other
 * servicing-agent touches.
 *
 * Body: { touch_type: 'call' | 'voicemail' | 'text' | 'email', notes?: string }
 *   - touch_type maps to case_touches.touch_type. A Hearsay text is 'text'.
 *   - notes is the free-text outcome of the conversation (optional).
 */

const ALLOWED_TOUCH_TYPES = ['call', 'voicemail', 'text', 'email'] as const
type TouchType = (typeof ALLOWED_TOUCH_TYPES)[number]

async function resolveEmployeeName(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  try {
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return null
    const { data: profile } = await admin
      .from('staff_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
    return profile?.display_name ?? user.email?.split('@')[0] ?? null
  } catch {
    return null
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  let body: { touch_type?: string; notes?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const touchType = body.touch_type as TouchType | undefined
  if (!touchType || !ALLOWED_TOUCH_TYPES.includes(touchType)) {
    return Response.json(
      { error: `touch_type must be one of: ${ALLOWED_TOUCH_TYPES.join(', ')}` },
      { status: 400 },
    )
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  const supabase = createAdminClient()

  // Resolve the customer for this outreach item.
  const { data: outreach, error: readErr } = await supabase
    .from('stewardship_outreach')
    .select('id, customer_prereviews!inner ( customer_id )')
    .eq('id', id)
    .single()
  if (readErr || !outreach) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }
  const customerId = (outreach as unknown as {
    customer_prereviews: { customer_id: string }
  }).customer_prereviews.customer_id

  const touchedBy = await resolveEmployeeName(supabase)

  const typeLabel: Record<TouchType, string> = {
    call: 'Call', voicemail: 'Voicemail', text: 'Text', email: 'Email',
  }
  const prefix = `Servicing-agent onboarding ${typeLabel[touchType].toLowerCase()}`
  const finalNotes = notes ? `${prefix}: ${notes}` : `${prefix}.`

  const { error: touchErr } = await supabase
    .from('case_touches')
    .insert({
      customer_id: customerId,
      case_id:     null,
      touch_type:  touchType,
      notes:       finalNotes,
      touched_at:  new Date().toISOString(),
      touched_by:  touchedBy,
    })
  if (touchErr) {
    console.error('stewardship ad-hoc touch log error:', touchErr)
    return Response.json({ error: 'Could not record the history entry.' }, { status: 500 })
  }

  return Response.json({ data: { ok: true } }, { status: 201 })
}
