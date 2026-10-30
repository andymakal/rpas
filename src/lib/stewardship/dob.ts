/**
 * Date-of-birth input, storage, and masked display — the one place Right Path
 * normalizes a customer DOB entered as SEPARATE month / day / year parts,
 * preserving whatever precision the operator actually knows without inventing
 * anything, and renders it masked so the DAY is never exposed.
 *
 * Storage model (see migration 20261106000001):
 *   - An EXACT DOB (all three parts known) is stored in customers.date_of_birth
 *     as a real `date` (YYYY-MM-DD).
 *   - A PARTIAL DOB (year known, month optional, day blank/unknown) is stored in
 *     customers.date_of_birth_approx as the masked string the age engine already
 *     parses: "MM/xx/YYYY" (month + year) or "xx/xx/YYYY" (year only). The day is
 *     ALWAYS "xx" there — no day is ever stored in the approx column.
 *
 * Rules honored here:
 *   - Unknown parts are left blank; a missing day never becomes a real day.
 *   - A partial date is preserved at its true precision, never upgraded by
 *     guessing and never silently discarded.
 *   - A known EXACT DOB is never downgraded to a less precise value: an exact
 *     entry always targets date_of_birth and clears the approx column, while a
 *     partial entry targets the approx column and clears the exact one.
 *   - Display and history NEVER show the day: both exact and partial DOBs render
 *     masked as "MM/xx/YYYY" / "xx/xx/YYYY" / "xx/xx/YYYY".
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

/**
 * The masked display of a stored DOB — "MM/xx/YYYY" (month + year known) or
 * "xx/xx/YYYY" (year only). The day is never shown. Pass the exact
 * date_of_birth (YYYY-MM-DD) and/or the partial date_of_birth_approx; the exact
 * value wins when present. Returns null when no DOB is on file.
 */
export function maskDobDisplay(
  exact: string | null | undefined,
  approx: string | null | undefined,
): string | null {
  if (exact) {
    const iso = exact.includes('T') ? exact.slice(0, 10) : exact
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (m) return `${m[2]}/xx/${m[1]}`
  }
  if (approx) {
    // Already masked; normalize a numeric month to two digits and force the day
    // token to "xx" defensively so a day can never leak through display.
    const a = /^(\d{1,2}|xx)\/\w{1,2}\/(\d{4})$/.exec(approx.trim())
    if (a) {
      const month = a[1] === 'xx' ? 'xx' : a[1].padStart(2, '0')
      return `${month}/xx/${a[2]}`
    }
  }
  return null
}

/**
 * The masked DOB string used in HISTORY prose, or "(none)" when there is no DOB
 * — so a prior -> new audit sentence reads clearly even when one side is blank.
 * Never contains a day.
 */
export function maskApproxDobForHistory(
  exact: string | null | undefined,
  approx: string | null | undefined,
): string {
  return maskDobDisplay(exact, approx) ?? '(none)'
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
  if (exact) {
    const iso = exact.includes('T') ? exact.slice(0, 10) : exact
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (m) return { month: String(parseInt(m[2], 10)), day: String(parseInt(m[3], 10)), year: m[1] }
  }
  if (approx) {
    const a = /^(\d{1,2}|xx)\/\w{1,2}\/(\d{4})$/.exec(approx.trim())
    if (a) {
      return { month: a[1] === 'xx' ? '' : String(parseInt(a[1], 10)), day: '', year: a[2] }
    }
  }
  return { month: '', day: '', year: '' }
}
