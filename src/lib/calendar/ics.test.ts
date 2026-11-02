/**
 * .ics builder tests — the timezone/DST guard that a type-check cannot give.
 *
 * The core regression: given an absolute instant + a stated IANA zone, the
 * emitted DTSTART must carry the STATED local wall-clock regardless of the
 * server's own zone (a native Date + timezone made ical-generator shift it).
 * Also covers a standard/daylight boundary date and the Mountain/Pacific zones.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTimeContext, customerWallClockToInstant } from '@/lib/time'
import { buildAppointmentIcs } from './ics'

/** Pull the DTSTART line's TZID + local stamp from an .ics string. */
function dtstart(ics: string): string {
  const m = ics.match(/DTSTART;TZID=([^:]+):(\d{8}T\d{6})/)
  assert.ok(m, `DTSTART not found in:\n${ics}`)
  return `${m![1]}:${m![2]}`
}

function icsFor(zone: string, date: string, clock: string): string {
  const ctx = createTimeContext({ customerTimeZone: zone })
  const start = customerWallClockToInstant(ctx, date, clock)!
  const end = new Date(start.getTime() + 30 * 60000)
  return buildAppointmentIcs({ start, end, statedTimeZone: zone, summary: 'Call', uid: 'u1' })
}

test('Eastern 9:00 emits the stated local time, not a server-shifted one', () => {
  // The regression: on a non-Eastern server this used to emit T080000.
  assert.equal(dtstart(icsFor('America/New_York', '2026-11-13', '09:00')), 'America/New_York:20261113T090000')
})

test('Central 9:00 stays 9:00 Central', () => {
  assert.equal(dtstart(icsFor('America/Chicago', '2026-11-13', '09:00')), 'America/Chicago:20261113T090000')
})

test('Mountain (Colorado) 9:00 stays 9:00 Denver', () => {
  assert.equal(dtstart(icsFor('America/Denver', '2026-11-13', '09:00')), 'America/Denver:20261113T090000')
})

test('Pacific 9:00 stays 9:00 Los Angeles', () => {
  assert.equal(dtstart(icsFor('America/Los_Angeles', '2026-11-13', '09:00')), 'America/Los_Angeles:20261113T090000')
})

test('standard-time date (after DST ends Nov 1 2026) renders the stated wall clock', () => {
  // Nov 13 is EST; the emitted local time must still read 14:00, not shifted.
  assert.equal(dtstart(icsFor('America/New_York', '2026-11-13', '14:00')), 'America/New_York:20261113T140000')
})

test('daylight-time date (before DST ends) renders the same wall clock', () => {
  // Oct 25 2026 is EDT; the stated 14:00 must still emit as 140000 locally.
  assert.equal(dtstart(icsFor('America/New_York', '2026-10-25', '14:00')), 'America/New_York:20261025T140000')
})

test('the invite is a REQUEST (accept/decline) and names the attendee', () => {
  const ctx = createTimeContext({ customerTimeZone: 'America/New_York' })
  const start = customerWallClockToInstant(ctx, '2026-11-13', '09:00')!
  const ics = buildAppointmentIcs({
    start,
    end: new Date(start.getTime() + 30 * 60000),
    statedTimeZone: 'America/New_York',
    summary: 'Call with Linda Koenig',
    uid: 'u2',
    attendees: [{ name: 'Linda Koenig', email: 'linda@example.com' }],
  })
  assert.match(ics, /METHOD:REQUEST/)
  assert.match(ics, /ATTENDEE[^\n]*linda@example\.com/)
})
