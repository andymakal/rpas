/**
 * Customer Interaction predicate — the step between routine calling/outreach and
 * Servicing Access. These tests pin the shared membership rule both My Work and
 * the board route use:
 *
 *   - A genuinely engaged, pre-authorization customer IS in the population.
 *   - A reached call, a promised callback, or a recorded inbound response
 *     (engagedAt) counts as engagement.
 *   - A voicemail / no-response / bad-number is NOT engagement.
 *   - A refused customer, or one past the funnel into servicing access (form in
 *     hand / waiting-for-form / waiting-for-carrier), is excluded.
 *   - engagedAtOf reads the action_context marker safely.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { isCustomerInteraction, engagedAtOf, ENGAGED_AT_KEY } from './queues'

const base = {
  effectiveQueue: 'ready-to-call' as const,
  lastCallOutcome: null,
  callbackDate: null,
  formReceivedAt: null,
  refusedAt: null,
  engagedAt: null,
}

test('reached on a call is an active conversation', () => {
  assert.equal(isCustomerInteraction({ ...base, lastCallOutcome: 'reached' }), true)
})

test('a promised callback is an active conversation', () => {
  assert.equal(isCustomerInteraction({ ...base, lastCallOutcome: 'callback', callbackDate: '2026-11-01' }), true)
  // A callback date alone (however recorded) also counts.
  assert.equal(isCustomerInteraction({ ...base, callbackDate: '2026-11-01' }), true)
})

test('a recorded inbound response (engagedAt) is an active conversation', () => {
  assert.equal(isCustomerInteraction({ ...base, engagedAt: '2026-10-22T10:00:00.000Z' }), true)
})

test('voicemail / no-response / bad-number are NOT engagement', () => {
  assert.equal(isCustomerInteraction({ ...base, lastCallOutcome: 'voicemail' }), false)
  assert.equal(isCustomerInteraction({ ...base, lastCallOutcome: 'bad-number' }), false)
  // Nothing recorded at all: not yet engaged.
  assert.equal(isCustomerInteraction(base), false)
})

test('an explicit refusal is excluded even when previously engaged', () => {
  assert.equal(
    isCustomerInteraction({ ...base, lastCallOutcome: 'reached', refusedAt: '2026-10-22T10:00:00.000Z' }),
    false,
  )
})

test('a customer past the funnel into servicing access is excluded', () => {
  // Signed form in hand.
  assert.equal(
    isCustomerInteraction({ ...base, lastCallOutcome: 'reached', formReceivedAt: '2026-10-22T10:00:00.000Z' }),
    false,
  )
  // Waiting-for-form / waiting-for-carrier are the servicing-access stages.
  assert.equal(
    isCustomerInteraction({ ...base, effectiveQueue: 'waiting-for-form', lastCallOutcome: 'reached' }),
    false,
  )
  assert.equal(
    isCustomerInteraction({ ...base, effectiveQueue: 'waiting-for-carrier', lastCallOutcome: 'reached' }),
    false,
  )
})

test('engagedAtOf reads the marker safely', () => {
  assert.equal(engagedAtOf({ [ENGAGED_AT_KEY]: '2026-10-22T10:00:00.000Z' }), '2026-10-22T10:00:00.000Z')
  assert.equal(engagedAtOf({}), null)
  assert.equal(engagedAtOf(null), null)
  assert.equal(engagedAtOf('nope'), null)
  assert.equal(engagedAtOf({ [ENGAGED_AT_KEY]: '' }), null)
})
