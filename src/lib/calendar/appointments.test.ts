/**
 * Double-booking guard tests: the pure overlap math and the kind-aware guard
 * (CALENDAR_DESIGN.md §4a). appointment/busy overlaps conflict; a hold never
 * does; touching endpoints do not overlap.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { intervalsOverlap, isDoubleBooked, type GuardBlock } from './appointments'

const d = (iso: string) => new Date(iso)

test('intervalsOverlap: half-open, touching endpoints do NOT overlap', () => {
  // A ends exactly when B starts.
  assert.equal(
    intervalsOverlap(d('2026-11-13T14:00:00Z'), d('2026-11-13T14:30:00Z'), d('2026-11-13T14:30:00Z'), d('2026-11-13T15:00:00Z')),
    false,
  )
  // Genuine overlap.
  assert.equal(
    intervalsOverlap(d('2026-11-13T14:00:00Z'), d('2026-11-13T14:30:00Z'), d('2026-11-13T14:15:00Z'), d('2026-11-13T14:45:00Z')),
    true,
  )
  // Fully disjoint.
  assert.equal(
    intervalsOverlap(d('2026-11-13T14:00:00Z'), d('2026-11-13T14:30:00Z'), d('2026-11-13T16:00:00Z'), d('2026-11-13T16:30:00Z')),
    false,
  )
})

const start = d('2026-11-13T14:00:00Z')
const end = d('2026-11-13T14:30:00Z')

test('an overlapping APPOINTMENT is a conflict', () => {
  const existing: GuardBlock[] = [
    { kind: 'appointment', purpose: null, starts_at: '2026-11-13T14:15:00Z', ends_at: '2026-11-13T14:45:00Z' },
  ]
  assert.equal(isDoubleBooked(start, end, existing), true)
})

test('an overlapping BUSY block is a conflict', () => {
  const existing: GuardBlock[] = [
    { kind: 'busy', purpose: null, starts_at: '2026-11-13T13:45:00Z', ends_at: '2026-11-13T14:10:00Z' },
  ]
  assert.equal(isDoubleBooked(start, end, existing), true)
})

test('an overlapping HOLD is NOT a conflict (fillable, not blocking)', () => {
  const existing: GuardBlock[] = [
    { kind: 'hold', purpose: 'review', starts_at: '2026-11-13T13:00:00Z', ends_at: '2026-11-13T17:00:00Z' },
  ]
  assert.equal(isDoubleBooked(start, end, existing), false)
})

test('a non-overlapping appointment is not a conflict', () => {
  const existing: GuardBlock[] = [
    { kind: 'appointment', purpose: null, starts_at: '2026-11-13T15:00:00Z', ends_at: '2026-11-13T15:30:00Z' },
  ]
  assert.equal(isDoubleBooked(start, end, existing), false)
})

test('mixed set: a hold overlaps but an appointment does not -> no conflict', () => {
  const existing: GuardBlock[] = [
    { kind: 'hold', purpose: 'review', starts_at: '2026-11-13T14:00:00Z', ends_at: '2026-11-13T18:00:00Z' },
    { kind: 'appointment', purpose: null, starts_at: '2026-11-13T16:00:00Z', ends_at: '2026-11-13T16:30:00Z' },
  ]
  assert.equal(isDoubleBooked(start, end, existing), false)
})
