/**
 * Reusable contact-input normalization standard for customer-contact forms.
 *
 * This is the single source of truth for how operator-typed or pasted contact
 * values (phone, email, name) are cleaned before they are shown back in a form
 * and before they are written to a customer record. It exists so every
 * customer-contact form behaves identically and invalid formatting cannot slip
 * past the UI into the database.
 *
 * The behavior is adapted from IPF's established contact handling and is kept
 * consistent with Right Path's existing utilities:
 *   - Phone display formatting matches `normalizePhone` in `./fmt` exactly
 *     ((XXX) XXX-XXXX, country-code 1 dropped).
 *   - Email handling matches `normalizeEmail` in `./fmt` (trim + lowercase).
 * The difference here is that these functions return a STRUCTURED result with a
 * validity signal, so a form can refuse to save an invalid phone instead of
 * silently keeping bad input. The plain string normalizers in `./fmt` remain
 * the right choice for backfills and best-effort server coercion.
 */

import { normalizeEmail as normalizeEmailLoose } from './fmt'

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
 * input is unambiguous. The result is the canonical display form the rest of
 * the app uses: `(XXX) XXX-XXXX`.
 *
 * Unambiguous means the input contains exactly one plausible US number:
 *   - exactly 10 digits, or
 *   - exactly 11 digits beginning with the country code 1.
 * Any other digit count (too few, too many, or extra stray digits from
 * surrounding text) is treated as INVALID rather than guessed at, so a bad
 * number is never silently truncated or saved.
 *
 *   "215-555-0100"                  → valid  "(215) 555-0100"
 *   "(215) 555-0100"                → valid  "(215) 555-0100"  (idempotent)
 *   "1 215 555 0100"                → valid  "(215) 555-0100"  (country code)
 *   "+1 (215) 555-0100"             → valid  "(215) 555-0100"
 *   "call her at 215.555.0100 pls"  → valid  "(215) 555-0100"  (text stripped)
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

  return valid(`(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`)
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
 * Collapses runs of internal whitespace to a single space and trims the ends,
 * while preserving the capitalization exactly as typed. This mirrors IPF's
 * whitespace handling and intentionally does NOT title-case: names like
 * "McDonald", "DeLuca", or "van der Berg" keep their intended capitalization
 * rather than being flattened by a blind title-case pass.
 *
 *   "  john   smith "   → valid  "john smith"
 *   "McDonald"          → valid  "McDonald"   (caps preserved)
 *   "van der Berg"      → valid  "van der Berg"
 *   ""                  → empty
 */
export function normalizeNameInput(raw: string | null | undefined): ContactFieldResult {
  if (!raw || !raw.trim()) return empty()
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  return collapsed ? valid(collapsed) : empty()
}
