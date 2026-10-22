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

import {
  isCustomerInteraction, isEngaged, isServicingAccess, engagedAtOf, ENGAGED_AT_KEY,
  isIntroductoryEmail, callPopulationOf,
} from './queues'

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

test('servicing access is RECEIPT of the signed form, not merely sending it', () => {
  // Signed form IN HAND (receipt recorded): leaves Customer Interaction.
  assert.equal(
    isCustomerInteraction({ ...base, lastCallOutcome: 'reached', formReceivedAt: '2026-10-22T10:00:00.000Z' }),
    false,
  )
  // Form SENT, awaiting signature (waiting-for-form, NO receipt): the customer
  // is still in an active conversation — sending the form must NOT move them to
  // servicing access.
  assert.equal(
    isCustomerInteraction({ ...base, effectiveQueue: 'waiting-for-form', lastCallOutcome: 'reached', formReceivedAt: null }),
    true,
  )
  // waiting-for-form WITH a recorded receipt is servicing access (form in hand).
  assert.equal(
    isCustomerInteraction({ ...base, effectiveQueue: 'waiting-for-form', lastCallOutcome: 'reached', formReceivedAt: '2026-10-22T10:00:00.000Z' }),
    false,
  )
  // waiting-for-carrier is only reachable after receipt, so it is servicing access.
  assert.equal(
    isCustomerInteraction({ ...base, effectiveQueue: 'waiting-for-carrier', lastCallOutcome: 'reached', formReceivedAt: '2026-10-22T10:00:00.000Z' }),
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

test('isEngaged: inbound response, reached, or callback; not voicemail/none', () => {
  assert.equal(isEngaged({ lastCallOutcome: null, callbackDate: null, engagedAt: '2026-10-22T10:00:00.000Z' }), true)
  assert.equal(isEngaged({ lastCallOutcome: 'reached', callbackDate: null }), true)
  assert.equal(isEngaged({ lastCallOutcome: 'callback', callbackDate: '2026-11-01' }), true)
  assert.equal(isEngaged({ lastCallOutcome: 'voicemail', callbackDate: null }), false)
  assert.equal(isEngaged({ lastCallOutcome: null, callbackDate: null }), false)
})

test('isServicingAccess: receipt only, never a refused item', () => {
  assert.equal(isServicingAccess({ formReceivedAt: '2026-10-22T10:00:00.000Z', refusedAt: null }), true)
  assert.equal(isServicingAccess({ formReceivedAt: null, refusedAt: null }), false)
  assert.equal(isServicingAccess({ formReceivedAt: '2026-10-22T10:00:00.000Z', refusedAt: '2026-10-22T11:00:00.000Z' }), false)
})

test('an engaged customer is excluded from the introductory-email population', () => {
  // John La Bar exactly: ready-to-email, no email sent, engaged by inbound email.
  const john = {
    effectiveQueue: 'ready-to-email' as const,
    emailSentAt: null,
    lastCallOutcome: null,
    callbackDate: null,
    currentEmail: 'john@example.com',
    introEmailRecipient: null,
  }
  // Without the engaged flag he would be a first-touch intro email.
  assert.equal(isIntroductoryEmail(john), true)
  // Engaged: he has left routine first-touch outreach for Customer Interaction.
  assert.equal(isIntroductoryEmail({ ...john, engaged: true }), false)
})

test('an engaged customer is excluded from the call populations', () => {
  const callable = {
    effectiveQueue: 'ready-to-call' as const,
    callReason: 'callback-due' as const,
    hasUsablePhone: true,
    callbackDue: true,
  }
  // Without the engaged flag a due callback is Calls Due.
  assert.equal(callPopulationOf(callable), 'calls-due')
  // Engaged: worked in Customer Interaction, not surfaced in routine calling.
  assert.equal(callPopulationOf({ ...callable, engaged: true }), null)
})
