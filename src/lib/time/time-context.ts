/**
 * Right Path shared Time Context.
 *
 * The single, framework-free owner of timezone-aware time reasoning for Right
 * Path. Adapted from the established IPF architecture
 * (ipf-stewardship: src/domain/shared/time-context.ts); the actor/customer/
 * absolute-instant model is reused rather than rebuilt. Any workflow that
 * interprets a customer-local statement, decides due/overdue against an
 * absolute instant, or presents a time in a particular clock MUST go through
 * this module. This is system-wide (scheduling, callbacks, appointments, Daily
 * Direction, shared work queues), never per-workflow timezone logic.
 *
 * Three distinct time concepts are preserved and never conflated:
 *
 *   - actor time:    the signed-in employee's current device/session zone,
 *                    detected per session (Andy in Eastern, Bob/Angie in
 *                    Central). Used only to present instants on the actor's
 *                    clock. Never a hardcoded or server zone.
 *   - customer time: the customer's IANA zone when known. Customer-local
 *                    statements (preferred windows, promised callbacks) are
 *                    interpreted on THIS clock, never the server/runtime zone.
 *   - scheduled event time: one absolute instant (UTC). The same instant is
 *                    shown correctly in either clock, and its original
 *                    customer-local meaning is preserved.
 *
 * Pure TypeScript. No IO, no browser globals, no server/runtime-zone
 * dependence. All zone math is delegated to Luxon (IANA zones via the platform
 * Intl database), which is DST-correct.
 */

import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// Zone fallbacks (LAST RESORT ONLY)
// ---------------------------------------------------------------------------
//
// Right Path operates across time zones (PA/Eastern and Central staff), so
// there is NO single business timezone. The real actor zone is DETECTED per
// session and passed in explicitly; the real customer zone is passed in when
// known. These constants are used ONLY when a zone is genuinely unknown and
// some value is unavoidable (e.g. a server read before the actor zone cookie
// exists). They are deliberately NOT a business calendar and must never be used
// as a substitute for the detected actor zone or a known customer zone.
//
// US Eastern is the least-surprising last-resort fallback because the home
// office (Andy, Pennsylvania) and the dominant customer book are Eastern; but
// correctness comes from the detected/known zones above, not from this value.

/** Last-resort actor zone when the signed-in employee's device zone is unknown. */
export const FALLBACK_ACTOR_TIME_ZONE = 'America/New_York'

/** Last-resort customer zone when a customer's zone is genuinely unknown. */
export const FALLBACK_CUSTOMER_TIME_ZONE = 'America/New_York'

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

/**
 * A resolved evaluation moment plus the two clocks that give it meaning. `now`
 * is an absolute instant; the zone in which it is READ is chosen explicitly
 * (customer clock for domain classification, actor clock for presentation).
 */
export interface TimeContext {
  /** The absolute instant at which evaluation happens. */
  now: Date
  /** The signed-in employee's detected device/session IANA zone. */
  actorTimeZone: string
  /** The customer's IANA zone. Falls back only when genuinely unknown. */
  customerTimeZone: string
  /** Whether the actor zone was actually known (vs. defaulted). */
  actorTimeZoneKnown: boolean
  /** Whether the customer zone was actually known (vs. defaulted). */
  customerTimeZoneKnown: boolean
}

export interface TimeContextInit {
  /** Evaluation instant. Defaults to the current moment. */
  now?: Date
  /** Signed-in employee's detected device/session zone. */
  actorTimeZone?: string | null
  /** Customer's IANA zone, when known. */
  customerTimeZone?: string | null
}

/** True when the string is a zone Luxon (and the platform Intl db) recognizes. */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone || !zone.trim()) return false
  return DateTime.local().setZone(zone).isValid
}

/**
 * Build a TimeContext from an evaluation instant and the two clocks. Invalid or
 * absent zones fall back to the documented LAST-RESORT defaults, and the
 * *-known flags record whether each zone was real so callers can tell a
 * detected zone from a fallback.
 */
export function createTimeContext(init: TimeContextInit = {}): TimeContext {
  const now = init.now ?? new Date()
  const actorTimeZoneKnown = isValidTimeZone(init.actorTimeZone)
  const actorTimeZone = actorTimeZoneKnown
    ? (init.actorTimeZone as string)
    : FALLBACK_ACTOR_TIME_ZONE
  const customerTimeZoneKnown = isValidTimeZone(init.customerTimeZone)
  const customerTimeZone = customerTimeZoneKnown
    ? (init.customerTimeZone as string)
    : FALLBACK_CUSTOMER_TIME_ZONE
  return { now, actorTimeZone, customerTimeZone, actorTimeZoneKnown, customerTimeZoneKnown }
}

// ---------------------------------------------------------------------------
// Customer-local wall clock <-> absolute instant
// ---------------------------------------------------------------------------

/**
 * Resolve a customer-local wall clock to an absolute instant. Accepts a plain
 * date `YYYY-MM-DD` plus a clock `HH:MM` (or a combined `YYYY-MM-DDTHH:MM`) and
 * interprets it on the customer clock, returning the absolute instant it
 * denotes. This is how a customer statement like "tomorrow at 3 PM" becomes a
 * storable instant without ever touching the server zone. Returns null when the
 * input is not a valid wall clock.
 */
export function customerWallClockToInstant(
  ctx: TimeContext,
  isoDate: string,
  clock?: string | null,
): Date | null {
  const raw = (isoDate ?? '').trim()
  const combined = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (combined && (clock == null || clock === '')) {
    return customerWallClockToInstant(ctx, combined[1], combined[2])
  }
  const date = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const time = (clock ?? '00:00').trim()
  const tm = time.match(/^(\d{2}):(\d{2})/)
  const hour = tm ? Number(tm[1]) : 0
  const minute = tm ? Number(tm[2]) : 0
  const dt = DateTime.fromObject(
    {
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      day: Number(date.slice(8, 10)),
      hour,
      minute,
    },
    { zone: ctx.customerTimeZone },
  )
  if (!dt.isValid) return null
  return dt.toJSDate()
}

/**
 * Render an absolute instant as a customer-local wall-clock ISO string
 * (`YYYY-MM-DDTHH:MM`). Returns null for an invalid instant.
 */
export function instantToCustomerWallClock(ctx: TimeContext, instant: Date): string | null {
  const dt = DateTime.fromJSDate(instant, { zone: ctx.customerTimeZone })
  if (!dt.isValid) return null
  return dt.toFormat("yyyy-LL-dd'T'HH:mm")
}

/**
 * Render an absolute instant on the ACTOR's clock as `YYYY-MM-DDTHH:MM`, so the
 * same commitment can be shown correctly in the employee's own zone when it
 * differs from the customer's. Returns null for an invalid instant.
 */
export function instantToActorWallClock(ctx: TimeContext, instant: Date): string | null {
  const dt = DateTime.fromJSDate(instant, { zone: ctx.actorTimeZone })
  if (!dt.isValid) return null
  return dt.toFormat("yyyy-LL-dd'T'HH:mm")
}

// ---------------------------------------------------------------------------
// Calendar dates on each clock
// ---------------------------------------------------------------------------

/**
 * The ACTOR-local calendar date (`YYYY-MM-DD`) of the evaluation instant. This
 * is the employee's "today": the day their work is organized around. Each
 * employee sees their own today (Andy Eastern, Bob/Angie Central).
 */
export function actorToday(ctx: TimeContext): string {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.actorTimeZone })
  return dt.isValid ? dt.toFormat('yyyy-LL-dd') : ''
}

/** The CUSTOMER-local calendar date (`YYYY-MM-DD`) of the evaluation instant. */
export function customerToday(ctx: TimeContext): string {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.customerTimeZone })
  return dt.isValid ? dt.toFormat('yyyy-LL-dd') : ''
}

/** Minutes `instant` is past `now` (negative when still in the future). */
export function minutesPast(ctx: TimeContext, instant: Date): number {
  return (ctx.now.getTime() - instant.getTime()) / 60000
}

// ---------------------------------------------------------------------------
// Dual-clock presentation (single owner of time-of-day labels)
// ---------------------------------------------------------------------------

/**
 * A short, season-neutral zone abbreviation (e.g. "CT", "ET") for an IANA zone
 * at an instant, used to distinguish two clocks when actor and customer zones
 * differ. Collapses "CDT"/"CST" to "CT" so the label is stable across DST.
 */
export function zoneAbbreviation(zone: string, instant: Date): string {
  const dt = DateTime.fromJSDate(instant, { zone })
  if (!dt.isValid) return ''
  const short = dt.toFormat('ZZZZ')
  return short.replace(/^(\w)[DS](T)$/, '$1$2') || short
}

/** Time-of-day label for an instant read on a specific zone, e.g. "3:00 PM". */
function clockLabelInZone(zone: string, instant: Date): string | null {
  const dt = DateTime.fromJSDate(instant, { zone })
  if (!dt.isValid) return null
  return dt.toFormat('h:mm a')
}

/** Date + time label for an instant read on a specific zone. */
function dateTimeLabelInZone(zone: string, instant: Date): string | null {
  const dt = DateTime.fromJSDate(instant, { zone })
  if (!dt.isValid) return null
  return dt.toFormat("MM/dd/yyyy 'at' h:mm a")
}

/** Customer-clock calendar label for an instant, e.g. "Wednesday, August 26". */
export function customerCalendarLabel(ctx: TimeContext, instant: Date): string | null {
  const dt = DateTime.fromJSDate(instant, { zone: ctx.customerTimeZone })
  if (!dt.isValid) return null
  return dt.toFormat('cccc, LLLL d')
}

/**
 * The resolved presentation of one absolute instant on BOTH clocks. `differ` is
 * true only when actor and customer zones genuinely resolve to different
 * wall-clock labels, so a caller shows one clock normally and both (with zone
 * abbreviations) when they diverge.
 */
export interface CommitmentClocks {
  actorTime: string | null
  customerTime: string | null
  actorDateTime: string | null
  customerDateTime: string | null
  actorZoneAbbrev: string
  customerZoneAbbrev: string
  differ: boolean
}

/**
 * Resolve a commitment instant into actor-local and customer-local
 * presentations. The single place time-of-day becomes a label; pages/components
 * must not split ISO strings or build AM/PM labels themselves. This is what
 * makes "5:00 PM Eastern" (set by Dulce) show as "4:00 PM Central" to Bob while
 * both reference the one absolute instant.
 */
export function commitmentClocks(ctx: TimeContext, instant: Date): CommitmentClocks {
  const actorTime = clockLabelInZone(ctx.actorTimeZone, instant)
  const customerTime = clockLabelInZone(ctx.customerTimeZone, instant)
  const differ =
    ctx.actorTimeZone !== ctx.customerTimeZone &&
    actorTime != null &&
    customerTime != null &&
    actorTime !== customerTime
  return {
    actorTime,
    customerTime,
    actorDateTime: dateTimeLabelInZone(ctx.actorTimeZone, instant),
    customerDateTime: dateTimeLabelInZone(ctx.customerTimeZone, instant),
    actorZoneAbbrev: zoneAbbreviation(ctx.actorTimeZone, instant),
    customerZoneAbbrev: zoneAbbreviation(ctx.customerTimeZone, instant),
    differ,
  }
}

/**
 * A single compact dual-clock label for a commitment instant. When the two
 * clocks agree, returns the plain time (e.g. "3:00 PM"). When they differ,
 * returns both with zone abbreviations, e.g.
 * "1:00 PM CT (3:00 PM ET their time)". `withDate` prefixes the actor-clock
 * calendar date.
 */
export function commitmentClockLabel(
  ctx: TimeContext,
  instant: Date,
  opts: { withDate?: boolean } = {},
): string | null {
  const c = commitmentClocks(ctx, instant)
  const base = opts.withDate ? c.actorDateTime : c.actorTime
  if (base == null) return null
  if (!c.differ) return base
  return `${base} ${c.actorZoneAbbrev} (${c.customerTime} ${c.customerZoneAbbrev} their time)`
}
