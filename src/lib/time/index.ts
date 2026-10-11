/**
 * Right Path shared time module.
 *
 * System-wide timezone-aware time reasoning for Right Path, adapted from the
 * established IPF architecture. Use this everywhere time crosses zones:
 * scheduling, callbacks, appointments, Daily Direction, and shared work queues.
 * Do NOT create per-workflow timezone logic.
 *
 * The three concepts are kept distinct:
 *   - actor time    (the signed-in employee's detected zone)
 *   - customer time (the customer's zone when known)
 *   - scheduled event time (one absolute instant, shown per participant)
 *
 * Server surfaces read the actor zone via getActorTimeZone() and build a
 * TimeContext with createTimeContext(); the client <ActorTimeZoneSync/> keeps
 * that zone current.
 */

export {
  type TimeContext,
  type TimeContextInit,
  type CommitmentClocks,
  FALLBACK_ACTOR_TIME_ZONE,
  FALLBACK_CUSTOMER_TIME_ZONE,
  isValidTimeZone,
  createTimeContext,
  customerWallClockToInstant,
  instantToCustomerWallClock,
  instantToActorWallClock,
  actorToday,
  customerToday,
  minutesPast,
  zoneAbbreviation,
  customerCalendarLabel,
  commitmentClocks,
  commitmentClockLabel,
} from './time-context'

export {
  type FutureCommitment,
  type CommitmentPresentation,
  hasTime,
  formatClockLabel,
  resolveCommitmentInstant,
  commitmentToCustomerWallClock,
  commitmentFromInstant,
  presentCommitment,
  futureCommitmentText,
} from './future-commitment'

export { ACTOR_TIME_ZONE_COOKIE, parseActorTimeZone } from './actor-timezone-cookie'

// NOTE: getActorTimeZone (server-only; imports next/headers) is intentionally
// NOT re-exported here. This barrel is imported by client components (via the
// pure time helpers), and re-exporting a next/headers module would pull it into
// the client bundle and break the build. Server callers import it directly:
//   import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
