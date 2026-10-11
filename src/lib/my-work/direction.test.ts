/**
 * MY WORK Daily Direction derivation tests (Right Path).
 *
 * Runs on node:test via jiti (npm run test:dd). These lock in that the My Work
 * Assistant READS the ZEN-decided ordering rather than re-ranking, and that it
 * preserves the IPF distinctions the integration must keep:
 *   1. The Next Best Action is the already-top-ranked ACTIONABLE activity; the
 *      derivation never promotes a lower-ranked activity.
 *   2. Awareness-only standings (unassigned, unlicensed) are never recommended
 *      and never actionable.
 *   3. Primary responsibilities and Support work are listed distinctly, read
 *      from the stored routing (routedAs), not inferred.
 *   4. The reason is reused verbatim from the activity, so the Assistant and the
 *      activity card never disagree.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveMyWorkDirection } from './direction'
import type { ActivityGroup, MyWorkState, PriorityBand, RoutedAs } from './types'
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
      },
    ],
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

test('direction: next action is the top-ranked actionable activity (no re-ranking)', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ band: 'focus', rank: 2, label: 'Outreach', availableCount: 3, reason: 'focus reason' }),
      activity({ band: 'owned', rank: 4, label: 'Research', ownedCount: 1 }),
    ]),
  )
  assert.equal(d.quiet, false)
  assert.equal(d.nextAction?.label, 'Outreach')
  assert.equal(d.nextAction?.band, 'focus')
  // Reason is reused verbatim from the activity.
  assert.equal(d.nextAction?.reason, 'focus reason')
})

test('direction: a due date-only callback surfaces its due count on the next action', () => {
  const d = deriveMyWorkDirection(
    state([activity({ band: 'due_callback', rank: 3, label: 'Outreach', availableCount: 2, dueCount: 2 })]),
  )
  assert.equal(d.nextAction?.dueCount, 2)
  // No invented clock time anywhere in the heading/label.
  assert.doesNotMatch(d.nextAction?.heading ?? '', /\d{1,2}:\d{2}/)
  assert.doesNotMatch(d.nextAction?.actionLabel ?? '', /\d{1,2}:\d{2}/)
})

test('direction: awareness-only standings are never recommended and never quiet-breaking', () => {
  // Only unassigned + unlicensed activities exist: nothing is actionable.
  const d = deriveMyWorkDirection(
    state([
      activity({ band: 'unassigned', rank: 7, totalCount: 5, availableCount: 0 }),
      activity({ band: 'unlicensed', rank: 8, totalCount: 2, availableCount: 0 }),
    ]),
  )
  assert.equal(d.quiet, true)
  assert.equal(d.nextAction, null)
  assert.deepEqual(d.primary, [])
  assert.deepEqual(d.support, [])
})

test('direction: an actionable band with no items the worker can act on is not recommended', () => {
  // A shared activity whose only items are claimed by teammates: nothing to do.
  const d = deriveMyWorkDirection(
    state([activity({ band: 'shared', rank: 5, availableCount: 0, ownedCount: 0, claimedByOthersCount: 4, totalCount: 4 })]),
  )
  assert.equal(d.quiet, true)
  assert.equal(d.nextAction, null)
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

test('direction: actionableCount counts owned + available + due only', () => {
  const d = deriveMyWorkDirection(
    state([
      activity({ band: 'owned', rank: 4, ownedCount: 2, availableCount: 1, dueCount: 1, claimedByOthersCount: 3 }),
    ]),
  )
  // 2 owned + 1 available + 1 due = 4; the 3 teammate-claimed are excluded.
  assert.equal(d.nextAction?.actionableCount, 4)
})

test('direction: a direct route is taken from an actionable source', () => {
  const d = deriveMyWorkDirection(
    state([activity({ band: 'shared', rank: 5, workFunction: 'outreach', availableCount: 2 })]),
  )
  assert.equal(d.nextAction?.route, '/stewardship?wf=outreach')
})
