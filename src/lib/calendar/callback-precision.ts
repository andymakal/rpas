/**
 * Promised-callback precision — the pure rules for "when did we promise to call
 * back," at whatever precision the customer actually gave, on the CUSTOMER'S
 * clock.
 *
 * TWO INDEPENDENT AXES (CALENDAR_DESIGN.md; the operator's enumeration):
 *
 *   WHEN:  'date'      — a specific calendar date ("Tuesday the 14th").
 *          'recurring' — one or more recurring weekdays ("any Mon/Tue/Wed"),
 *                        Mon-Sat (Sunday is never a work day).
 *   TIME:  'exact'     — a specific half-hour time. ONLY valid with whenMode
 *                        'date' (an exact time is an appointment on a real date,
 *                        never "any Tuesday at 2").
 *          'bands'     — one or more of the four daily bands ("after 3").
 *          'any'       — no time; all day.
 *
 * The meaningful combinations this covers:
 *   date + exact   -> an appointment ("Tue the 14th at 2:00").
 *   date + bands   -> "Tue the 14th after 3".
 *   date + any     -> "Tue the 14th, any time".
 *   recurring+bands-> "Mondays after 3" / "any Mon/Tue/Wed after 3".
 *   recurring+any  -> "Tuesdays, any time".
 *   (recurring + exact is disallowed: an exact time needs a real date.)
 *
 * Pure TypeScript: no React, no IO, no runtime-zone dependence. All zone math is
 * delegated to the shared Time Context (@/lib/time). This module owns only the
 * precision VOCABULARY, validation, and resurfacing-date resolution; it does not
 * render and does not persist.
 */

import {
  type TimeContext,
  customerWallClockToInstant,
} from '@/lib/time'
import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// Time bands (the four fixed daily buckets)
// ---------------------------------------------------------------------------

/**
 * The four fixed daily availability bands, customer-local. End hour is
 * EXCLUSIVE; the evening band runs to end of day. A customer can accept one,
 * several, or all of them.
 */
export const TIME_BANDS = [
  { key: 'morning', label: 'Morning', shortLabel: '9–12', startHour: 9, endHour: 12 },
  { key: 'early_afternoon', label: 'Early afternoon', shortLabel: '12–3', startHour: 12, endHour: 15 },
  { key: 'late_afternoon', label: 'Late afternoon', shortLabel: '3–6', startHour: 15, endHour: 18 },
  { key: 'evening', label: 'Evening', shortLabel: '6+', startHour: 18, endHour: 24 },
] as const

export type TimeBandKey = (typeof TIME_BANDS)[number]['key']

/**
 * Work weekdays, Monday-first. Sunday is deliberately excluded: the agency does
 * no work on Sunday, so it is never an offered callback day.
 */
export const WEEKDAYS = [
  { key: 'mon', label: 'Mon', isoWeekday: 1 },
  { key: 'tue', label: 'Tue', isoWeekday: 2 },
  { key: 'wed', label: 'Wed', isoWeekday: 3 },
  { key: 'thu', label: 'Thu', isoWeekday: 4 },
  { key: 'fri', label: 'Fri', isoWeekday: 5 },
  { key: 'sat', label: 'Sat', isoWeekday: 6 },
] as const

export type WeekdayKey = (typeof WEEKDAYS)[number]['key']

const ISO_BY_WEEKDAY: Record<WeekdayKey, number> = Object.fromEntries(
  WEEKDAYS.map((w) => [w.key, w.isoWeekday]),
) as Record<WeekdayKey, number>

// ---------------------------------------------------------------------------
// Exact-time choices — HALF-HOUR granularity only (no arbitrary minute entry)
// ---------------------------------------------------------------------------

/**
 * Exact appointment times are chosen from a controlled HALF-HOUR dropdown, never
 * typed to the minute. Half-hour is the finest granularity we offer: even a
 * 15-minute appointment needs the rest of the half hour to write notes and
 * reset. (Mirrors IPF's buildHalfHourSlots; 1:13 / 3:14 are never offered.)
 */
export interface TimeRange {
  /** First selectable hour, 0-23. */
  startHour: number
  /** Last selectable hour, 0-23. The :30 slot of endHour is NOT offered, so the
   * last choice is exactly endHour:00. */
  endHour: number
}

/** The allowable range for a promised-callback exact time: 7:00 AM - 9:00 PM. */
export const CALLBACK_TIME_RANGE: TimeRange = { startHour: 7, endHour: 21 }

export interface TimeSlot {
  /** Canonical stored value, HH:MM (e.g. "09:30", "14:00"). */
  value: string
  /** Display label, e.g. "9:30 AM". */
  label: string
}

/**
 * The controlled half-hour choices for a range, from `startHour:00` up to and
 * including `endHour:00` (the trailing `endHour:30` is omitted so the last
 * offered time is exactly the range end). Half-hour granularity only.
 */
export function buildHalfHourSlots(range: TimeRange = CALLBACK_TIME_RANGE): TimeSlot[] {
  const slots: TimeSlot[] = []
  for (let h = range.startHour; h <= range.endHour; h++) {
    for (const m of ['00', '30'] as const) {
      if (h === range.endHour && m === '30') continue
      const value = `${h.toString().padStart(2, '0')}:${m}`
      slots.push({ value, label: clockLabel(value) ?? value })
    }
  }
  return slots
}

// ---------------------------------------------------------------------------
// The commitment value (two axes)
// ---------------------------------------------------------------------------

export type WhenMode = 'date' | 'recurring'
export type TimeMode = 'exact' | 'bands' | 'any'

/**
 * A promised callback expressed on two axes.
 *   whenMode 'date'      -> `date` (YYYY-MM-DD, customer-local) is the due date.
 *   whenMode 'recurring' -> `days` (>=1 of Mon-Sat) are the recurring days; no
 *                           single due date (resolved to the next match).
 *   timeMode 'exact'     -> `clock` (HH:MM). Only with whenMode 'date'.
 *   timeMode 'bands'     -> `bands` (>=1) narrow the day.
 *   timeMode 'any'       -> all day; clock null, bands empty.
 */
export interface CallbackCommitment {
  whenMode: WhenMode
  date: string
  days: WeekdayKey[]
  timeMode: TimeMode
  clock: string | null
  bands: TimeBandKey[]
}

export interface CallbackValidation {
  status: 'empty' | 'valid' | 'invalid'
  reason: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_RE = /^\d{2}:\d{2}$/

/**
 * Validate a draft commitment.
 *   - Empty (date mode, no date) is a valid "no promise".
 *   - date mode needs a valid date; recurring mode needs >=1 weekday.
 *   - exact time needs a date (not recurring) AND a clock.
 *   - bands mode needs >=1 band.
 */
export function validateCallback(c: CallbackCommitment): CallbackValidation {
  // The WHEN axis.
  if (c.whenMode === 'date') {
    const date = (c.date ?? '').trim()
    if (!date) {
      // No date chosen yet. If nothing else is set either, it is an empty
      // no-promise; otherwise prompt for the date the rest needs.
      if (c.timeMode === 'any') return { status: 'empty', reason: null }
      return { status: 'invalid', reason: 'Pick the callback date.' }
    }
    if (!DATE_RE.test(date)) return { status: 'invalid', reason: 'Enter a valid callback date.' }
  } else {
    if (c.days.length === 0) {
      return { status: 'invalid', reason: 'Pick at least one day the customer can be reached.' }
    }
  }

  // The TIME axis.
  if (c.timeMode === 'exact') {
    if (c.whenMode !== 'date') {
      return { status: 'invalid', reason: 'An exact time needs a specific date. Pick a date, or choose time bands.' }
    }
    const clock = (c.clock ?? '').trim()
    if (!clock) return { status: 'invalid', reason: 'Pick the exact callback time.' }
    if (!CLOCK_RE.test(clock)) return { status: 'invalid', reason: 'Enter a valid time (HH:MM).' }
  } else if (c.timeMode === 'bands') {
    if (c.bands.length === 0) {
      return { status: 'invalid', reason: 'Pick at least one time of day, or choose Any time.' }
    }
  }

  return { status: 'valid', reason: null }
}

/** True when the commitment is a specific-date exact-time appointment. */
export function hasExactTime(c: CallbackCommitment | null | undefined): boolean {
  return (
    !!c &&
    c.whenMode === 'date' &&
    c.timeMode === 'exact' &&
    typeof c.clock === 'string' &&
    CLOCK_RE.test(c.clock)
  )
}

/**
 * Resolve an EXACT (specific-date) commitment to its absolute instant on the
 * customer clock. Returns null for any non-exact commitment or an unparseable
 * value. This is the instant stored on the calendar_blocks appointment.
 */
export function resolveExactInstant(ctx: TimeContext, c: CallbackCommitment): Date | null {
  if (!hasExactTime(c)) return null
  return customerWallClockToInstant(ctx, c.date, c.clock)
}

/**
 * The customer-local calendar date (YYYY-MM-DD) this commitment should first
 * surface as a due call.
 *   - date mode: the chosen date.
 *   - recurring mode: the NEXT matching weekday on or after the customer's today
 *     (so "Mon/Tue/Wed" stated on a Friday first surfaces the coming Monday).
 * Returns null when it cannot be resolved (no date / no days).
 */
export function resolveDueDate(ctx: TimeContext, c: CallbackCommitment): string | null {
  if (c.whenMode === 'date') {
    const date = (c.date ?? '').trim()
    return DATE_RE.test(date) ? date : null
  }
  if (c.days.length === 0) return null
  const wanted = new Set(c.days.map((d) => ISO_BY_WEEKDAY[d]))
  // Walk forward from the customer's today up to 7 days to find the next match.
  const today = DateTime.fromJSDate(ctx.now, { zone: ctx.customerTimeZone }).startOf('day')
  for (let i = 0; i < 7; i++) {
    const day = today.plus({ days: i })
    if (wanted.has(day.weekday)) return day.toFormat('yyyy-LL-dd')
  }
  return null
}

/** 12-hour label for a HH:MM clock, e.g. "14:30" -> "2:30 PM". */
export function clockLabel(clock: string | null | undefined): string | null {
  if (!clock || !CLOCK_RE.test(clock)) return null
  const [h, m] = clock.split(':')
  const hour = Number(h)
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour12}:${m} ${ampm}`
}

/** The band portion of a label, e.g. "3–6, 6+" or "any time" when none. */
function bandLabelPart(c: CallbackCommitment): string {
  if (c.timeMode !== 'bands') return 'any time'
  const labels = TIME_BANDS.filter((b) => c.bands.includes(b.key)).map((b) => b.shortLabel)
  return labels.length > 0 ? labels.join(', ') : 'any time'
}

/** The day portion of a recurring label, e.g. "Mon, Tue, Wed" or "Any day". */
function recurringDayPart(c: CallbackCommitment): string {
  const allOrNone = c.days.length === 0 || c.days.length === WEEKDAYS.length
  if (allOrNone) return 'Any day'
  return WEEKDAYS.filter((d) => c.days.includes(d.key)).map((d) => d.label).join(', ')
}

/**
 * A short human summary of the WHEN+TIME commitment, for the history preview and
 * the save confirmation. Exact appointments read as an appointment with a time;
 * recurring/band commitments read as availability.
 *   - date+exact:  "Tue 11/17 at 2:00 PM" (callers prefix "Appointment ...").
 *   - date+bands:  "11/17 · 3–6, 6+"
 *   - date+any:    "11/17 · any time"
 *   - recurring:   "Mon, Tue, Wed · 3–6, 6+"  /  "Any day · any time"
 * `dateLabel` is a preformatted MM/DD/YYYY (or similar) for the date case.
 */
export function commitmentSummary(c: CallbackCommitment, dateLabel?: string | null): string | null {
  if (c.whenMode === 'date') {
    const d = dateLabel || c.date
    if (!d) return null
    if (hasExactTime(c)) return `${d} at ${clockLabel(c.clock)}`
    return `${d} · ${bandLabelPart(c)}`
  }
  if (c.days.length === 0) return null
  return `${recurringDayPart(c)} · ${bandLabelPart(c)}`
}

/** An empty draft: a specific date, no time (all day) — the simplest promise. */
export function emptyCommitment(date = ''): CallbackCommitment {
  return { whenMode: 'date', date, days: [], timeMode: 'any', clock: null, bands: [] }
}
