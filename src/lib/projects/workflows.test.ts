/**
 * Reusable project/workflow model — the completion + gating rules as pure
 * predicates:
 *   - onboardingCompleteForPolicies: Servicing Agent Onboarding is COMPLETE for
 *     a customer when every applicable PERMANENT policy has servicing access
 *     confirmed; a customer with no permanent policy has nothing to establish;
 *     term policies never block; pre-existing access is already complete.
 *   - evaluateWorkflowForCustomer: onboarding is open/complete from the fact;
 *     review_preparation is BLOCKED until its gate (onboarding) is complete,
 *     then open, then complete once a determination is recorded.
 *   - projectContainsWorkflow: a project's behavior comes from the workflows it
 *     contains, never its name/type.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  onboardingCompleteForPolicies,
  evaluateWorkflowForCustomer,
  projectContainsWorkflow,
  type ProjectWorkflow,
} from './workflows'

test('onboarding complete: all permanent policies confirmed', () => {
  assert.equal(
    onboardingCompleteForPolicies([
      { product_type: 'UL', sa_status: 'confirmed' },
      { product_type: 'Term', sa_status: 'unknown' }, // term never blocks
    ]),
    true,
  )
})

test('onboarding incomplete: a permanent policy still unconfirmed', () => {
  assert.equal(
    onboardingCompleteForPolicies([
      { product_type: 'UL', sa_status: 'confirmed' },
      { product_type: 'WL', sa_status: 'unknown' },
    ]),
    false,
  )
})

test('onboarding complete: no permanent policy means nothing to establish', () => {
  assert.equal(
    onboardingCompleteForPolicies([{ product_type: 'Term', sa_status: 'unknown' }]),
    true,
  )
  assert.equal(onboardingCompleteForPolicies([]), true)
})

test('onboarding complete: access that pre-existed is already satisfied (no effort)', () => {
  // Rita Wolfe's shape: a single permanent UL already confirmed.
  assert.equal(
    onboardingCompleteForPolicies([{ product_type: 'UL', sa_status: 'confirmed' }]),
    true,
  )
})

test('evaluate onboarding: confirmed -> complete; unconfirmed -> open', () => {
  assert.equal(
    evaluateWorkflowForCustomer({
      workflowKey: 'servicing_agent_onboarding',
      gateComplete: true,
      policies: [{ product_type: 'UL', sa_status: 'confirmed' }],
    }).status,
    'complete',
  )
  assert.equal(
    evaluateWorkflowForCustomer({
      workflowKey: 'servicing_agent_onboarding',
      gateComplete: true,
      policies: [{ product_type: 'UL', sa_status: 'unknown' }],
    }).status,
    'open',
  )
})

test('evaluate review_preparation: blocked until onboarding (gate) is complete', () => {
  assert.equal(
    evaluateWorkflowForCustomer({
      workflowKey: 'review_preparation',
      gateComplete: false,
      policies: [],
    }).status,
    'blocked',
  )
})

test('evaluate review_preparation: open once gate complete, complete once determined', () => {
  assert.equal(
    evaluateWorkflowForCustomer({
      workflowKey: 'review_preparation',
      gateComplete: true,
      policies: [],
      reviewDetermined: false,
    }).status,
    'open',
  )
  assert.equal(
    evaluateWorkflowForCustomer({
      workflowKey: 'review_preparation',
      gateComplete: true,
      policies: [],
      reviewDetermined: true,
    }).status,
    'complete',
  )
})

test('projectContainsWorkflow keys off the contained workflows, not the name', () => {
  const workflows: ProjectWorkflow[] = [
    { id: 'pw1', workflowId: 'w1', key: 'servicing_agent_onboarding', name: 'Servicing Agent Onboarding', completionMode: 'automatic', position: 0, gatedByProjectWorkflowId: null },
    { id: 'pw2', workflowId: 'w2', key: 'review_preparation', name: 'Review Preparation', completionMode: 'manual', position: 1, gatedByProjectWorkflowId: 'pw1' },
  ]
  assert.equal(projectContainsWorkflow(workflows, 'servicing_agent_onboarding'), true)
  assert.equal(projectContainsWorkflow(workflows, 'review_preparation'), true)
  assert.equal(projectContainsWorkflow([], 'servicing_agent_onboarding'), false)
})
