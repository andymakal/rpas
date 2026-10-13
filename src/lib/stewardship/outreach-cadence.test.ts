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
import { groupIntoAttempts, countCallAttempts, countOutreachAttempts } from './outreach-attempts'
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

// ── Attempt grouping (pure) ──────────────────────────────────────────────────

test('attempts: multiple communications on one day count as ONE attempt', () => {
  const attempts = groupIntoAttempts(
    [
      { channel: 'call', at: '2026-01-05T14:00:00Z' },
      { channel: 'voicemail', at: '2026-01-05T14:01:00Z' },
      { channel: 'text', at: '2026-01-05T15:00:00Z' },
      { channel: 'call', at: '2026-01-07T16:00:00Z' },
    ],
    UTC,
  )
  assert.equal(attempts.length, 2) // two distinct days
  assert.equal(countCallAttempts(attempts), 2) // both days included a call
  assert.equal(countOutreachAttempts(attempts), 2)
  // The first attempt preserves all three individual communications.
  assert.equal(attempts[0].communications.length, 3)
})

test('attempts: an email-only day is an outreach attempt but not a call attempt', () => {
  const attempts = groupIntoAttempts(
    [{ channel: 'email', at: '2026-01-05T10:00:00Z' }],
    UTC,
  )
  assert.equal(countOutreachAttempts(attempts), 1)
  assert.equal(countCallAttempts(attempts), 0)
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
