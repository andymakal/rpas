/**
 * Daily Direction engine + normalization tests (Right Path).
 *
 * Runs on the Node built-in test runner (node:test), loaded through jiti so the
 * real TypeScript engine and the real GoRules ZEN rule are exercised (no copy of
 * the logic, no new test-framework dependency). Run with: npm run test:dd
 *
 * These lock in the corrected behaviors:
 *   1. Priority lives entirely in GoRules and reflects only established Right
 *      Path distinctions. Ready-to-call, ready-to-email, and a due callback are
 *      EQUALLY ELIGIBLE outreach (no call-over-email bias, no automatic
 *      callback-first). Research is the exception path; waiting is last.
 *   2. A date-only due callback is due outreach work carrying only a date (never
 *      a clock time), surfaced distinctly, not an automatic top priority.
 *   3. The ready state deep-links into real queues; outreach exposes co-equal
 *      options rather than one ranked route.
 *   4. The business calendar is US Eastern and judges date-only due.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decideDailyDirection,
  evaluateNextBestAction,
  buildReason,
} from './engine'
import { businessToday, isCallbackDue, BUSINESS_TIME_ZONE } from './business-calendar'
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

// ── ZEN decision table: priority reflects only established distinctions ──────

test('ZEN: any ordinary outreach (call/email/callback) yields one neutral outreach verdict', async () => {
  const v = await evaluateNextBestAction({
    hasOutreachWork: true,
    hasResearchNeeded: true,
    hasWaitingWork: true,
  })
  assert.equal(v.nextActionKind, 'outreach')
  assert.equal(v.reasonCode, 'outreach_work')
})

test('ZEN: research-needed (exception) only wins once ordinary outreach is exhausted', async () => {
  const v = await evaluateNextBestAction({
    hasOutreachWork: false,
    hasResearchNeeded: true,
    hasWaitingWork: true,
  })
  assert.equal(v.nextActionKind, 'research_needed')
})

test('ZEN: all-waiting yields waiting; empty board yields open capacity', async () => {
  const waiting = await evaluateNextBestAction({
    hasOutreachWork: false,
    hasResearchNeeded: false,
    hasWaitingWork: true,
  })
  assert.equal(waiting.nextActionKind, 'waiting')

  const empty = await evaluateNextBestAction({
    hasOutreachWork: false,
    hasResearchNeeded: false,
    hasWaitingWork: false,
  })
  assert.equal(empty.nextActionKind, 'none')
  assert.equal(empty.reasonCode, 'open_capacity')
})

// The ZEN rule must NOT expose any input that lets it (or a reader) rank calls
// over emails or callbacks over other outreach: the only outreach fact is the
// collapsed hasOutreachWork.
test('ZEN rule exposes no call/email/callback ranking inputs', async () => {
  const model = (await import('@/rules/next-best-action.json', { with: { type: 'json' } })).default as {
    nodes: { content?: { inputs?: { field: string }[] } }[]
  }
  const table = model.nodes.find((n) => n.content?.inputs)
  const fields = (table?.content?.inputs ?? []).map((i) => i.field)
  assert.ok(fields.includes('hasOutreachWork'))
  for (const banned of ['hasReadyToCall', 'hasReadyToEmail', 'hasCallbackDue', 'topActionQueue']) {
    assert.ok(!fields.includes(banned), `rule must not rank on ${banned}`)
  }
})

// ── decideDailyDirection: equally-eligible outreach + deep links ────────────

test('decide: call + email present -> outreach verdict with TWO co-equal options, no single route', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [],
    queues: [
      queue('ready-to-call', 57, 'action'),
      queue('ready-to-email', 3, 'action'),
    ],
  }
  const state = await decideDailyDirection(candidates)
  assert.equal(state.nextActionKind, 'outreach')
  // No single ranked destination for outreach.
  assert.equal(state.route, null)
  // Both channels are offered as co-equal options, each deep-linking its queue.
  assert.equal(state.outreachOptions.length, 2)
  const byQueue = Object.fromEntries(state.outreachOptions.map((o) => [o.queue, o]))
  assert.equal(byQueue['ready-to-call'].route, '/stewardship?queue=ready-to-call')
  assert.equal(byQueue['ready-to-email'].route, '/stewardship?queue=ready-to-email')
})

test('decide: only email present -> outreach verdict, email is the sole option (no invented call tier)', async () => {
  const state = await decideDailyDirection({
    dueCallbacks: [],
    queues: [queue('ready-to-email', 3, 'action')],
  })
  assert.equal(state.nextActionKind, 'outreach')
  assert.equal(state.outreachOptions.length, 1)
  assert.equal(state.outreachOptions[0].queue, 'ready-to-email')
})

test('decide: a due date-only callback is outreach (not auto-top) and carries no clock time', async () => {
  const candidates: DailyDirectionCandidates = {
    dueCallbacks: [callback('a', 'Jo Sample', '2026-10-09')],
    queues: [
      queue('ready-to-call', 57, 'action'),
      queue('ready-to-email', 3, 'action'),
    ],
  }
  const state = await decideDailyDirection(candidates)
  // Still just outreach — the callback does not promote itself above emails.
  assert.equal(state.nextActionKind, 'outreach')
  // Email remains an equally-eligible option alongside the call queue.
  assert.ok(state.outreachOptions.some((o) => o.queue === 'ready-to-email'))
  assert.ok(state.outreachOptions.some((o) => o.queue === 'ready-to-call'))
  // The callback is surfaced distinctly, date-only, with a deep link.
  assert.equal(state.dueCallbacks.length, 1)
  assert.equal(state.dueCallbacks[0].callbackDate, '2026-10-09')
  assert.ok(!('callbackAt' in state.dueCallbacks[0]))
  assert.equal(state.dueCallbacks[0].route, '/stewardship?queue=ready-to-call')
  assert.doesNotMatch(state.reason, /\d{1,2}:\d{2}/)
})

test('decide: research-only board -> single research route; waiting-only -> waiting; empty -> quiet', async () => {
  const research = await decideDailyDirection({
    dueCallbacks: [],
    queues: [queue('research-needed', 13, 'action')],
  })
  assert.equal(research.nextActionKind, 'research_needed')
  assert.equal(research.route, '/stewardship?queue=research-needed')

  const waiting = await decideDailyDirection({
    dueCallbacks: [],
    queues: [queue('waiting-for-response', 4, 'waiting')],
  })
  assert.equal(waiting.nextActionKind, 'waiting')

  const empty = await decideDailyDirection({ dueCallbacks: [], queues: [] })
  assert.equal(empty.nextActionKind, 'none')
  assert.equal(empty.quiet, true)
})

// ── buildReason: no invented business rule ──────────────────────────────────

test('reason: outreach prose does not rank calls over emails and invents no "fastest" claim', () => {
  const r = buildReason('outreach_work', {
    outreachCount: 60,
    dueCallbackCount: 0,
    researchCount: 0,
    waitingCount: 0,
  })
  assert.doesNotMatch(r, /fastest/i)
  assert.doesNotMatch(r, /call .* before .* email|email .* before .* call/i)
  assert.match(r, /equally ready/i)
})

test('reason: outreach prose notes due callbacks as due work, not a top priority', () => {
  const r = buildReason('outreach_work', {
    outreachCount: 60,
    dueCallbackCount: 2,
    researchCount: 0,
    waitingCount: 0,
  })
  assert.match(r, /promised callback/i)
  assert.doesNotMatch(r, /first|outrank|top priority/i)
})

// ── business calendar: US Eastern ───────────────────────────────────────────

test('business calendar is US Eastern (evidence: PA/Eastern book), not inherited Central', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'America/New_York')
})

test('isCallbackDue judges date-only due on the business calendar', () => {
  // A fixed instant: 2026-10-09 02:00 UTC = 2026-10-08 22:00 US Eastern.
  const now = new Date('2026-10-09T02:00:00Z')
  assert.equal(businessToday(now), '2026-10-08') // Eastern, not UTC's Oct 9
  assert.equal(isCallbackDue('2026-10-08', now), true) // today -> due
  assert.equal(isCallbackDue('2026-10-07', now), true) // past -> due
  assert.equal(isCallbackDue('2026-10-09', now), false) // future -> not due
  assert.equal(isCallbackDue(null, now), false)
})
