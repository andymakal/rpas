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
  evaluateWorkflowsForCustomer,
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

// Order-independence of gate evaluation (the defect fix): a valid dependency
// must resolve correctly no matter the order the workflows are listed in.
const onboarding = (id: string, pos: number, gatedBy: string | null = null): ProjectWorkflow => ({
  id, workflowId: `w-${id}`, key: 'servicing_agent_onboarding', name: 'Servicing Agent Onboarding', completionMode: 'automatic', position: pos, gatedByProjectWorkflowId: gatedBy,
})
const review = (id: string, pos: number, gatedBy: string | null): ProjectWorkflow => ({
  id, workflowId: `w-${id}`, key: 'review_preparation', name: 'Review Preparation', completionMode: 'manual', position: pos, gatedByProjectWorkflowId: gatedBy,
})
const confirmedPermanent = [{ product_type: 'UL', sa_status: 'confirmed' }]
const unconfirmedPermanent = [{ product_type: 'UL', sa_status: 'unknown' }]
const statusOf = (states: ReturnType<typeof evaluateWorkflowsForCustomer>, key: string) =>
  states.find(s => s.workflowKey === key)?.status

test('gate order-independent: gate listed BEFORE dependent — complete onboarding opens review', () => {
  // positions: onboarding(0) then review(1), review gated by onboarding.
  const workflows = [onboarding('pw1', 0), review('pw2', 1, 'pw1')]
  const states = evaluateWorkflowsForCustomer({ customerId: 'c', workflows, policies: confirmedPermanent, reviewDetermined: false })
  assert.equal(statusOf(states, 'servicing_agent_onboarding'), 'complete')
  assert.equal(statusOf(states, 'review_preparation'), 'open')
})

test('gate order-independent: gate listed AFTER dependent — complete onboarding still opens review (the defect)', () => {
  // review(0) listed FIRST, its gating onboarding(1) listed SECOND. The old
  // single ordered pass would see the gate unevaluated and wrongly BLOCK review.
  const workflows = [review('pw2', 0, 'pw1'), onboarding('pw1', 1, null)]
  const states = evaluateWorkflowsForCustomer({ customerId: 'c', workflows, policies: confirmedPermanent, reviewDetermined: false })
  assert.equal(statusOf(states, 'servicing_agent_onboarding'), 'complete')
  assert.equal(statusOf(states, 'review_preparation'), 'open') // NOT blocked
})

test('gate order-independent: incomplete onboarding blocks review regardless of order', () => {
  const before = [onboarding('pw1', 0), review('pw2', 1, 'pw1')]
  const after = [review('pw2', 0, 'pw1'), onboarding('pw1', 1, null)]
  for (const workflows of [before, after]) {
    const states = evaluateWorkflowsForCustomer({ customerId: 'c', workflows, policies: unconfirmedPermanent, reviewDetermined: false })
    assert.equal(statusOf(states, 'servicing_agent_onboarding'), 'open')
    assert.equal(statusOf(states, 'review_preparation'), 'blocked')
  }
})

test('gate order-independent: a dependency cycle terminates with a defined result (no hang/crash)', () => {
  // Two workflows gating each other (prevented by the config guards, but the
  // evaluator must still TERMINATE and produce a defined state for every
  // workflow rather than hang or throw). The cycle guard breaks the recursion.
  const a = review('pwA', 0, 'pwB')
  const b: ProjectWorkflow = { id: 'pwB', workflowId: 'w-pwB', key: 'servicing_agent_onboarding', name: 'Onboarding', completionMode: 'automatic', position: 1, gatedByProjectWorkflowId: 'pwA' }
  const states = evaluateWorkflowsForCustomer({ customerId: 'c', workflows: [a, b], policies: confirmedPermanent, reviewDetermined: false })
  assert.equal(states.length, 2)
  for (const s of states) {
    assert.ok(['blocked', 'open', 'complete'].includes(s.status))
  }
})
