/**
 * Future Commitment (Right Path shared capability).
 *
 * Adapted from the established IPF module
 * (ipf-stewardship: src/domain/shared/future-commitment.ts). A future
 * commitment is a customer-local calendar date, optionally with a specific
 * customer-local time. It is the single normalized representation of "when we
 * promised to act" for callbacks, preferred call times, appointments, and any
 * future scheduling across Right Path.
 *
 * Two shapes, never conflated:
 *   - date-only:     a date with NO time. Midnight is never inferred or shown
 *                    as a promised time.
 *   - specific-time: a date plus a customer-local clock, which resolves to one
 *                    absolute instant and is presented on each participant's
 *                    clock.
 *
 * All zone reasoning is delegated to the shared Time Context. This module never
 * reads the runtime/server zone and never does raw local-to-ISO conversion.
 */

import {
  type TimeContext,
  customerWallClockToInstant,
  instantToCustomerWallClock,
  instantToActorWallClock,
  customerCalendarLabel,
  customerToday,
} from './time-context'

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

/**
 * A normalized future commitment. `date` is a customer-local calendar date
 * (`YYYY-MM-DD`); `clock` is a customer-local `HH:MM` time, or null for a
 * date-only commitment.
 */
export interface FutureCommitment {
  date: string
  clock: string | null
}

/** True when the commitment carries a specific customer-local time. */
export function hasTime(c: FutureCommitment | null | undefined): boolean {
  return !!c && typeof c.clock === 'string' && /^\d{2}:\d{2}$/.test(c.clock)
}

/** 12-hour AM/PM label for an hour + minute, e.g. (14,'30') -> "2:30 PM". */
export function formatClockLabel(hour: number, minute: string): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour12}:${minute} ${ampm}`
}

// ---------------------------------------------------------------------------
// Resolution to the absolute instant (via the Time Context)
// ---------------------------------------------------------------------------

/**
 * Resolve a commitment to its absolute instant on the customer clock. A
 * date-only commitment resolves to the START of the customer-local day (used
 * only for due-date arithmetic; it is never presented as a time). Returns null
 * when the date is unparseable.
 */
export function resolveCommitmentInstant(ctx: TimeContext, c: FutureCommitment): Date | null {
  return customerWallClockToInstant(ctx, c.date, hasTime(c) ? c.clock : '00:00')
}

/**
 * The customer-local wall clock for a commitment, in the form a decision engine
 * consumes:
 *   - specific-time: `YYYY-MM-DDTHH:MM`
 *   - date-only:     `YYYY-MM-DD` (no fabricated time)
 */
export function commitmentToCustomerWallClock(c: FutureCommitment): string {
  return hasTime(c) ? `${c.date}T${c.clock}` : c.date
}

/**
 * Build a commitment from a stored absolute instant plus whether a time was
 * committed, reading the instant on the CUSTOMER clock. This is how a stored
 * absolute instant + a has-time flag becomes an editable commitment without
 * touching the runtime zone.
 */
export function commitmentFromInstant(
  ctx: TimeContext,
  instant: Date,
  withTime: boolean,
): FutureCommitment | null {
  const wall = instantToCustomerWallClock(ctx, instant)
  if (!wall) return null
  return { date: wall.slice(0, 10), clock: withTime ? wall.slice(11, 16) : null }
}

// ---------------------------------------------------------------------------
// Presentation (single owner of commitment wording)
// ---------------------------------------------------------------------------

/**
 * The resolved presentation of a commitment on both clocks. Built where the
 * Time Context exists so the UI renders ready strings and never does timezone
 * math. A date-only commitment carries no time labels.
 */
export interface CommitmentPresentation {
  hasTime: boolean
  /** Customer-local date label, MM/DD/YYYY. */
  dateLabel: string
  /** 'today'/'tomorrow' on the customer clock, else null (use readableDate). */
  relativeDay: 'today' | 'tomorrow' | null
  /** Readable customer-local calendar label, e.g. "Wednesday, September 3". */
  readableDate: string
  /** Customer-local time label, e.g. "3:00 PM". Null for date-only. */
  customerTimeLabel: string | null
  /** Actor-local time label, e.g. "2:00 PM". Null for date-only. */
  actorTimeLabel: string | null
  /** True when actor and customer clocks resolve to different wall-clock times. */
  clocksDiffer: boolean
}

function mmddyyyy(wallDate: string): string {
  const m = wallDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : wallDate
}

function clockLabelFromWall(zoneWall: string | null): string | null {
  if (!zoneWall) return null
  const m = zoneWall.match(/T(\d{2}):(\d{2})/)
  if (!m) return null
  return formatClockLabel(Number(m[1]), m[2])
}

/** Next calendar day for a YYYY-MM-DD string (pure date math, zone-agnostic). */
function nextCalendarDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Resolve a commitment into a both-clocks presentation through the Time Context.
 * Date-only commitments yield only a date (no fabricated time). When actor and
 * customer zones resolve the instant to different wall-clock times, the
 * actor-local time is provided so the UI can show it automatically.
 */
export function presentCommitment(
  ctx: TimeContext,
  c: FutureCommitment,
): CommitmentPresentation | null {
  const instant = resolveCommitmentInstant(ctx, c)
  if (!instant) return null

  const customerWall = instantToCustomerWallClock(ctx, instant)
  if (!customerWall) return null
  const dateLabel = mmddyyyy(customerWall)
  const readableDate = customerCalendarLabel(ctx, instant) ?? dateLabel

  const commitmentDate = customerWall.slice(0, 10)
  const today = customerToday(ctx)
  const relativeDay: 'today' | 'tomorrow' | null =
    commitmentDate === today
      ? 'today'
      : commitmentDate === nextCalendarDay(today)
        ? 'tomorrow'
        : null

  if (!hasTime(c)) {
    return {
      hasTime: false,
      dateLabel,
      relativeDay,
      readableDate,
      customerTimeLabel: null,
      actorTimeLabel: null,
      clocksDiffer: false,
    }
  }

  const actorWall = instantToActorWallClock(ctx, instant)
  const customerTimeLabel = clockLabelFromWall(customerWall)
  const actorTimeLabel = clockLabelFromWall(actorWall)
  const clocksDiffer =
    ctx.actorTimeZone !== ctx.customerTimeZone &&
    actorTimeLabel != null &&
    customerTimeLabel != null &&
    actorTimeLabel !== customerTimeLabel

  return {
    hasTime: true,
    dateLabel,
    relativeDay,
    readableDate,
    customerTimeLabel,
    actorTimeLabel,
    clocksDiffer,
  }
}

/**
 * The single source of commitment WORDING, shared by display components and
 * server surfaces. Relative language for today/tomorrow, a readable date for
 * later commitments, and a specific time only when one exists; the actor-local
 * equivalent is appended when the clocks differ. Returns null when there is no
 * presentation.
 */
export function futureCommitmentText(
  presentation: CommitmentPresentation | null,
  prefix?: string,
): string | null {
  if (!presentation) return null
  const lead = prefix ? `${prefix} ` : ''

  const whenPhrase =
    presentation.relativeDay === 'today'
      ? 'today'
      : presentation.relativeDay === 'tomorrow'
        ? 'tomorrow'
        : `on ${presentation.readableDate}`

  if (!presentation.hasTime) {
    return `${lead}due ${whenPhrase}`.trim()
  }

  const base = `${lead}${whenPhrase} at ${presentation.customerTimeLabel}`.trim()
  if (presentation.clocksDiffer && presentation.actorTimeLabel) {
    return `${base} (${presentation.actorTimeLabel} your time)`
  }
  return base
}
