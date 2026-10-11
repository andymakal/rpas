/**
 * Daily Direction engine + normalization tests (Right Path).
 *
 * Runs on the Node built-in test runner (node:test), loaded through jiti so the
 * real TypeScript engine and the real GoRules ZEN rule are exercised (no copy of
 * the logic, no new test-framework dependency). Run with: npm run test:dd
 *
 * These cover the two things that must stay correct:
 *   1. The ZEN decision table produces the right Next Best Action for each board
 *      shape (priority order, fallbacks).
 *   2. The composition's normalization honors the settled rules: date-only
 *      callbacks are a due priority (never an exact-time commitment), action
 *      queues outrank waiting, and the reason prose matches the verdict.
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

// ── ZEN decision table: the priority order and fallbacks ────────────────────

test('ZEN: a due callback outranks all queue work', async () => {
  const v = await evaluateNextBestAction({
    hasCallbackDue: true,
    hasActionWork: true,
    topActionQueue: 'ready-to-call',
    hasWaitingWork: true,
  })
  assert.equal(v.nextActionKind, 'callback_due')
  assert.equal(v.reasonCode, 'callback_due_today')
})

test('ZEN: ready-to-call is the next action when it is the top action queue', async () => {
  const v = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasActionWork: true,
    topActionQueue: 'ready-to-call',
    hasWaitingWork: false,
  })
  assert.equal(v.nextActionKind, 'ready_to_call')
})

test('ZEN: research-needed only wins when it is the top action queue', async () => {
  const v = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasActionWork: true,
    topActionQueue: 'research-needed',
    hasWaitingWork: false,
  })
  assert.equal(v.nextActionKind, 'research_needed')
})

test('ZEN: all-waiting board yields waiting, empty board yields open capacity', async () => {
  const waiting = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasActionWork: false,
    topActionQueue: 'none',
    hasWaitingWork: true,
  })
  assert.equal(waiting.nextActionKind, 'waiting')

  const empty = await evaluateNextBestAction({
    hasCallbackDue: false,
    hasActionWork: false,
    topActionQueue: 'none',
    hasWaitingWork: false,
  })
  assert.equal(empty.nextActionKind, 'none')
  assert.equal(empty.reasonCode, 'open_capacity')
})

// ── decideDailyDirection: normalization + ready state ───────────────────────

test('decide: ready-to-call outranks ready-to-email and research by precedence', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [],
    queues: [
      queue('research-needed', 13, 'action'),
      queue('ready-to-email', 1, 'action'),
      queue('ready-to-call', 57, 'action'),
    ],
  }
  const state = await decideDailyDirection(candidates)
  assert.equal(state.nextActionKind, 'ready_to_call')
  assert.equal(state.actionCount, 57)
  assert.equal(state.route, '/stewardship?queue=ready-to-call')
  // The board breakdown surfaces every non-empty queue.
  assert.equal(state.availableWork.length, 3)
})

test('decide: a due date-only callback takes priority and carries no clock time', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [callback('a', 'Jo Sample', '2026-10-09')],
    queues: [queue('ready-to-call', 57, 'action')],
  }
  const state = await decideDailyDirection(candidates)
  assert.equal(state.nextActionKind, 'callback_due')
  assert.equal(state.dueCallbacks.length, 1)
  // The due callback is date-only: the state exposes a date, never a time.
  assert.equal(state.dueCallbacks[0].callbackDate, '2026-10-09')
  assert.ok(!('callbackAt' in state.dueCallbacks[0]))
  // The reason names the customer and frames it as a kept commitment.
  assert.match(state.reason, /Jo Sample/)
  assert.match(state.reason, /commitment/i)
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

// ── buildReason: deterministic prose per verdict ────────────────────────────

test('reason: plural callback phrasing when more than one is due', () => {
  const r = buildReason('callback_due_today', {
    dueCallbackCount: 3,
    firstDueCallbackName: 'Jo Sample',
    topActionQueueLabel: 'Ready to Call',
    topActionQueueCount: 57,
    waitingCount: 0,
  })
  assert.match(r, /3 customers/)
})
