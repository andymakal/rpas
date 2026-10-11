/**
 * MY WORK priority engine tests (Right Path).
 *
 * Runs on node:test via jiti (npm run test:dd), exercising the REAL GoRules ZEN
 * rule (my-work-priority.json) and the real engine normalization — no copy of
 * the logic. These lock in the IPF-derived, Right-Path-settled ordering:
 *   1. Priority lives entirely in GoRules; TypeScript ranks nothing.
 *   2. A due customer commitment outranks Today's Focus.
 *   3. Focus elevates only ELIGIBLE work; it never grants eligibility and never
 *      disables other bands.
 *   4. Owned (claimed) eligible work comes before unclaimed shared work.
 *   5. Ineligible work is visible (a band exists) but ranked last.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateActivityBand, buildActivityReason } from './engine'
import type { ActivityFacts } from './types'

function facts(p: Partial<ActivityFacts>): ActivityFacts {
  return {
    hasDueCommitment: false,
    isEligible: true,
    isFocusElevated: false,
    hasOwnedWork: false,
    ...p,
  }
}

test('ZEN: a due customer commitment outranks Today\'s Focus', async () => {
  const v = await evaluateActivityBand(
    facts({ hasDueCommitment: true, isFocusElevated: true, hasOwnedWork: true }),
  )
  assert.equal(v.band, 'due_commitment')
  assert.equal(v.rank, 1)
  assert.equal(v.reasonCode, 'due_customer_commitment')
})

test('ZEN: focus elevates eligible work above owned and shared', async () => {
  const v = await evaluateActivityBand(
    facts({ isEligible: true, isFocusElevated: true, hasOwnedWork: true }),
  )
  assert.equal(v.band, 'focus')
  assert.equal(v.rank, 2)
})

test('ZEN: focus does NOT elevate ineligible work (focus never grants eligibility)', async () => {
  const v = await evaluateActivityBand(
    facts({ isEligible: false, isFocusElevated: true }),
  )
  // Ineligible wins regardless of focus: focus cannot make you eligible.
  assert.equal(v.band, 'ineligible')
  assert.equal(v.rank, 5)
})

test('ZEN: owned eligible work (no focus) ranks above unclaimed shared work', async () => {
  const owned = await evaluateActivityBand(facts({ hasOwnedWork: true }))
  const shared = await evaluateActivityBand(facts({ hasOwnedWork: false }))
  assert.equal(owned.band, 'owned')
  assert.equal(owned.rank, 3)
  assert.equal(shared.band, 'shared')
  assert.equal(shared.rank, 4)
  assert.ok(owned.rank < shared.rank)
})

test('ZEN: ineligible work is still classified (visible, ranked last)', async () => {
  const v = await evaluateActivityBand(facts({ isEligible: false }))
  assert.equal(v.band, 'ineligible')
  assert.equal(v.rank, 5)
  assert.equal(v.reasonCode, 'not_eligible')
})

test('ZEN rule exposes exactly the four independent presence facts (no ranked inputs)', async () => {
  const model = (await import('@/rules/my-work-priority.json', { with: { type: 'json' } }))
    .default as { nodes: { content?: { inputs?: { field: string }[] } }[] }
  const table = model.nodes.find((n) => n.content?.inputs)
  const fields = (table?.content?.inputs ?? []).map((i) => i.field).sort()
  assert.deepEqual(fields, ['hasDueCommitment', 'hasOwnedWork', 'isEligible', 'isFocusElevated'].sort())
})

test('reason: due-commitment prose states the commitment outranks focus, invents no clock time', () => {
  const r = buildActivityReason('due_customer_commitment', {
    dueCount: 2,
    ownedCount: 0,
    sharedCount: 0,
    label: 'Outreach',
  })
  assert.match(r, /outranks focus/i)
  assert.doesNotMatch(r, /\d{1,2}:\d{2}/)
})

test('reason: ineligible prose says shown for awareness, not routed', () => {
  const r = buildActivityReason('not_eligible', {
    dueCount: 0,
    ownedCount: 0,
    sharedCount: 0,
    label: 'Determination',
  })
  assert.match(r, /awareness/i)
  assert.match(r, /not routed/i)
})
