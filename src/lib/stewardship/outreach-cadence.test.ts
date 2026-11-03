/**
 * Servicing-Agent Onboarding — cadence, attempts, contact options, and the
 * Nonresponsive recommendation (Right Path).
 *
 * Runs on the Node built-in test runner (node:test) via jiti, exercising the
 * REAL pure time-math and the REAL GoRules ZEN rules (contact-options.json and
 * outreach-cadence.json) — no copy of the logic. Run with: npm run test:dd
 *
 * Locks in the corrected business rules:
 *   1. Contact options: a usable phone enables BOTH calling and texting; email
 *      enables emailing; these are simultaneous and independent; no usable
 *      method -> Contact Research. (ZEN decides; TS normalizes.)
 *   2. Call cadence: 24h, 24h, 2d, 3d, then every 6 business days rotating
 *      weekdays. Promised callbacks and employee overrides take precedence.
 *   3. Attempts: individual communications group into attempts by day; multiple
 *      communications in one day count as ONE attempt.
 *   4. Nonresponsive: at 7 unsuccessful attempts ZEN flags "review contact
 *      strategy" — a recommendation only, never auto-stop.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  nextAutomaticCallDate,
  resolveNextCallDate,
  isNonresponsive,
  EARLY_CALL_SPACING_DAYS,
  NONRESPONSIVE_ATTEMPT_THRESHOLD,
} from './call-cadence'
import { applyAction, callPopulationOf, deriveFollowUpRouting, deriveEmailRouting, derivePhoneRouting, isIntroductoryEmail, introNeededForReplacedEmail, normalizeRecipientEmail, type OutreachState } from './queues'
import {
  groupIntoAttempts,
  countCallAttempts,
  countOutreachAttempts,
  countUnsuccessfulAttempts,
  unusableChannels,
  parseOutcomeFromNote,
  buildUnusableMarker,
  unusableValueFromNote,
  normalizeUnusableValue,
  OUTCOME_MARKERS,
} from './outreach-attempts'
import { evaluateContactOptions, resolveContactOptions, toContactFacts, initialQueueFromOptions } from './contact-options'
import { evaluateCadenceStatus } from './cadence-status'

const UTC = 'UTC'
// A fixed Monday for deterministic cadence math (2026-01-05 is a Monday).
const MONDAY = new Date('2026-01-05T12:00:00.000Z')

// ── Contact options (ZEN) ────────────────────────────────────────────────────

test('contact options: phone enables BOTH call and text, simultaneously with email', async () => {
  const opts = await evaluateContactOptions({
    hasUsablePhone: true,
    hasUsableEmail: true,
    hasUsableAddress: false,
  })
  assert.equal(opts.canCall, true)
  assert.equal(opts.canText, true)
  assert.equal(opts.canEmail, true)
  assert.equal(opts.needsResearch, false)
})

test('contact options: phone only -> call + text, no email, no research', async () => {
  const opts = await evaluateContactOptions({
    hasUsablePhone: true,
    hasUsableEmail: false,
    hasUsableAddress: false,
  })
  assert.equal(opts.canCall, true)
  assert.equal(opts.canText, true)
  assert.equal(opts.canEmail, false)
  assert.equal(opts.needsResearch, false)
})

test('contact options: no phone and no email -> Contact Research (address alone never qualifies)', async () => {
  const opts = await evaluateContactOptions({
    hasUsablePhone: false,
    hasUsableEmail: false,
    hasUsableAddress: true,
  })
  assert.equal(opts.canCall, false)
  assert.equal(opts.canText, false)
  assert.equal(opts.canEmail, false)
  assert.equal(opts.needsResearch, true)
  // Address still supports postal form delivery once contact is established.
  assert.equal(opts.canPostal, true)
})

test('toContactFacts: usable address requires a street line plus city or zip', () => {
  assert.equal(toContactFacts({ phone: null, email: null, street: '1 Main St', zip: '19000' }).hasUsableAddress, true)
  assert.equal(toContactFacts({ phone: null, email: null, address_line1: '1 Main St', city: 'Phila' }).hasUsableAddress, true)
  assert.equal(toContactFacts({ phone: null, email: null, street: '1 Main St' }).hasUsableAddress, false)
  assert.equal(toContactFacts({ phone: ' ', email: '' }).hasUsablePhone, false)
})

test('initial recommended queue: email first, else call, else research — one workflow', async () => {
  assert.equal(initialQueueFromOptions(await evaluateContactOptions({ hasUsablePhone: true, hasUsableEmail: true, hasUsableAddress: false })).queue, 'ready-to-email')
  assert.equal(initialQueueFromOptions(await evaluateContactOptions({ hasUsablePhone: true, hasUsableEmail: false, hasUsableAddress: false })).queue, 'ready-to-call')
  assert.equal(initialQueueFromOptions(await evaluateContactOptions({ hasUsablePhone: false, hasUsableEmail: false, hasUsableAddress: false })).queue, 'research-needed')
})

// ── Call cadence (pure time-math) ────────────────────────────────────────────

test('cadence: after intro email the first call is due in 24h (1 day)', () => {
  // priorUnsuccessfulAttempts 0 == first call after the intro email.
  const d = nextAutomaticCallDate({ priorUnsuccessfulAttempts: 0, now: MONDAY, actorTimeZone: UTC })
  assert.equal(d, '2026-01-06') // Mon -> Tue
})

test('cadence: early schedule is 24h, 24h, 2d, 3d by attempt index', () => {
  assert.deepEqual(EARLY_CALL_SPACING_DAYS, [1, 1, 2, 3])
  // index 1 (after 1st unsuccessful call): +1 day
  assert.equal(nextAutomaticCallDate({ priorUnsuccessfulAttempts: 1, now: MONDAY, actorTimeZone: UTC }), '2026-01-06')
  // index 2 (after 2nd): +2 days
  assert.equal(nextAutomaticCallDate({ priorUnsuccessfulAttempts: 2, now: MONDAY, actorTimeZone: UTC }), '2026-01-07')
  // index 3 (after 3rd): +3 days
  assert.equal(nextAutomaticCallDate({ priorUnsuccessfulAttempts: 3, now: MONDAY, actorTimeZone: UTC }), '2026-01-08')
})

test('cadence: 4th+ attempts are every 6 business days (never a weekend) and rotate the weekday', () => {
  // From Monday 2026-01-05, +6 business days = Tuesday 2026-01-13 (skips the
  // weekend), advancing the weekday Mon -> Tue.
  const d4 = nextAutomaticCallDate({ priorUnsuccessfulAttempts: 4, now: MONDAY, actorTimeZone: UTC })
  assert.equal(d4, '2026-01-13')
  const weekday = new Date(`${d4}T12:00:00Z`).getUTCDay() // 0=Sun..6=Sat
  assert.ok(weekday >= 1 && weekday <= 5, 'late cadence never lands on a weekend')

  // Rotation: starting from the next landing day advances the weekday again.
  const fromTue = nextAutomaticCallDate({ priorUnsuccessfulAttempts: 4, now: new Date('2026-01-13T12:00:00Z'), actorTimeZone: UTC })
  assert.equal(fromTue, '2026-01-21') // Tue -> Wed, still a weekday
})

test('cadence precedence: promised callback > employee override > automatic cadence', () => {
  const promised = resolveNextCallDate({
    priorUnsuccessfulAttempts: 4,
    now: MONDAY,
    actorTimeZone: UTC,
    promisedCallbackDate: '2026-02-01',
    employeeOverrideDate: '2026-01-20',
  })
  assert.deepEqual(promised, { date: '2026-02-01', source: 'promised_callback' })

  const override = resolveNextCallDate({
    priorUnsuccessfulAttempts: 4,
    now: MONDAY,
    actorTimeZone: UTC,
    promisedCallbackDate: null,
    employeeOverrideDate: '2026-01-20',
  })
  assert.deepEqual(override, { date: '2026-01-20', source: 'employee_override' })

  const cadence = resolveNextCallDate({
    priorUnsuccessfulAttempts: 0,
    now: MONDAY,
    actorTimeZone: UTC,
    promisedCallbackDate: null,
    employeeOverrideDate: null,
  })
  assert.equal(cadence.source, 'cadence')
})

// ── Attempt grouping (IPF grouping model over case_touches) ──────────────────

test('attempts: multiple channels recorded TOGETHER are ONE attempt (shared timestamp)', () => {
  // A call + voicemail + text recorded as one coordinated reach-out share the
  // attempt timestamp (as the touch route writes them), so they are ONE attempt
  // containing multiple channel outcomes — the IPF grouping.
  const attempts = groupIntoAttempts(
    [
      { channel: 'call', at: '2026-01-05T14:00:00.000Z' },
      { channel: 'voicemail', at: '2026-01-05T14:00:00.000Z' },
      { channel: 'text', at: '2026-01-05T14:00:00.000Z' },
    ],
    UTC,
  )
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].communications.length, 3) // every channel preserved
  assert.equal(attempts[0].includedCall, true)
  assert.equal(countOutreachAttempts(attempts), 1)
  assert.equal(countCallAttempts(attempts), 1)
})

test('attempts: two SEPARATE reach-outs on the same day are TWO attempts', () => {
  // Unlike the old by-day grouping, two deliberate reach-outs hours apart on the
  // same day are two distinct attempts (two groupings).
  const attempts = groupIntoAttempts(
    [
      { channel: 'call', at: '2026-01-05T14:00:00Z' },
      { channel: 'call', at: '2026-01-05T18:30:00Z' },
    ],
    UTC,
  )
  assert.equal(attempts.length, 2)
  assert.equal(countCallAttempts(attempts), 2)
})

test('attempts: an email-only attempt counts as an outreach attempt but not a call attempt', () => {
  const attempts = groupIntoAttempts([{ channel: 'email', at: '2026-01-05T10:00:00Z' }], UTC)
  assert.equal(countOutreachAttempts(attempts), 1)
  assert.equal(countCallAttempts(attempts), 0)
})

// ── Channel usability (recorded fact, reused from IPF) ───────────────────────

test('usability: a channel recorded unusable is reported; a touch is not', () => {
  const attempts = groupIntoAttempts(
    [
      { channel: 'call', at: '2026-01-05T14:00:00.000Z', outcome: 'unusable' },
      { channel: 'email', at: '2026-01-05T14:00:00.000Z', outcome: 'touch' },
    ],
    UTC,
  )
  const unusable = unusableChannels(attempts)
  assert.equal(unusable.has('call'), true)
  assert.equal(unusable.has('email'), false)
  // An unusable channel is NOT a touch; the email send is.
  assert.equal(attempts[0].includedTouch, true)
})

test('outcome markers: parsed from the touch note; absence of a marker is a touch', () => {
  assert.equal(parseOutcomeFromNote('Servicing-agent onboarding call: Reached.'), 'touch')
  assert.equal(parseOutcomeFromNote(`Bad number. ${OUTCOME_MARKERS.unusable}`), 'unusable')
  assert.equal(parseOutcomeFromNote(`Left a voicemail. ${OUTCOME_MARKERS.no_contact}`), 'no_contact')
  assert.equal(parseOutcomeFromNote(null), 'touch')
})

test('contact options: a channel recorded unusable is not offered, and all-unusable needs research', async () => {
  // Phone + email on file, but the phone number is recorded unusable: calling
  // AND texting (same number) drop, email remains.
  const phoneUnusable = await evaluateContactOptions(
    { hasUsablePhone: true, hasUsableEmail: true, hasUsableAddress: false },
    { unusableChannels: ['call'] },
  )
  assert.equal(phoneUnusable.canCall, false)
  assert.equal(phoneUnusable.canText, false)
  assert.equal(phoneUnusable.canEmail, true)
  assert.equal(phoneUnusable.needsResearch, false)

  // Every usable channel exhausted -> Contact Research.
  const allGone = await evaluateContactOptions(
    { hasUsablePhone: true, hasUsableEmail: true, hasUsableAddress: false },
    { unusableChannels: ['call', 'email'] },
  )
  assert.equal(allGone.canCall, false)
  assert.equal(allGone.canText, false)
  assert.equal(allGone.canEmail, false)
  assert.equal(allGone.needsResearch, true)
})

// ── Nonresponsive recommendation (ZEN) ───────────────────────────────────────

test('nonresponsive: ZEN flags review strategy at exactly 7 attempts, not before', async () => {
  assert.equal(NONRESPONSIVE_ATTEMPT_THRESHOLD, 7)
  const six = await evaluateCadenceStatus(6)
  assert.equal(six.status, 'active')
  assert.equal(six.isNonresponsive, false)

  const seven = await evaluateCadenceStatus(7)
  assert.equal(seven.status, 'nonresponsive')
  assert.equal(seven.recommendation, 'review_contact_strategy')
  assert.equal(seven.isNonresponsive, true)

  // The pure helper agrees with the ZEN threshold.
  assert.equal(isNonresponsive(6), false)
  assert.equal(isNonresponsive(7), true)
})

// ── Unified coordinated attempt (record-attempt) and queue independence ──────

function state(partial: Partial<OutreachState> = {}): OutreachState {
  return {
    queue: 'ready-to-call',
    call_reason: null,
    research_reason: null,
    last_call_outcome: null,
    callback_date: null,
    email_sent_at: null,
    intro_email_recipient: null,
    follow_up_due: null,
    form_received_at: null,
    submitted_at: null,
    carrier_correction: null,
    form_delivery_method: null,
    refused_at: null,
    has_usable_phone: true,
    ...partial,
  }
}

test('record-attempt: a voicemail call schedules the next call via next_call_date', () => {
  const r = applyAction(state({ queue: 'ready-to-call' }), {
    type: 'record-attempt',
    call: 'voicemail',
    text: 'touch',
    next_call_date: '2026-02-01',
  })
  // The call outcome drives the workflow exactly like call-outcome: voicemail
  // moves to waiting-for-response with the scheduled next call.
  assert.equal(r.patch.queue, 'waiting-for-response')
  assert.equal(r.patch.last_call_outcome, 'voicemail')
  assert.equal(String(r.patch.follow_up_due).slice(0, 10), '2026-02-01')
})

test('record-attempt: a reached call advances the same as call-outcome reached', () => {
  const r = applyAction(state({ queue: 'ready-to-call' }), { type: 'record-attempt', call: 'reached' })
  assert.equal(r.patch.last_call_outcome, 'reached')
  // Reached does not leave the call flow; the form step follows.
  assert.equal(r.patch.queue, undefined)
})

test('record-attempt: a call is allowed from a NON-call queue (queue is not a lock)', () => {
  // A callable customer sitting in Ready to Email can still be called; the pure
  // transition does not reject on the stored queue (the route gates on an actual
  // usable phone instead).
  const r = applyAction(state({ queue: 'ready-to-email' }), { type: 'record-attempt', call: 'voicemail', next_call_date: '2026-02-02' })
  assert.equal(r.error, undefined)
  assert.equal(r.patch.queue, 'waiting-for-response')
})

test('record-attempt: an email-only attempt on a call-flow item schedules the next call without a forced call transition', () => {
  const r = applyAction(state({ queue: 'ready-to-call' }), {
    type: 'record-attempt',
    email: 'touch',
    next_call_date: '2026-02-03',
  })
  assert.equal(r.error, undefined)
  // No call channel: the touches are the progress; the next call is scheduled.
  assert.equal(r.patch.queue, 'waiting-for-response')
  assert.equal(String(r.patch.follow_up_due).slice(0, 10), '2026-02-03')
  assert.equal(r.patch.last_call_outcome, undefined) // no call outcome recorded
})

test('record-attempt: callback sets the promised date and keeps the item in the call flow', () => {
  const r = applyAction(state({ queue: 'ready-to-call' }), {
    type: 'record-attempt',
    call: 'callback',
    callback_date: '2026-02-10',
  })
  assert.equal(r.patch.last_call_outcome, 'callback')
  assert.equal(r.patch.callback_date, '2026-02-10')
  assert.equal(r.patch.queue, 'ready-to-call')
})

test('call-outcome: no longer rejected by the stored queue (parity with record-attempt)', () => {
  // The pure transition for a plain call-outcome also no longer gates on queue;
  // a bad-number from any queue routes to research.
  const r = applyAction(state({ queue: 'ready-to-email' }), { type: 'call-outcome', outcome: 'bad-number' })
  assert.equal(r.error, undefined)
  assert.equal(r.patch.queue, 'research-needed')
})

// ── Backward-movement guard + proceed-to-authorization (Failure 2) ───────────

test('record-attempt: a call CHASE while awaiting the signed form never moves the customer backward', () => {
  // Calling to chase the signature and leaving a voicemail must NOT drop the
  // customer out of waiting-for-form back into the call flow.
  const r = applyAction(state({ queue: 'waiting-for-form' }), { type: 'record-attempt', call: 'voicemail' })
  assert.equal(r.error, undefined)
  assert.equal(r.patch.queue, undefined) // stage preserved
  assert.equal(r.patch.last_call_outcome, 'voicemail') // history still recorded
})

test('record-attempt: a call chase while awaiting the carrier preserves the carrier stage', () => {
  const r = applyAction(state({ queue: 'waiting-for-carrier' }), { type: 'record-attempt', call: 'bad-number' })
  assert.equal(r.patch.queue, undefined) // not moved to research-needed
  assert.equal(r.patch.last_call_outcome, 'bad-number')
})

test('call-outcome: not-interested stops outreach even from a waiting stage', () => {
  const r = applyAction(state({ queue: 'waiting-for-carrier' }), { type: 'call-outcome', outcome: 'not-interested' })
  assert.ok(r.patch.refused_at) // explicit refusal always applies
})

test('form-sent: allowed from Ready to Email (call first, reach, proceed to authorization)', () => {
  const r = applyAction(state({ queue: 'ready-to-email' }), { type: 'form-sent' })
  assert.equal(r.error, undefined)
  assert.equal(r.patch.queue, 'waiting-for-form')
})

// ── Intro email via a coordinated attempt updates progress (Failure 2) ───────

test('record-attempt: an email sent from Ready to Email is the introductory email and advances progress', () => {
  const r = applyAction(state({ queue: 'ready-to-email' }), {
    type: 'record-attempt',
    email: 'touch',
    next_call_date: '2026-03-01',
  })
  assert.equal(r.error, undefined)
  // Leaves the intro-email population so the introduction is never recommended
  // again, and schedules the first call.
  assert.equal(r.patch.queue, 'waiting-for-response')
  assert.ok(r.patch.email_sent_at)
  assert.equal(String(r.patch.follow_up_due).slice(0, 10), '2026-03-01')
})

// ── Only genuinely unsuccessful attempts count (Failure 3) ───────────────────

test('unsuccessful count: a reached attempt is excluded; voicemails count', () => {
  const attempts = groupIntoAttempts(
    [
      { channel: 'call', at: '2026-01-05T14:00:00.000Z', reached: false }, // voicemail-style miss
      { channel: 'call', at: '2026-01-06T14:00:00.000Z', reached: true },  // reached: success
    ],
    UTC,
  )
  assert.equal(countOutreachAttempts(attempts), 2)
  assert.equal(countUnsuccessfulAttempts(attempts), 1) // the reached one does not count
})

test('unsuccessful count: seven unsuccessful attempts flag nonresponsive (advisory, outreach not stopped)', async () => {
  const comms = Array.from({ length: 7 }, (_, i) => ({
    channel: 'call' as const,
    at: new Date(Date.UTC(2026, 0, 5 + i, 14)).toISOString(),
    reached: false,
  }))
  const attempts = groupIntoAttempts(comms, UTC)
  assert.equal(countUnsuccessfulAttempts(attempts), 7)
  const verdict = await evaluateCadenceStatus(countUnsuccessfulAttempts(attempts))
  assert.equal(verdict.isNonresponsive, true)
  // Advisory only: nothing in the verdict stops outreach or sets a terminal state.
  assert.equal(verdict.recommendation, 'review_contact_strategy')
})

// ── Due status is DURABLE across reads/refreshes/transitions (Issue 1) ───────

test('calls-due is read from durable call_reason, so it survives a later read', () => {
  // A cadence retry that came due is persisted as call_reason 'no-response' when
  // the item is promoted to ready-to-call. On ANY later read (no promotion that
  // pass) it must still read as Calls Due, not flip to Available.
  const promoted = deriveFollowUpRouting(
    { queue: 'waiting-for-response', follow_up_due: '2026-01-01T00:00:00.000Z' },
    new Date('2026-02-01T12:00:00Z'),
  )
  assert.equal(promoted?.queue, 'ready-to-call')
  assert.equal(promoted?.call_reason, 'no-response')

  // Simulate the subsequent read: stored queue ready-to-call, durable
  // call_reason 'no-response', nothing promoted this pass.
  const pop = callPopulationOf({
    effectiveQueue: 'ready-to-call',
    callReason: 'no-response',
    hasUsablePhone: true,
    callbackDue: false,
  })
  assert.equal(pop, 'calls-due')
})

test('a due promised callback reads Calls Due; a plain ready-to-call reads Available', () => {
  assert.equal(
    callPopulationOf({ effectiveQueue: 'ready-to-call', callReason: 'callback-due', hasUsablePhone: true, callbackDue: true }),
    'calls-due',
  )
  assert.equal(
    callPopulationOf({ effectiveQueue: 'ready-to-call', callReason: null, hasUsablePhone: true, callbackDue: false }),
    'available-to-call',
  )
})

test('a FUTURE promised callback is Available to Call, not Calls Due, until its date arrives', () => {
  // call_reason is stamped 'callback-due' the moment the callback is scheduled,
  // with a future callback_date. Before that date (callbackDue=false) it must
  // NOT appear in Calls Due; the 'callback-due' reason alone is not "due now".
  assert.equal(
    callPopulationOf({ effectiveQueue: 'ready-to-call', callReason: 'callback-due', hasUsablePhone: true, callbackDue: false }),
    'available-to-call',
  )
  // On/after the scheduled date, callbackDue flips true and it becomes Calls Due.
  assert.equal(
    callPopulationOf({ effectiveQueue: 'ready-to-call', callReason: 'callback-due', hasUsablePhone: true, callbackDue: true }),
    'calls-due',
  )
})

test('a callable ready-to-email customer is Available to Call; no phone is in no call population', () => {
  assert.equal(
    callPopulationOf({ effectiveQueue: 'ready-to-email', callReason: null, hasUsablePhone: true, callbackDue: false }),
    'available-to-call',
  )
  assert.equal(
    callPopulationOf({ effectiveQueue: 'ready-to-call', callReason: 'no-response', hasUsablePhone: false, callbackDue: false }),
    null,
  )
})

// ── Reached-from-Ready-to-Email proceeds to authorization, not an intro (Issue 2)

test('a reached call from Ready to Email keeps the item callable and lets form-sent advance to Waiting for Form', () => {
  // Record a reached call via a coordinated attempt from ready-to-email: stays
  // in ready-to-email (no backward move) and marks reached.
  const reached = applyAction(state({ queue: 'ready-to-email' }), { type: 'record-attempt', call: 'reached' })
  assert.equal(reached.error, undefined)
  assert.equal(reached.patch.last_call_outcome, 'reached')
  assert.equal(reached.patch.queue, undefined) // still ready-to-email

  // The authorization form send then advances to Waiting for Form. This is the
  // form-sent transition (authorization), NOT email-sent (the introduction).
  const formSent = applyAction(state({ queue: 'ready-to-email', last_call_outcome: 'reached' }), { type: 'form-sent' })
  assert.equal(formSent.error, undefined)
  assert.equal(formSent.patch.queue, 'waiting-for-form')
})

// ── deriveEmailRouting: a newly-added email re-routes an UNTOUCHED opener ─────
// An email added after intake must surface the item in Ready to Email (the
// introductory email carries the authorization form), re-derived live from the
// current email the same way callability is derived live from the phone. It
// upgrades ONLY an untouched opening item; anything that has progressed is left
// exactly where it is.

// A minimal input for deriveEmailRouting (the opening ready-to-call "no-email"
// state intake assigns when a phone but no email was on file).
function openingCall(partial: Partial<Parameters<typeof deriveEmailRouting>[0]> = {}) {
  return {
    queue: 'ready-to-call' as const,
    call_reason: 'no-email' as const,
    research_reason: null,
    last_call_outcome: null,
    email_sent_at: null,
    callback_date: null,
    refused_at: null,
    has_usable_email: true,
    ...partial,
  }
}

test('deriveEmailRouting: an untouched opening ready-to-call (no-email) with a new email becomes ready-to-email', () => {
  const patch = deriveEmailRouting(openingCall())
  assert.equal(patch?.queue, 'ready-to-email')
  assert.equal(patch?.call_reason, null)
  assert.equal(patch?.research_reason, null)
})

test('deriveEmailRouting: an untouched opening research-needed (no-contact) with a new email becomes ready-to-email', () => {
  const patch = deriveEmailRouting(
    openingCall({ queue: 'research-needed', call_reason: null, research_reason: 'no-contact' }),
  )
  assert.equal(patch?.queue, 'ready-to-email')
})

test('deriveEmailRouting: no usable email leaves the item where it is', () => {
  assert.equal(deriveEmailRouting(openingCall({ has_usable_email: false })), null)
})

test('deriveEmailRouting: an item already in ready-to-email is unchanged', () => {
  assert.equal(deriveEmailRouting(openingCall({ queue: 'ready-to-email', call_reason: null })), null)
})

test('deriveEmailRouting: a PROGRESSED item is never rerouted (call placed, email sent, callback promised, or research after bad number)', () => {
  // A call was placed (voicemail/reached): real work done, do not reset.
  assert.equal(deriveEmailRouting(openingCall({ last_call_outcome: 'voicemail' })), null)
  assert.equal(deriveEmailRouting(openingCall({ last_call_outcome: 'reached' })), null)
  // An intro email already went out.
  assert.equal(deriveEmailRouting(openingCall({ email_sent_at: '2026-01-01T00:00:00.000Z' })), null)
  // A promised callback exists (a personal follow-up was accepted).
  assert.equal(
    deriveEmailRouting(openingCall({ queue: 'ready-to-call', call_reason: 'callback-due', callback_date: '2026-02-01' })),
    null,
  )
  // Research reached via a bad number (not the no-contact opener) is real
  // research state, not an untouched opener.
  assert.equal(
    deriveEmailRouting(openingCall({ queue: 'research-needed', call_reason: null, research_reason: 'bad-number' })),
    null,
  )
})

test('deriveEmailRouting: a refused item is never rerouted', () => {
  assert.equal(deriveEmailRouting(openingCall({ refused_at: '2026-01-01T00:00:00.000Z' })), null)
})

test('deriveEmailRouting: a ready-to-call that is a cadence retry (no-response), not the opener, is not rerouted', () => {
  // 'no-response' is a lapsed-cadence retry, i.e. a call was already attempted;
  // only the ORIGINAL opening 'no-email' reason is an untouched opener.
  assert.equal(deriveEmailRouting(openingCall({ call_reason: 'no-response' })), null)
})

// ── Replaced-address re-offer of the introductory email (Fix #1) ─────────────
// The introduction went to an OLD address. Replacing the email, while still in
// the pre-authorization funnel, makes the introduction available again for the
// NEW address — without restarting onboarding once authorization has progressed.

test('introNeededForReplacedEmail: a prior intro to a now-replaced address is re-offered', () => {
  assert.equal(
    introNeededForReplacedEmail({
      emailSentAt: '2026-01-01T00:00:00.000Z',
      currentEmail: 'new@example.com',
      introEmailRecipient: 'old@example.com',
    }),
    true,
  )
})

test('introNeededForReplacedEmail: the same address (case/space-insensitive) is NOT re-offered', () => {
  assert.equal(
    introNeededForReplacedEmail({
      emailSentAt: '2026-01-01T00:00:00.000Z',
      currentEmail: '  Same@Example.com ',
      introEmailRecipient: 'same@example.com',
    }),
    false,
  )
})

test('introNeededForReplacedEmail: no prior send, no current email, or legacy (unrecorded) recipient is NOT re-offered', () => {
  // No introduction sent yet.
  assert.equal(introNeededForReplacedEmail({ emailSentAt: null, currentEmail: 'new@example.com', introEmailRecipient: null }), false)
  // No usable email now (nothing to re-offer to).
  assert.equal(introNeededForReplacedEmail({ emailSentAt: '2026-01-01T00:00:00.000Z', currentEmail: null, introEmailRecipient: 'old@example.com' }), false)
  // Legacy send with no recorded recipient: treated as delivered to the address
  // on file, never resurfaced spuriously.
  assert.equal(introNeededForReplacedEmail({ emailSentAt: '2026-01-01T00:00:00.000Z', currentEmail: 'x@example.com', introEmailRecipient: null }), false)
})

test('deriveEmailRouting: a replaced email re-offers the intro from waiting-for-response (pre-auth)', () => {
  // The intro was sent (email_sent_at set) and the item advanced to
  // waiting-for-response — but to the OLD address. A replacement email, still
  // pre-authorization, routes back to ready-to-email so the intro is offered
  // again for the new address.
  const patch = deriveEmailRouting(
    openingCall({
      queue: 'waiting-for-response',
      call_reason: null,
      email_sent_at: '2026-01-01T00:00:00.000Z',
      current_email: 'new@example.com',
      intro_email_recipient: 'old@example.com',
    }),
  )
  assert.equal(patch?.queue, 'ready-to-email')
})

test('deriveEmailRouting: a replaced email NEVER restarts onboarding past authorization', () => {
  // Awaiting the signed form or carrier is past authorization: a replacement
  // email is a chase, never a reset to the introductory email.
  for (const queue of ['waiting-for-form', 'waiting-for-carrier'] as const) {
    assert.equal(
      deriveEmailRouting(
        openingCall({
          queue,
          call_reason: null,
          email_sent_at: '2026-01-01T00:00:00.000Z',
          current_email: 'new@example.com',
          intro_email_recipient: 'old@example.com',
        }),
      ),
      null,
    )
  }
})

test('deriveEmailRouting: the SAME email (unchanged recipient) does not re-offer the intro', () => {
  assert.equal(
    deriveEmailRouting(
      openingCall({
        queue: 'waiting-for-response',
        call_reason: null,
        email_sent_at: '2026-01-01T00:00:00.000Z',
        current_email: 'same@example.com',
        intro_email_recipient: 'same@example.com',
      }),
    ),
    null,
  )
})

test('isIntroductoryEmail: a replaced-address item routed back to ready-to-email IS an introduction again', () => {
  // After deriveEmailRouting re-routes to ready-to-email, the predicate must
  // recognize it as an introduction even though email_sent_at is set, because
  // the recorded recipient differs from the current email.
  assert.equal(
    isIntroductoryEmail({
      effectiveQueue: 'ready-to-email',
      emailSentAt: '2026-01-01T00:00:00.000Z',
      lastCallOutcome: null,
      callbackDate: null,
      currentEmail: 'new@example.com',
      introEmailRecipient: 'old@example.com',
    }),
    true,
  )
})

test('isIntroductoryEmail: a sent intro to the SAME current address is NOT a fresh introduction', () => {
  assert.equal(
    isIntroductoryEmail({
      effectiveQueue: 'ready-to-email',
      emailSentAt: '2026-01-01T00:00:00.000Z',
      lastCallOutcome: null,
      callbackDate: null,
      currentEmail: 'same@example.com',
      introEmailRecipient: 'same@example.com',
    }),
    false,
  )
})

test('normalizeRecipientEmail: trims, lowercases, and blanks to null', () => {
  assert.equal(normalizeRecipientEmail('  Foo@Bar.COM '), 'foo@bar.com')
  assert.equal(normalizeRecipientEmail('   '), null)
  assert.equal(normalizeRecipientEmail(null), null)
})

// ── derivePhoneRouting: a replacement number returns the customer to calling ──
// A customer sent to Research Needed for a missing/bad phone must return to
// Available to Call once a usable number is on file — the phone analogue of the
// email re-derivation. This is the second half of the Bad Number correction:
// the number becomes usable AND the customer re-enters calling work, without
// restarting onboarding or touching Waiting for Form / Waiting for Carrier.

function researchForBadNumber(partial: Partial<Parameters<typeof derivePhoneRouting>[0]> = {}) {
  return {
    queue: 'research-needed' as const,
    call_reason: null,
    research_reason: 'bad-number' as const,
    last_call_outcome: null,
    email_sent_at: null,
    callback_date: null,
    refused_at: null,
    has_usable_phone: true,
    has_usable_email: false,
    current_email: null,
    intro_email_recipient: null,
    ...partial,
  }
}

test('derivePhoneRouting: a replacement number returns a bad-number research item to Ready to Call', () => {
  const patch = derivePhoneRouting(researchForBadNumber())
  assert.equal(patch?.queue, 'ready-to-call')
  assert.equal(patch?.research_reason, null)
  // No due signal, so it lands in Available to Call (not Calls Due).
  assert.equal(patch?.call_reason, null)
})

test('derivePhoneRouting: a bounce-no-phone item that gains a phone returns to Ready to Call (email-bounced)', () => {
  const patch = derivePhoneRouting(researchForBadNumber({ research_reason: 'bounce-no-phone' }))
  assert.equal(patch?.queue, 'ready-to-call')
  assert.equal(patch?.research_reason, null)
  // The email bounced and a phone now exists: the reducer's own bounce+phone
  // outcome (email-bounced) is preserved.
  assert.equal(patch?.call_reason, 'email-bounced')
})

test('derivePhoneRouting: a no-contact item that gains a phone becomes callable', () => {
  const patch = derivePhoneRouting(researchForBadNumber({ research_reason: 'no-contact' }))
  assert.equal(patch?.queue, 'ready-to-call')
  assert.equal(patch?.research_reason, null)
})

test('derivePhoneRouting: no usable phone leaves the item in research', () => {
  assert.equal(derivePhoneRouting(researchForBadNumber({ has_usable_phone: false })), null)
})

test('derivePhoneRouting: a refused item is never rerouted', () => {
  assert.equal(derivePhoneRouting(researchForBadNumber({ refused_at: '2026-01-01T00:00:00.000Z' })), null)
})

test('derivePhoneRouting: never touches an authorization/carrier stage (onboarding is not restarted)', () => {
  for (const queue of ['waiting-for-form', 'waiting-for-carrier', 'ready-to-email', 'waiting-for-response'] as const) {
    assert.equal(
      // research_reason is irrelevant off research-needed; the queue gate alone
      // keeps these stages untouched so completed outreach is preserved.
      derivePhoneRouting(researchForBadNumber({ queue, research_reason: null })),
      null,
    )
  }
})

test('derivePhoneRouting end-to-end: a replaced bad number actually surfaces as Available to Call', () => {
  // The requirement is not merely that the number is usable, but that the
  // customer returns to calling work. Compose the two pure steps the reads use:
  // the effective queue from the phone re-derivation, then the call population.
  const eff = derivePhoneRouting(researchForBadNumber())?.queue ?? 'research-needed'
  const population = callPopulationOf({
    effectiveQueue: eff,
    callReason: null,
    hasUsablePhone: true,
    callbackDue: false,
    engaged: false,
  })
  assert.equal(eff, 'ready-to-call')
  assert.equal(population, 'available-to-call')
})

test('derivePhoneRouting end-to-end: still in research while no replacement exists', () => {
  // Before a replacement, the customer stays in research and is NOT callable.
  const eff = derivePhoneRouting(researchForBadNumber({ has_usable_phone: false }))?.queue ?? 'research-needed'
  const population = callPopulationOf({
    effectiveQueue: eff,
    callReason: null,
    hasUsablePhone: false,
    callbackDue: false,
    engaged: false,
  })
  assert.equal(eff, 'research-needed')
  assert.equal(population, null)
})

// ── Introductory-email precedence over phone routing (PR #15 follow-up) ──────
// An UNTOUCHED no-contact opener (no email AND no phone at intake) that gains
// BOTH an email and a phone must open with the introductory email, not a call.
// derivePhoneRouting must yield so deriveEmailRouting takes the item.

test('derivePhoneRouting: an untouched no-contact opener with BOTH email and phone yields to the introductory email', () => {
  // The exact regression PR #15 could cause: no-contact + usable phone would
  // have promoted to ready-to-call. With a usable email also present and the
  // item untouched, phone routing must yield (null) so email routing wins.
  const patch = derivePhoneRouting(
    researchForBadNumber({ research_reason: 'no-contact', has_usable_email: true, current_email: 'c@example.com' }),
  )
  assert.equal(patch, null)
  // And the email side DOES take it to ready-to-email (the introductory email).
  const emailPatch = deriveEmailRouting({
    queue: 'research-needed',
    call_reason: null,
    research_reason: 'no-contact',
    last_call_outcome: null,
    email_sent_at: null,
    callback_date: null,
    refused_at: null,
    has_usable_email: true,
    current_email: 'c@example.com',
    intro_email_recipient: null,
  })
  assert.equal(emailPatch?.queue, 'ready-to-email')
})

test('derivePhoneRouting: a no-contact opener with ONLY a phone (no email) still returns to Ready to Call', () => {
  // No email means no introductory-email precedence to defer to, so the
  // now-callable customer still returns to calling work.
  const patch = derivePhoneRouting(researchForBadNumber({ research_reason: 'no-contact', has_usable_email: false }))
  assert.equal(patch?.queue, 'ready-to-call')
  assert.equal(patch?.research_reason, null)
})

test('derivePhoneRouting: a no-contact opener that ALREADY sent the intro email is callable once a phone arrives', () => {
  // The intro email already went out (email_sent_at set to the current
  // recipient), so deriveEmailRouting no longer claims it; a phone arriving now
  // correctly returns the customer to Ready to Call rather than re-opening email.
  const patch = derivePhoneRouting(
    researchForBadNumber({
      research_reason: 'no-contact',
      has_usable_email: true,
      current_email: 'c@example.com',
      intro_email_recipient: 'c@example.com',
      email_sent_at: '2026-01-01T00:00:00.000Z',
    }),
  )
  assert.equal(patch?.queue, 'ready-to-call')
})

test('derivePhoneRouting: Bad Number recovery is UNCHANGED when an email is also present', () => {
  // A bad-number item is not an untouched no-contact opener (a call was placed),
  // so the introductory-email precedence never applies: it returns to calling
  // work whether or not a usable email exists. Bad Number recovery intact.
  assert.equal(
    derivePhoneRouting(researchForBadNumber({ has_usable_email: true, current_email: 'c@example.com' }))?.queue,
    'ready-to-call',
  )
  // bounce-no-phone likewise (an email flow already ran): still returns to call.
  assert.equal(
    derivePhoneRouting(researchForBadNumber({ research_reason: 'bounce-no-phone', has_usable_email: true, current_email: 'c@example.com' }))?.queue,
    'ready-to-call',
  )
})

// ── Value-scoped unusable: replacement restores eligibility (Fix #1) ─────────
// A bad number / bounced email is unusable for the SPECIFIC value, not the
// channel forever. The marker records the failed value so a later comparison
// against the value on file tells a replacement from the still-failed value.

test('buildUnusableMarker: records the normalized failed value; parses back; bare marker when unknown', () => {
  const phoneMarker = buildUnusableMarker('call', '(215) 555-0100')
  assert.equal(phoneMarker, '[channel-unusable:2155550100]')
  assert.equal(unusableValueFromNote(`Bad number. ${phoneMarker}`), '2155550100')

  const emailMarker = buildUnusableMarker('email', '  Old@Example.com ')
  assert.equal(emailMarker, '[channel-unusable:old@example.com]')
  assert.equal(unusableValueFromNote(`Bounced. ${emailMarker}`), 'old@example.com')

  // Unknown value -> bare legacy marker; still parses as 'unusable', no value.
  assert.equal(buildUnusableMarker('email', null), OUTCOME_MARKERS.unusable)
  assert.equal(unusableValueFromNote(`Bounced. ${OUTCOME_MARKERS.unusable}`), null)
})

test('normalizeUnusableValue: phones compare by digits, emails by lowercase/trim', () => {
  // Same number in different formats normalizes identically (so a reformatted
  // but unchanged number stays unusable), a different number does not.
  assert.equal(normalizeUnusableValue('call', '215-555-0100'), normalizeUnusableValue('voicemail', '(215) 555 0100'))
  assert.notEqual(normalizeUnusableValue('call', '215-555-0100'), normalizeUnusableValue('call', '215-555-0199'))
  assert.equal(normalizeUnusableValue('email', 'A@B.com'), 'a@b.com')
  assert.equal(normalizeUnusableValue('email', '   '), null)
})

test('value-scoped unusable: a replacement value is no longer suppressed; the same value still is', () => {
  // Emulate the readUnusableChannelsByCustomer comparison: a channel stays
  // unusable only while the recorded failed value equals the current value.
  const failed = unusableValueFromNote(`Bad number. ${buildUnusableMarker('call', '215-555-0100')}`)
  const stillSame = normalizeUnusableValue('call', '(215) 555-0100') // same number, reformatted
  const replaced = normalizeUnusableValue('call', '267-555-0133')     // a new number
  assert.equal(stillSame, failed)      // same value -> still unusable
  assert.notEqual(replaced, failed)    // replacement -> eligibility restored
})

// ── Fix #4: email follow-up must not become an actionable call without a phone ──

test('deriveFollowUpRouting: an overdue email follow-up WITH a usable phone -> Ready to Call', () => {
  const patch = deriveFollowUpRouting(
    { queue: 'waiting-for-response', follow_up_due: '2026-01-01T00:00:00.000Z', has_usable_phone: true },
    new Date('2026-02-01T12:00:00Z'),
  )
  assert.equal(patch?.queue, 'ready-to-call')
  assert.equal(patch?.call_reason, 'no-response')
})

test('deriveFollowUpRouting: an overdue email follow-up WITHOUT a usable phone -> Research Needed (no actionable call)', () => {
  const patch = deriveFollowUpRouting(
    { queue: 'waiting-for-response', follow_up_due: '2026-01-01T00:00:00.000Z', has_usable_phone: false },
    new Date('2026-02-01T12:00:00Z'),
  )
  // Never an actionable call without a phone: routed to research for the missing
  // phone, preserving progress (not reset, not refused).
  assert.equal(patch?.queue, 'research-needed')
  assert.equal(patch?.research_reason, 'bounce-no-phone')
  assert.equal(patch?.call_reason, null)
})

test('deriveFollowUpRouting: a phoneless overdue follow-up is NEVER in a call population', () => {
  // Compose the two pure steps the reads use: the effective queue from the
  // phone-gated follow-up, then the call population. No phone -> research-needed
  // -> callPopulationOf returns null (no usable phone AND not a callable queue).
  const eff = deriveFollowUpRouting(
    { queue: 'waiting-for-response', follow_up_due: '2026-01-01T00:00:00.000Z', has_usable_phone: false },
    new Date('2026-02-01T12:00:00Z'),
  )?.queue ?? 'waiting-for-response'
  const pop = callPopulationOf({
    effectiveQueue: eff,
    callReason: null,
    hasUsablePhone: false,
    callbackDue: false,
  })
  assert.equal(pop, null)
})

test('deriveFollowUpRouting: not overdue, or not waiting-for-response, returns null regardless of phone', () => {
  // Future follow-up: nothing to promote.
  assert.equal(
    deriveFollowUpRouting(
      { queue: 'waiting-for-response', follow_up_due: '2027-01-01T00:00:00.000Z', has_usable_phone: false },
      new Date('2026-02-01T12:00:00Z'),
    ),
    null,
  )
  // A refused item is never resurfaced.
  assert.equal(
    deriveFollowUpRouting(
      { queue: 'waiting-for-response', follow_up_due: '2026-01-01T00:00:00.000Z', refused_at: '2026-01-02T00:00:00.000Z', has_usable_phone: false },
      new Date('2026-02-01T12:00:00Z'),
    ),
    null,
  )
})

test('parseOutcomeFromNote: recognizes BOTH the bare and the value-scoped unusable markers', () => {
  assert.equal(parseOutcomeFromNote(`Bad number. ${OUTCOME_MARKERS.unusable}`), 'unusable')
  assert.equal(parseOutcomeFromNote(`Bad number. ${buildUnusableMarker('call', '215-555-0100')}`), 'unusable')
  assert.equal(parseOutcomeFromNote('Servicing-agent onboarding call: Reached.'), 'touch')
})

// ── Contact-action availability after a Customer Contact Card save ───────────
// These lock in the behavior the stewardship workflow now relies on: after the
// self-contained card saves, the workflow recomputes the AUTHORITATIVE
// contact_options from the saved facts via resolveContactOptions (the one
// server path). No second client-side availability calculation exists, so these
// exercise exactly what the reload produces. The value-scoped comparison the
// stewardship read performs against the current phone is modeled with
// normalizeUnusableValue, as the existing value-scoped test does.

test('availability: reformatting the SAME number keeps a value-scoped call-unusable restriction (digits identity)', async () => {
  // A recorded bad-number failure for 814-808-7526; the number on file is later
  // shown reformatted as (814) 808-7526. The read resolves the per-number
  // unusable fact by comparing digits, so the restriction still applies.
  const failedDigits = unusableValueFromNote(`Bad number. ${buildUnusableMarker('call', '814-808-7526')}`)
  const currentDigits = normalizeUnusableValue('call', '(814) 808-7526')
  assert.equal(currentDigits, failedDigits) // reformat is the SAME number

  // Because it is still unusable, the resolved options subtract call+text (both
  // ride the number); the reformat did NOT silently restore them.
  const opts = await resolveContactOptions(
    { phone: '(814) 808-7526', email: null, street: null, city: null, state: null, zip: null },
    ['call'],
  )
  assert.equal(opts.canCall, false)
  assert.equal(opts.canText, false)
  assert.equal(opts.needsResearch, true)
})

test('availability: replacing a genuinely unusable number restores BOTH calling and texting', async () => {
  // The failed number is 814-808-7526; the card saves a DIFFERENT number.
  const failedDigits = unusableValueFromNote(`Bad number. ${buildUnusableMarker('call', '814-808-7526')}`)
  const replacedDigits = normalizeUnusableValue('call', '267-555-0133')
  assert.notEqual(replacedDigits, failedDigits) // genuinely a new number

  // The value-scoped mark no longer matches the current number, so the read
  // contributes no unusable channel. resolveContactOptions then restores call
  // AND text from the usable number — the Call/Voicemail AND Text actions all
  // come back without a page refresh.
  const opts = await resolveContactOptions(
    { phone: '267-555-0133', email: null, street: null, city: null, state: null, zip: null },
    [], // the old failure is value-scoped away by the current-number comparison
  )
  assert.equal(opts.canCall, true)
  assert.equal(opts.canText, true)
  assert.equal(opts.needsResearch, false)
})

test('availability: Do Not Text disables ONLY texting; calling stays available', async () => {
  // A usable number with the durable Do Not Text opt-out set. resolveContactOptions
  // subtracts texting only; calling is untouched.
  const optedOut = await resolveContactOptions(
    { phone: '267-555-0133', email: null, street: null, city: null, state: null, zip: null },
    [],
    true, // customers.sms_opt_out
  )
  assert.equal(optedOut.canCall, true)
  assert.equal(optedOut.canText, false)

  // Clearing Do Not Text (opt-out false) restores texting on an otherwise
  // eligible number.
  const cleared = await resolveContactOptions(
    { phone: '267-555-0133', email: null, street: null, city: null, state: null, zip: null },
    [],
    false,
  )
  assert.equal(cleared.canCall, true)
  assert.equal(cleared.canText, true)
})

test('availability: Text Undeliverable for the current number disables ONLY texting; calling stays available', async () => {
  // The text channel is recorded unusable for the number on file (Text
  // Undeliverable). Texting drops; calling on the same number remains.
  const opts = await resolveContactOptions(
    { phone: '267-555-0133', email: null, street: null, city: null, state: null, zip: null },
    ['text'],
  )
  assert.equal(opts.canCall, true)
  assert.equal(opts.canText, false)
  assert.equal(opts.needsResearch, false)
})
