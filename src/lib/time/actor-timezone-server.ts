/**
 * Server-side reader for the actor timezone cookie.
 *
 * Server components call this during SSR to get the signed-in employee's
 * detected IANA zone (written by <ActorTimeZoneSync/> on the client). The
 * result is passed to createTimeContext; when the cookie is absent or invalid
 * the Time Context falls back to its documented last-resort default. This keeps
 * timezone detection in one place for every server surface (Daily Direction,
 * queues, scheduling), never per-workflow.
 */

import { cookies } from 'next/headers'
import { ACTOR_TIME_ZONE_COOKIE, parseActorTimeZone } from './actor-timezone-cookie'

/**
 * The detected actor IANA zone from the request cookies, or null when it is not
 * yet known (first request before the client sync writes it, or an invalid
 * value). Null lets createTimeContext apply its last-resort fallback.
 */
export async function getActorTimeZone(): Promise<string | null> {
  const store = await cookies()
  return parseActorTimeZone(store.get(ACTOR_TIME_ZONE_COOKIE)?.value)
}
