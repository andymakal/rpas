/**
 * Reusable contact-input normalization standard for customer-contact forms.
 *
 * This is the single source of truth for how operator-typed or pasted contact
 * values (phone, email, name) are cleaned before they are shown back in a form
 * and before they are written to a customer record. It exists so every
 * customer-contact form behaves identically and invalid formatting cannot slip
 * past the UI into the database.
 *
 * Storage standard (system-wide): a phone is STORED as bare 10 digits (no
 * punctuation); it is formatted to `(XXX) XXX-XXXX` only on display, via
 * `formatPhoneDisplay`. `normalizePhoneInput` therefore returns the bare
 * 10-digit value as its canonical `value`, and `normalizePhone` in `./fmt`
 * returns the same bare-digit form for best-effort server coercion.
 *
 * The behavior is adapted from IPF's established contact handling and is kept
 * consistent with Right Path's existing utilities:
 *   - Phone display formatting lives in `formatPhoneDisplay` ((XXX) XXX-XXXX,
 *     country-code 1 dropped), the one display formatter in the app.
 *   - Email handling matches `normalizeEmail` in `./fmt` (trim + lowercase).
 * The difference here is that these functions return a STRUCTURED result with a
 * validity signal, so a form can refuse to save an invalid phone instead of
 * silently keeping bad input. The plain string normalizers in `./fmt` remain
 * the right choice for backfills and best-effort server coercion.
 */

import { normalizeEmail as normalizeEmailLoose, titleCaseIfAllCaps } from './fmt'

/**
 * The outcome of normalizing a single contact field.
 *
 *   - `empty`   : the input had no meaningful content (blank / whitespace).
 *                 `value` is null; this is a valid "cleared" state, not an error.
 *   - `valid`   : the input parsed cleanly. `value` is the canonical form.
 *   - `invalid` : the input had content but could not be reduced to a valid
 *                 value. `value` is null and `reason` explains why. Callers must
 *                 NOT save an invalid value.
 */
export type ContactFieldStatus = 'empty' | 'valid' | 'invalid'

export interface ContactFieldResult {
  status: ContactFieldStatus
  /** Canonical value to display and save; null when empty or invalid. */
  value: string | null
  /** Human-readable explanation, present only when status is 'invalid'. */
  reason?: string
}

const empty = (): ContactFieldResult => ({ status: 'empty', value: null })
const valid = (value: string): ContactFieldResult => ({ status: 'valid', value })
const invalid = (reason: string): ContactFieldResult => ({ status: 'invalid', value: null, reason })

// ── Phone ────────────────────────────────────────────────────────────────────

/**
 * Normalize a US phone number from arbitrary pasted input.
 *
 * Accepts numbers with spaces, punctuation, a leading country code of 1, or
 * surrounding explanatory text, and extracts exactly 10 US digits when the
 * input is unambiguous. The result is the canonical STORED form the rest of
 * the app uses: bare 10 digits (no punctuation). Display formatting to
 * `(XXX) XXX-XXXX` is applied only at render time via `formatPhoneDisplay`.
 *
 * Unambiguous means the input contains exactly one plausible US number:
 *   - exactly 10 digits, or
 *   - exactly 11 digits beginning with the country code 1.
 * Any other digit count (too few, too many, or extra stray digits from
 * surrounding text) is treated as INVALID rather than guessed at, so a bad
 * number is never silently truncated or saved.
 *
 *   "215-555-0100"                  → valid  "2155550100"
 *   "(215) 555-0100"                → valid  "2155550100"  (punctuation stripped)
 *   "2155550100"                    → valid  "2155550100"  (idempotent)
 *   "1 215 555 0100"                → valid  "2155550100"  (country code)
 *   "+1 (215) 555-0100"             → valid  "2155550100"
 *   "call her at 215.555.0100 pls"  → valid  "2155550100"  (text stripped)
 *   "2155550"                       → invalid (only 7 digits)
 *   "215-555-0100 x204"             → invalid (13 digits, ambiguous)
 *   ""                              → empty
 */
export function normalizePhoneInput(raw: string | null | undefined): ContactFieldResult {
  if (!raw || !raw.trim()) return empty()

  const digits = raw.replace(/\D/g, '')
  if (digits.length === 0) {
    return invalid('No digits found. Enter a 10-digit US phone number.')
  }

  // Drop a US country code only in the unambiguous 11-digit "1 + 10" case.
  const national = digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits

  if (national.length !== 10) {
    return invalid(
      national.length < 10
        ? 'That is not a complete 10-digit US phone number.'
        : 'That has too many digits to be a single US phone number. Remove extensions or extra text.',
    )
  }

  // The canonical value is the bare 10 digits — the stored form. Display is
  // formatted on render via `formatPhoneDisplay`, never stored with punctuation.
  return valid(national)
}

/**
 * The IPF phone display standard: `(XXX) XXX-XXXX`.
 *
 * This is the single source of truth for how a US phone number is shown
 * anywhere in Right Path. Give it any stored or raw value; it strips to digits,
 * drops a leading country code of 1, and formats the 10 national digits. A
 * value that is not reducible to 10 digits is formatted progressively (as far
 * as the digits allow) so it is still readable, and an empty input renders as
 * an em-free placeholder the caller supplies (default empty string).
 *
 *   "8148087526"      → "(814) 808-7526"
 *   "(814) 808-7526"  → "(814) 808-7526"  (idempotent)
 *   "18148087526"     → "(814) 808-7526"  (country code dropped)
 *   "814808"          → "(814) 808"       (partial, still readable)
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return ''
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  digits = digits.slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Progressive formatter for an EDITABLE phone field: call it on every keystroke
 * so the value an operator sees and edits is always in the `(XXX) XXX-XXXX`
 * standard as they type. Identical formatting to formatPhoneDisplay, exposed
 * under an intention-revealing name for input onChange handlers.
 */
export function formatPhoneAsTyped(raw: string): string {
  return formatPhoneDisplay(raw)
}

// ── Email ──────────────────────────────────────────────────────────────────

// Pragmatic email shape check: some local part, an @, a dotted domain. This is
// deliberately permissive: it rejects obvious non-emails (no @, no domain)
// without trying to fully validate RFC 5322.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Normalize an email address: trim surrounding whitespace and lowercase.
 *
 * Reuses `normalizeEmail` from `./fmt` for the actual trim+lowercase so the
 * transformation stays identical to every other save point in the app, then
 * adds a light shape check so an obviously malformed address is reported as
 * invalid instead of saved.
 *
 *   "  Jane.Doe@Example.COM "  → valid  "jane.doe@example.com"
 *   "not-an-email"             → invalid
 *   ""                         → empty
 */
export function normalizeEmailInput(raw: string | null | undefined): ContactFieldResult {
  const cleaned = normalizeEmailLoose(raw) // trim + lowercase, or null when blank
  if (!cleaned) return empty()
  if (!EMAIL_SHAPE.test(cleaned)) {
    return invalid('That does not look like a valid email address.')
  }
  return valid(cleaned)
}

// ── Name ─────────────────────────────────────────────────────────────────────

/**
 * Normalize a person-name component (first or last name).
 *
 * Collapses internal whitespace, then applies title case ONLY when the entire
 * value is uppercase — an import artifact like "SMITH" becomes "Smith", while
 * intentionally mixed-case names (McDonald, DeLuca, van der Berg) are
 * preserved exactly as typed.
 *
 *   "JOHN"              → valid  "John"       (all-caps import → title case)
 *   "McDonald"          → valid  "McDonald"   (mixed case preserved)
 *   "van der Berg"      → valid  "van der Berg"
 *   "  john   smith "   → valid  "john smith" (mixed — preserved, not up-cased)
 *   ""                  → empty
 */
export function normalizeNameInput(raw: string | null | undefined): ContactFieldResult {
  if (!raw || !raw.trim()) return empty()
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return empty()
  return valid(titleCaseIfAllCaps(collapsed))
}
