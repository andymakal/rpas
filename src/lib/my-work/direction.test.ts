/**
 * MY WORK Daily Direction derivation tests (Right Path).
 *
 * Runs on node:test via jiti (npm run test:dd). These lock in that the My Work
 * Assistant READS the ZEN-decided ordering rather than re-ranking, and that it
 * preserves the IPF distinctions the integration must keep:
 *   1. The recommended WORKING PLAN follows the ZEN rank + catalog working order
 *      the composition already applied; the derivation never promotes a
 *      lower-ranked activity and never re-ranks.
 *   2. Awareness-only standings (unassigned, unlicensed) are never recommended
 *      and never actionable.
 *   3. Primary responsibilities and Support work are listed distinctly, read
 *      from the stored routing (routedAs), not inferred.
 *   4. Outreach expands into its real sub-populations (introductory emails, due
 *      calls, other callable customers) in working order, read from the
 *      informational sources — not re-ranked.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveMyWorkDirection } from './direction'
import type { ActivityGroup, MyWorkState, PriorityBand, RoutedAs, WorkSource } from './types'
import type { CapabilityStatus } from '@/lib/capabilities/work-functions'

let seq = 0
function activity(p: Partial<ActivityGroup> & { band: PriorityBand; rank: number }): ActivityGroup {
  const wf = (p.workFunction ?? (`wf_${seq++}` as ActivityGroup['workFunction']))
  const capabilityStatus: CapabilityStatus =
    p.capabilityStatus ??
    (p.band === 'assist' ? 'assist'
      : p.band === 'unassigned' ? 'unassigned'
        : p.band === 'unlicensed' ? 'unlicensed'
          : 'routable')
  const routedAs: RoutedAs = p.routedAs ?? (capabilityStatus === 'routable' ? 'primary' : 'none')
  const ownedCount = p.ownedCount ?? 0
  const availableCount = p.availableCount ?? 0
  const dueCount = p.dueCount ?? 0
  return {
    workFunction: wf,
    label: p.label ?? 'Outreach',
    description: null,
    band: p.band,
    rank: p.rank,
    reasonCode: p.reasonCode ?? 'eligible_shared_work',
    reason: p.reason ?? 'because reasons',
    totalCount: p.totalCount ?? ownedCount + availableCount,
    unresolvedCount: p.unresolvedCount,
    unsuccessfulCount: p.unsuccessfulCount,
    ownedCount,
    availableCount,
    claimedByOthersCount: p.claimedByOthersCount ?? 0,
    notEligibleCount: p.notEligibleCount ?? 0,
    dueCount,
    isEligible: p.isEligible ?? capabilityStatus === 'routable',
    capabilityStatus,
    routedAs,
    isFocusElevated: p.isFocusElevated ?? false,
    sources: p.sources ?? [
      {
        kind: 'stewardship',
        label: 'Shared Stewardship board',
        count: ownedCount + availableCount,
        route: `/stewardship?wf=${wf}`,
        projectId: null,
        ownedByMe: ownedCount,
        availableToMe: availableCount,
        claimedByOthers: p.claimedByOthersCount ?? 0,
        notEligible: 0,
        dueToMe: dueCount,
      },
    ],
  }
}

/** An informational outreach sub-population source (introductory emails / calls
 * due / available to call), as the composition emits it. */
function infoSource(label: string, available: number, route: string): WorkSource {
  return {
    kind: 'stewardship',
    label,
    count: available,
    route,
    projectId: null,
    ownedByMe: 0,
    availableToMe: available,
    claimedByOthers: 0,
    notEligible: 0,
    dueToMe: 0,
    informational: true,
  }
}

function state(activities: ActivityGroup[]): MyWorkState {
  return {
    employeeName: 'Pat Example',
    noProfile: false,
    activities,
    focusNotes: [],
    quiet: activities.every((a) => a.totalCount === 0),
  }
}

test('plan: a single ordered working plan, not co-equal options (no "any of these")', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ workFunction: 'research', band: 'shared', rank: 5, label: 'Contact Research', availableCount: 2 }),
      activity({ workFunction: 'operations_prep', band: 'shared', rank: 5, label: 'Operations Preparation', availableCount: 4 }),
    ]),
  )
  assert.equal(d.quiet, false)
  // The result is a flat, ordered list of steps — there is no tied/options shape.
  assert.ok(Array.isArray(d.workingPlan))
  assert.equal(d.workingPlan.length, 2)
  // Order follows the input (ZEN rank + catalog order the composition applied):
  // research before operations preparation. The derivation does NOT re-rank.
  assert.deepEqual(d.workingPlan.map((s) => s.key), ['research', 'operations_prep'])
  // Each step has WHAT (title), WHY (reason), and a direct action + route.
  for (const step of d.workingPlan) {
    assert.ok(step.title.length > 0)
    assert.ok(step.reason.length > 0)
    assert.ok(step.actionLabel.length > 0)
    assert.ok(step.route && step.route.length > 0)
  }
})

test('plan: preserves the activity order it is given (no re-ranking)', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ workFunction: 'focus_wf' as ActivityGroup['workFunction'], band: 'focus', rank: 2, label: 'Focused work', availableCount: 3, reason: 'focus reason' }),
      activity({ workFunction: 'research', band: 'owned', rank: 4, label: 'Contact Research', ownedCount: 1 }),
    ]),
  )
  // The rank-2 focus activity leads; research follows. No promotion of the
  // lower-ranked activity.
  assert.equal(d.workingPlan[0].title, 'Focused work')
  // A focus/commitment step carries emphasis so the UI can lightly highlight it.
  assert.equal(d.workingPlan[0].emphasis, true)
})

test('plan: outreach expands into intro emails -> due calls -> other calls, in order', () => {
  const outreach = activity({
    workFunction: 'outreach',
    band: 'shared',
    rank: 5,
    label: 'Outreach',
    availableCount: 9,
    sources: [
      infoSource('Shared Stewardship board — Introductory emails', 3, '/stewardship?queue=ready-to-email'),
      infoSource('Shared Stewardship board — Calls Due', 2, '/stewardship?population=calls-due'),
      infoSource('Shared Stewardship board — Available to Call', 4, '/stewardship?population=available-to-call'),
    ],
  })
  const d = deriveMyWorkDirection(state([outreach]))
  assert.deepEqual(
    d.workingPlan.map((s) => s.key),
    ['outreach:intro', 'outreach:calls-due', 'outreach:calls-other'],
  )
  // Counts come from the informational sources, not re-summed.
  assert.deepEqual(d.workingPlan.map((s) => s.count), [3, 2, 4])
  // Due calls carry emphasis (a genuine scheduled commitment); the others do not.
  assert.equal(d.workingPlan[1].emphasis, true)
  assert.equal(d.workingPlan[0].emphasis, false)
})

test('plan: outreach with no recognized sub-population falls back to one step', () => {
  // Only a generic (non-informational) source: e.g. follow-up chases. The step
  // is never silently dropped.
  const d = deriveMyWorkDirection(
    state([activity({ workFunction: 'outreach', band: 'shared', rank: 5, label: 'Outreach', availableCount: 2 })]),
  )
  assert.deepEqual(d.workingPlan.map((s) => s.key), ['outreach'])
  assert.equal(d.workingPlan[0].count, 2)
})

test('plan: a due date-only callback is a SUBSET of actionable work, not double-counted', () => {
  // 1 owned + 2 available = 3 actionable; the step count is those 3, never + due.
  const d = deriveMyWorkDirection(
    state([
      activity({
        workFunction: 'research',
        band: 'due_callback',
        rank: 3,
        label: 'Contact Research',
        ownedCount: 1,
        availableCount: 2,
        dueCount: 2,
      }),
    ]),
  )
  assert.equal(d.workingPlan.length, 1)
  assert.equal(d.workingPlan[0].count, 3)
})

test('plan: awareness-only standings are never in the plan and keep it quiet', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ band: 'unassigned', rank: 7, totalCount: 5, availableCount: 0 }),
      activity({ band: 'unlicensed', rank: 8, totalCount: 2, availableCount: 0 }),
    ]),
  )
  assert.equal(d.quiet, true)
  assert.deepEqual(d.workingPlan, [])
  assert.deepEqual(d.primary, [])
  assert.deepEqual(d.support, [])
})

test('plan: an actionable band with no items the worker can act on is not in the plan', () => {
  const d = deriveMyWorkDirection(
    state([activity({ band: 'shared', rank: 5, availableCount: 0, ownedCount: 0, claimedByOthersCount: 4, totalCount: 4 })]),
  )
  assert.equal(d.quiet, true)
  assert.deepEqual(d.workingPlan, [])
})

test('plan: Research shows the full unresolved population with the attempted breakdown', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({
        workFunction: 'research', band: 'shared', rank: 5, label: 'Contact Research',
        availableCount: 8, totalCount: 8, unresolvedCount: 9, unsuccessfulCount: 1,
      }),
    ]),
  )
  const step = d.workingPlan.find((s) => s.key === 'research')
  assert.ok(step)
  // Headline is the full unresolved population (not the outstanding 8).
  assert.equal(step!.count, 9)
  assert.equal(step!.unresolvedCount, 9)
  assert.equal(step!.unsuccessfulCount, 1)
})

test('plan: Research stays in the plan when outstanding is zero but unresolved remains', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({
        workFunction: 'research', band: 'shared', rank: 5, label: 'Contact Research',
        // Nothing outstanding/actionable, but 3 researched-unsuccessfully remain.
        availableCount: 0, ownedCount: 0, totalCount: 0,
        unresolvedCount: 3, unsuccessfulCount: 3,
        sources: [infoSource('Shared Stewardship board — Research Needed', 0, '/stewardship?queue=research-needed')],
      }),
    ]),
  )
  assert.equal(d.quiet, false)
  const step = d.workingPlan.find((s) => s.key === 'research')
  assert.ok(step, 'research step is present even with zero outstanding')
  assert.equal(step!.count, 3)
  assert.equal(step!.unsuccessfulCount, 3)
  assert.equal(step!.route, '/stewardship?queue=research-needed')
})

test('direction: Primary and Support are split by the stored routing (routedAs)', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ band: 'owned', rank: 4, label: 'Outreach', routedAs: 'primary', ownedCount: 2 }),
      activity({ band: 'shared', rank: 5, label: 'Research', routedAs: 'support', availableCount: 3 }),
      activity({ band: 'assist', rank: 6, label: 'Determination', capabilityStatus: 'assist', routedAs: 'none', availableCount: 1 }),
    ]),
  )
  // Primary holds only the primary-routed activity.
  assert.deepEqual(d.primary.map((r) => r.label), ['Outreach'])
  // Support holds the support-routed activity AND the assist activity (help).
  assert.deepEqual(d.support.map((r) => r.label).sort(), ['Determination', 'Research'])
})

test('direction: actionableCount counts owned + available only (due is a subset)', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ band: 'owned', rank: 4, ownedCount: 2, availableCount: 1, dueCount: 1, claimedByOthersCount: 3 }),
    ]),
  )
  // 2 owned + 1 available = 3; the due item is already one of those, and the 3
  // teammate-claimed are excluded. The due count is NOT added on top.
  const row = [...d.primary, ...d.support][0]
  assert.equal(row?.actionableCount, 3)
})
