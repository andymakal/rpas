/**
 * Shared, framework-neutral helpers for the Right Path actor-timezone cookie.
 *
 * Adapted from IPF (ipf-stewardship: src/components/actor-timezone-cookie.ts).
 * The signed-in employee's browser/device IANA timezone is a client-only value
 * (Intl.DateTimeFormat().resolvedOptions().timeZone). It is captured on the
 * client and mirrored into this cookie so server components can read the actor
 * zone during SSR and pass it into timezone-sensitive reads. This is how Andy
 * (Eastern) and Bob/Angie (Central) each get their own clock without any
 * hardcoded or server zone.
 *
 * Kept in a non-client module so both the server (reads the cookie during SSR)
 * and the client synchronizer (writes it) reference one authoritative name and
 * validator.
 */

export const ACTOR_TIME_ZONE_COOKIE = 'rp-actor-time-zone'

/**
 * Validate a raw cookie value as an IANA time zone the platform recognizes.
 * Returns the zone when valid, otherwise null. Server callers pass the result
 * to createTimeContext, which independently falls back to its documented
 * last-resort default when the zone is null/invalid.
 */
export function parseActorTimeZone(raw: string | undefined | null): string | null {
  if (!raw || !raw.trim()) return null
  const zone = raw.trim()
  try {
    // Intl throws a RangeError for an unrecognized IANA zone.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}
