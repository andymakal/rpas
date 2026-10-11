/**
 * MY WORK priority engine tests (Right Path).
 *
 * Runs on node:test via jiti (npm run test:dd), exercising the REAL GoRules ZEN
 * rule (my-work-priority.json) and the real engine normalization — no copy of
 * the logic. These lock in the IPF-derived, Right-Path-settled ordering:
 *   1. Priority lives entirely in GoRules; TypeScript ranks nothing.
 *   2. An EXACT-TIME fixed commitment outranks Today's Focus (the IPF
 *      distinction). A DATE-ONLY due callback is due work that ranks BELOW focus
 *      and never auto-outranks it.
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
    hasExactTimeCommitment: false,
    isEligible: true,
    isFocusElevated: false,
    hasDueCallback: false,
    hasOwnedWork: false,
    ...p,
  }
}

test('ZEN: an exact-time fixed commitment outranks Today\'s Focus', async () => {
  const v = await evaluateActivityBand(
    facts({ hasExactTimeCommitment: true, isFocusElevated: true, hasDueCallback: true, hasOwnedWork: true }),
  )
  assert.equal(v.band, 'exact_time_commitment')
  assert.equal(v.rank, 1)
  assert.equal(v.reasonCode, 'exact_time_commitment')
})

test('ZEN: a DATE-ONLY due callback does NOT outrank focus (preserved IPF distinction)', async () => {
  // Focus + a due date-only callback together: focus wins, because a date-only
  // callback is due work, not a fixed-time interruption.
  const withFocus = await evaluateActivityBand(
    facts({ isFocusElevated: true, hasDueCallback: true }),
  )
  assert.equal(withFocus.band, 'focus')
  assert.equal(withFocus.rank, 2)

  // Without focus, the due callback is its own band, ranked below where focus
  // would sit (3), and above ordinary owned/shared work.
  const noFocus = await evaluateActivityBand(
    facts({ isFocusElevated: false, hasDueCallback: true, hasOwnedWork: true }),
  )
  assert.equal(noFocus.band, 'due_callback')
  assert.equal(noFocus.rank, 3)
  assert.ok(noFocus.rank > withFocus.rank, 'a due date-only callback must rank below focus')
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
    facts({ isEligible: false, isFocusElevated: true, hasDueCallback: true }),
  )
  // Ineligible wins regardless of focus or a due callback: neither makes you
  // eligible.
  assert.equal(v.band, 'ineligible')
  assert.equal(v.rank, 6)
})

test('ZEN: owned eligible work (no focus, no due callback) ranks above unclaimed shared work', async () => {
  const owned = await evaluateActivityBand(facts({ hasOwnedWork: true }))
  const shared = await evaluateActivityBand(facts({ hasOwnedWork: false }))
  assert.equal(owned.band, 'owned')
  assert.equal(owned.rank, 4)
  assert.equal(shared.band, 'shared')
  assert.equal(shared.rank, 5)
  assert.ok(owned.rank < shared.rank)
})

test('ZEN: ineligible work is still classified (visible, ranked last)', async () => {
  const v = await evaluateActivityBand(facts({ isEligible: false }))
  assert.equal(v.band, 'ineligible')
  assert.equal(v.rank, 6)
  assert.equal(v.reasonCode, 'not_eligible')
})

test('ZEN rule exposes exactly the five independent presence facts (no ranked inputs)', async () => {
  const model = (await import('@/rules/my-work-priority.json', { with: { type: 'json' } }))
    .default as { nodes: { content?: { inputs?: { field: string }[] } }[] }
  const table = model.nodes.find((n) => n.content?.inputs)
  const fields = (table?.content?.inputs ?? []).map((i) => i.field).sort()
  assert.deepEqual(
    fields,
    ['hasDueCallback', 'hasExactTimeCommitment', 'hasOwnedWork', 'isEligible', 'isFocusElevated'].sort(),
  )
})

test('reason: due-callback prose states it does not override focus and invents no clock time', () => {
  const r = buildActivityReason('due_callback', {
    dueCount: 2,
    ownedCount: 0,
    sharedCount: 0,
    label: 'Outreach',
  })
  assert.match(r, /does not override Today's Focus/i)
  assert.doesNotMatch(r, /\d{1,2}:\d{2}/)
})

test('reason: exact-time prose states the fixed appointment comes before focus', () => {
  const r = buildActivityReason('exact_time_commitment', {
    dueCount: 1,
    ownedCount: 0,
    sharedCount: 0,
    label: 'Outreach',
  })
  assert.match(r, /before Today's Focus/i)
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
