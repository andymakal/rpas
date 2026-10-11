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
import { classifyBoardItem } from './composition'
import type { ActivityFacts } from './types'

function facts(p: Partial<ActivityFacts>): ActivityFacts {
  return {
    hasExactTimeCommitment: false,
    isEligible: true,
    canAssist: false,
    licenseGap: false,
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

test('ZEN: focus does NOT elevate non-routable work (focus never grants eligibility)', async () => {
  const v = await evaluateActivityBand(
    facts({ isEligible: false, isFocusElevated: true, hasDueCallback: true }),
  )
  // A non-routable standing wins regardless of focus or a due callback: neither
  // makes you routably eligible. With no assist/license-gap flag it is the
  // plain unassigned awareness band.
  assert.equal(v.band, 'unassigned')
  assert.equal(v.rank, 7)
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

test('ZEN: the three non-routable standings produce DISTINCT bands and reasons', async () => {
  // Overqualified assist: not routed, but ACTIONABLE (pickable), ranked after
  // ordinary eligible shared work.
  const assist = await evaluateActivityBand(facts({ isEligible: false, canAssist: true }))
  assert.equal(assist.band, 'assist')
  assert.equal(assist.rank, 6)
  assert.equal(assist.reasonCode, 'assist_available')

  // Qualified but not assigned: awareness only, no confirmed license gap.
  const unassigned = await evaluateActivityBand(
    facts({ isEligible: false, canAssist: false, licenseGap: false }),
  )
  assert.equal(unassigned.band, 'unassigned')
  assert.equal(unassigned.rank, 7)
  assert.equal(unassigned.reasonCode, 'not_assigned')

  // Confirmed missing license: awareness only, distinct from unassigned.
  const unlicensed = await evaluateActivityBand(
    facts({ isEligible: false, canAssist: false, licenseGap: true }),
  )
  assert.equal(unlicensed.band, 'unlicensed')
  assert.equal(unlicensed.rank, 8)
  assert.equal(unlicensed.reasonCode, 'not_licensed')

  // The three are genuinely ordered distinctly: assist (actionable) first, then
  // the two awareness bands.
  assert.ok(assist.rank < unassigned.rank && unassigned.rank < unlicensed.rank)
})

test('ZEN: an assist-capable standing never collapses into an awareness band', async () => {
  // Even if a (nonsensical) license gap were also flagged, canAssist wins: a
  // capable, assigned-overqualified worker may still help.
  const v = await evaluateActivityBand(facts({ isEligible: false, canAssist: true, licenseGap: true }))
  assert.equal(v.band, 'assist')
})

test('ZEN rule exposes exactly the independent presence facts (no ranked inputs)', async () => {
  const model = (await import('@/rules/my-work-priority.json', { with: { type: 'json' } }))
    .default as { nodes: { content?: { inputs?: { field: string }[] } }[] }
  const table = model.nodes.find((n) => n.content?.inputs)
  const fields = (table?.content?.inputs ?? []).map((i) => i.field).sort()
  assert.deepEqual(
    fields,
    [
      'canAssist', 'hasDueCallback', 'hasExactTimeCommitment', 'hasOwnedWork',
      'isEligible', 'isFocusElevated', 'licenseGap',
    ].sort(),
  )
})

// ── classifyBoardItem: assist visibility + due-callback claim exclusion ─────

test('board item: an OVERQUALIFIED (assist) employee sees unclaimed shared work as pickable', () => {
  // Not routable, but assist-capable: the item is available to pick up, exactly
  // as the claim path permits — never awareness-only.
  const c = classifyBoardItem({
    routableEligible: false,
    assistCapable: true,
    claimedBy: null,
    isDueCallback: false,
  })
  assert.equal(c.bucket, 'available')
  // Assist never feeds routable eligibility, so GoRules priorities are unchanged.
  assert.equal(c.routableEligible, false)
})

test('board item: an assist employee can OWN shared work they have claimed', () => {
  const c = classifyBoardItem({
    routableEligible: false,
    assistCapable: true,
    claimedBy: 'me',
    isDueCallback: false,
  })
  assert.equal(c.bucket, 'owned')
})

test('board item: unassigned / unlicensed (neither routable nor assist) is awareness-only', () => {
  const c = classifyBoardItem({
    routableEligible: false,
    assistCapable: false,
    claimedBy: null,
    isDueCallback: true,
  })
  assert.equal(c.bucket, 'notEligible')
  // Not pickable, so not routable and not my due callback either.
  assert.equal(c.routableEligible, false)
  assert.equal(c.countsAsMyDueCallback, false)
})

test('board item: a routable employee still sees routable work (unchanged behavior)', () => {
  const c = classifyBoardItem({
    routableEligible: true,
    assistCapable: false,
    claimedBy: null,
    isDueCallback: false,
  })
  assert.equal(c.bucket, 'available')
  assert.equal(c.routableEligible, true)
})

test('board item: a due callback claimed by ANOTHER employee is NOT my due callback', () => {
  const c = classifyBoardItem({
    routableEligible: true,
    assistCapable: false,
    claimedBy: 'other',
    isDueCallback: true,
  })
  assert.equal(c.bucket, 'claimedByOthers')
  // The teammate's commitment is never counted as my due work.
  assert.equal(c.countsAsMyDueCallback, false)
})

test('board item: a due callback counts as mine when I OWN it or it is UNCLAIMED', () => {
  const owned = classifyBoardItem({
    routableEligible: true, assistCapable: false, claimedBy: 'me', isDueCallback: true,
  })
  assert.equal(owned.bucket, 'owned')
  assert.equal(owned.countsAsMyDueCallback, true)

  const unclaimed = classifyBoardItem({
    routableEligible: true, assistCapable: false, claimedBy: null, isDueCallback: true,
  })
  assert.equal(unclaimed.bucket, 'available')
  assert.equal(unclaimed.countsAsMyDueCallback, true)
})

test('board item: an assist employee can pick up a due callback as their own due work', () => {
  // Assist-capable + unclaimed + due: pickable AND counts as my due work.
  const c = classifyBoardItem({
    routableEligible: false, assistCapable: true, claimedBy: null, isDueCallback: true,
  })
  assert.equal(c.bucket, 'available')
  assert.equal(c.countsAsMyDueCallback, true)
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

test('reason: the three non-routable prose variants read distinctly (shared explanations)', () => {
  const assist = buildActivityReason('assist_available', reasonCtx({ label: 'Determination' }))
  assert.match(assist, /qualified/i)
  assert.match(assist, /assist|pick it up/i)
  assert.doesNotMatch(assist, /not routed to you\.?$/i) // assist is actionable, not awareness

  const unassigned = buildActivityReason('not_assigned', reasonCtx({ label: 'Determination' }))
  assert.match(unassigned, /not assigned to you/i)
  assert.match(unassigned, /awareness/i)

  const unlicensed = buildActivityReason('not_licensed', reasonCtx({ label: 'Determination' }))
  assert.match(unlicensed, /license/i)
  assert.match(unlicensed, /awareness/i)

  // The three are genuinely different sentences.
  assert.notEqual(assist, unassigned)
  assert.notEqual(unassigned, unlicensed)
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
