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

function reasonCtx(p: Partial<{ dueCount: number; ownedCount: number; availableCount: number; claimedByOthersCount: number; label: string }>) {
  return { dueCount: 0, ownedCount: 0, availableCount: 0, claimedByOthersCount: 0, label: 'Outreach', ...p }
}

test('reason: due-callback prose states it does not override focus and invents no clock time', () => {
  const r = buildActivityReason('due_callback', reasonCtx({ dueCount: 2 }))
  assert.match(r, /does not override Today's Focus/i)
  assert.doesNotMatch(r, /\d{1,2}:\d{2}/)
})

test('reason: exact-time prose states the fixed appointment comes before focus', () => {
  const r = buildActivityReason('exact_time_commitment', reasonCtx({ dueCount: 1 }))
  assert.match(r, /before Today's Focus/i)
})

test('reason: ineligible prose says shown for awareness, not routed', () => {
  const r = buildActivityReason('not_eligible', reasonCtx({ label: 'Determination' }))
  assert.match(r, /awareness/i)
  assert.match(r, /not routed/i)
})

test('reason: shared prose counts AVAILABLE (unclaimed) work and flags teammate-claimed separately', () => {
  // 3 available to me, 2 already claimed by teammates: the prose must count only
  // the 3 available and never describe the 2 as unclaimed/available.
  const r = buildActivityReason('eligible_shared_work', reasonCtx({ availableCount: 3, claimedByOthersCount: 2 }))
  assert.match(r, /3 items are unclaimed and available to you/i)
  assert.match(r, /2 are already claimed by a teammate/i)
  assert.doesNotMatch(r, /5 (items|are)/i) // never conflate available + others
})

test('reason: shared prose with zero available but teammate-claimed says no unclaimed work for you', () => {
  const r = buildActivityReason('eligible_shared_work', reasonCtx({ availableCount: 0, claimedByOthersCount: 4 }))
  assert.match(r, /no unclaimed work for you/i)
  assert.match(r, /4 are already claimed by a teammate/i)
})

test('reason: owned prose notes teammate-claimed items without calling them shared', () => {
  const r = buildActivityReason('owned_work', reasonCtx({ ownedCount: 1, availableCount: 0, claimedByOthersCount: 1 }))
  assert.match(r, /claimed 1 item/i)
  assert.match(r, /1 is already claimed by a teammate/i)
})
