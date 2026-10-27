/**
 * Text-message availability (Do Not Text + Text Undeliverable) — Right Path.
 *
 * Runs on the Node built-in test runner (node:test) via jiti, exercising the
 * REAL sms-availability resolver and the REAL GoRules-backed contact-options
 * evaluation (no copy of the logic). Run with: npm run test:dd
 *
 * Locks in the settled business rules for texting:
 *   - Status resolves to Available / Do Not Text / Text Undeliverable.
 *   - Do Not Text (the durable customer opt-out) outranks a delivery failure.
 *   - Both restrictions disable TEXTING only; telephone CALLS are never removed.
 *   - A per-number delivery failure is value-scoped: it does not survive on its
 *     own in the resolver (the caller supplies the current-number fact), so a
 *     replaced number is simply "no failure on file".
 *   - An ordinary unsent text is not a delivery failure (textUndeliverable only
 *     reflects a RECORDED failure, never an absence of sending).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveSmsAvailabilityDisplay,
  canTextGivenFacts,
  SMS_AVAILABILITY_LABEL,
} from './sms-availability'
import { evaluateContactOptions, toContactFacts } from './stewardship/contact-options'

test('status: available when not opted out and no delivery failure on file', () => {
  const d = resolveSmsAvailabilityDisplay({ smsOptOut: false, textUndeliverable: false })
  assert.equal(d, 'available')
  assert.equal(SMS_AVAILABILITY_LABEL[d], 'Text available')
  assert.equal(canTextGivenFacts({ smsOptOut: false, textUndeliverable: false }), true)
})

test('status: Do Not Text when the customer opted out', () => {
  const d = resolveSmsAvailabilityDisplay({ smsOptOut: true, textUndeliverable: false })
  assert.equal(d, 'do_not_text')
  assert.equal(SMS_AVAILABILITY_LABEL[d], 'Do Not Text')
  assert.equal(canTextGivenFacts({ smsOptOut: true, textUndeliverable: false }), false)
})

test('status: Text Undeliverable when the number on file failed to deliver', () => {
  const d = resolveSmsAvailabilityDisplay({ smsOptOut: false, textUndeliverable: true })
  assert.equal(d, 'undeliverable')
  assert.equal(SMS_AVAILABILITY_LABEL[d], 'Text Undeliverable')
  assert.equal(canTextGivenFacts({ smsOptOut: false, textUndeliverable: true }), false)
})

test('Do Not Text outranks a delivery failure in the displayed status', () => {
  // Both facts true: the stronger, deliberate opt-out is what we show, because
  // it follows the customer and persists across a number change.
  assert.equal(
    resolveSmsAvailabilityDisplay({ smsOptOut: true, textUndeliverable: true }),
    'do_not_text',
  )
})

test('contact-options: Do Not Text disables texting but NOT calling', async () => {
  const facts = toContactFacts({ phone: '(215) 555-0100', email: null })
  const optedOut = await evaluateContactOptions(facts, { smsOptOut: true })
  assert.equal(optedOut.canText, false, 'texting is disabled by the opt-out')
  assert.equal(optedOut.canCall, true, 'calling rides the same number and stays available')

  const normal = await evaluateContactOptions(facts, { smsOptOut: false })
  assert.equal(normal.canText, true, 'without the opt-out a usable phone enables texting')
  assert.equal(normal.canCall, true)
})

test('contact-options: a recorded text failure disables texting but NOT calling', async () => {
  const facts = toContactFacts({ phone: '(215) 555-0100', email: null })
  const opts = await evaluateContactOptions(facts, { unusableChannels: ['text'] })
  assert.equal(opts.canText, false, 'the failed number cannot be texted')
  assert.equal(opts.canCall, true, 'the same number can still be called')
})

test('contact-options: a bad NUMBER (call unusable) removes both calling and texting', async () => {
  // Distinct from a text-only failure: when the number itself is unusable, both
  // channels that ride it are removed. This confirms the text restriction is the
  // narrower one.
  const facts = toContactFacts({ phone: '(215) 555-0100', email: null })
  const opts = await evaluateContactOptions(facts, { unusableChannels: ['call'] })
  assert.equal(opts.canCall, false)
  assert.equal(opts.canText, false)
})

test('contact-options: opt-out and delivery failure stack; email is untouched', async () => {
  const facts = toContactFacts({ phone: '(215) 555-0100', email: 'a@b.com' })
  const opts = await evaluateContactOptions(facts, { smsOptOut: true, unusableChannels: ['text'] })
  assert.equal(opts.canText, false)
  assert.equal(opts.canCall, true)
  assert.equal(opts.canEmail, true, 'texting restrictions never affect emailing')
})
