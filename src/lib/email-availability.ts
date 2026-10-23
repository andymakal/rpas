/**
 * Email availability — the single source of truth for a customer's durable
 * email-availability fact.
 *
 * Email availability answers one customer-level question: what does the agency
 * currently know about reaching this customer by email? It is stored on
 * `customers.email_availability` (added by migration
 * 20261116000001_customers_email_availability.sql) and is independent of any one
 * workflow. This module owns the state set, the operator-facing labels, and the
 * small amount of logic that every consumer (the shared contact card, the save
 * route, and the research/outreach gating) must agree on — so the rules live in
 * one place rather than being re-derived per screen.
 *
 * It follows IPF's useful pattern of a durable, attributable contact fact that
 * directs work, WITHOUT importing IPF's architecture: the state is re-homed on
 * Right Path's own `customers` row and recorded in Right Path's own
 * `case_touches` history, and it never closes a case, stops servicing, or
 * removes a customer from a project.
 */

/**
 * The stored states. NULL in the column means UNKNOWN ("Missing") — no email on
 * file and no reason recorded — so the column is nullable and existing rows need
 * no backfill. The four non-null values are:
 *
 *   - 'available'     : a usable email address is on file (the normal state).
 *   - 'no_address'    : the customer confirmed they have NO email address.
 *   - 'refused'       : the customer refuses to provide or use email.
 *   - 'undeliverable' : a known address permanently failed; the address is
 *                       removed from active use and preserved in history, and
 *                       research for a REPLACEMENT is allowed.
 */
export type EmailAvailability =
  | 'available'
  | 'no_address'
  | 'refused'
  | 'undeliverable'

/** The durable-state values accepted from a request body / stored in the column.
 * 'available' is set by the system when a usable address is on file; the
 * operator selects one of the three "no usable email" reasons. */
export const EMAIL_AVAILABILITY_VALUES: readonly EmailAvailability[] = [
  'available',
  'no_address',
  'refused',
  'undeliverable',
] as const

export function isEmailAvailability(v: unknown): v is EmailAvailability {
  return typeof v === 'string' && (EMAIL_AVAILABILITY_VALUES as readonly string[]).includes(v)
}

/**
 * The effective, display-facing state the UI reads. Combines the stored
 * availability with whether a usable address is actually on file, so the card
 * never shows a contradictory combination (e.g. a stored 'available' with no
 * address, or a stale terminal reason once an address is back):
 *
 *   - 'on_file'       : a usable email address is present. Shown normally.
 *   - 'missing'       : no address, reason unknown (stored NULL or 'available').
 *   - 'no_address'    : no address, customer has none.
 *   - 'refused'       : refused (shown whether or not an address lingers; the
 *                       refusal is the governing fact until explicitly reversed).
 *   - 'undeliverable' : a known address failed and was removed from active use.
 */
export type EmailAvailabilityDisplay =
  | 'on_file'
  | 'missing'
  | 'no_address'
  | 'refused'
  | 'undeliverable'

/** Short operator-facing labels for the selectable reasons and states. */
export const EMAIL_AVAILABILITY_LABEL: Record<EmailAvailabilityDisplay, string> = {
  on_file: 'Email on file',
  missing: 'Missing',
  no_address: 'No Email Address',
  refused: 'Email Refused',
  undeliverable: 'Undeliverable',
}

/** A one-line meaning for each state, used as help text beside the selection. */
export const EMAIL_AVAILABILITY_HELP: Record<EmailAvailabilityDisplay, string> = {
  on_file: 'A usable email address is on file.',
  missing: 'No email on file; the reason is not yet known.',
  no_address: 'The customer has confirmed they do not have an email address.',
  refused: 'The customer refuses to provide or use email.',
  undeliverable: 'A known email address permanently failed and was removed from use.',
}

/** A usable email value is present and non-blank. */
export function hasUsableEmailValue(email: string | null | undefined): boolean {
  return !!email && email.trim().length > 0
}

/**
 * Resolve the effective display state from the stored fact and the stored email
 * value. The email value takes precedence for the "on file" vs "missing" split
 * so a usable address always shows normally; a terminal reason only shows once
 * there is no usable address, EXCEPT 'refused', which governs regardless (a
 * refusal is not undone merely because an address is still on record).
 */
export function resolveEmailAvailabilityDisplay(
  stored: EmailAvailability | null | undefined,
  email: string | null | undefined,
): EmailAvailabilityDisplay {
  const hasEmail = hasUsableEmailValue(email)
  if (stored === 'refused') return 'refused'
  if (hasEmail) return 'on_file'
  if (stored === 'no_address') return 'no_address'
  if (stored === 'undeliverable') return 'undeliverable'
  return 'missing'
}

/**
 * Whether email RESEARCH (looking up a usable address) is still worthwhile given
 * the current fact. This is the gate the research/outreach logic consults for
 * the email method:
 *
 *   - 'no_address' and 'refused' STOP unnecessary email research: the customer
 *     has no address or will not use email, so there is nothing to find.
 *   - 'undeliverable' ALLOWS research: the known address failed, so a REPLACEMENT
 *     should be sought.
 *   - unknown/'available' fall through to ordinary presence-based logic.
 *
 * It never, on its own, decides a customer is unreachable or closes any work; it
 * only suppresses the email leg of research where research cannot help.
 */
export function emailResearchSuppressed(
  stored: EmailAvailability | null | undefined,
): boolean {
  return stored === 'no_address' || stored === 'refused'
}
