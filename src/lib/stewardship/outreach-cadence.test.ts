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
import { applyAction, type OutreachState } from './queues'
import {
  groupIntoAttempts,
  countCallAttempts,
  countOutreachAttempts,
  countUnsuccessfulAttempts,
  unusableChannels,
  parseOutcomeFromNote,
  OUTCOME_MARKERS,
} from './outreach-attempts'
import { evaluateContactOptions, toContactFacts, initialQueueFromOptions } from './contact-options'
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
