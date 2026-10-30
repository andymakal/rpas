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

// ---------------------------------------------------------------------------
// The one consistent interpretation: FHIR partial dates
// ---------------------------------------------------------------------------
//
// Every date of birth in Right Path is understood at exactly one of four
// precisions, which is the FHIR partial-date model:
//
//   exact       YYYY-MM-DD   all three parts known
//   month-year  YYYY-MM      year + month known, day unknown
//   year-only   YYYY         year known, month + day unknown
//   none        —            no usable birth information
//
// `readStoredDob` already yields this shape from the two customer storage
// columns; `DobSourceParts` lets a resolver (e.g. the SQL
// project_customer_dob_display, which can also draw a reliable partial DOB from
// a customer's linked policies) feed the SAME interpretation to the display and
// precision helpers below. The STORAGE encoding is unchanged — this is the one
// interpretation layered over whatever source produced the parts; no part is
// ever invented.

/** Resolved DOB parts from any source, carrying the FHIR precision and where it
 * came from. A day is present ONLY at `exact` precision from a genuine full
 * date; a partial source (the customer's own partial DOB or a linked-policy
 * consensus) carries year (+ month) with a null day. */
export interface DobSourceParts {
  year: number | null
  month: number | null
  day: number | null
  precision: DobPrecision
  /** Where the displayed DOB came from. 'exact'/'customer_partial' live on the
   * customer row; 'linked_policy' is the reliable owner-DOB consensus across the
   * customer's policies (never the policy insured); 'none' = nothing to show. */
  source: 'exact' | 'customer_partial' | 'linked_policy' | 'none'
}

/** Map the DB precision token (project_customer_dob_display: 'exact' |
 * 'month_year' | 'year_only' | 'none') to the DobPrecision used here. Unknown
 * tokens degrade to 'none' rather than guess. */
export function dobPrecisionFromToken(token: string | null | undefined): DobPrecision {
  switch (token) {
    case 'exact':
      return 'exact'
    case 'month_year':
      return 'month-year'
    case 'year_only':
      return 'year-only'
    default:
      return 'none'
  }
}

/**
 * Format resolved DOB parts for the shared Customer Contact Card, applying the
 * SAME display rule as `formatDobDisplay`: "MM/DD/YYYY" (exact), "MM/YYYY"
 * (month+year), "YYYY" (year-only), null (none). A day is shown only when the
 * precision is exact AND a day is actually present, so a partial source can
 * never print a day. Missing parts are never invented.
 */
export function formatDobParts(parts: DobSourceParts): string | null {
  const yyyy = parts.year == null ? null : String(parts.year).padStart(4, '0')
  const mm = parts.month == null ? null : String(parts.month).padStart(2, '0')
  const dd = parts.day == null ? null : String(parts.day).padStart(2, '0')
  switch (parts.precision) {
    case 'exact':
      return dd && mm && yyyy ? `${mm}/${dd}/${yyyy}` : mm && yyyy ? `${mm}/${yyyy}` : yyyy
    case 'month-year':
      return mm && yyyy ? `${mm}/${yyyy}` : yyyy
    case 'year-only':
      return yyyy
    default:
      return null
  }
}

/**
 * The canonical FHIR partial-date token for resolved DOB parts: "YYYY-MM-DD",
 * "YYYY-MM", "YYYY", or null (none). This is the standardized machine form of a
 * DOB at its known precision — year/month/day joined with hyphens, dropping the
 * parts that are unknown. Never fabricates a missing part.
 */
export function toFhirDob(parts: DobSourceParts): string | null {
  const yyyy = parts.year == null ? null : String(parts.year).padStart(4, '0')
  const mm = parts.month == null ? null : String(parts.month).padStart(2, '0')
  const dd = parts.day == null ? null : String(parts.day).padStart(2, '0')
  switch (parts.precision) {
    case 'exact':
      return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : mm && yyyy ? `${yyyy}-${mm}` : yyyy
    case 'month-year':
      return mm && yyyy ? `${yyyy}-${mm}` : yyyy
    case 'year-only':
      return yyyy
    default:
      return null
  }
}

/** The canonical FHIR partial-date token ("YYYY-MM-DD" / "YYYY-MM" / "YYYY" /
 * null) for a RAW import source value. Useful for carrying an interpreted DOB
 * across a client -> server boundary as a plain, unambiguous string (a JS Date
 * cell cannot survive JSON as a Date); the receiver re-interprets it with
 * `interpretSourceDob`. Defined after interpretSourceDob below. */
export function sourceDobToFhir(raw: unknown): string | null {
  const s = interpretSourceDob(raw)
  return toFhirDob({ year: s.year, month: s.month, day: s.day, precision: s.precision, source: 'exact' })
}

/** The FHIR partial-date token for a stored (exact, approx) customer DOB pair.
 * Convenience over `readStoredDob` + `toFhirDob`. */
export function storedDobToFhir(
  exact: string | null | undefined,
  approx: string | null | undefined,
): string | null {
  const s = readStoredDob(exact, approx)
  return toFhirDob({ year: s.year, month: s.month, day: s.day, precision: s.precision, source: 'exact' })
}

/**
 * Break resolved DOB parts into editable form parts (month/day/year strings),
 * mirroring `dobToParts` but for a source that may be a linked-policy
 * consensus. A partial source yields a BLANK day — the day was never known, so
 * the operator starts from blank and the downgrade guard still protects any
 * stored exact date. All-blank when there is nothing to seed.
 */
export function dobSourceToParts(parts: DobSourceParts): DobParts {
  if (parts.precision === 'none') return { month: '', day: '', year: '' }
  return {
    month: parts.month == null ? '' : String(parts.month),
    day: parts.day == null ? '' : String(parts.day),
    year: parts.year == null ? '' : String(parts.year),
  }
}

// ---------------------------------------------------------------------------
// Interpreting a raw IMPORT source value (spreadsheet cell / string / Date)
// ---------------------------------------------------------------------------

/** A DOB interpreted from a raw import source, at the precision actually
 * present. `day` is non-null ONLY for an `exact` full date; `month` is non-null
 * for `exact` or `month-year`. No component is ever invented, and a genuinely
 * known component is never dropped. */
export interface SourceDob {
  precision: DobPrecision
  year: number | null
  month: number | null
  day: number | null
}

const NONE_SOURCE_DOB: SourceDob = { precision: 'none', year: null, month: null, day: null }

/** Is (y, m, d) a real calendar date? Rejects 02/30, 04/31, etc. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Interpret a raw date-of-birth value from an IMPORT source — a spreadsheet
 * cell (which may arrive as a JS `Date`), or a string in any of the formats
 * legacy books actually use — into its true precision WITHOUT inventing or
 * discarding a genuinely known component. This is the single shared entry point
 * every import path uses so a year-only, month+year, or exact source is each
 * preserved at exactly the precision it carries.
 *
 * Recognized, in order (first match wins):
 *   - a real JS Date                         -> exact (year + month + day)
 *   - ISO "YYYY-MM-DD" (optionally with time) -> exact
 *   - "M/D/YYYY" or "M-D-YYYY"                 -> exact
 *   - masked "MM/xx/YYYY" / "xx/xx/YYYY"       -> month-year / year-only (no day)
 *   - "MM/YYYY" or "YYYY-MM"                   -> month-year
 *   - a bare 4-digit year "YYYY"               -> year-only
 *   - a value we can only anchor to a trailing 4-digit year -> year-only
 *   - anything with no reliable year           -> none
 *
 * A day is honored only as part of a complete, valid calendar date; an
 * impossible date (02/30) degrades to its month+year rather than being dropped
 * entirely or stored as a fake day. A two-digit "year" is not guessed into a
 * century — only a full 4-digit year is trusted.
 */
export function interpretSourceDob(raw: unknown): SourceDob {
  if (raw == null) return NONE_SOURCE_DOB

  // A real spreadsheet Date cell -> exact.
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return NONE_SOURCE_DOB
    return { precision: 'exact', year: raw.getFullYear(), month: raw.getMonth() + 1, day: raw.getDate() }
  }

  const s = String(raw).trim()
  if (!s) return NONE_SOURCE_DOB

  const masked = /xx/i.test(s)

  // Non-masked, LEADING-year ISO forms (handled before the trailing-year anchor
  // below, since "YYYY-MM" has no trailing 4-digit run).
  if (!masked) {
    // ISO "YYYY-MM-DD" (optionally "...THH:MM...").
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
    if (iso) {
      const y = +iso[1], m = +iso[2], d = +iso[3]
      if (isRealDate(y, m, d)) return { precision: 'exact', year: y, month: m, day: d }
      if (m >= 1 && m <= 12) return { precision: 'month-year', year: y, month: m, day: null }
      return { precision: 'year-only', year: y, month: null, day: null }
    }
    // ISO "YYYY-MM" (month precision, no day).
    const ym = s.match(/^(\d{4})-(\d{1,2})$/)
    if (ym) {
      const m = +ym[2]
      if (m >= 1 && m <= 12) return { precision: 'month-year', year: +ym[1], month: m, day: null }
      return { precision: 'year-only', year: +ym[1], month: null, day: null }
    }
    // "M/D/YYYY" or "M-D-YYYY".
    const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (mdy) {
      const m = +mdy[1], d = +mdy[2], y = +mdy[3]
      if (isRealDate(y, m, d)) return { precision: 'exact', year: y, month: m, day: d }
      if (m >= 1 && m <= 12) return { precision: 'month-year', year: y, month: m, day: null }
      return { precision: 'year-only', year: y, month: null, day: null }
    }
  }

  // Trailing 4-digit year anchors everything below. No year -> nothing usable.
  const year = s.match(/(\d{4})\s*$/)?.[1]
  if (!year) return NONE_SOURCE_DOB
  const y = +year

  // Masked "MM/xx/YYYY" (month+year) or "xx/xx/YYYY" (year only).
  if (masked) {
    const leadMonth = s.match(/^(\d{1,2})/)?.[1]
    const m = leadMonth != null ? Number(leadMonth) : null
    if (m != null && m >= 1 && m <= 12) return { precision: 'month-year', year: y, month: m, day: null }
    return { precision: 'year-only', year: y, month: null, day: null }
  }

  // "MM/YYYY" (month + year, no day).
  const my = s.match(/^(\d{1,2})[/-](\d{4})$/)
  if (my) {
    const m = +my[1]
    if (m >= 1 && m <= 12) return { precision: 'month-year', year: y, month: m, day: null }
    return { precision: 'year-only', year: y, month: null, day: null }
  }

  // Bare 4-digit year, or any value we can only anchor to a trailing year.
  return { precision: 'year-only', year: y, month: null, day: null }
}

/**
 * The masked owner-DOB string (`service_policies.owner_dob_approx` convention)
 * for a raw import source. The owner mask is DAY-LESS by design (PHI): an exact
 * source keeps its month as "MM/xx/YYYY"; a year-only source is "xx/xx/YYYY".
 * Returns null when no reliable 4-digit year is present (never a malformed
 * mask). Preserves month/year precision; only the day is intentionally dropped.
 */
export function sourceDobToOwnerMask(raw: unknown): string | null {
  const s = interpretSourceDob(raw)
  if (s.year == null) return null
  const yyyy = String(s.year).padStart(4, '0')
  const mm = s.month == null ? 'xx' : String(s.month).padStart(2, '0')
  return `${mm}/xx/${yyyy}`
}

/**
 * The service_policies insured DOB-by-precision columns for a raw import
 * source, preserving the FULL precision (an exact source keeps its day). Shapes
 * match the service_policies_insured_dob_shape_check constraint exactly. Used
 * when the policy owner IS the insured so the owner's real precision — day and
 * all — is retained on the insured record.
 */
export function sourceDobToInsuredColumns(raw: unknown): {
  insured_dob: string | null
  insured_dob_year: number | null
  insured_dob_month: number | null
  insured_dob_precision: 'exact' | 'month_year' | 'year_only' | 'missing'
} {
  const s = interpretSourceDob(raw)
  switch (s.precision) {
    case 'exact':
      return {
        insured_dob: `${String(s.year).padStart(4, '0')}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`,
        insured_dob_year: s.year,
        insured_dob_month: s.month,
        insured_dob_precision: 'exact',
      }
    case 'month-year':
      return { insured_dob: null, insured_dob_year: s.year, insured_dob_month: s.month, insured_dob_precision: 'month_year' }
    case 'year-only':
      return { insured_dob: null, insured_dob_year: s.year, insured_dob_month: null, insured_dob_precision: 'year_only' }
    default:
      return { insured_dob: null, insured_dob_year: null, insured_dob_month: null, insured_dob_precision: 'missing' }
  }
}

/**
 * Route a raw import source DOB to the two CUSTOMER storage columns, preserving
 * precision: an exact full date -> `date_of_birth` (ISO, day included); a
 * partial (month+year or year-only) -> `date_of_birth_approx` (masked, day-less,
 * matching the customers_date_of_birth_approx_shape constraint); nothing usable
 * -> both null. The day is only ever written on the exact column.
 */
export function sourceDobToCustomerColumns(raw: unknown): {
  date_of_birth: string | null
  date_of_birth_approx: string | null
} {
  const s = interpretSourceDob(raw)
  if (s.precision === 'exact') {
    return {
      date_of_birth: `${String(s.year).padStart(4, '0')}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`,
      date_of_birth_approx: null,
    }
  }
  if (s.precision === 'month-year' || s.precision === 'year-only') {
    const yyyy = String(s.year).padStart(4, '0')
    const mm = s.month == null ? 'xx' : String(s.month).padStart(2, '0')
    return { date_of_birth: null, date_of_birth_approx: `${mm}/xx/${yyyy}` }
  }
  return { date_of_birth: null, date_of_birth_approx: null }
}

// ---------------------------------------------------------------------------
// Compatible enrichment: merge an incoming import DOB into an existing stored one
// ---------------------------------------------------------------------------

/** How precise a DOB is, as a rank for comparison. Higher = more complete. */
function precisionRank(p: DobPrecision): number {
  switch (p) {
    case 'exact': return 3
    case 'month-year': return 2
    case 'year-only': return 1
    default: return 0
  }
}

/**
 * Merge an INCOMING import DOB into a customer's EXISTING stored DOB, returning
 * the customer columns to write ONLY when the incoming information genuinely
 * ADDS compatible precision, or `null` when nothing should change. This is how
 * an import enriches a customer whose DOB is partial (or absent) without ever
 * overwriting contradictory or more-reliable information.
 *
 * Rules (the incoming value is `interpretSourceDob(raw)` output):
 *   - incoming has no usable year            -> null (nothing to add)
 *   - existing has no DOB                     -> adopt the incoming value
 *   - YEARS differ (both known)               -> null (CONTRADICTION; keep existing)
 *   - same year, but a KNOWN month differs    -> null (contradiction; keep existing)
 *   - same year + month, but a KNOWN day differs (both exact) -> null (keep existing)
 *   - incoming precision <= existing precision AND adds no new component
 *                                             -> null (existing already as good)
 *   - otherwise COMPATIBLE and MORE COMPLETE  -> the merged value, taking each
 *       component from whichever side knows it (they agree where both know it)
 *
 * The merged result is expressed as the two customer columns: an exact full date
 * on `date_of_birth`; a partial (month+year or year-only) on the masked,
 * day-less `date_of_birth_approx`. A day is only ever set when the merge yields a
 * complete, real calendar date. Never fabricates a component neither side knows.
 */
export function mergeImportDobIntoCustomer(
  existingExact: string | null | undefined,
  existingApprox: string | null | undefined,
  incoming: SourceDob,
): { date_of_birth: string | null; date_of_birth_approx: string | null } | null {
  // Nothing usable coming in.
  if (incoming.year == null) return null

  const cur = readStoredDob(existingExact, existingApprox)

  // Existing has no DOB at all: adopt the incoming value outright.
  if (cur.precision === 'none') {
    return sourceToCustomerColumns(incoming)
  }

  // CONTRADICTION guards — never overwrite a conflicting known component.
  if (cur.year != null && incoming.year !== cur.year) return null
  if (cur.month != null && incoming.month != null && incoming.month !== cur.month) return null
  if (
    cur.day != null && incoming.day != null &&
    (incoming.day !== cur.day || (incoming.month ?? cur.month) !== cur.month)
  ) {
    return null
  }

  // Build the most complete COMPATIBLE value, taking each component from
  // whichever side knows it (they agree wherever both know it).
  const year = cur.year ?? incoming.year
  const month = cur.month ?? incoming.month ?? null
  // A day is only trusted as part of a complete, real date whose month/year
  // match the merged values (so an incoming exact day cannot attach to a month
  // the existing record contradicts — already guarded above).
  const day =
    cur.day != null ? cur.day
    : incoming.day != null && month != null && incoming.month === month && incoming.year === year
      ? incoming.day
      : null

  const mergedPrecision: DobPrecision =
    day != null && month != null ? 'exact'
    : month != null ? 'month-year'
    : 'year-only'

  // Only write when the merge is strictly MORE complete than what's on file.
  if (precisionRank(mergedPrecision) <= precisionRank(cur.precision)) return null

  return sourceToCustomerColumns({ precision: mergedPrecision, year, month, day })
}

/** The two customer columns for a resolved SourceDob: an exact date on
 * date_of_birth; a partial on the masked, day-less date_of_birth_approx. */
function sourceToCustomerColumns(s: SourceDob): {
  date_of_birth: string | null
  date_of_birth_approx: string | null
} {
  if (s.precision === 'exact' && s.year != null && s.month != null && s.day != null) {
    return {
      date_of_birth: `${String(s.year).padStart(4, '0')}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`,
      date_of_birth_approx: null,
    }
  }
  if ((s.precision === 'month-year' || s.precision === 'year-only') && s.year != null) {
    const yyyy = String(s.year).padStart(4, '0')
    const mm = s.month == null ? 'xx' : String(s.month).padStart(2, '0')
    return { date_of_birth: null, date_of_birth_approx: `${mm}/xx/${yyyy}` }
  }
  return { date_of_birth: null, date_of_birth_approx: null }
}
