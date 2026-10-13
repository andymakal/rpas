/**
 * Outreach-attempt grouping for Servicing-Agent Onboarding (Right Path).
 *
 * The communication history preserves every INDIVIDUAL communication (each call,
 * voicemail, text, or email is its own durable case_touches row — nothing is
 * collapsed or lost). For cadence and the Nonresponsive judgment we need the
 * coarser notion of an ATTEMPT: a single coordinated reach-out. Multiple
 * communications made as part of one reach-out count as ONE attempt (e.g. a call
 * that goes to voicemail plus a follow-up text the same day is one attempt, not
 * two).
 *
 * This is pure normalization (the TypeScript half of the GoRules division of
 * labor): it turns the raw communication history into the attempt facts ZEN and
 * the cadence consume. It reads no database and makes no business decision about
 * eligibility or priority.
 *
 * Grouping rule: communications are grouped by their ACTOR-calendar day. All
 * channels on the same day form one attempt. This is deterministic, matches how
 * a worker experiences a day's outreach as one push, and uses only the
 * date-only resolution Right Path already applies to callbacks and follow-ups
 * (no invented clock time). The actor time zone is supplied by the caller.
 */

import { DateTime } from 'luxon'
import { FALLBACK_ACTOR_TIME_ZONE, isValidTimeZone } from '@/lib/time'

/** The communication channels that count as outreach contact attempts. */
export type OutreachChannel = 'call' | 'voicemail' | 'text' | 'email' | 'postal'

/**
 * One individual communication from the customer's history, reduced to the two
 * facts attempt-grouping needs. Maps directly to a case_touches row
 * (touch_type + touched_at); the caller filters to the onboarding outreach
 * touches before passing them in.
 */
export interface Communication {
  /** The channel used, from case_touches.touch_type. */
  channel: OutreachChannel
  /** When the communication happened (ISO instant, from touched_at). */
  at: string
}

/** One grouped outreach attempt: the day it happened and what it comprised. */
export interface OutreachAttempt {
  /** The attempt's actor-calendar day (YYYY-MM-DD). */
  day: string
  /** The individual communications that make up this one attempt. */
  communications: Communication[]
  /** True when any communication in the attempt was a phone CALL (call/voicemail). */
  includedCall: boolean
}

function actorDay(at: string, actorTimeZone: string | null): string | null {
  const zone = isValidTimeZone(actorTimeZone) ? (actorTimeZone as string) : FALLBACK_ACTOR_TIME_ZONE
  const dt = DateTime.fromISO(at, { zone })
  if (!dt.isValid) {
    const fromJs = DateTime.fromJSDate(new Date(at), { zone })
    return fromJs.isValid ? fromJs.toFormat('yyyy-LL-dd') : null
  }
  return dt.toFormat('yyyy-LL-dd')
}

/**
 * Group a customer's individual communications into outreach attempts by
 * actor-calendar day. Communications with an unparseable timestamp are ignored
 * (they cannot be placed on a day); everything else is grouped. The result is
 * ordered oldest attempt first.
 */
export function groupIntoAttempts(
  communications: Communication[],
  actorTimeZone: string | null,
): OutreachAttempt[] {
  const byDay = new Map<string, Communication[]>()
  for (const c of communications) {
    const day = actorDay(c.at, actorTimeZone)
    if (!day) continue
    const list = byDay.get(day) ?? []
    list.push(c)
    byDay.set(day, list)
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, comms]) => ({
      day,
      communications: comms.slice().sort((a, b) => a.at.localeCompare(b.at)),
      includedCall: comms.some((c) => c.channel === 'call' || c.channel === 'voicemail'),
    }))
}

/**
 * How many unsuccessful CALL attempts have been made. An attempt counts as a
 * call attempt when it included a phone call (call or voicemail). "Unsuccessful"
 * is the caller's concern: the onboarding records an attempt's outcome
 * separately (a reached call advances the workflow out of the call cadence), so
 * for cadence purposes every grouped call attempt still in the call flow is an
 * unsuccessful one. This counts the grouped call attempts, which drives both the
 * escalating cadence index and the Nonresponsive threshold.
 */
export function countCallAttempts(attempts: OutreachAttempt[]): number {
  return attempts.filter((a) => a.includedCall).length
}

/**
 * The total number of grouped outreach attempts across ALL channels. This is the
 * "7 unsuccessful outreach attempts" basis for the Nonresponsive recommendation:
 * the rule speaks of outreach attempts, not calls specifically, so every grouped
 * reach-out day (call, text, email, or postal) counts once.
 */
export function countOutreachAttempts(attempts: OutreachAttempt[]): number {
  return attempts.length
}
