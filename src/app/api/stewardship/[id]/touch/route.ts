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
 * One outreach ATTEMPT can touch the customer on several channels at once (a
 * call plus a Hearsay text plus an email, for example). The worker records the
 * channels they ACTUALLY completed in that attempt; each completed channel
 * becomes its own case_touches row. Channels not completed are simply omitted —
 * nothing fictitious is logged.
 *
 * Body (either form is accepted):
 *   { channels: Array<{ touch_type, notes? }> }   — the multi-channel attempt
 *   { touch_type, notes? }                        — a single channel (legacy)
 *   touch_type maps to case_touches.touch_type. A Hearsay text is 'text'.
 *   notes is the free-text outcome for that channel (optional).
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

  let body: {
    touch_type?: string
    notes?: string
    channels?: Array<{ touch_type?: string; notes?: string }>
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Accept the multi-channel attempt form OR the single-channel legacy form.
  // Only channels the worker actually completed are present; empties are dropped.
  const rawChannels = Array.isArray(body.channels)
    ? body.channels
    : (body.touch_type ? [{ touch_type: body.touch_type, notes: body.notes }] : [])

  const channels: { touchType: TouchType; notes: string }[] = []
  for (const ch of rawChannels) {
    const t = ch.touch_type as TouchType | undefined
    if (!t || !ALLOWED_TOUCH_TYPES.includes(t)) {
      return Response.json(
        { error: `Each channel touch_type must be one of: ${ALLOWED_TOUCH_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    channels.push({ touchType: t, notes: typeof ch.notes === 'string' ? ch.notes.trim() : '' })
  }

  if (channels.length === 0) {
    return Response.json(
      { error: 'Record at least one completed channel (call, voicemail, text, or email).' },
      { status: 400 },
    )
  }

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
  const touchedAt = new Date().toISOString()

  const typeLabel: Record<TouchType, string> = {
    call: 'Call', voicemail: 'Voicemail', text: 'Text', email: 'Email',
  }

  // One case_touches row per COMPLETED channel in this attempt. Same timestamp
  // so the channels of a single attempt read together in history.
  const rows = channels.map(({ touchType, notes }) => {
    const prefix = `Servicing-agent onboarding ${typeLabel[touchType].toLowerCase()}`
    return {
      customer_id: customerId,
      case_id:     null,
      touch_type:  touchType,
      notes:       notes ? `${prefix}: ${notes}` : `${prefix}.`,
      touched_at:  touchedAt,
      touched_by:  touchedBy,
    }
  })

  const { error: touchErr } = await supabase.from('case_touches').insert(rows)
  if (touchErr) {
    console.error('stewardship ad-hoc touch log error:', touchErr)
    return Response.json({ error: 'Could not record the history entry.' }, { status: 500 })
  }

  return Response.json({ data: { ok: true, recorded: rows.length } }, { status: 201 })
}
