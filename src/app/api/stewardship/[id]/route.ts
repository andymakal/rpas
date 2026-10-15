import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { handoffToInitialAnalysis } from '@/lib/stewardship/analysis-handoff'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { getAttemptHistory } from '@/lib/stewardship/attempt-history'
import { resolveNextCallDate } from '@/lib/stewardship/call-cadence'
import { resolveContactOptions } from '@/lib/stewardship/contact-options'
import { OUTCOME_MARKERS, REACHED_MARKER } from '@/lib/stewardship/outreach-attempts'
import {
  buildResearchTouchRows,
  contactMethodsStillMissing,
  readResearchedUnsuccessfully,
  methodsSettledByResearch,
  stillNeedsResearchRecommendation,
} from '@/lib/stewardship/research-record'
import {
  evaluateCadenceStatus,
  cadenceRecommendationText,
  NONRESPONSIVE_LABEL,
} from '@/lib/stewardship/cadence-status'
import {
  applyAction,
  deriveEmailRouting,
  type OutreachAction,
  type OutreachState,
  type OutreachQueue,
  type CallReason,
  type ResearchReason,
  type CallOutcome,
} from '@/lib/stewardship/queues'

type OutreachRow = {
  id: string
  prereview_id: string
  queue: OutreachQueue
  call_reason: CallReason | null
  research_reason: ResearchReason | null
  last_call_outcome: CallOutcome | null
  callback_date: string | null
  email_sent_at: string | null
  follow_up_due: string | null
  form_received_at: string | null
  submitted_at: string | null
  carrier_correction: string | null
  form_delivery_method: 'email' | 'postal' | null
  refused_at: string | null
}

const OUTREACH_COLUMNS =
  'id, prereview_id, queue, call_reason, research_reason, last_call_outcome, ' +
  'callback_date, email_sent_at, follow_up_due, form_received_at, submitted_at, carrier_correction, ' +
  'form_delivery_method, refused_at'

/**
 * Resolve the signed-in employee's display name for a touch log, mirroring the
 * cases touch route: prefer staff_profiles.display_name, fall back to the email
 * local-part. Attribution is best-effort and never blocks the workflow.
 */
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

/**
 * GET /api/stewardship/[id]
 *
 * One outreach work item with everything the task screen needs: the outreach
 * state, the customer, the request policies, and all other known holdings shown
 * as context. Policy facts come from service_policies (not duplicated).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  const { data: outreach, error } = await supabase
    .from('stewardship_outreach')
    .select(`
      ${OUTREACH_COLUMNS},
      customer_prereviews!inner (
        id, customer_id, source_agency_id, decision, created_at,
        customers!inner ( id, first_name, last_name, email, phone, date_of_birth, street, address_line1, city, state, zip, phone_verified_at, email_verified_at, address_verified_at )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !outreach) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }

  const pre = (outreach as unknown as {
    customer_prereviews: {
      id: string
      customer_id: string
      source_agency_id: string | null
      created_at: string
      customers: Record<string, unknown>
    }
  }).customer_prereviews
  const customerId = pre.customer_id

  // All known holdings for this customer (context), and which are in the request.
  const [{ data: allPolicies }, { data: requestLinks }] = await Promise.all([
    supabase
      .from('service_policies')
      .select('id, policy_number, carrier, product_type, face_amount, cash_value_amount, coverage_status, insured_first_name, insured_last_name, sa_status, sa_form_sent_at')
      .eq('customer_id', customerId)
      .eq('is_test', false),
    supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id),
  ])

  const requestIds = new Set((requestLinks ?? []).map((r: { policy_id: string }) => r.policy_id))

  const holdings = ((allPolicies ?? []) as Record<string, unknown>[]).map(p => ({
    id: p.id as string,
    policy_number: p.policy_number as string,
    carrier: p.carrier as string,
    product_type: p.product_type as string | null,
    face_amount: p.face_amount as number | null,
    cash_value_amount: p.cash_value_amount as number | null,
    coverage_status: p.coverage_status as string,
    insured_name: [p.insured_first_name, p.insured_last_name].filter(Boolean).join(' ') || null,
    sa_status: p.sa_status as string,
    sa_form_sent_at: p.sa_form_sent_at as string | null,
    in_request: requestIds.has(p.id as string),
  }))

  const o = outreach as unknown as OutreachRow
  const cust = pre.customers as {
    id: string; first_name: string; last_name: string
    email: string | null; phone: string | null; date_of_birth: string | null
    street: string | null; address_line1: string | null; city: string | null; state: string | null; zip: string | null
    phone_verified_at: string | null; email_verified_at: string | null; address_verified_at: string | null
  }

  // Required-signer identity is NOT durable today: there is no owner/signer
  // record, and the customer is not necessarily the policy owner or a required
  // signer. We therefore do not assert any signer. The customer and the request
  // policies' insured names are returned as context the worker uses to verify
  // the actual signature(s) from the returned form before submitting; the UI
  // The CADENCE / NONRESPONSIVE status and the contact-method usability, both
  // from the grouped communication history. TypeScript groups the individual
  // communications into explicit attempts (IPF grouping model over case_touches,
  // preserving every communication) and counts the unsuccessful attempts; ZEN
  // decides whether the run has reached the "Nonresponsive — Review Contact
  // Strategy" recommendation. Recommendation only: it never stops outreach or
  // changes the queue.
  const actorTimeZone = await getActorTimeZone()
  const history = await getAttemptHistory(supabase, customerId, actorTimeZone, {
    since: pre.created_at,
  })

  // The AVAILABLE CONTACT OPTIONS for this customer, decided by the ZEN
  // contact-options decision over the real contact facts, with any channel
  // recorded UNUSABLE in the attempt history subtracted. Calling, emailing, and
  // texting are reported independently and simultaneously; a mailing address
  // supports postal form delivery. One customer, one workflow: these are the
  // actions available on THIS single onboarding item, not separate workflows.
  const contactOptions = await resolveContactOptions(
    {
      phone: cust.phone,
      email: cust.email,
      street: cust.street,
      address_line1: cust.address_line1,
      city: cust.city,
      state: cust.state,
      zip: cust.zip,
    },
    history.unusableChannels,
  )

  // Whether a still-missing method has already been researched unsuccessfully
  // (recorded, durable, per method). The task panel uses this to show that
  // research was completed and to stop implying the same look-up is still owed,
  // while leaving the research action available for a deliberate retry. A method
  // with a value on file is never "settled by research" (presence makes it
  // moot), so a newly-found value re-opens it on its own.
  const researchedUnsuccessfully = await readResearchedUnsuccessfully(supabase, customerId)
  const presence = {
    hasEmail: !!cust.email?.trim(),
    hasPhone: !!cust.phone?.trim(),
  }
  const researchSettled = methodsSettledByResearch(presence, researchedUnsuccessfully)
  const researchStillRecommended = stillNeedsResearchRecommendation(presence, researchedUnsuccessfully)

  // The Nonresponsive advisory counts only genuinely UNSUCCESSFUL attempts (a
  // reached attempt is a success and never counts toward the seven-attempt
  // warning).
  const cadence = await evaluateCadenceStatus(history.unsuccessfulAttempts)
  const nonresponsive = cadence.isNonresponsive
    ? {
        label: NONRESPONSIVE_LABEL,
        attempts: history.unsuccessfulAttempts,
        recommendation: cadenceRecommendationText(cadence.recommendation, history.unsuccessfulAttempts),
      }
    : null

  // The EFFECTIVE queue, re-derived live from the customer's CURRENT email the
  // same way the board list does (deriveEmailRouting): an untouched opening item
  // whose email became usable after intake is an introductory email now, not a
  // "no-email" call. Without this the task view would switch on the stale stored
  // queue and show "Call … — No email" for a customer the board correctly lists
  // under Introductory Emails. The upgrade only applies to untouched openers, so
  // an advanced item is never rerouted. Only one of the two routings can apply,
  // so this is a safe overlay on the stored queue, and the returned call_reason/
  // research_reason are nulled to match the derived ready-to-email state.
  const emailPatch = deriveEmailRouting({
    queue: o.queue,
    call_reason: o.call_reason,
    research_reason: o.research_reason,
    last_call_outcome: o.last_call_outcome,
    email_sent_at: o.email_sent_at,
    callback_date: o.callback_date,
    refused_at: o.refused_at,
    has_usable_email: !!cust.email?.trim(),
  })
  const effectiveQueue: OutreachQueue = emailPatch?.queue ?? o.queue
  const effectiveCallReason: CallReason | null = emailPatch ? (emailPatch.call_reason ?? null) : o.call_reason
  const effectiveResearchReason: ResearchReason | null = emailPatch ? (emailPatch.research_reason ?? null) : o.research_reason

  // requires that confirmation.
  return Response.json({
    data: {
      id: o.id,
      prereview_id: o.prereview_id,
      queue: effectiveQueue,
      call_reason: effectiveCallReason,
      research_reason: effectiveResearchReason,
      last_call_outcome: o.last_call_outcome,
      callback_date: o.callback_date,
      email_sent_at: o.email_sent_at,
      follow_up_due: o.follow_up_due,
      form_received_at: o.form_received_at,
      submitted_at: o.submitted_at,
      carrier_correction: o.carrier_correction,
      form_delivery_method: o.form_delivery_method,
      refused_at: o.refused_at,
      // Customer-verified contact flags now live PERMANENTLY on the customer
      // record (they must survive outreach completion), so they are returned
      // from the joined customer, not the temporary outreach row.
      phone_verified_at: cust.phone_verified_at,
      email_verified_at: cust.email_verified_at,
      address_verified_at: cust.address_verified_at,
      customer: cust,
      source_agency_id: pre.source_agency_id,
      holdings,
      // The available contact actions (call / text / email / postal) and whether
      // Contact Research is needed, decided by ZEN from the real contact facts.
      contact_options: contactOptions,
      // Durable per-method research outcome: which still-missing methods have
      // been researched unsuccessfully, and whether research is still worth
      // recommending at all for this customer. Recorded fact, not inferred.
      research: {
        email_settled: researchSettled.email,
        phone_settled: researchSettled.phone,
        still_recommended: researchStillRecommended,
      },
      // Grouped outreach-attempt count and the Nonresponsive recommendation when
      // ZEN has flagged the run (null otherwise). Recommendation only.
      outreach_attempts: history.outreachAttempts,
      call_attempts: history.callAttempts,
      nonresponsive,
      // Signer identity cannot be determined from durable data.
      signer_identity_known: false,
    },
  })
}

/**
 * PATCH /api/stewardship/[id]
 *
 * Apply a workflow transition. Body: { action: OutreachAction }. The transition
 * rules live in src/lib/stewardship/queues.ts; this route validates the action
 * against the current state, persists the resulting patch, and performs the
 * durable side effects:
 *   - research-found email/phone persists the actual contact value on the
 *     customer (field-level, never overwriting the other fact);
 *   - form-sent stamps sa_form_sent_at on the request policies;
 *   - carrier-confirmed sets sa_status = 'confirmed' on the ONE named request
 *     policy (never the others), then ends outreach by deleting the
 *     stewardship_outreach row ONLY when every request policy is confirmed. While
 *     any request policy still needs access, the item stays in waiting-for-carrier
 *     and remains actionable. The open customer_prereview is left for the later
 *     documentation layer.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  let body: { action?: OutreachAction & { email?: string; phone?: string } }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = body.action
  if (!action?.type) {
    return Response.json({ error: 'action is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: current, error: readErr } = await supabase
    .from('stewardship_outreach')
    .select(`${OUTREACH_COLUMNS}, customer_prereviews!inner ( customer_id, created_at, customers!inner ( phone, email ) )`)
    .eq('id', id)
    .single()
  if (readErr || !current) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }

  const row = current as unknown as OutreachRow & {
    customer_prereviews: {
      customer_id: string
      created_at: string
      customers: { phone: string | null; email: string | null }
    }
  }
  const customerId = row.customer_prereviews.customer_id
  const runSince = row.customer_prereviews.created_at

  // ── research-found: persist the actual contact value BEFORE routing ─────────
  // Field-level: write only the found fact, never overwrite the other. Refuse
  // to advance on a blank value.
  if (action.type === 'research-found' && (action.found === 'email' || action.found === 'phone')) {
    const value = (action.found === 'email' ? body.action?.email : body.action?.phone)?.trim()
    if (!value) {
      return Response.json(
        { error: `A ${action.found} value is required to route this customer forward` },
        { status: 400 },
      )
    }
    const field = action.found === 'email' ? { email: value } : { phone: value }
    const { error: custErr } = await supabase
      .from('customers')
      .update(field)
      .eq('id', customerId)
    if (custErr) {
      console.error('stewardship research contact persist error:', custErr)
      return Response.json({ error: custErr.message }, { status: 500 })
    }
  }

  // ── research-found 'nothing': RECORD the unsuccessful research durably ──────
  // Previously a no-op that left no trace, so the same research was recommended
  // again on every pass. Now it records, PER MISSING METHOD, that research was
  // completed with nothing usable found (who + when), as an ordinary
  // case_touches row with a stable marker. Only the method(s) STILL MISSING are
  // recorded — a method already on file is not "researched unsuccessfully". The
  // recommendation surfaces read this fact to stop re-recommending a settled
  // method, while a found value or a deliberate re-research re-opens it. The
  // workflow transition stays a no-op (the customer remains in Research Needed;
  // nothing is auto-closed).
  if (action.type === 'research-found' && action.found === 'nothing') {
    const missing = contactMethodsStillMissing({
      email: row.customer_prereviews.customers?.email ?? null,
      phone: row.customer_prereviews.customers?.phone ?? null,
    })
    if (missing.length > 0) {
      const touchedBy = await resolveEmployeeName(supabase)
      const rows = buildResearchTouchRows(customerId, missing, touchedBy)
      const { error: researchErr } = await supabase.from('case_touches').insert(rows)
      if (researchErr) {
        console.error('stewardship research-nothing record error:', researchErr)
        return Response.json(
          { error: 'Could not record the research outcome; please try again.' },
          { status: 500 },
        )
      }
    }
  }

  // ── verify-contact: persist the customer's confirmation ON THE CUSTOMER ─────
  // The verification timestamp is durable customer-record truth and must survive
  // the end of outreach, so it is written to customers (not the temporary
  // outreach row). The pure transition only validated the field; here we stamp
  // or clear the matching customers column.
  if (action.type === 'verify-contact') {
    const ts = action.verified ? new Date().toISOString() : null
    const col =
      action.field === 'phone'   ? 'phone_verified_at' :
      action.field === 'email'   ? 'email_verified_at' :
      'address_verified_at'
    const { error: vErr } = await supabase
      .from('customers')
      .update({ [col]: ts })
      .eq('id', customerId)
    if (vErr) {
      console.error('stewardship verify-contact persist error:', vErr)
      return Response.json({ error: vErr.message }, { status: 500 })
    }
  }

  const state: OutreachState = {
    queue: row.queue,
    call_reason: row.call_reason,
    research_reason: row.research_reason,
    last_call_outcome: row.last_call_outcome,
    callback_date: row.callback_date,
    email_sent_at: row.email_sent_at,
    follow_up_due: row.follow_up_due,
    form_received_at: row.form_received_at,
    submitted_at: row.submitted_at,
    carrier_correction: row.carrier_correction,
    form_delivery_method: row.form_delivery_method,
    refused_at: row.refused_at,
    has_usable_phone: !!row.customer_prereviews.customers?.phone?.trim(),
  }

  // ── Cadence: resolve the next automatic CALL date from the attempt history ──
  // The escalating call cadence (24h, 24h, 2d, 3d, then every 6 business days
  // rotating weekdays) is deterministic time-math, so it is computed HERE (the
  // TypeScript/normalization half of the GoRules division of labor) and passed
  // into the pure transition as next_call_date. ZEN is not involved in the
  // day-math. The resolved date honors a customer-promised callback and an
  // employee override over the computed cadence.
  //
  //   - email-sent: the first call is due 24h after the intro email -> cadence
  //     with zero prior unsuccessful call attempts.
  //   - call-outcome / voicemail: the NEXT call is scheduled from the prior
  //     unsuccessful call attempts PLUS this voicemail (the current attempt is
  //     logged as a touch after the transition, so it is not yet in history).
  // Does this action schedule the NEXT automatic call? email-sent (first call
  // 24h later), a voicemail call-outcome, and a record-attempt that is an
  // unsuccessful non-reaching attempt (voicemail call, or a no-call attempt on a
  // call-flow item) all do. For those we resolve the cadence date up front.
  // An intro authorization email sent via a record-attempt (email channel from
  // Ready to Email) schedules the first call 24h later, exactly like email-sent.
  const attemptIsIntroEmail =
    action.type === 'record-attempt' &&
    !action.call &&
    row.queue === 'ready-to-email' &&
    action.email === 'touch'
  const attemptSchedulesCall =
    action.type === 'record-attempt' &&
    // A reached/callback/bad-number/not-interested attempt does NOT roll the
    // call cadence (reached advances; callback sets its own date; bad-number and
    // not-interested leave the call flow). Only a voicemail call, a no-call
    // record-only attempt still in the call flow, or the intro-email attempt
    // schedules the next call.
    (action.call === 'voicemail' ||
      attemptIsIntroEmail ||
      (!action.call && (row.queue === 'ready-to-call' || row.queue === 'waiting-for-response')))

  let actionForTransition: typeof action = action
  if (
    action.type === 'email-sent' ||
    (action.type === 'call-outcome' && action.outcome === 'voicemail') ||
    attemptSchedulesCall
  ) {
    const actorTimeZone = await getActorTimeZone()
    const history = await getAttemptHistory(supabase, customerId, actorTimeZone, { since: runSince })
    // The cadence index is how many unsuccessful CALL attempts precede the next
    // call:
    //   - email-sent: pre-call baseline, 0 prior calls -> next call in 24h.
    //   - a voicemail call (call-outcome or record-attempt call='voicemail'):
    //     this attempt added a call, so the next call is scheduled from
    //     callAttempts + 1.
    //   - a no-call record-only attempt (email/text only) on a call-flow item:
    //     no new call was placed, so the next call still uses callAttempts.
    const madeCallThisAttempt =
      (action.type === 'call-outcome' && action.outcome === 'voicemail') ||
      (action.type === 'record-attempt' && action.call === 'voicemail')
    const priorUnsuccessfulAttempts =
      action.type === 'email-sent' || attemptIsIntroEmail
        ? 0 // first call is due 24h after the introductory email
        : history.callAttempts + (madeCallThisAttempt ? 1 : 0)
    const resolved = resolveNextCallDate({
      priorUnsuccessfulAttempts,
      actorTimeZone,
      // A customer-promised callback and an employee override take precedence;
      // this scheduling path is only reached for non-callback attempts, so none
      // applies here (a callback outcome sets callback_date in the transition).
      promisedCallbackDate: null,
      employeeOverrideDate: null,
    })
    actionForTransition = { ...action, next_call_date: resolved.date }
  }

  // Callability gate (replaces the old stored-queue restriction on calling):
  // a call outcome or a call within a coordinated attempt requires a usable
  // phone on file, NOT a particular stored queue. This is what lets an employee
  // call a callable customer who happens to sit in Ready to Email, while still
  // refusing a call when there is genuinely no number to dial.
  const placesCall =
    action.type === 'call-outcome' ||
    (action.type === 'record-attempt' && !!action.call)
  if (placesCall && !row.customer_prereviews.customers?.phone?.trim()) {
    return Response.json(
      { error: 'This customer has no usable phone on file. Use Contact Research to find one.' },
      { status: 409 },
    )
  }

  const result = applyAction(state, actionForTransition)
  if (result.error) {
    return Response.json({ error: result.error }, { status: 409 })
  }

  // form-sent stamps sa_form_sent_at on the request policies (servicing-agent
  // status lives on service_policies). Do this before the outreach patch.
  if (action.type === 'form-sent') {
    const { data: links } = await supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id)
    const policyIds = (links ?? []).map((l: { policy_id: string }) => l.policy_id)
    if (policyIds.length > 0) {
      await supabase
        .from('service_policies')
        .update({ sa_form_sent_at: new Date().toISOString() })
        .in('id', policyIds)
    }
  }

  // Record call outcomes in customer history. Every recorded call outcome
  // becomes a durable touch (call or voicemail) so the customer's history shows
  // the contact attempts the onboarding workflow made. Attribution is
  // best-effort; a failed touch log must never block the workflow transition.
  if (action.type === 'call-outcome') {
    const outcome = action.outcome
    // Voicemail is its own touch_type; every other call outcome is a 'call'.
    const touchType = outcome === 'voicemail' ? 'voicemail' : 'call'
    const outcomeLabel: Record<CallOutcome, string> = {
      reached: 'Reached the customer.',
      voicemail: 'Left a voicemail. Follow-up auto-scheduled.',
      'bad-number': 'Bad number. Moved to Research Needed.',
      'not-interested': 'Customer declined. Outreach stopped until deliberately reopened.',
      callback: `Customer asked for a callback${action.callback_date ? ` on ${action.callback_date}` : ''}.`,
    }
    const touchedBy = await resolveEmployeeName(supabase)
    // Carry the per-channel outcome marker so the attempt history reads this
    // touch correctly: a bad number marks the phone channel UNUSABLE (it cannot
    // deliver), a voicemail is an ordinary non-response (not a reached touch),
    // and other recorded outcomes read as a completed call touch. This never
    // influences cadence/timing (IPF Decision Engine Boundary); it feeds
    // attempt counting and contact-method usability only.
    // reached / callback / not-interested all mean the customer was REACHED, so
    // the attempt is successful and excluded from the unsuccessful total. A bad
    // number is an unusable channel; a voicemail is an ordinary non-response.
    const outcomeMarker =
      outcome === 'bad-number' ? OUTCOME_MARKERS.unusable :
      outcome === 'voicemail'  ? OUTCOME_MARKERS.no_contact :
      (outcome === 'reached' || outcome === 'callback' || outcome === 'not-interested') ? REACHED_MARKER :
      ''
    const callNote = `Servicing-agent onboarding call: ${outcomeLabel[outcome]}`
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  touchType,
        notes:       outcomeMarker ? `${callNote} ${outcomeMarker}` : callNote,
        touched_at:  new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      // Non-fatal: the workflow transition still proceeds. Log for visibility.
      console.error('stewardship call-outcome touch log error:', touchErr)
    }
  }

  // record-attempt: ONE coordinated multi-channel attempt (IPF grouping). Write
  // the individual channel outcomes as separate case_touches rows at a SHARED
  // timestamp so they group into exactly one attempt, each preserving its own
  // outcome. The workflow transition was already applied above from the call
  // outcome; this records the attempt's history without the employee recording
  // anything twice. Outcome markers carry per-channel usability/no-contact so
  // attempt counting and contact-method usability read correctly; markers never
  // influence cadence/timing.
  if (action.type === 'record-attempt') {
    const touchedBy = await resolveEmployeeName(supabase)
    const attemptAt = new Date().toISOString()

    const callLabel: Record<CallOutcome, string> = {
      reached: 'Reached the customer.',
      voicemail: 'Left a voicemail. Follow-up auto-scheduled.',
      'bad-number': 'Bad number. Moved to Research Needed.',
      'not-interested': 'Customer declined. Outreach stopped until deliberately reopened.',
      callback: `Customer asked for a callback${action.callback_date ? ` on ${action.callback_date}` : ''}.`,
    }
    // Map a non-call channel outcome to its stored note marker.
    const markerFor = (o: 'touch' | 'no_contact' | 'unusable' | null | undefined): string =>
      o === 'unusable' ? OUTCOME_MARKERS.unusable :
      o === 'no_contact' ? OUTCOME_MARKERS.no_contact :
      '' // 'touch' (or absent) records a completed touch with no marker

    const rows: Array<{
      customer_id: string; case_id: null; touch_type: string; notes: string; touched_at: string; touched_by: string | null
    }> = []

    // The call channel, when a call was placed in this attempt.
    if (action.call) {
      const callMarker =
        action.call === 'bad-number' ? OUTCOME_MARKERS.unusable :
        action.call === 'voicemail'  ? OUTCOME_MARKERS.no_contact :
        (action.call === 'reached' || action.call === 'callback' || action.call === 'not-interested') ? REACHED_MARKER :
        ''
      const touchType = action.call === 'voicemail' ? 'voicemail' : 'call'
      const base = `Servicing-agent onboarding call: ${callLabel[action.call]}`
      rows.push({
        customer_id: customerId, case_id: null, touch_type: touchType,
        notes: callMarker ? `${base} ${callMarker}` : base,
        touched_at: attemptAt, touched_by: touchedBy,
      })
    }

    // The non-call channels actually used in this attempt (absent = not offered).
    const channelSpecs: Array<{ key: 'voicemail' | 'text' | 'email' | 'postal'; touchType: string; verb: string }> = [
      { key: 'voicemail', touchType: 'voicemail', verb: 'voicemail' },
      { key: 'text',      touchType: 'text',      verb: 'text' },
      { key: 'email',     touchType: 'email',     verb: 'email' },
      { key: 'postal',    touchType: 'postal',    verb: 'postal' },
    ]
    for (const spec of channelSpecs) {
      const outcome = action[spec.key]
      if (outcome == null) continue // channel not offered on this attempt
      const marker = markerFor(outcome)
      const base = `Servicing-agent onboarding ${spec.verb}.`
      rows.push({
        customer_id: customerId, case_id: null, touch_type: spec.touchType,
        notes: marker ? `${base} ${marker}` : base,
        touched_at: attemptAt, touched_by: touchedBy,
      })
    }

    if (rows.length > 0) {
      const { error: touchErr } = await supabase.from('case_touches').insert(rows)
      if (touchErr) {
        // The grouping IS the required attempt history for this coordinated
        // attempt, and the attempt also advances workflow progress / cadence.
        // If the history fails to save we must NOT silently advance the
        // workflow: abort before the patch persists so the attempt can be
        // retried as a whole. This is the one place a touch-log failure is
        // fatal, precisely because the attempt and its history are one unit.
        console.error('stewardship record-attempt touch log error:', touchErr)
        return Response.json(
          { error: 'Could not save the attempt history. Nothing was changed; please try recording the attempt again.' },
          { status: 500 },
        )
      }
    }
  }

  // Record the servicing-agent form being sent to the customer (from a reached
  // call or from the waiting-for-response engagement path). The ready-to-email
  // path records its own email touch separately below.
  if (action.type === 'form-sent') {
    const touchedBy = await resolveEmployeeName(supabase)
    const isPostal = row.form_delivery_method === 'postal'
    const method = isPostal ? 'by postal mail' : 'by email'
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  isPostal ? 'postal' : 'email',
        notes:       `Servicing-agent authorization form sent to the customer ${method}.`,
        touched_at:  new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      console.error('stewardship form-sent touch log error:', touchErr)
    }
  }

  // form-returned: the signed form came back on its own after the intro email.
  // Record the RECEIPT only — never a fictitious second mailing/send.
  if (action.type === 'form-returned') {
    const touchedBy = await resolveEmployeeName(supabase)
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  'email', // inbound return (scan/email is the usual channel)
        notes:       'Signed servicing-agent form returned by the customer (no re-send; the form went with the introductory email).',
        touched_at:  new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      console.error('stewardship form-returned touch log error:', touchErr)
    }
  }

  // record-follow-up: a chase on a waiting item (signature or carrier). Log it
  // and let the state machine roll the next follow-up date forward.
  if (action.type === 'record-follow-up') {
    const touchedBy = await resolveEmployeeName(supabase)
    const what = state.queue === 'waiting-for-carrier'
      ? 'Followed up with the carrier on servicing-agent confirmation (still outstanding).'
      : 'Followed up with the customer on the outstanding signed form (not yet returned).'
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  'call',
        notes:       `Servicing-agent onboarding follow-up: ${what}`,
        touched_at:  new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      console.error('stewardship record-follow-up touch log error:', touchErr)
    }
  }

  // reopen: a refused item was deliberately reopened for further outreach.
  if (action.type === 'reopen') {
    const touchedBy = await resolveEmployeeName(supabase)
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  'call',
        notes:       'Servicing-agent onboarding reopened after a prior refusal.',
        touched_at:  new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      console.error('stewardship reopen touch log error:', touchErr)
    }
  }

  // carrier-confirmed: confirm servicing access on the ONE named request policy,
  // then end outreach only once EVERY request policy is confirmed. The open
  // customer_prereview remains (decision still null) for the documentation
  // layer. "Out of outreach" stays derivable: no stewardship_outreach row.
  if (result.confirmPolicyId) {
    // The policy must belong to THIS outreach's request set (a confirmation can
    // only apply to a policy actually in the servicing request). This also
    // guards against confirming a policy from a different customer/outreach.
    const { data: links } = await supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id)
    const requestPolicyIds = (links ?? []).map((l: { policy_id: string }) => l.policy_id)
    if (!requestPolicyIds.includes(result.confirmPolicyId)) {
      return Response.json(
        { error: 'That policy is not part of this servicing request.' },
        { status: 409 },
      )
    }

    // Confirm exactly this one policy. Scoped by id AND customer_id so a stray
    // id can never confirm another customer's policy. The other request
    // policies are left untouched — their statuses are independent.
    const { error: saErr } = await supabase
      .from('service_policies')
      .update({ sa_status: 'confirmed' })
      .eq('id', result.confirmPolicyId)
      .eq('customer_id', customerId)
    if (saErr) {
      console.error('stewardship carrier-confirm sa_status update error:', saErr)
      return Response.json(
        { error: 'Could not update servicing status; the item was left in Waiting for Carrier.' },
        { status: 500 },
      )
    }

    // NOTE: promotion and the Initial Analysis handoff happen ONLY when the
    // WHOLE onboarding completes (every request policy confirmed), not on this
    // single per-policy confirmation. See the allConfirmed branch below.

    // Persist the outreach patch (clears any standing correction note). Keep the
    // item in waiting-for-carrier; it stays actionable for the remaining
    // policies. Done before deciding completion so a correction note never
    // lingers on a still-open item.
    if (Object.keys(result.patch).length > 0) {
      const { error: updErr } = await supabase
        .from('stewardship_outreach')
        .update(result.patch)
        .eq('id', id)
      if (updErr) {
        console.error('stewardship carrier-confirm patch error:', updErr)
        return Response.json({ error: updErr.message }, { status: 500 })
      }
    }

    // Re-read the request policies' live statuses to decide completion. Outreach
    // is finished only when every request policy — term and permanent alike — is
    // confirmed. (The 1035 review advances to operations prep independently once
    // the permanent policies are confirmed; it does not wait on term policies.)
    const { data: statusRows, error: statusErr } = await supabase
      .from('service_policies')
      .select('id, sa_status')
      .in('id', requestPolicyIds)
    if (statusErr) {
      console.error('stewardship carrier-confirm status re-read error:', statusErr)
      return Response.json({ error: statusErr.message }, { status: 500 })
    }
    const allConfirmed =
      requestPolicyIds.length > 0 &&
      (statusRows ?? []).length === requestPolicyIds.length &&
      (statusRows ?? []).every((p: { sa_status: string | null }) => p.sa_status === 'confirmed')

    if (allConfirmed) {
      // Every request policy is confirmed — the servicing-agent onboarding run
      // is COMPLETE. This single point is where completion-triggered effects
      // fire (never on an earlier per-policy confirmation):
      //
      //   1. Record the durable completion marker on the pre-review. This is the
      //      honest, non-derivable signal of "this onboarding completed"; it is
      //      NOT inferred from sa_status later, and it survives deleting the
      //      outreach row and its request-policy links.
      //   2. Promote Wanderer -> Explorer, now that onboarding is complete for
      //      ALL applicable policies. Scoped to segment = 'wanderer' so it only
      //      ever lifts a wanderer and never downgrades or touches a higher tier.
      //   3. Hand the customer into the existing Initial Analysis preparation
      //      process (policy_reviews in 'prep', linked to the pre-review, visible
      //      on /reviews) — the general path that works for project AND
      //      non-project customers alike.
      //
      // The request-policy ids are captured BEFORE deletion so the handoff knows
      // exactly which policies were onboarded.
      const prereviewId = (current as unknown as OutreachRow).prereview_id

      // 1. Durable completion marker (always recorded, independent of decision).
      const { error: compErr } = await supabase
        .from('customer_prereviews')
        .update({ servicing_completed_at: new Date().toISOString() })
        .eq('id', prereviewId)
      if (compErr) {
        console.error('stewardship completion marker error:', compErr)
      }

      // 2. Wanderer -> Explorer on COMPLETION (not first confirmation).
      const { error: promoteErr } = await supabase
        .from('customers')
        .update({ segment: 'explorer' })
        .eq('id', customerId)
        .eq('segment', 'wanderer')
      if (promoteErr) {
        console.error('stewardship Wanderer->Explorer promotion error:', promoteErr)
      }

      // 3. Initial Analysis handoff. For a 1035-project customer this defers to
      // that project's document-preparation workflow (no duplicate review); for
      // everyone else it creates the prep review. The OUTCOME is persisted to
      // the pre-review so a failed handoff is never silently lost — it stays
      // visible and retryable (handoff_status = 'failed' + handoff_error).
      let handoff
      try {
        handoff = await handoffToInitialAnalysis(supabase, {
          prereviewId,
          customerId,
          policyIds: requestPolicyIds,
        })
      } catch (e) {
        handoff = { status: 'failed' as const, error: e instanceof Error ? e.message : String(e) }
      }
      const { error: hsErr } = await supabase
        .from('customer_prereviews')
        .update({
          handoff_status: handoff.status,
          handoff_error:  handoff.status === 'failed' ? (handoff.error ?? 'Unknown handoff error') : null,
        })
        .eq('id', prereviewId)
      if (hsErr) {
        console.error('stewardship handoff status persist error:', hsErr)
      }

      // Finally, delete the outreach row (cascades stewardship_outreach_policies).
      // The pre-review now carries servicing_completed_at and decision=review_now.
      const { error: delErr } = await supabase
        .from('stewardship_outreach')
        .delete()
        .eq('id', id)
      if (delErr) {
        console.error('stewardship carrier-confirm delete error:', delErr)
        return Response.json({ error: delErr.message }, { status: 500 })
      }
      return Response.json({ data: null, completed_outreach: true })
    }

    // Still have policies awaiting confirmation — return the (still-open) row so
    // the task screen refreshes with the updated per-policy statuses.
    const { data: stillOpen } = await supabase
      .from('stewardship_outreach')
      .select(OUTREACH_COLUMNS)
      .eq('id', id)
      .single()
    return Response.json({ data: stillOpen, completed_outreach: false })
  }

  // ── "Servicing-agent authorization email sent": advance AND record the touch ─
  // This confirmation is the one place the sent authorization email becomes
  // durable history (opening Outlook is a separate mailto that records nothing).
  // Emailing is an INDEPENDENT channel, so an email may be sent from any
  // pre-authorization state (Ready to Email, Ready to Call, Research Needed,
  // Waiting for Response) OR as a chase while awaiting the form/carrier. Two
  // requirements shape this path:
  //
  //   1. A successful send must never silently leave the customer without a
  //      history entry. The touch is recorded as part of the operation; if it
  //      fails we surface an error instead of swallowing it.
  //   2. Repeated or concurrent submits of the SAME send must not create
  //      duplicate touches, while a legitimate later email still does.
  //
  // When the send ADVANCES the funnel (applyAction returned a queue change out
  // of the pre-authorization funnel into waiting-for-response), both are met by
  // a conditional update scoped to the item's CURRENT stored queue: only the
  // first request to flip the row matches, so a duplicate/concurrent submit
  // matches zero rows and records nothing. When the send is a CHASE in an
  // authorization/carrier stage (no queue change), there is no funnel flip to
  // gate on, so we persist email_sent_at and log the touch directly — a chase
  // email is a legitimate new history entry each time it is recorded.
  if (action.type === 'email-sent') {
    const advancesFunnel = result.patch.queue === 'waiting-for-response'
    let advanced: OutreachRow | null = null
    if (advancesFunnel) {
      const { data: advancedRows, error: advErr } = await supabase
        .from('stewardship_outreach')
        .update(result.patch)
        .eq('id', id)
        .eq('queue', state.queue) // atomic flip from the item's current queue
        .select(OUTREACH_COLUMNS)
      if (advErr) {
        console.error('stewardship email-sent advance error:', advErr)
        return Response.json({ error: advErr.message }, { status: 500 })
      }
      // Zero rows: another request already advanced this item (duplicate or
      // concurrent submit). Nothing further to record. Return the current row.
      if (!advancedRows || advancedRows.length === 0) {
        const { data: currentRow } = await supabase
          .from('stewardship_outreach')
          .select(OUTREACH_COLUMNS)
          .eq('id', id)
          .single()
        return Response.json({ data: currentRow, completed_outreach: false })
      }
      advanced = advancedRows[0] as unknown as OutreachRow
    } else {
      // Chase email in a non-funnel stage: persist email_sent_at without moving
      // the queue, then log the touch below.
      if (Object.keys(result.patch).length > 0) {
        const { error: updErr } = await supabase
          .from('stewardship_outreach')
          .update(result.patch)
          .eq('id', id)
        if (updErr) {
          console.error('stewardship email-sent (chase) patch error:', updErr)
          return Response.json({ error: updErr.message }, { status: 500 })
        }
      }
      const { data: cur } = await supabase
        .from('stewardship_outreach')
        .select(OUTREACH_COLUMNS)
        .eq('id', id)
        .single()
      advanced = cur as unknown as OutreachRow
    }

    const touchedBy = await resolveEmployeeName(supabase)
    // Record the actual delivery channel. The introductory servicing-agent form
    // can go out by email OR by postal mail (the worker's chosen
    // form_delivery_method). A postal send must be recorded as a postal touch,
    // not as an email, so history reflects what really happened.
    const isPostal = row.form_delivery_method === 'postal'
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  isPostal ? 'postal' : 'email',
        notes:       isPostal
          ? '1035 servicing-agent authorization letter mailed to the customer by postal mail.'
          : '1035 servicing-agent authorization email sent to the customer.',
        touched_at:  advanced?.email_sent_at ?? new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      // The send must not silently lose its history entry. Surface the failure
      // so the worker knows to retry rather than believing it logged.
      console.error('stewardship send touch log error:', touchErr)
      return Response.json(
        { error: 'The send was recorded but its history entry could not be saved. Please try again.' },
        { status: 500 },
      )
    }

    return Response.json({ data: advanced, completed_outreach: false })
  }

  // Normal case: persist the outreach patch.
  if (Object.keys(result.patch).length > 0) {
    const { error: updErr } = await supabase
      .from('stewardship_outreach')
      .update(result.patch)
      .eq('id', id)
    if (updErr) {
      console.error('stewardship patch error:', updErr)
      return Response.json({ error: updErr.message }, { status: 500 })
    }
  }

  const { data: updated } = await supabase
    .from('stewardship_outreach')
    .select(OUTREACH_COLUMNS)
    .eq('id', id)
    .single()

  return Response.json({ data: updated, completed_outreach: false })
}
