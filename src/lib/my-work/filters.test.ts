/**
 * Unit tests for the My Work Project + Activity filtering (src/lib/my-work/filters.ts).
 *
 * Focus: the project-filtered activity totals. The regression these guard
 * against is an Outreach total that drops ready-to-call customers because the
 * normal ready-to-call source is never emitted and the Calls Due / Available to
 * Call populations are informational (excluded from a source re-sum). The fix
 * reads the authoritative per-project aggregate (projectTotals) instead, so the
 * filtered total counts every applicable customer once, including ready-to-call,
 * without double-counting a customer who has several contact methods.
 *
 * Run with: npm run test:dd
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ALL, applyWorkFilters, projectFilterOptions } from './filters'
import type { ActivityGroup, MyWorkState, WorkSource } from './types'

const PID = 'project-1035'
const OTHER_PID = 'project-other'

/** A shared stewardship source with a per-project breakdown. */
function sharedSource(partial: Partial<WorkSource> & { label: string }): WorkSource {
  return {
    kind: 'stewardship',
    count: 0,
    route: '/stewardship',
    projectId: null,
    ownedByMe: 0,
    availableToMe: 0,
    claimedByOthers: 0,
    notEligible: 0,
    dueToMe: 0,
    ...partial,
  }
}

/**
 * Build a state that mirrors the development 1035 scenario: one project with
 * 125 Outreach customers (74 ready-to-call surfaced ONLY via the informational
 * Calls Due / Available to Call populations, 51 ready-to-email) and 18 research
 * customers, all shared-board work (projectId null) attributed to the project
 * via projectScopes + the authoritative projectTotals.
 */
function devLikeState(): MyWorkState {
  const outreach: ActivityGroup = {
    workFunction: 'outreach',
    label: 'Outreach',
    description: null,
    band: 'shared',
    rank: 10,
    reasonCode: 'shared',
    reason: 'Shared outreach work.',
    // Activity-level unfiltered totals: 125 outreach customers counted once.
    totalCount: 125,
    ownedCount: 0,
    availableCount: 125,
    claimedByOthersCount: 0,
    notEligibleCount: 0,
    dueCount: 0,
    // Authoritative per-project aggregate: each customer once across queues.
    projectTotals: {
      [PID]: {
        totalCount: 125,
        ownedCount: 0,
        availableCount: 125,
        claimedByOthersCount: 0,
        notEligibleCount: 0,
        dueCount: 0,
      },
    },
    isEligible: true,
    capabilityStatus: 'routable',
    routedAs: 'primary',
    isFocusElevated: false,
    sources: [
      // Ready to Email (51), a normal counted source for the project.
      sharedSource({
        label: 'Shared Stewardship board — Ready to Email',
        count: 51,
        availableToMe: 51,
        projectScopes: {
          [PID]: {
            count: 51, ownedByMe: 0, availableToMe: 51, claimedByOthers: 0,
            notEligible: 0, dueToMe: 0, route: `/stewardship?queue=ready-to-email&project_id=${PID}`,
          },
        },
      }),
      // The ready-to-call customers appear ONLY through these informational
      // populations; the normal ready-to-call source is never emitted. Together
      // they represent the 74 callable customers (split due vs available).
      sharedSource({
        label: 'Shared Stewardship board — Calls Due',
        count: 30,
        availableToMe: 30,
        dueToMe: 30,
        informational: true,
        projectScopes: {
          [PID]: {
            count: 30, ownedByMe: 0, availableToMe: 30, claimedByOthers: 0,
            notEligible: 0, dueToMe: 30, route: `/stewardship?population=calls-due&project_id=${PID}`,
          },
        },
      }),
      sharedSource({
        label: 'Shared Stewardship board — Available to Call',
        count: 44,
        availableToMe: 44,
        informational: true,
        projectScopes: {
          [PID]: {
            count: 44, ownedByMe: 0, availableToMe: 44, claimedByOthers: 0,
            notEligible: 0, dueToMe: 0, route: `/stewardship?population=available-to-call&project_id=${PID}`,
          },
        },
      }),
    ],
  }

  const research: ActivityGroup = {
    workFunction: 'research',
    label: 'Contact Research',
    description: null,
    band: 'shared',
    rank: 20,
    reasonCode: 'shared',
    reason: 'Shared research work.',
    totalCount: 18,
    ownedCount: 0,
    availableCount: 18,
    claimedByOthersCount: 0,
    notEligibleCount: 0,
    dueCount: 0,
    projectTotals: {
      [PID]: {
        totalCount: 18, ownedCount: 0, availableCount: 18,
        claimedByOthersCount: 0, notEligibleCount: 0, dueCount: 0,
      },
    },
    isEligible: true,
    capabilityStatus: 'routable',
    routedAs: 'primary',
    isFocusElevated: false,
    sources: [
      sharedSource({
        label: 'Shared Stewardship board — Research needed',
        count: 18,
        availableToMe: 18,
        projectScopes: {
          [PID]: {
            count: 18, ownedByMe: 0, availableToMe: 18, claimedByOthers: 0,
            notEligible: 0, dueToMe: 0, route: `/stewardship?queue=research-needed&project_id=${PID}`,
          },
        },
      }),
    ],
  }

  return {
    employeeName: 'Test Worker',
    noProfile: false,
    activities: [outreach, research],
    responsibilities: [],
    focusNotes: [],
    quiet: false,
  }
}

test('project filter keeps the Outreach total complete, including ready-to-call', () => {
  const filtered = applyWorkFilters(devLikeState(), PID, ALL)
  const outreach = filtered.activities.find((a) => a.workFunction === 'outreach')
  assert.ok(outreach, 'Outreach activity should remain under the project filter')
  // The whole point: 125, not 51. Ready-to-call customers (surfaced only via the
  // informational populations) are still counted.
  assert.equal(outreach.totalCount, 125)
  assert.equal(outreach.availableCount, 125)
})

test('project filter does not double-count: total is not inflated by the informational populations', () => {
  const filtered = applyWorkFilters(devLikeState(), PID, ALL)
  const outreach = filtered.activities.find((a) => a.workFunction === 'outreach')!
  // If sources were summed, 51 + 30 + 44 = 125 by coincidence here, but a
  // customer both emailable and callable would be counted in BOTH email (51) and
  // calls (74). The authoritative aggregate counts each once, so the total is
  // exactly the aggregate, never the inflated source sum.
  assert.equal(outreach.totalCount, 125)
  assert.notEqual(outreach.totalCount, 51 + 30 + 44 + /* a hypothetical overlap */ 1)
})

test('research total is scoped to the project', () => {
  const filtered = applyWorkFilters(devLikeState(), PID, ALL)
  const research = filtered.activities.find((a) => a.workFunction === 'research')
  assert.ok(research, 'Research should remain under the project filter')
  assert.equal(research.totalCount, 18)
})

test('narrowed sources keep project-scoped links', () => {
  const filtered = applyWorkFilters(devLikeState(), PID, ALL)
  const outreach = filtered.activities.find((a) => a.workFunction === 'outreach')!
  for (const s of outreach.sources) {
    assert.match(s.route, new RegExp(`project_id=${PID}`), `source ${s.label} should link to the project scope`)
  }
})

test('unfiltered state is returned unchanged (identity) when both filters are ALL', () => {
  const state = devLikeState()
  const filtered = applyWorkFilters(state, ALL, ALL)
  assert.equal(filtered, state, 'no-op filter must return the same object (no re-aggregation)')
})

test('activity filter combines with project filter (AND)', () => {
  const filtered = applyWorkFilters(devLikeState(), PID, 'research')
  assert.equal(filtered.activities.length, 1)
  assert.equal(filtered.activities[0].workFunction, 'research')
  assert.equal(filtered.activities[0].totalCount, 18)
})

test('selecting a different project excludes unrelated work', () => {
  const filtered = applyWorkFilters(devLikeState(), OTHER_PID, ALL)
  // No activity has work in OTHER_PID, so nothing survives the project filter.
  assert.equal(filtered.activities.length, 0)
})

test('fixed-time commitments are exempt from the filters', () => {
  const state = devLikeState()
  // Promote outreach to a due-callback commitment band; it must survive even a
  // non-matching project filter, with all sources intact.
  state.activities[0] = { ...state.activities[0], band: 'due_callback' }
  const filtered = applyWorkFilters(state, OTHER_PID, 'research')
  const outreach = filtered.activities.find((a) => a.workFunction === 'outreach')
  assert.ok(outreach, 'a commitment-band activity is never hidden by the filters')
  assert.equal(outreach.totalCount, 125, 'commitment keeps its full counts')
})

test('projectFilterOptions discovers a project seen only via shared projectScopes', () => {
  const options = projectFilterOptions(devLikeState())
  assert.ok(options.some((o) => o.id === PID), 'the project must be filterable from shared scopes alone')
})
