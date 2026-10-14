/**
 * Servicing-Agent Onboarding — the two settled business-rule corrections, as
 * pure predicates:
 *   - canClaimOutreach: a claim means the customer was REACHED and the employee
 *     took on personal follow-up; a scheduled callback is NOT required, and
 *     routine outreach never claims.
 *   - onboardingDecision: membership-driven onboarding is idempotent — skip a
 *     fully-onboarded customer, backfill an open pre-review that lacks an
 *     outreach row, create when there is no open pre-review. Never duplicate.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { canClaimOutreach } from './queues'
import { onboardingDecision } from './ensure-onboarding'

test('claim: a REACHED customer is claimable (no scheduled callback required)', () => {
  assert.equal(canClaimOutreach({ decision: null, lastCallOutcome: 'reached' }), true)
})

test('claim: a promised callback is also a reach, so it is claimable', () => {
  assert.equal(canClaimOutreach({ decision: null, lastCallOutcome: 'callback' }), true)
})

test('claim: routine outreach never claims (no outcome, voicemail, bad-number, not-interested)', () => {
  assert.equal(canClaimOutreach({ decision: null, lastCallOutcome: null }), false)
  assert.equal(canClaimOutreach({ decision: null, lastCallOutcome: 'voicemail' }), false)
  assert.equal(canClaimOutreach({ decision: null, lastCallOutcome: 'bad-number' }), false)
  assert.equal(canClaimOutreach({ decision: null, lastCallOutcome: 'not-interested' }), false)
})

test('claim: a decided item is never claimable, even if the customer was reached', () => {
  assert.equal(canClaimOutreach({ decision: 'review_now', lastCallOutcome: 'reached' }), false)
})

test('onboarding: a fully-onboarded customer (open pre-review + outreach) is skipped', () => {
  assert.equal(
    onboardingDecision({ hasOpenPrereview: true, openPrereviewHasOutreach: true }),
    'skip',
  )
})

test('onboarding: an open pre-review with NO outreach row is backfilled (never duplicated)', () => {
  assert.equal(
    onboardingDecision({ hasOpenPrereview: true, openPrereviewHasOutreach: false }),
    'backfill',
  )
})

test('onboarding: a customer with no open pre-review gets a full record created', () => {
  assert.equal(
    onboardingDecision({ hasOpenPrereview: false, openPrereviewHasOutreach: false }),
    'create',
  )
})
