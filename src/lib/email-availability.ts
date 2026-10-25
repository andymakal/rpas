/**
 * Email availability — the single source of truth for a customer's durable
 * email-availability fact.
 *
 * Email availability is an INFORMATIONAL customer-level fact: what the agency
 * currently knows about whether a usable email address is on file. It is stored
 * on `customers.email_availability` (added by migration
 * 20261116000001_customers_email_availability.sql) and is independent of any one
 * workflow. This module owns the state set and the operator-facing labels so the
 * card and the save route agree on them in one place.
 *
 * It is deliberately NOT a business rule: it drives no research suppression, no
 * queue, and no workflow routing. It never closes a case, stops servicing, or
 * removes a customer from a project. An employee can change the status or enter
 * a new email at any time; entering a usable email returns the card to the
 * normal email-on-file state.
 */

/**
 * The stored states. NULL in the column means UNKNOWN ("Missing") — no email on
 * file and no reason recorded — so the column is nullable and existing rows need
 * no backfill. The three non-null values are:
 *
 *   - 'available'     : a usable email address is on file (the normal state).
 *   - 'no_address'    : the customer has no email address or will not provide
 *                       one ("No Usable Email").
 *   - 'undeliverable' : a known address permanently failed and was removed from
 *                       active use (the failed address stays in history).
 */
export type EmailAvailability =
  | 'available'
  | 'no_address'
  | 'undeliverable'

/** The durable-state values accepted from a request body / stored in the column.
 * 'available' is set by the system when a usable address is on file; the
 * operator selects one of the two "no usable email" reasons. */
export const EMAIL_AVAILABILITY_VALUES: readonly EmailAvailability[] = [
  'available',
  'no_address',
  'undeliverable',
] as const

export function isEmailAvailability(v: unknown): v is EmailAvailability {
  return typeof v === 'string' && (EMAIL_AVAILABILITY_VALUES as readonly string[]).includes(v)
}

/**
 * What an operator can choose in the email editor's "record why" control. These
 * are the two "no usable email" reasons plus 'missing', which RESETS the fact to
 * unknown (the stored column back to NULL). 'missing' is not a stored value —
 * it is the request intent to clear the column — so it is kept separate from
 * EmailAvailability. 'available' is never chosen here; it is set by the system
 * when a usable address is saved.
 */
export type SelectableEmailAvailability = 'missing' | 'no_address' | 'undeliverable'

export const SELECTABLE_EMAIL_AVAILABILITY_VALUES: readonly SelectableEmailAvailability[] = [
  'missing',
  'no_address',
  'undeliverable',
] as const

export function isSelectableEmailAvailability(v: unknown): v is SelectableEmailAvailability {
  return typeof v === 'string'
    && (SELECTABLE_EMAIL_AVAILABILITY_VALUES as readonly string[]).includes(v)
}

/**
 * The effective, display-facing state the UI reads. Combines the stored
 * availability with whether a usable address is actually on file, so the card
 * never shows a contradictory combination (e.g. a stored 'available' with no
 * address, or a stale terminal reason once an address is back):
 *
 *   - 'on_file'       : a usable email address is present. Shown normally.
 *   - 'missing'       : no address, reason unknown (stored NULL or 'available').
 *   - 'no_address'    : no usable email (none, or the customer will not provide).
 *   - 'undeliverable' : a known address failed and was removed from active use.
 */
export type EmailAvailabilityDisplay =
  | 'on_file'
  | 'missing'
  | 'no_address'
  | 'undeliverable'

/** Short operator-facing labels for the selectable reasons and states. */
export const EMAIL_AVAILABILITY_LABEL: Record<EmailAvailabilityDisplay, string> = {
  on_file: 'Email on file',
  missing: 'Missing',
  no_address: 'No Usable Email',
  undeliverable: 'Undeliverable',
}

/** A one-line meaning for each state, used as help text beside the selection. */
export const EMAIL_AVAILABILITY_HELP: Record<EmailAvailabilityDisplay, string> = {
  on_file: 'A usable email address is on file.',
  missing: 'No email on file; the reason is not yet known.',
  no_address: 'The customer has no email address or will not provide one.',
  undeliverable: 'A known email address permanently failed and was removed from use.',
}

/** A usable email value is present and non-blank. */
export function hasUsableEmailValue(email: string | null | undefined): boolean {
  return !!email && email.trim().length > 0
}

/**
 * Resolve the effective display state from the stored fact and the stored email
 * value. A usable address always shows normally ('on_file'); a recorded reason
 * shows only when there is no usable address on file. A usable email therefore
 * returns the card to the normal state regardless of any prior reason.
 */
export function resolveEmailAvailabilityDisplay(
  stored: EmailAvailability | null | undefined,
  email: string | null | undefined,
): EmailAvailabilityDisplay {
  if (hasUsableEmailValue(email)) return 'on_file'
  if (stored === 'no_address') return 'no_address'
  if (stored === 'undeliverable') return 'undeliverable'
  return 'missing'
}
