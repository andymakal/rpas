/**
 * Callback precision rules tests (node:test via jiti; `npm run test:dd`).
 * The two-axis model: WHEN (specific date | recurring days Mon-Sat) × TIME
 * (exact half-hour | bands | any). Validation across the combos, the exact-time
 * flag + resolution, the next-matching-weekday due date, and the summary label.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTimeContext } from '@/lib/time'
import {
  validateCallback,
  hasExactTime,
  resolveExactInstant,
  resolveDueDate,
  commitmentSummary,
  buildHalfHourSlots,
  CALLBACK_TIME_RANGE,
  WEEKDAYS,
  emptyCommitment,
  type CallbackCommitment,
} from './callback-precision'

const ET = 'America/New_York'
const CT = 'America/Chicago'

// A convenience builder.
function cb(p: Partial<CallbackCommitment>): CallbackCommitment {
  return { whenMode: 'date', date: '', days: [], timeMode: 'any', clock: null, bands: [], ...p }
}

// ── WHEN axis excludes Sunday ────────────────────────────────────────────────

test('weekday chips are Mon-Sat only; Sunday is never offered', () => {
  const keys = WEEKDAYS.map((w) => w.key)
  assert.deepEqual(keys, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
  assert.ok(!keys.includes('sun' as never))
})

// ── Validation ───────────────────────────────────────────────────────────────

test('date mode with no date and any-time is an empty no-promise', () => {
  assert.equal(validateCallback(emptyCommitment('')).status, 'empty')
})

test('date mode: a date alone (any time) is valid', () => {
  assert.equal(validateCallback(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'any' })).status, 'valid')
})

test('date + exact requires a chosen time', () => {
  assert.equal(validateCallback(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'exact', clock: null })).status, 'invalid')
  assert.equal(validateCallback(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'exact', clock: '14:00' })).status, 'valid')
})

test('date + bands requires at least one band', () => {
  assert.equal(validateCallback(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'bands', bands: [] })).status, 'invalid')
  assert.equal(validateCallback(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'bands', bands: ['late_afternoon'] })).status, 'valid')
})

test('recurring mode requires at least one day', () => {
  assert.equal(validateCallback(cb({ whenMode: 'recurring', days: [] })).status, 'invalid')
  assert.equal(validateCallback(cb({ whenMode: 'recurring', days: ['tue'], timeMode: 'any' })).status, 'valid')
})

test('recurring + exact is disallowed (an exact time needs a real date)', () => {
  const v = validateCallback(cb({ whenMode: 'recurring', days: ['tue'], timeMode: 'exact', clock: '14:00' }))
  assert.equal(v.status, 'invalid')
  assert.match(v.reason ?? '', /specific date/i)
})

test('recurring + bands is the "any Mon/Tue/Wed after 3" case', () => {
  const v = validateCallback(cb({ whenMode: 'recurring', days: ['mon', 'tue', 'wed'], timeMode: 'bands', bands: ['late_afternoon', 'evening'] }))
  assert.equal(v.status, 'valid')
})

// ── Exact time ───────────────────────────────────────────────────────────────

test('hasExactTime: only a specific-date exact clock', () => {
  assert.equal(hasExactTime(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'exact', clock: '14:00' })), true)
  assert.equal(hasExactTime(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'bands', bands: ['morning'] })), false)
  assert.equal(hasExactTime(cb({ whenMode: 'recurring', days: ['tue'], timeMode: 'exact', clock: '14:00' })), false)
})

test('resolveExactInstant is on the customer clock (9:00 ET = 14:00Z in Nov)', () => {
  const ctx = createTimeContext({ customerTimeZone: ET, actorTimeZone: CT })
  const instant = resolveExactInstant(ctx, cb({ whenMode: 'date', date: '2026-11-13', timeMode: 'exact', clock: '09:00' }))
  assert.ok(instant)
  assert.equal(instant!.toISOString(), '2026-11-13T14:00:00.000Z')
})

// ── Due-date resolution ──────────────────────────────────────────────────────

test('resolveDueDate: date mode returns the chosen date', () => {
  const ctx = createTimeContext({ customerTimeZone: ET })
  assert.equal(resolveDueDate(ctx, cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'any' })), '2026-11-17')
})

test('resolveDueDate: recurring returns the NEXT matching weekday', () => {
  // Fri Nov 13 2026 (customer clock). "Mon/Tue/Wed" first surfaces the coming
  // Monday, Nov 16.
  const ctx = createTimeContext({ customerTimeZone: ET, now: new Date('2026-11-13T18:00:00Z') })
  assert.equal(
    resolveDueDate(ctx, cb({ whenMode: 'recurring', days: ['mon', 'tue', 'wed'], timeMode: 'bands', bands: ['late_afternoon'] })),
    '2026-11-16',
  )
})

test('resolveDueDate: recurring matches TODAY when today is one of the days', () => {
  // Fri Nov 13 2026; "Fri" matches today.
  const ctx = createTimeContext({ customerTimeZone: ET, now: new Date('2026-11-13T18:00:00Z') })
  assert.equal(resolveDueDate(ctx, cb({ whenMode: 'recurring', days: ['fri'], timeMode: 'any' })), '2026-11-13')
})

// ── Summary label (drives the history preview) ───────────────────────────────

test('commitmentSummary: exact appointment carries date + time', () => {
  assert.equal(
    commitmentSummary(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'exact', clock: '14:00' }), '11/17/2026'),
    '11/17/2026 at 2:00 PM',
  )
})

test('commitmentSummary: date + bands', () => {
  assert.equal(
    commitmentSummary(cb({ whenMode: 'date', date: '2026-11-17', timeMode: 'bands', bands: ['late_afternoon', 'evening'] }), '11/17/2026'),
    '11/17/2026 · 3–6, 6+',
  )
})

test('commitmentSummary: recurring days + bands', () => {
  assert.equal(
    commitmentSummary(cb({ whenMode: 'recurring', days: ['mon', 'tue', 'wed'], timeMode: 'bands', bands: ['late_afternoon'] })),
    'Mon, Tue, Wed · 3–6',
  )
})

test('commitmentSummary: recurring all/none days reads "Any day"', () => {
  assert.equal(
    commitmentSummary(cb({ whenMode: 'recurring', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], timeMode: 'any' })),
    'Any day · any time',
  )
})

// ── Half-hour slots (unchanged) ──────────────────────────────────────────────

test('buildHalfHourSlots: half-hour granularity, range-bounded, no trailing :30', () => {
  const slots = buildHalfHourSlots(CALLBACK_TIME_RANGE) // 7:00 AM - 9:00 PM
  assert.equal(slots[0].value, '07:00')
  assert.equal(slots[0].label, '7:00 AM')
  assert.equal(slots[slots.length - 1].value, '21:00')
  assert.equal(slots[slots.length - 1].label, '9:00 PM')
  for (const s of slots) assert.match(s.value, /:(00|30)$/)
  assert.equal(slots.length, 29)
  assert.ok(slots.some((s) => s.value === '12:00' && s.label === '12:00 PM'))
  assert.ok(slots.some((s) => s.value === '13:30' && s.label === '1:30 PM'))
})
