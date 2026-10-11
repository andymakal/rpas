/**
 * Date-only due judgment for Daily Direction, on the ACTOR's calendar.
 *
 * Right Path operates across time zones (Andy in Eastern; Bob and Angie in
 * Central), so there is NO single agency business timezone. A date-only
 * promised callback is "due today" on the SIGNED-IN EMPLOYEE's calendar: the
 * day their work is organized around. Each employee therefore sees their own
 * "today" — Bob at 11pm Central still sees the Central day, not a server/UTC day
 * and not a hardcoded zone.
 *
 * All zone reasoning is delegated to the shared Right Path time module. This
 * file no longer owns a timezone constant.
 */

import { createTimeContext, actorToday, type TimeContext } from '@/lib/time'

/**
 * Today's date (YYYY-MM-DD) on the actor's calendar for a given actor zone and
 * instant. actorTimeZone null/invalid falls back to the time module's documented
 * last resort (never a hardcoded business zone).
 */
export function actorBusinessToday(actorTimeZone: string | null, now: Date = new Date()): string {
  const ctx = createTimeContext({ now, actorTimeZone })
  return actorToday(ctx)
}

/**
 * Whether a date-only callback date (YYYY-MM-DD) is due on or before today on
 * the ACTOR's calendar. Date-only in; no clock time is read or implied. Accepts
 * either a prepared TimeContext or an actor zone + instant.
 */
export function isCallbackDue(
  callbackDate: string | null | undefined,
  ctxOrActorZone: TimeContext | string | null,
  now: Date = new Date(),
): boolean {
  if (!callbackDate) return false
  const today =
    typeof ctxOrActorZone === 'object' && ctxOrActorZone !== null
      ? actorToday(ctxOrActorZone)
      : actorBusinessToday(ctxOrActorZone, now)
  return callbackDate <= today
}
