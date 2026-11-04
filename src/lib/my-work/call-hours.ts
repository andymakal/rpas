/**
 * MY WORK — call hours (Right Path).
 *
 * The agency's calling window: 9 am to 6 pm Eastern. Live phone outreach is
 * best done inside it; quiet work (research, email, document preparation) is
 * not time-bound. The Assistant reads this to decide whether call work can be
 * recommended right now or should wait.
 *
 * Zone math is delegated to Luxon with an IANA zone (DST-correct), the same
 * engine the shared time module uses. No hard-coded UTC offset.
 *
 * Pure: no IO, client-safe. Business days are NOT modeled; the window is
 * judged on the clock only, because no weekend or holiday rule has been
 * established.
 */

import { DateTime } from 'luxon'

export const CALL_HOURS = {
  timeZone: 'America/New_York',
  /** Inclusive opening hour (24h clock, Eastern). */
  startHour: 9,
  /** Exclusive closing hour (24h clock, Eastern): open until 5:59:59 pm. */
  endHour: 18,
  label: '9 am to 6 pm Eastern',
} as const

/** Whether the calling window is open at the given instant. An invalid instant
 * reads as closed. */
export function isCallHoursOpen(now: Date): boolean {
  const dt = DateTime.fromJSDate(now, { zone: CALL_HOURS.timeZone })
  if (!dt.isValid) return false
  return dt.hour >= CALL_HOURS.startHour && dt.hour < CALL_HOURS.endHour
}
