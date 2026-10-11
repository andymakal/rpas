/**
 * Right Path time module tests (actor/customer/absolute-instant).
 *
 * Runs on node:test via jiti (same harness as the Daily Direction suite). These
 * verify the multi-timezone contract that replaced the single hardcoded zone:
 *   - a customer-time commitment resolves to ONE absolute instant and displays
 *     correctly on each participant's clock (the Dulce -> Bob example);
 *   - Eastern/Central conversions, including across daylight-saving transitions;
 *   - date-only commitments stay date-only (no fabricated clock time);
 *   - exact-time commitments retain their customer-time meaning.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createTimeContext,
  instantToActorWallClock,
  instantToCustomerWallClock,
  commitmentClockLabel,
  actorToday,
} from './time-context'
import {
  resolveCommitmentInstant,
  commitmentToCustomerWallClock,
  commitmentFromInstant,
  presentCommitment,
  futureCommitmentText,
  hasTime,
  type FutureCommitment,
} from './future-commitment'

const ET = 'America/New_York'
const CT = 'America/Chicago'

// ── The requirement's worked example ────────────────────────────────────────

test('Dulce schedules 5:00 PM Eastern; Bob (Central) sees 4:00 PM; same instant', () => {
  // Summer so ET=UTC-4, CT=UTC-5. Customer/appointment expressed in Eastern.
  // Viewer (actor) is Bob in Central.
  const ctx = createTimeContext({
    now: new Date('2026-09-01T12:00:00Z'),
    actorTimeZone: CT,
    customerTimeZone: ET,
  })
  const appt: FutureCommitment = { date: '2026-09-03', clock: '17:00' } // 5:00 PM ET

  const instant = resolveCommitmentInstant(ctx, appt)
  assert.ok(instant)
  // 5:00 PM EDT (UTC-4) == 21:00 UTC. ONE absolute instant.
  assert.equal(instant!.toISOString(), '2026-09-03T21:00:00.000Z')

  const p = presentCommitment(ctx, appt)!
  assert.equal(p.hasTime, true)
  assert.equal(p.customerTimeLabel, '5:00 PM') // Eastern (where it was set)
  assert.equal(p.actorTimeLabel, '4:00 PM') // Central (Bob's clock)
  assert.equal(p.clocksDiffer, true)

  // A viewer in Eastern (e.g. Andy) sees 5:00 PM for the same instant.
  const andyCtx = createTimeContext({
    now: ctx.now,
    actorTimeZone: ET,
    customerTimeZone: ET,
  })
  assert.equal(instantToActorWallClock(andyCtx, instant!), '2026-09-03T17:00')
  // And Bob's actor wall clock is 4:00 PM for that same instant.
  assert.equal(instantToActorWallClock(ctx, instant!), '2026-09-03T16:00')
})

test('dual-clock label reads both zones when actor and customer differ', () => {
  const ctx = createTimeContext({
    now: new Date('2026-09-01T12:00:00Z'),
    actorTimeZone: CT,
    customerTimeZone: ET,
  })
  const instant = resolveCommitmentInstant(ctx, { date: '2026-09-03', clock: '17:00' })!
  const label = commitmentClockLabel(ctx, instant)
  // Bob's own clock first, customer's promised clock noted.
  assert.equal(label, '4:00 PM CT (5:00 PM ET their time)')
})

// ── Eastern/Central conversion + DST transitions ────────────────────────────

test('Central is one hour behind Eastern in summer (EDT/CDT) and winter (EST/CST)', () => {
  // Summer: 3:00 PM ET == 2:00 PM CT.
  const summer = createTimeContext({ actorTimeZone: CT, customerTimeZone: ET, now: new Date('2026-07-01T12:00:00Z') })
  const sInstant = resolveCommitmentInstant(summer, { date: '2026-07-15', clock: '15:00' })!
  assert.equal(sInstant.toISOString(), '2026-07-15T19:00:00.000Z') // 3pm EDT = 19:00Z
  assert.equal(instantToActorWallClock(summer, sInstant), '2026-07-15T14:00') // 2pm CDT

  // Winter: 3:00 PM ET == 2:00 PM CT, but offsets shift (EST=UTC-5, CST=UTC-6).
  const winter = createTimeContext({ actorTimeZone: CT, customerTimeZone: ET, now: new Date('2026-01-01T12:00:00Z') })
  const wInstant = resolveCommitmentInstant(winter, { date: '2026-01-15', clock: '15:00' })!
  assert.equal(wInstant.toISOString(), '2026-01-15T20:00:00.000Z') // 3pm EST = 20:00Z
  assert.equal(instantToActorWallClock(winter, wInstant), '2026-01-15T14:00') // 2pm CST
})

test('DST spring-forward: a commitment after the US transition uses summer offset', () => {
  // US DST 2026 begins Sunday March 8. A 10:00 AM ET commitment on March 9 is
  // EDT (UTC-4), so 14:00Z; the same wall time on March 1 would be EST (15:00Z).
  const ctx = createTimeContext({ actorTimeZone: CT, customerTimeZone: ET, now: new Date('2026-03-01T12:00:00Z') })
  const before = resolveCommitmentInstant(ctx, { date: '2026-03-01', clock: '10:00' })!
  const after = resolveCommitmentInstant(ctx, { date: '2026-03-09', clock: '10:00' })!
  assert.equal(before.toISOString(), '2026-03-01T15:00:00.000Z') // EST
  assert.equal(after.toISOString(), '2026-03-09T14:00:00.000Z') // EDT
  // Central equivalents stay one hour behind on each side of the transition.
  assert.equal(instantToActorWallClock(ctx, before), '2026-03-01T09:00')
  assert.equal(instantToActorWallClock(ctx, after), '2026-03-09T09:00')
})

test('DST fall-back: a commitment after the US transition uses winter offset', () => {
  // US DST 2026 ends Sunday November 1. A 10:00 AM ET commitment on November 2
  // is EST (UTC-5) = 15:00Z; on October 25 it is EDT (UTC-4) = 14:00Z.
  const ctx = createTimeContext({ actorTimeZone: CT, customerTimeZone: ET, now: new Date('2026-10-20T12:00:00Z') })
  const edt = resolveCommitmentInstant(ctx, { date: '2026-10-25', clock: '10:00' })!
  const est = resolveCommitmentInstant(ctx, { date: '2026-11-02', clock: '10:00' })!
  assert.equal(edt.toISOString(), '2026-10-25T14:00:00.000Z')
  assert.equal(est.toISOString(), '2026-11-02T15:00:00.000Z')
})

// ── actorToday across the Eastern/Central midnight gap ──────────────────────

test('actorToday differs by zone in the hour between Eastern and Central midnight', () => {
  // 2026-10-09 04:30 UTC = 00:30 ET (Oct 9) but 23:30 CT (Oct 8).
  const now = new Date('2026-10-09T04:30:00Z')
  assert.equal(actorToday(createTimeContext({ now, actorTimeZone: ET })), '2026-10-09')
  assert.equal(actorToday(createTimeContext({ now, actorTimeZone: CT })), '2026-10-08')
})

// ── date-only vs exact-time ─────────────────────────────────────────────────

test('date-only commitment stays date-only: no clock time fabricated', () => {
  const ctx = createTimeContext({ actorTimeZone: CT, customerTimeZone: ET, now: new Date('2026-09-01T12:00:00Z') })
  const dateOnly: FutureCommitment = { date: '2026-09-03', clock: null }

  assert.equal(hasTime(dateOnly), false)
  assert.equal(commitmentToCustomerWallClock(dateOnly), '2026-09-03') // no T time

  const p = presentCommitment(ctx, dateOnly)!
  assert.equal(p.hasTime, false)
  assert.equal(p.customerTimeLabel, null)
  assert.equal(p.actorTimeLabel, null)

  // Round-trips through an instant without inventing a time.
  const instant = resolveCommitmentInstant(ctx, dateOnly)!
  assert.deepEqual(commitmentFromInstant(ctx, instant, false), { date: '2026-09-03', clock: null })

  // Wording states a due date, never a time.
  assert.equal(futureCommitmentText(p, 'Callback'), 'Callback due on Thursday, September 3')
})

test('exact-time commitment retains its customer-time meaning through round-trip', () => {
  const ctx = createTimeContext({ actorTimeZone: CT, customerTimeZone: ET, now: new Date('2026-09-01T12:00:00Z') })
  const timed: FutureCommitment = { date: '2026-09-03', clock: '17:00' }
  assert.equal(commitmentToCustomerWallClock(timed), '2026-09-03T17:00')
  const instant = resolveCommitmentInstant(ctx, timed)!
  // Reading the stored instant back on the customer clock recovers 5:00 PM.
  assert.equal(instantToCustomerWallClock(ctx, instant), '2026-09-03T17:00')
  // And a timed round-trip preserves the customer-local clock.
  assert.deepEqual(commitmentFromInstant(ctx, instant, true), { date: '2026-09-03', clock: '17:00' })
})
