/**
 * Time-of-day greeting, resolved on the actor's own clock.
 *
 * Right Path has no single business timezone (Eastern/Central staff), so the
 * greeting is computed on the signed-in employee's detected zone, consistent
 * with the shared Time Context. Pure and framework-free: callers pass the
 * actor's IANA zone (from getActorTimeZone) and, optionally, the evaluation
 * instant for testability.
 */

import { DateTime } from 'luxon'
import { FALLBACK_ACTOR_TIME_ZONE, isValidTimeZone } from '@/lib/time/time-context'

/** "Good morning" / "Good afternoon" / "Good evening" on the actor's clock. */
export function timeOfDayGreeting(actorTimeZone?: string | null, now: Date = new Date()): string {
  const zone = isValidTimeZone(actorTimeZone) ? actorTimeZone : FALLBACK_ACTOR_TIME_ZONE
  const hour = DateTime.fromJSDate(now, { zone }).hour
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The full personalized greeting line, e.g. "Good morning, Bob". Falls back to
 * the plain time-of-day greeting when no first name is known. */
export function personalGreeting(
  firstName: string | null | undefined,
  actorTimeZone?: string | null,
  now: Date = new Date(),
): string {
  const base = timeOfDayGreeting(actorTimeZone, now)
  const name = (firstName ?? '').trim()
  return name ? `${base}, ${name}` : base
}
