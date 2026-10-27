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
  isIntroductoryEmail, callPopulationOf, applyAction, type OutreachState,
} from './queues'
import { buildCustomerHistory, type HistoryTouchRow } from './customer-history'

/** A minimal pre-authorization state for transition tests. */
function baseState(over: Partial<OutreachState> = {}): OutreachState {
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
    ...over,
  }
}

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

test('set-follow-up in the pre-authorization funnel sets a promised callback date', () => {
  const r = applyAction(baseState({ queue: 'waiting-for-response' }), {
    type: 'set-follow-up', follow_up_date: '2026-11-05',
  })
  assert.equal(r.error, undefined)
  assert.equal(r.patch.queue, 'ready-to-call')
  assert.equal(r.patch.call_reason, 'callback-due')
  assert.equal(r.patch.callback_date, '2026-11-05')
})

test('set-follow-up works for a customer AWAITING a signed authorization (waiting-for-form, no receipt)', () => {
  // The reported bug: a customer whose authorization was SENT but not returned
  // sits in waiting-for-form with no receipt and must still accept a follow-up.
  const r = applyAction(baseState({ queue: 'waiting-for-form', form_received_at: null }), {
    type: 'set-follow-up', follow_up_date: '2026-11-05',
  })
  assert.equal(r.error, undefined)
  // Stays in waiting-for-form (no backward move); the signature chase is set to
  // the chosen date.
  assert.equal(r.patch.queue, undefined)
  assert.equal(r.patch.follow_up_due, '2026-11-05T00:00:00.000Z')
})

test('set-follow-up is rejected only once the form is in hand or at the carrier stage', () => {
  // Form already received -> Servicing Access owns it now.
  const received = applyAction(
    baseState({ queue: 'waiting-for-form', form_received_at: '2026-10-22T00:00:00.000Z' }),
    { type: 'set-follow-up', follow_up_date: '2026-11-05' },
  )
  assert.ok(received.error)
  // Carrier stage uses its own record-follow-up chase.
  const carrier = applyAction(baseState({ queue: 'waiting-for-carrier' }), {
    type: 'set-follow-up', follow_up_date: '2026-11-05',
  })
  assert.ok(carrier.error)
})

test('complete-follow-up clears the due marker so it is no longer overdue', () => {
  // Pre-authorization: clears the promised callback + callback-due reason.
  const preAuth = applyAction(
    baseState({ queue: 'ready-to-call', call_reason: 'callback-due', callback_date: '2026-10-20' }),
    { type: 'complete-follow-up' },
  )
  assert.equal(preAuth.error, undefined)
  assert.equal(preAuth.patch.callback_date, null)
  assert.equal(preAuth.patch.call_reason, null)
  // Awaiting signature: clears follow_up_due, keeping the stage.
  const awaiting = applyAction(
    baseState({ queue: 'waiting-for-form', form_received_at: null, follow_up_due: '2026-10-20T00:00:00.000Z' }),
    { type: 'complete-follow-up' },
  )
  assert.equal(awaiting.error, undefined)
  assert.equal(awaiting.patch.follow_up_due, null)
  assert.equal(awaiting.patch.queue, undefined) // stage unchanged
})

test('refuse stops outreach channel-agnostically (no call required)', () => {
  const r = applyAction(baseState({ queue: 'ready-to-email' }), { type: 'refuse' })
  assert.equal(r.error, undefined)
  assert.ok(r.patch.refused_at)
  assert.equal(r.patch.callback_date, null)
  assert.equal(r.patch.follow_up_due, null)
  // And a refused customer is no longer a Customer Interaction member.
  assert.equal(
    isCustomerInteraction({
      effectiveQueue: 'ready-to-email',
      lastCallOutcome: 'not-interested',
      callbackDate: null,
      formReceivedAt: null,
      refusedAt: (r.patch.refused_at as string) ?? '2026-10-22T00:00:00.000Z',
      engagedAt: '2026-10-22T10:00:00.000Z',
    }),
    false,
  )
})

test('follow-up and refusal are recorded as workflow MILESTONES, never telephone calls', () => {
  const rows: HistoryTouchRow[] = [
    {
      id: 'w1',
      touch_type: 'workflow',
      notes: 'Customer interaction follow-up: Follow-up with the customer scheduled for 2026-11-05.',
      touched_at: '2026-10-22T10:00:00.000Z',
      touched_by: 'Pat Example',
    },
    {
      id: 'w2',
      touch_type: 'workflow',
      notes: 'Customer interaction follow-up completed; no further follow-up scheduled yet.',
      touched_at: '2026-10-22T11:00:00.000Z',
      touched_by: 'Pat Example',
    },
    {
      id: 'w3',
      touch_type: 'workflow',
      notes: 'Customer declined. Outreach stopped until deliberately reopened.',
      touched_at: '2026-10-22T12:00:00.000Z',
      touched_by: 'Pat Example',
    },
    // A genuine email communication, to confirm the two kinds stay separate.
    {
      id: 'e1',
      touch_type: 'email',
      notes: 'Customer email response received: I need more info. [inbound]',
      touched_at: '2026-10-22T09:00:00.000Z',
      touched_by: 'Pat Example',
    },
  ]
  const events = buildCustomerHistory(rows, 'America/New_York')

  // The three workflow milestones are present, each as kind 'milestone', not a
  // contact/call event, and never reading as reached/called.
  const milestones = events.filter((e) => e.kind === 'milestone')
  assert.equal(milestones.length, 3)
  for (const m of milestones) {
    assert.equal(m.reached, false)
    assert.equal(m.communications.length, 0) // no fabricated communication
  }
  const summaries = milestones.map((m) => m.summary).sort()
  assert.deepEqual(summaries, ['Customer refusal', 'Follow-up completed', 'Follow-up scheduled'])

  // The real email is still its own contact event — the milestones did not
  // absorb it and it is not mislabeled.
  const contact = events.filter((e) => e.kind === 'contact')
  assert.equal(contact.length, 1)
  assert.equal(contact[0].communications[0].channel, 'email')

  // No workflow milestone is ever rendered as a call channel.
  const anyCallFromWorkflow = events.some(
    (e) => e.kind !== 'contact' && e.communications.some((c) => c.channel === 'call'),
  )
  assert.equal(anyCallFromWorkflow, false)
})

test('recording receipt from waiting-for-form (no receipt) hands off to Servicing Access', () => {
  const r = applyAction(baseState({ queue: 'waiting-for-form', form_received_at: null }), {
    type: 'form-received',
  })
  assert.equal(r.error, undefined)
  assert.ok(r.patch.form_received_at)
  // Now isServicingAccess is true (form in hand), so the customer leaves
  // Customer Interaction for the existing Servicing Access workflow.
  assert.equal(
    isServicingAccess({ formReceivedAt: r.patch.form_received_at as string, refusedAt: null }),
    true,
  )
})

test('engagement persists through a later unsuccessful attempt (requirement 3)', () => {
  // A customer engaged via a reached call, then a later voicemail. The voicemail
  // changes last_call_outcome to 'voicemail' and routes to waiting-for-response
  // (still pre-auth). Because the route stamps a durable engagedAt on the reached
  // call, isCustomerInteraction stays TRUE on the later read — the customer does
  // NOT fall back into routine calling and the conversation does not disappear.
  const afterVoicemail = {
    effectiveQueue: 'waiting-for-response' as const,
    lastCallOutcome: 'voicemail' as const, // the later, unsuccessful attempt
    callbackDate: null,
    formReceivedAt: null,
    refusedAt: null,
    engagedAt: '2026-10-22T10:00:00.000Z', // durable, from the earlier reached call
  }
  assert.equal(isCustomerInteraction(afterVoicemail), true)
  // And such an engaged customer is NOT surfaced back in the call populations.
  assert.equal(
    callPopulationOf({
      effectiveQueue: 'ready-to-call',
      callReason: 'no-response',
      hasUsablePhone: true,
      callbackDue: false,
      engaged: isEngaged({ lastCallOutcome: 'voicemail', callbackDate: null, engagedAt: '2026-10-22T10:00:00.000Z' }),
    }),
    null,
  )
  // Without the durable marker, a voicemail alone is NOT engagement (the bug we fixed).
  assert.equal(
    isCustomerInteraction({ ...afterVoicemail, engagedAt: null }),
    false,
  )
})
