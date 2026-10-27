/**
 * Text-message (SMS) availability — the single source of truth for whether a
 * customer can be TEXTED, and the operator-facing labels for that status.
 *
 * Texting availability is derived from TWO existing, independent facts. This
 * module introduces NO new customer field and NO separate texting system; it
 * only reads the two mechanisms Right Path already has and resolves them into
 * one display status the shared Customer Contact Card and the workflow
 * availability logic agree on.
 *
 *   1. Do Not Text — the durable customer-level opt-out `customers.sms_opt_out`
 *      (boolean). The customer told us to STOP (a received STOP message, or an
 *      explicit request). It is a property of the CUSTOMER, not of a number, so
 *      it persists even if the phone number changes, and only a deliberate clear
 *      lifts it. It is the strongest restriction and outranks Undeliverable.
 *
 *   2. Text Undeliverable — a recorded text-DELIVERY FAILURE for the SPECIFIC
 *      number on file. This is the existing value-scoped unusable fact carried
 *      on a `case_touches` text row as `[channel-unusable:<digits>]` (see
 *      `@/lib/stewardship/outreach-attempts` and `attempt-history`). Because it
 *      is scoped to the failed number's digits, REPLACING the number restores
 *      text availability on its own. An ordinary unsent text is NOT a failure —
 *      only the recorded `unusable` outcome marks the number undeliverable.
 *
 * Both restrictions disable TEXTING only. Telephone CALLS are unaffected: Do Not
 * Text and Text Undeliverable never remove calling, which rides the same number
 * but is a separate channel. This mirrors the contact-options rule that a text
 * being unusable removes only texting, while a phone being unusable (a bad
 * number) removes both.
 *
 * Like email availability, this is INFORMATIONAL for the contact surface: it
 * drives no queue, closes no case, and stops no servicing. It only governs
 * whether texting is offered as an available channel across the new workflow
 * screens.
 */

/**
 * The effective, display-facing texting status the UI reads. Resolved from the
 * opt-out flag and the current-number delivery-failure fact so the card never
 * shows a contradictory combination:
 *
 *   - 'available'      : texting is available (no opt-out, number deliverable).
 *   - 'do_not_text'    : the customer opted out (STOP). Outranks undeliverable.
 *   - 'undeliverable'  : the number on file has a recorded text-delivery failure.
 */
export type SmsAvailabilityDisplay =
  | 'available'
  | 'do_not_text'
  | 'undeliverable'

/** Short operator-facing labels for each texting status. */
export const SMS_AVAILABILITY_LABEL: Record<SmsAvailabilityDisplay, string> = {
  available: 'Text available',
  do_not_text: 'Do Not Text',
  undeliverable: 'Text Undeliverable',
}

/** A one-line meaning for each status, used as help text beside the control. */
export const SMS_AVAILABILITY_HELP: Record<SmsAvailabilityDisplay, string> = {
  available: 'Texting this number is available.',
  do_not_text: 'The customer asked not to be texted (STOP). Texting stays off until cleared, even if the number changes.',
  undeliverable: 'A text to the number on file failed to deliver. Replacing the number restores texting.',
}

/** The facts resolved into a texting status. Both already exist on/around the
 * customer record; this type just names them for the resolver. */
export interface SmsAvailabilityFacts {
  /** The durable customer-level opt-out (`customers.sms_opt_out`). */
  smsOptOut: boolean
  /** Whether the NUMBER currently on file has a recorded text-delivery failure
   * (the value-scoped `[channel-unusable:<digits>]` text fact, already matched
   * against the current phone by the attempt-history read). */
  textUndeliverable: boolean
}

/**
 * Resolve the effective texting status from the two facts. Do Not Text is the
 * strongest restriction and is reported first (it follows the customer
 * regardless of the number); a recorded delivery failure for the current number
 * reads as Undeliverable; otherwise texting is available. Calling is never
 * affected by either state.
 */
export function resolveSmsAvailabilityDisplay(facts: SmsAvailabilityFacts): SmsAvailabilityDisplay {
  if (facts.smsOptOut) return 'do_not_text'
  if (facts.textUndeliverable) return 'undeliverable'
  return 'available'
}

/** Whether texting is available given the two facts: neither opted out nor a
 * recorded delivery failure on the current number. The shared contact-options
 * logic uses the same two inputs so the card and the workflow stay consistent. */
export function canTextGivenFacts(facts: SmsAvailabilityFacts): boolean {
  return !facts.smsOptOut && !facts.textUndeliverable
}
