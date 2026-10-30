/**
 * Date-of-birth input, storage, display, and change detection — the one place
 * Right Path normalizes a customer DOB entered as SEPARATE month / day / year
 * parts, preserving whatever precision the operator actually knows without
 * inventing anything.
 *
 * Storage model (see migration 20261030154658_customers_date_of_birth_approx):
 *   - An EXACT DOB (all three parts known) is stored in customers.date_of_birth
 *     as a real `date` (YYYY-MM-DD).
 *   - A PARTIAL DOB (year known, month optional, day blank/unknown) is stored in
 *     customers.date_of_birth_approx as the masked string the age engine already
 *     parses: "MM/xx/YYYY" (month + year) or "xx/xx/YYYY" (year only). The day is
 *     ALWAYS "xx" there — no day is ever stored in the approx column.
 *
 * Display rules (the shared Customer Contact Card — a deliberate, scoped
 * exception to the general DOB-masking rule, see AGENTS.md):
 *   - Show the COMPLETE DOB when known: "MM/DD/YYYY".
 *   - Show only the KNOWN parts when incomplete: "MM/YYYY" (month + year) or
 *     "YYYY" (year only). Missing parts are never invented or shown.
 *   - Routine customer HISTORY never exposes the day: a DOB correction is
 *     recorded as a precision-appropriate fact that does not print the day.
 *
 * Change-detection rule: DOB changes are compared on the TRUE stored values
 * (the exact date plus the partial string), NOT on a day-masked form, so an
 * actual correction — INCLUDING a day-only correction — is detected and
 * recorded. A known EXACT DOB is never silently downgraded by entering partial
 * information; that guard lives where the prior value is known (the route and
 * the card), using `wouldDowngradeExactDob` below.
 */

/** The DOB as three independent, possibly-blank input parts. Each part is the
 * raw string from its own field; blank means "unknown". */
export interface DobParts {
  month: string
  day: string
  year: string
}

/** How a normalized DOB entry should be persisted. Exactly one of the two
 * storage columns carries a value; the other is explicitly null so storing one
 * precision clears the other (an exact DOB never leaves a stale approx behind,
 * and a partial DOB never leaves a stale exact date behind). `status` reports
 * whether the entry was usable. */
export type DobNormalizeResult =
  | {
      status: 'empty'
      /** Both columns cleared. */
      date_of_birth: null
      date_of_birth_approx: null
      reason?: undefined
    }
  | {
      status: 'exact'
      /** YYYY-MM-DD for the exact column; approx cleared. */
      date_of_birth: string
      date_of_birth_approx: null
      reason?: undefined
    }
  | {
      status: 'partial'
      /** Exact cleared; approx holds the masked precision. */
      date_of_birth: null
      date_of_birth_approx: string
      reason?: undefined
    }
  | {
      status: 'invalid'
      date_of_birth: null
      date_of_birth_approx: null
      /** Why the entry could not be used, for an inline validity message. */
      reason: string
    }

const CURRENT_YEAR = new Date().getUTCFullYear()

/** Parse a raw part to an integer, or null when blank/non-numeric. */
function toInt(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (!/^\d+$/.test(t)) return NaN as unknown as number
  return parseInt(t, 10)
}

/**
 * Normalize three DOB parts into a storage decision. Blank parts are unknown.
 *   - all blank            -> empty (clear both columns)
 *   - month + day + year   -> exact (validated real calendar date)
 *   - year (+ optional month), day blank -> partial (masked approx)
 *   - a day without a full month+year, or an impossible/partial-with-day combo,
 *     or an out-of-range value -> invalid (never stored, surfaced to the UI)
 *
 * A day is only honored as part of a complete, valid exact date; a lone day or a
 * day with only a year is rejected rather than invented into a date or silently
 * dropped.
 */
export function normalizeDobParts(parts: DobParts): DobNormalizeResult {
  const invalid = (reason: string): DobNormalizeResult => ({
    status: 'invalid',
    date_of_birth: null,
    date_of_birth_approx: null,
    reason,
  })

  const m = toInt(parts.month)
  const d = toInt(parts.day)
  const y = toInt(parts.year)

  const monthBlank = parts.month.trim() === ''
  const dayBlank = parts.day.trim() === ''
  const yearBlank = parts.year.trim() === ''

  // Non-numeric in any provided field.
  if (Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(y)) {
    return invalid('Enter numbers only for month, day, and year.')
  }

  // All blank: a valid clear.
  if (monthBlank && dayBlank && yearBlank) {
    return { status: 'empty', date_of_birth: null, date_of_birth_approx: null }
  }

  // Range checks on whatever parts are present.
  if (m != null && (m < 1 || m > 12)) return invalid('Month must be between 1 and 12.')
  if (d != null && (d < 1 || d > 31)) return invalid('Day must be between 1 and 31.')
  if (!yearBlank) {
    if (y == null || y < 1900 || y > CURRENT_YEAR) {
      return invalid(`Year must be a 4-digit year between 1900 and ${CURRENT_YEAR}.`)
    }
  }

  // A year is required for any stored DOB — without it, nothing can be preserved
  // meaningfully (a lone month or lone day is not a date of birth).
  if (yearBlank) {
    return invalid('Enter at least a 4-digit year.')
  }
  if ((parts.year.trim().length !== 4)) {
    return invalid('Year must be a 4-digit year.')
  }

  // A day given without a month cannot form a date and must not be invented.
  if (!dayBlank && monthBlank) {
    return invalid('Enter the month as well when a day is given, or clear the day.')
  }

  // Exact: month + day + year all present. Validate it is a real calendar date
  // (rejects 02/30, 04/31, etc.) so no impossible day is stored.
  if (!monthBlank && !dayBlank) {
    const mm = m as number
    const dd = d as number
    const yy = y as number
    const dt = new Date(Date.UTC(yy, mm - 1, dd))
    const real =
      dt.getUTCFullYear() === yy && dt.getUTCMonth() === mm - 1 && dt.getUTCDate() === dd
    if (!real) return invalid('That is not a real calendar date.')
    const iso = `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    return { status: 'exact', date_of_birth: iso, date_of_birth_approx: null }
  }

  // Partial: a year, optionally a month, and NO day. Store masked.
  const yy = y as number
  const monthToken = monthBlank ? 'xx' : String(m as number).padStart(2, '0')
  const masked = `${monthToken}/xx/${yy}`
  return { status: 'partial', date_of_birth: null, date_of_birth_approx: masked }
}

// ---------------------------------------------------------------------------
// Parsing a stored DOB back to parts
// ---------------------------------------------------------------------------

/** The precision a stored DOB is held at. */
export type DobPrecision = 'exact' | 'month-year' | 'year-only' | 'none'

/** The parsed year/month/day of a stored DOB, with its precision. Missing
 * components are null — never invented. */
export interface StoredDob {
  precision: DobPrecision
  year: number | null
  month: number | null
  day: number | null
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const APPROX_RE = /^(\d{1,2}|xx)\/\w{1,2}\/(\d{4})$/

/**
 * Resolve the stored DOB to its true components and precision. The EXACT column
 * wins when present (so a known exact DOB is never represented at lower
 * precision than it is held). A partial approx yields month+year or year-only.
 * No component is ever fabricated.
 */
export function readStoredDob(
  exact: string | null | undefined,
  approx: string | null | undefined,
): StoredDob {
  if (exact) {
    const iso = exact.includes('T') ? exact.slice(0, 10) : exact
    const m = ISO_RE.exec(iso)
    if (m) {
      return { precision: 'exact', year: +m[1], month: +m[2], day: +m[3] }
    }
  }
  if (approx) {
    const a = APPROX_RE.exec(approx.trim())
    if (a) {
      const month = a[1] === 'xx' ? null : parseInt(a[1], 10)
      return {
        precision: month == null ? 'year-only' : 'month-year',
        year: +a[2],
        month,
        day: null,
      }
    }
  }
  return { precision: 'none', year: null, month: null, day: null }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * The COMPLETE DOB for display on the shared Customer Contact Card: "MM/DD/YYYY"
 * when the exact date is known, "MM/YYYY" when only month + year are known,
 * "YYYY" when only the year is known, null when no DOB is on file. Missing parts
 * are never invented. This deliberately shows the day for a known exact DOB (a
 * scoped exception to the general masking rule — see AGENTS.md); it is NOT used
 * for routine history.
 */
export function formatDobDisplay(
  exact: string | null | undefined,
  approx: string | null | undefined,
): string | null {
  const s = readStoredDob(exact, approx)
  const yyyy = s.year == null ? null : String(s.year).padStart(4, '0')
  const mm = s.month == null ? null : String(s.month).padStart(2, '0')
  const dd = s.day == null ? null : String(s.day).padStart(2, '0')
  switch (s.precision) {
    case 'exact':
      return `${mm}/${dd}/${yyyy}`
    case 'month-year':
      return `${mm}/${yyyy}`
    case 'year-only':
      return yyyy
    default:
      return null
  }
}

/**
 * A precision label for a stored DOB, used in ROUTINE HISTORY prose so a
 * correction can be recorded WITHOUT printing the day. Exact -> "a full date";
 * month+year -> "month and year"; year-only -> "year only"; none -> "not on
 * file". Never contains any DOB component.
 */
export function dobPrecisionLabel(
  exact: string | null | undefined,
  approx: string | null | undefined,
): string {
  switch (readStoredDob(exact, approx).precision) {
    case 'exact':
      return 'a full date'
    case 'month-year':
      return 'month and year'
    case 'year-only':
      return 'year only'
    default:
      return 'not on file'
  }
}

// ---------------------------------------------------------------------------
// Change detection (true values, not a masked form)
// ---------------------------------------------------------------------------

/**
 * Whether two stored DOBs differ, compared on their TRUE components (so a
 * day-only correction to an exact date counts as a change). Each side is the
 * (exact, approx) pair as stored.
 */
export function dobChanged(
  beforeExact: string | null | undefined,
  beforeApprox: string | null | undefined,
  afterExact: string | null | undefined,
  afterApprox: string | null | undefined,
): boolean {
  const a = readStoredDob(beforeExact, beforeApprox)
  const b = readStoredDob(afterExact, afterApprox)
  return (
    a.precision !== b.precision ||
    a.year !== b.year ||
    a.month !== b.month ||
    a.day !== b.day
  )
}

/**
 * Whether applying `next` on top of `prior` would DOWNGRADE a known exact DOB to
 * less precise information — i.e. the record currently holds an exact date and
 * the new entry is a (different) partial date. Replacing an exact DOB with
 * another exact DOB is a correction, not a downgrade; clearing the DOB entirely
 * is an explicit clear, not a downgrade; adding precision is never a downgrade.
 * The caller rejects a downgrade so an exact birth date is never silently lost.
 */
export function wouldDowngradeExactDob(
  prior: Pick<DobNormalizeResult, 'date_of_birth' | 'date_of_birth_approx'>,
  next: DobNormalizeResult,
): boolean {
  const hadExact = !!prior.date_of_birth
  return hadExact && next.status === 'partial'
}

/**
 * Break a stored DOB back into editable parts for the form. Exact dates expose
 * month/day/year; a partial DOB exposes month (when known) and year with a
 * BLANK day (the day was never stored, so it stays unknown). Returns all-blank
 * when no DOB is on file.
 */
export function dobToParts(
  exact: string | null | undefined,
  approx: string | null | undefined,
): DobParts {
  const s = readStoredDob(exact, approx)
  return {
    month: s.month == null ? '' : String(s.month),
    day: s.day == null ? '' : String(s.day),
    year: s.year == null ? '' : String(s.year),
  }
}
