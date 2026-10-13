/**
 * Automatic call cadence for Servicing-Agent Onboarding (Right Path).
 *
 * This is the deterministic TIME-MATH half of the GoRules division of labor:
 * ZEN owns the business decisions about WHICH action is eligible, what the next
 * step is, and how work is prioritized (eligibility + ordering over normalized
 * facts); TypeScript owns normalization and time math. Computing the next call
 * DATE from the attempt history is pure, DST-correct time math, so it lives here
 * and never in a ZEN rule. ZEN is fed the resulting facts (how many attempts,
 * whether a call is due) and never queries the database.
 *
 * The cadence (settled business rule):
 *   - After the introductory email: call in 24 hours.
 *   - After the 1st unsuccessful call: retry in 24 hours.
 *   - After the 2nd unsuccessful call: retry in 2 days.
 *   - After the 3rd unsuccessful call: retry in 3 days.
 *   - After the 4th and every subsequent unsuccessful call: retry every 6
 *     business days, rotating weekdays (so the attempt does not always land on
 *     the same weekday, and never on a weekend).
 *   - Honor promised callbacks and employee overrides: an explicit
 *     customer-promised callback date or an employee-chosen date takes
 *     precedence over the computed cadence date.
 *   - An employee may always contact the customer BEFORE the scheduled date;
 *     the cadence sets when the item next RESURFACES on its own, not a lockout.
 *   - Continue indefinitely unless deliberately stopped. There is NO attempt
 *     cap and nothing auto-closes; after enough attempts the item is flagged
 *     Nonresponsive for human review (that decision is ZEN's), but the cadence
 *     keeps producing dates.
 *
 * Dates are DATE-ONLY on the ACTOR's calendar, consistent with how the board
 * and the Daily Direction reads treat callback_date / follow_up_due: Right Path
 * records no clock time for a scheduled call, so none is invented here. The
 * caller supplies the actor time zone (never the server/runtime zone).
 */

import { DateTime } from 'luxon'
import { FALLBACK_ACTOR_TIME_ZONE, isValidTimeZone } from '@/lib/time'

/**
 * The fixed early-stage spacing, in CALENDAR days, indexed by how many
 * unsuccessful calls have ALREADY been made when we schedule the next one.
 *
 *   index 0 -> the first call after the introductory email (24h / 1 day)
 *   index 1 -> after the 1st unsuccessful call (24h / 1 day)
 *   index 2 -> after the 2nd unsuccessful call (2 days)
 *   index 3 -> after the 3rd unsuccessful call (3 days)
 *
 * After these, the cadence switches to the business-day rotation below.
 */
export const EARLY_CALL_SPACING_DAYS: readonly number[] = [1, 1, 2, 3]

/**
 * Once past the early stage, retries are spaced this many BUSINESS days apart.
 * Six business days from a weekday advances the landing weekday by one each
 * time, which is the "rotating weekdays" behavior: a run of late attempts does
 * not keep hitting the same day of the week, and never lands on a weekend.
 */
export const LATE_CALL_BUSINESS_DAYS = 6

/**
 * How many unsuccessful OUTREACH ATTEMPTS trigger the "Nonresponsive — Review
 * Contact Strategy" recommendation. The cadence itself does not stop at this
 * number (nothing auto-closes); it is the point at which the work is flagged for
 * a human to reconsider contact info, method, or timing. The flag decision is
 * ZEN's; this constant is the shared threshold the fact normalization uses.
 */
export const NONRESPONSIVE_ATTEMPT_THRESHOLD = 7

/** Monday–Friday are business days. (Luxon weekday: 1=Mon … 7=Sun.) */
function isBusinessDay(dt: DateTime): boolean {
  return dt.weekday >= 1 && dt.weekday <= 5
}

/** Advance to the next business day, skipping Saturday and Sunday. */
function nextBusinessDay(dt: DateTime): DateTime {
  let d = dt.plus({ days: 1 })
  while (!isBusinessDay(d)) d = d.plus({ days: 1 })
  return d
}

/** Add N business days to a date (each step skips weekends). */
function addBusinessDays(dt: DateTime, businessDays: number): DateTime {
  let d = dt
  for (let i = 0; i < businessDays; i++) d = nextBusinessDay(d)
  return d
}

/**
 * The actor-calendar "today" (YYYY-MM-DD) a cadence computation is anchored to.
 * Pure wrapper over Luxon so this module owns no timezone constant beyond the
 * shared last-resort fallback.
 */
function actorDate(now: Date, actorTimeZone: string | null): DateTime {
  const zone = isValidTimeZone(actorTimeZone) ? (actorTimeZone as string) : FALLBACK_ACTOR_TIME_ZONE
  return DateTime.fromJSDate(now, { zone }).startOf('day')
}

export interface NextCallDateInput {
  /**
   * How many unsuccessful CALL ATTEMPTS have already been made for this customer
   * in the current onboarding run. 0 means no call has been attempted yet (the
   * next call is the first one, scheduled 24h after the introductory email).
   * Attempts are the GROUPED communication history (multiple communications in
   * one attempt count as one attempt), supplied by the caller.
   */
  priorUnsuccessfulAttempts: number
  /** Evaluation instant. Defaults to now. */
  now?: Date
  /** The actor's IANA time zone (never the server zone). */
  actorTimeZone?: string | null
}

/**
 * The next automatic call date (YYYY-MM-DD, date-only, actor calendar) for a
 * customer with `priorUnsuccessfulAttempts` unsuccessful calls already made.
 *
 * This is the cadence's resurfacing date only — the day the item comes back on
 * its own as Calls Due. It never prevents an earlier manual call, and it is
 * overridden by a promised callback or an explicit employee date (see
 * resolveNextCallDate). The cadence continues indefinitely; it never returns
 * null and never signals "stop".
 */
export function nextAutomaticCallDate(input: NextCallDateInput): string {
  const attempts = Math.max(0, Math.floor(input.priorUnsuccessfulAttempts || 0))
  const today = actorDate(input.now ?? new Date(), input.actorTimeZone ?? null)

  if (attempts < EARLY_CALL_SPACING_DAYS.length) {
    // Early stage: fixed calendar-day spacing (24h, 24h, 2d, 3d).
    const days = EARLY_CALL_SPACING_DAYS[attempts]
    return today.plus({ days }).toFormat('yyyy-LL-dd')
  }

  // Late stage: every 6 business days, which rotates the weekday forward and
  // never lands on a weekend.
  return addBusinessDays(today, LATE_CALL_BUSINESS_DAYS).toFormat('yyyy-LL-dd')
}

export interface ResolveNextCallInput extends NextCallDateInput {
  /**
   * A customer-promised callback date (YYYY-MM-DD) when one exists, else null.
   * A promised callback ALWAYS wins over the computed cadence: it is a customer
   * commitment, not an automatic retry.
   */
  promisedCallbackDate?: string | null
  /**
   * An explicit employee override date (YYYY-MM-DD) when the worker has chosen
   * when to next reach out, else null. An override wins over the computed
   * cadence but not over a customer-promised callback (a promise to the customer
   * outranks an internal scheduling preference).
   */
  employeeOverrideDate?: string | null
}

export interface ResolvedNextCall {
  /** The resolved next-call date (YYYY-MM-DD, date-only). */
  date: string
  /** Why this date was chosen, for honest UI/audit wording. */
  source: 'promised_callback' | 'employee_override' | 'cadence'
}

/**
 * Resolve the next call date honoring precedence: a customer-promised callback
 * first, then an explicit employee override, otherwise the automatic cadence.
 * Pure; the caller persists the result. Precedence is a settled business rule
 * (a customer commitment outranks internal scheduling), so it is expressed here
 * as deterministic normalization, not re-derived at each call site.
 */
export function resolveNextCallDate(input: ResolveNextCallInput): ResolvedNextCall {
  const promised = input.promisedCallbackDate?.trim()
  if (promised) return { date: promised, source: 'promised_callback' }

  const override = input.employeeOverrideDate?.trim()
  if (override) return { date: override, source: 'employee_override' }

  return { date: nextAutomaticCallDate(input), source: 'cadence' }
}

/**
 * Whether, given the attempt history, the customer should be flagged
 * "Nonresponsive — Review Contact Strategy". This is a presence FACT handed to
 * ZEN, not the decision itself: ZEN owns whether/how to surface the
 * recommendation. True once unsuccessful attempts reach the threshold. It never
 * stops outreach; the cadence keeps producing dates and a human decides what to
 * do.
 */
export function isNonresponsive(priorUnsuccessfulAttempts: number): boolean {
  return Math.max(0, Math.floor(priorUnsuccessfulAttempts || 0)) >= NONRESPONSIVE_ATTEMPT_THRESHOLD
}
