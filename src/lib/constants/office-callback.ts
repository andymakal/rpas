/**
 * Office callback number — Right Path.
 *
 * The single default callback number customers are asked to call back on in
 * guided outreach (voicemail scripts, follow-up and other customer-facing
 * outreach copy). This is the agency's published office line, already shown on
 * the public intake header and the servicing-agent form, centralized here so
 * the callback used in scripts/emails resolves from one place.
 *
 * Stored and displayed in Right Path's standard phone form `(XXX) XXX-XXXX`
 * (see `src/lib/contact-input.ts`).
 *
 * This is NOT the customer's number and NOT the employee's personal
 * `producers.phone`. `producers.phone` holds personal numbers that were not
 * explicitly chosen for customer callbacks, so it must never be used as the
 * callback number. An employee may override with an explicit direct callback
 * number, but that override must come from a field deliberately chosen for
 * callbacks, never from `producers.phone`.
 */
export const OFFICE_CALLBACK_PHONE = '(814) 808-7526' as const
