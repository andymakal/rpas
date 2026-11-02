/**
 * Promised-callback precision — the pure rules for "when did we promise to call
 * back," at whatever precision the customer actually gave, on the CUSTOMER'S
 * clock.
 *
 * This is the DOB-style precision model (CALENDAR_DESIGN.md §2, §9 Layer A): a
 * customer states a callback at one of three precisions, and we never invent the
 * missing part.
 *
 *   - 'exact'     — a specific date AND time ("Friday at 2:00"). The hard
 *                   appointment; becomes a calendar_blocks appointment and
 *                   surfaces on My Work via the exact-time band.
 *   - 'windows'   — a date plus one or more acceptable time BANDS across one or
 *                   more days ("any day after 3" = all days × {afternoon,
 *                   evening}; "Wed/Thu afternoon" = {Wed,Thu} × {afternoon}).
 *                   When they can be reached, not a booked time.
 *   - 'anytime'   — a date only ("just call me Friday"). Any time that day.
 *
 * Pure TypeScript: no React, no IO, no runtime-zone dependence. All zone math is
 * delegated to the shared Time Context (@/lib/time). This module owns only the
 * precision VOCABULARY and validation; it does not render and does not persist.
 */

import {
  type TimeContext,
  customerWallClockToInstant,
} from '@/lib/time'

// ---------------------------------------------------------------------------
// Time bands (the four fixed daily buckets)
// ---------------------------------------------------------------------------

/**
 * The four fixed daily availability bands, customer-local. End hour is
 * EXCLUSIVE; the evening band runs to end of day. These are the operator's
 * availability blocks a customer's stated preference maps onto; a customer can
 * accept one, several, or all of them (CALENDAR_DESIGN.md §2 fix #2).
 */
export const TIME_BANDS = [
  { key: 'morning', label: 'Morning', shortLabel: '9–12', startHour: 9, endHour: 12 },
  { key: 'early_afternoon', label: 'Early afternoon', shortLabel: '12–3', startHour: 12, endHour: 15 },
  { key: 'late_afternoon', label: 'Late afternoon', shortLabel: '3–6', startHour: 15, endHour: 18 },
  { key: 'evening', label: 'Evening', shortLabel: '6+', startHour: 18, endHour: 24 },
] as const

export type TimeBandKey = (typeof TIME_BANDS)[number]['key']

/** The seven weekday keys (customer-local), Monday first for display order. */
export const WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const

export type WeekdayKey = (typeof WEEKDAYS)[number]['key']

// ---------------------------------------------------------------------------
// The precision value
// ---------------------------------------------------------------------------

export type CallbackPrecision = 'exact' | 'windows' | 'anytime'

/**
 * A promised callback at one of the three precisions. `date` is always a
 * customer-local calendar date (YYYY-MM-DD) — the date the callback is due.
 *
 *   - precision 'exact':   `clock` is a customer-local HH:MM; `days`/`bands` empty.
 *   - precision 'windows': `days` (empty = every day) and `bands` (>=1) say WHEN
 *                          the customer can be reached; `clock` is null.
 *   - precision 'anytime': `clock` null, `days`/`bands` empty.
 */
export interface CallbackCommitment {
  precision: CallbackPrecision
  date: string
  clock: string | null
  days: WeekdayKey[]
  bands: TimeBandKey[]
}

export interface CallbackValidation {
  status: 'empty' | 'valid' | 'invalid'
  reason: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_RE = /^\d{2}:\d{2}$/

/**
 * Validate a draft commitment. Empty (no date) is a valid "no promise". A date
 * is required for any precision; an exact precision additionally requires a
 * clock; a windows precision requires at least one band.
 */
export function validateCallback(c: CallbackCommitment): CallbackValidation {
  const date = (c.date ?? '').trim()
  if (!date) return { status: 'empty', reason: null }
  if (!DATE_RE.test(date)) return { status: 'invalid', reason: 'Enter a valid callback date.' }

  if (c.precision === 'exact') {
    const clock = (c.clock ?? '').trim()
    if (!clock) return { status: 'invalid', reason: 'Enter the exact callback time.' }
    if (!CLOCK_RE.test(clock)) return { status: 'invalid', reason: 'Enter a valid time (HH:MM).' }
    return { status: 'valid', reason: null }
  }

  if (c.precision === 'windows') {
    if (c.bands.length === 0) {
      return { status: 'invalid', reason: 'Pick at least one time of day the customer can be reached.' }
    }
    return { status: 'valid', reason: null }
  }

  // 'anytime' — a date is enough.
  return { status: 'valid', reason: null }
}

/** True when the commitment carries a specific customer-local time. */
export function hasExactTime(c: CallbackCommitment | null | undefined): boolean {
  return !!c && c.precision === 'exact' && typeof c.clock === 'string' && CLOCK_RE.test(c.clock)
}

/**
 * Resolve an EXACT commitment to its absolute instant on the customer clock.
 * Returns null for a non-exact commitment or an unparseable value. This is the
 * instant stored on the calendar_blocks appointment and used by the .ics.
 */
export function resolveExactInstant(
  ctx: TimeContext,
  c: CallbackCommitment,
): Date | null {
  if (!hasExactTime(c)) return null
  return customerWallClockToInstant(ctx, c.date, c.clock)
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

/**
 * A short human summary of a windows commitment's availability, e.g.
 * "Mornings & afternoons", "Wed, Thu · 3–6, 6+", "Any day · 12–3". Returns null
 * for a non-windows commitment. Days omitted when all/none selected ("Any day").
 */
export function windowsSummary(c: CallbackCommitment): string | null {
  if (c.precision !== 'windows') return null
  const bandLabels = TIME_BANDS.filter((b) => c.bands.includes(b.key)).map((b) => b.shortLabel)
  const bandPart = bandLabels.length > 0 ? bandLabels.join(', ') : 'any time'
  const allOrNone = c.days.length === 0 || c.days.length === WEEKDAYS.length
  if (allOrNone) return `Any day · ${bandPart}`
  const dayLabels = WEEKDAYS.filter((d) => c.days.includes(d.key)).map((d) => d.label)
  return `${dayLabels.join(', ')} · ${bandPart}`
}

/** An empty draft for a given due date (anytime that day — today's behavior). */
export function emptyCommitment(date = ''): CallbackCommitment {
  return { precision: 'anytime', date, clock: null, days: [], bands: [] }
}
