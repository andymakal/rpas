/**
 * Callback precision rules tests (node:test via jiti; `npm run test:dd`).
 * Covers the three precisions (exact / windows / anytime): validation, the
 * exact-time flag, customer-clock resolution, and the windows summary.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTimeContext } from '@/lib/time'
import {
  validateCallback,
  hasExactTime,
  resolveExactInstant,
  windowsSummary,
  emptyCommitment,
  type CallbackCommitment,
} from './callback-precision'

const ET = 'America/New_York'
const CT = 'America/Chicago'

test('empty (no date) is a valid no-promise, not invalid', () => {
  const v = validateCallback(emptyCommitment(''))
  assert.equal(v.status, 'empty')
})

test('anytime needs only a date', () => {
  const v = validateCallback({ precision: 'anytime', date: '2026-11-13', clock: null, days: [], bands: [] })
  assert.equal(v.status, 'valid')
})

test('exact requires a clock; missing clock is invalid', () => {
  const invalid = validateCallback({ precision: 'exact', date: '2026-11-13', clock: null, days: [], bands: [] })
  assert.equal(invalid.status, 'invalid')
  const valid = validateCallback({ precision: 'exact', date: '2026-11-13', clock: '14:00', days: [], bands: [] })
  assert.equal(valid.status, 'valid')
})

test('windows requires at least one band', () => {
  const none = validateCallback({ precision: 'windows', date: '2026-11-13', clock: null, days: [], bands: [] })
  assert.equal(none.status, 'invalid')
  const ok = validateCallback({
    precision: 'windows', date: '2026-11-13', clock: null, days: [], bands: ['late_afternoon'],
  })
  assert.equal(ok.status, 'valid')
})

test('hasExactTime is true only for a well-formed exact clock', () => {
  assert.equal(hasExactTime({ precision: 'exact', date: '2026-11-13', clock: '14:00', days: [], bands: [] }), true)
  assert.equal(hasExactTime({ precision: 'exact', date: '2026-11-13', clock: null, days: [], bands: [] }), false)
  assert.equal(hasExactTime({ precision: 'anytime', date: '2026-11-13', clock: null, days: [], bands: [] }), false)
  assert.equal(hasExactTime({ precision: 'windows', date: '2026-11-13', clock: null, days: [], bands: ['morning'] }), false)
})

test('resolveExactInstant uses the CUSTOMER clock (9:00 ET viewed from Central)', () => {
  // ET is standard time (EST, UTC-5) on Nov 13, 2026 (after DST ends Nov 1).
  const ctx = createTimeContext({ customerTimeZone: ET, actorTimeZone: CT })
  const cb: CallbackCommitment = { precision: 'exact', date: '2026-11-13', clock: '09:00', days: [], bands: [] }
  const instant = resolveExactInstant(ctx, cb)
  assert.ok(instant)
  assert.equal(instant!.toISOString(), '2026-11-13T14:00:00.000Z') // 9:00 EST = 14:00Z
})

test('resolveExactInstant returns null for a non-exact commitment', () => {
  const ctx = createTimeContext({ customerTimeZone: ET })
  assert.equal(resolveExactInstant(ctx, emptyCommitment('2026-11-13')), null)
})

test('windowsSummary reads any-day and specific-day shapes', () => {
  assert.equal(
    windowsSummary({ precision: 'windows', date: '2026-11-13', clock: null, days: [], bands: ['late_afternoon', 'evening'] }),
    'Any day · 3–6, 6+',
  )
  assert.equal(
    windowsSummary({ precision: 'windows', date: '2026-11-13', clock: null, days: ['wed', 'thu'], bands: ['early_afternoon'] }),
    'Wed, Thu · 12–3',
  )
  assert.equal(windowsSummary(emptyCommitment('2026-11-13')), null)
})
