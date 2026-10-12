/**
 * Phone display formatting.
 *
 * The implementation now lives in the shared contact-input standard
 * (`./contact-input`) so there is exactly one phone formatter in the app.
 * This module re-exports it under the historical `formatPhone` name so existing
 * imports keep working; new code can import `formatPhoneDisplay` /
 * `formatPhoneAsTyped` from `./contact-input` directly.
 */
export { formatPhoneDisplay as formatPhone } from './contact-input'
