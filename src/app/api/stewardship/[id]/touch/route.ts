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

import { OUTCOME_MARKERS, INBOUND_MARKER, type ChannelOutcome } from '@/lib/stewardship/outreach-attempts'
import { ENGAGED_AT_KEY, engagedAtOf } from '@/lib/stewardship/queues'
import { retireUndeliverableEmail } from '@/lib/stewardship/email-undeliverable'

const ALLOWED_TOUCH_TYPES = ['call', 'voicemail', 'text', 'email', 'postal'] as const
type TouchType = (typeof ALLOWED_TOUCH_TYPES)[number]

const ALLOWED_OUTCOMES = ['touch', 'no_contact', 'unusable'] as const

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
    outcome?: string
    // Direction of the communication. 'incoming' is a customer-initiated
    // response (they emailed/called/texted us); 'outgoing' (the default) is our
    // reach-out. A genuine incoming response moves the customer into Customer
    // Interaction. 'automated' flags a non-human auto-reply (out-of-office,
    // delivery receipt), which is NOT engagement and never moves the customer.
    direction?: string
    automated?: boolean
    channels?: Array<{ touch_type?: string; notes?: string; outcome?: string; direction?: string; automated?: boolean }>
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Accept the multi-channel attempt form OR the single-channel legacy form.
  // Each channel carries its own outcome (reusing the IPF grouping outcome
  // vocabulary mapped to Right Path): 'touch' (a real completed send / placed
  // call — the default when omitted, matching the historical behavior of only
  // logging actually-completed channels), 'no_contact' (an ordinary
  // non-response), or 'unusable' (the channel itself cannot deliver). The
  // outcome is persisted via a stable note marker because case_touches has no
  // outcome column; it drives attempt counting and contact-method usability and
  // never influences cadence/timing (IPF Decision Engine Boundary).
  const rawChannels = Array.isArray(body.channels)
    ? body.channels
    : (body.touch_type
        ? [{ touch_type: body.touch_type, notes: body.notes, outcome: body.outcome, direction: body.direction, automated: body.automated }]
        : [])

  const channels: { touchType: TouchType; notes: string; outcome: ChannelOutcome; inbound: boolean; automated: boolean }[] = []
  for (const ch of rawChannels) {
    const t = ch.touch_type as TouchType | undefined
    if (!t || !ALLOWED_TOUCH_TYPES.includes(t)) {
      return Response.json(
        { error: `Each channel touch_type must be one of: ${ALLOWED_TOUCH_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    const outcome = (ch.outcome ?? 'touch') as ChannelOutcome
    if (!ALLOWED_OUTCOMES.includes(outcome)) {
      return Response.json(
        { error: `Each channel outcome must be one of: ${ALLOWED_OUTCOMES.join(', ')}` },
        { status: 400 },
      )
    }
    // Direction falls back to the top-level direction, then 'outgoing'. Only an
    // 'incoming' direction marks a received communication. 'automated' likewise
    // falls back to the top-level flag.
    const direction = (ch.direction ?? body.direction ?? 'outgoing')
    const inbound = direction === 'incoming'
    const automated = ch.automated ?? body.automated ?? false
    channels.push({ touchType: t, notes: typeof ch.notes === 'string' ? ch.notes.trim() : '', outcome, inbound, automated })
  }

  if (channels.length === 0) {
    return Response.json(
      { error: 'Record at least one channel (call, voicemail, text, email, or postal).' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // Resolve the customer for this outreach item. action_context carries the
  // engagement marker we may stamp below for a genuine incoming response.
  const { data: outreach, error: readErr } = await supabase
    .from('stewardship_outreach')
    .select('id, action_context, customer_prereviews!inner ( customer_id )')
    .eq('id', id)
    .single()
  if (readErr || !outreach) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }
  const outreachRow = outreach as unknown as {
    id: string
    action_context: unknown
    customer_prereviews: { customer_id: string }
  }
  const customerId = outreachRow.customer_prereviews.customer_id

  const touchedBy = await resolveEmployeeName(supabase)
  const touchedAt = new Date().toISOString()

  const typeLabel: Record<TouchType, string> = {
    call: 'Call', voicemail: 'Voicemail', text: 'Text', email: 'Email', postal: 'Postal',
  }

  // One case_touches row per channel in this attempt. All share one timestamp so
  // the channels of a single attempt read (and group) together as ONE attempt.
  // The per-channel outcome is appended as a stable machine marker so the
  // attempt history can tell a real touch from an unusable channel; a completed
  // touch carries no marker (reads as ordinary onboarding contact prose).
  const rows = channels.map(({ touchType, notes, outcome, inbound, automated }) => {
    // An inbound (customer-initiated) communication reads as a RESPONSE from the
    // customer; an outgoing one keeps the onboarding reach-out wording. An
    // automated inbound (out-of-office / delivery receipt) is labeled so the
    // history makes clear it is not a genuine response.
    const label = typeLabel[touchType].toLowerCase()
    const prefix = inbound
      ? (automated ? `Automated ${label} reply received` : `Customer ${label} response received`)
      : `Servicing-agent onboarding ${label}`
    const outcomeMarker = OUTCOME_MARKERS[outcome]
    // The inbound marker lets the history read a received communication
    // distinctly from an outgoing one; automated inbound is never engagement.
    const inboundMarker = inbound ? INBOUND_MARKER : ''
    const base = notes ? `${prefix}: ${notes}` : `${prefix}.`
    const suffix = [inboundMarker, outcomeMarker].filter(Boolean).join(' ')
    return {
      customer_id: customerId,
      case_id:     null,
      touch_type:  touchType,
      notes:       suffix ? `${base} ${suffix}` : base,
      touched_at:  touchedAt,
      touched_by:  touchedBy,
    }
  })

  const { error: touchErr } = await supabase.from('case_touches').insert(rows)
  if (touchErr) {
    console.error('stewardship ad-hoc touch log error:', touchErr)
    return Response.json({ error: 'Could not record the history entry.' }, { status: 500 })
  }

  // Email Undeliverable retires the failed address from active contact info, the
  // same way the Contact Card does and the guided attempt route now does. The
  // touch rows above already PRESERVED the outcome in Customer History (the
  // email touch carries the unusable marker), so we do NOT write a second entry
  // — that would duplicate the record. An INBOUND or AUTOMATED communication is
  // never a delivery failure of OUR address, so only an OUTGOING email recorded
  // unusable retires the address. retireUndeliverableEmail nulls the address and
  // verification and sets email_availability = 'undeliverable', which the
  // Contact Card reflects immediately; it is guarded on the still-matching value
  // so a replacement entered after the failure is never overwritten.
  const outgoingEmailUndeliverable = channels.some(
    (c) => c.touchType === 'email' && c.outcome === 'unusable' && !c.inbound,
  )
  if (outgoingEmailUndeliverable) {
    const { data: cust } = await supabase
      .from('customers')
      .select('email')
      .eq('id', customerId)
      .maybeSingle<{ email: string | null }>()
    await retireUndeliverableEmail(supabase, customerId, cust?.email ?? null)
  }

  // A GENUINE incoming response (not an automated reply) means the customer has
  // engaged: stamp the engagement signal on action_context so the customer moves
  // into Customer Interaction. This is a lightweight soft fact on the item, NOT
  // a claim and NOT a queue change — it never routes work to one person, never
  // creates a task, and never advances the workflow. Stamped once (idempotent):
  // a later response does not overwrite the first-engagement instant. Best-effort
  // and non-fatal; the history is already saved.
  const hasGenuineInbound = channels.some((c) => c.inbound && !c.automated)
  let engaged = false
  if (hasGenuineInbound && engagedAtOf(outreachRow.action_context) == null) {
    const base =
      outreachRow.action_context && typeof outreachRow.action_context === 'object' && !Array.isArray(outreachRow.action_context)
        ? (outreachRow.action_context as Record<string, unknown>)
        : {}
    const nextContext = { ...base, [ENGAGED_AT_KEY]: touchedAt }
    const { error: ctxErr } = await supabase
      .from('stewardship_outreach')
      .update({ action_context: nextContext })
      .eq('id', outreachRow.id)
    if (ctxErr) {
      console.error('stewardship engagement marker update error:', ctxErr)
    } else {
      engaged = true
    }
  }

  return Response.json({ data: { ok: true, recorded: rows.length, engaged } }, { status: 201 })
}
