/**
 * Daily Direction engine + normalization tests (Right Path).
 *
 * Runs on the Node built-in test runner (node:test), loaded through jiti so the
 * real TypeScript engine and the real GoRules ZEN rule are exercised (no copy of
 * the logic, no new test-framework dependency). Run with: npm run test:dd
 *
 * These lock in the four corrected behaviors:
 *   1. Priority lives entirely in GoRules; the engine passes independent
 *      presence facts and ZEN alone orders them. No call-over-email preference
 *      is invented (ready-to-call and ready-to-email are peers).
 *   2. A date-only due callback is DUE ACTION WORK surfaced first among action
 *      work, carrying only a date (never a clock time), and does not depend on a
 *      fixed-time interrupt model.
 *   3. The ready state links into the matching queue (route carries ?queue=).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decideDailyDirection,
  evaluateNextBestAction,
  buildReason,
} from './engine'
import type { DailyDirectionCandidates, QueueCandidate, DueCallback } from './types'

function queue(
  q: QueueCandidate['queue'],
  count: number,
  kind: 'action' | 'waiting',
): QueueCandidate {
  return { queue: q, label: q, count, kind, route: `/stewardship?queue=${q}` }
}

function callback(id: string, name: string, date: string): DueCallback {
  return { id, personName: name, callbackDate: date, route: '/stewardship?queue=ready-to-call' }
}

// ── ZEN decision table: priority lives in the rule ──────────────────────────

test('ZEN: a due callback is the first action work', async () => {
  const v = await evaluateNextBestAction({
    hasCallbackDue: true,
    hasReadyToCall: true,
    hasReadyToEmail: true,
    hasResearchNeeded: true,
    hasWaitingWork: true,
  })
  assert.equal(v.nextActionKind, 'callback_due')
  assert.equal(v.reasonCode, 'callback_due')
})

test('ZEN: ready-to-email wins when there is no call work (no call-over-email bias beyond naming)', async () => {
  const v = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasReadyToCall: false,
    hasReadyToEmail: true,
    hasResearchNeeded: true,
    hasWaitingWork: true,
  })
  // Email outranks research (exception path) and waiting.
  assert.equal(v.nextActionKind, 'ready_to_email')
  assert.equal(v.reasonCode, 'outreach_work')
})

test('ZEN: ordinary outreach (call or email) both report the same outreach_work reason', async () => {
  const call = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasReadyToCall: true,
    hasReadyToEmail: true,
    hasResearchNeeded: false,
    hasWaitingWork: false,
  })
  // Both call and email are the same tier: the reasonCode is the neutral
  // outreach_work, not a call-specific or email-specific preference.
  assert.equal(call.reasonCode, 'outreach_work')
})

test('ZEN: research-needed only wins after ordinary outreach is exhausted', async () => {
  const v = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasReadyToCall: false,
    hasReadyToEmail: false,
    hasResearchNeeded: true,
    hasWaitingWork: true,
  })
  assert.equal(v.nextActionKind, 'research_needed')
})

test('ZEN: all-waiting yields waiting; empty board yields open capacity', async () => {
  const waiting = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasReadyToCall: false,
    hasReadyToEmail: false,
    hasResearchNeeded: false,
    hasWaitingWork: true,
  })
  assert.equal(waiting.nextActionKind, 'waiting')

  const empty = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasReadyToCall: false,
    hasReadyToEmail: false,
    hasResearchNeeded: false,
    hasWaitingWork: false,
  })
  assert.equal(empty.nextActionKind, 'none')
  assert.equal(empty.reasonCode, 'open_capacity')
})

// ── decideDailyDirection: normalization + ready state ───────────────────────

test('decide: outreach work is recommended and the route deep-links into its queue', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [],
    queues: [
      queue('research-needed', 13, 'action'),
      queue('ready-to-email', 1, 'action'),
      queue('ready-to-call', 57, 'action'),
    ],
  }
  const state = await decideDailyDirection(candidates)
  // ZEN names ready-to-call first among present outreach; the point is the route
  // deep-links into the actual queue, not back to the board.
  assert.equal(state.nextActionKind, 'ready_to_call')
  assert.equal(state.route, '/stewardship?queue=ready-to-call')
  assert.ok((state.route ?? '').includes('?queue='))
  assert.equal(state.availableWork.length, 3)
  // Every board row carries a deep link into its own queue.
  for (const w of state.availableWork) {
    assert.equal(w.route, `/stewardship?queue=${w.queue}`)
  }
})

test('decide: a due date-only callback is first action work and carries no clock time', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [callback('a', 'Jo Sample', '2026-10-09')],
    queues: [queue('ready-to-call', 57, 'action')],
  }
  const state = await decideDailyDirection(candidates)
  assert.equal(state.nextActionKind, 'callback_due')
  assert.equal(state.dueCallbacks.length, 1)
  // Date-only: a date is exposed, never a clock time.
  assert.equal(state.dueCallbacks[0].callbackDate, '2026-10-09')
  assert.ok(!('callbackAt' in state.dueCallbacks[0]))
  assert.ok(!('callbackTime' in state.dueCallbacks[0]))
  // The callback opens the Ready to Call queue (where it lives).
  assert.equal(state.route, '/stewardship?queue=ready-to-call')
  // Reason names the customer; frames it as due action work, not a timed alarm.
  assert.match(state.reason, /Jo Sample/)
  assert.doesNotMatch(state.reason, /\d{1,2}:\d{2}/)
})

test('decide: a waiting-only board recommends waiting, not an action', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [],
    queues: [
      queue('waiting-for-response', 4, 'waiting'),
      queue('waiting-for-carrier', 2, 'waiting'),
    ],
  }
  const state = await decideDailyDirection(candidates)
  assert.equal(state.nextActionKind, 'waiting')
  assert.equal(state.actionCount, 6)
  assert.equal(state.quiet, false)
})

test('decide: an empty board is quiet (open capacity)', async () => {
  const state = await decideDailyDirection({ dueCallbacks: [], queues: [] })
  assert.equal(state.nextActionKind, 'none')
  assert.equal(state.quiet, true)
  assert.equal(state.route, null)
  assert.equal(state.availableWork.length, 0)
})

// ── buildReason: deterministic prose, no invented business rule ─────────────

test('reason: outreach prose states the queue and count without ranking calls over emails', () => {
  const r = buildReason('outreach_work', {
    dueCallbackCount: 0,
    firstDueCallbackName: null,
    recommendedLabel: 'Ready to Email',
    recommendedCount: 3,
    waitingCount: 0,
  })
  assert.match(r, /Ready to Email/)
  assert.match(r, /3 customers/)
  // Must NOT claim calls move customers forward fastest or otherwise invent a
  // call-over-email preference.
  assert.doesNotMatch(r, /fastest/i)
})

test('reason: plural callback phrasing when more than one is due', () => {
  const r = buildReason('callback_due', {
    dueCallbackCount: 3,
    firstDueCallbackName: 'Jo Sample',
    recommendedLabel: 'Ready to Call',
    recommendedCount: 3,
    waitingCount: 0,
  })
  assert.match(r, /3 customers/)
})
