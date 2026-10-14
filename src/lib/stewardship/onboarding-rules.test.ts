/**
 * Servicing-Agent Onboarding — settled business-rule corrections, as pure
 * predicates:
 *   - canClaimOutreach: claiming is VOLUNTARY with NO contact prerequisite —
 *     any OPEN item is claimable; only a DECIDED item is not. (Authorization and
 *     the already-claimed guard are enforced in the route, not here.)
 *   - onboardingDecision: membership-driven onboarding is idempotent — skip a
 *     fully-onboarded customer, backfill an open pre-review that lacks an
 *     outreach row, create when there is no open pre-review. Never duplicate.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { canClaimOutreach } from './queues'
import { onboardingDecision } from './ensure-onboarding'

test('claim: an OPEN item is claimable with no prior contact (no reach/callback required)', () => {
  assert.equal(canClaimOutreach({ decision: null }), true)
})

test('claim: a decided item is never claimable (no longer open work)', () => {
  assert.equal(canClaimOutreach({ decision: 'review_now' }), false)
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
