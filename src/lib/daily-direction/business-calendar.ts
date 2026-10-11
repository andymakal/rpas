/**
 * Right Path business calendar (pure, no server/runtime deps).
 *
 * Date-only work (promised callbacks) is judged "due today" on Right Path's
 * business calendar, NOT the server's UTC/local clock, so the judgment is
 * stable wherever the code runs (server render or browser).
 *
 * Timezone evidence (NOT inherited from IPF, whose default was America/Chicago):
 *   - Makal Financial Services is a Pennsylvania agency. The SML producer teams
 *     are seeded in US Eastern states, predominantly PA (sml_teams.region).
 *   - The customer book is overwhelmingly Eastern (PA, VA, CT, DE, NJ, RI;
 *     verified against the live development database).
 * The callback date is set by the operator on the agency's single operating
 * clock, so one business calendar is correct. US Eastern it is.
 */
export const BUSINESS_TIME_ZONE = 'America/New_York'

/**
 * Today's date on the business calendar as YYYY-MM-DD. DST-correct via Intl;
 * en-CA yields YYYY-MM-DD, which compares correctly against date-only strings.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Whether a date-only callback date (YYYY-MM-DD) is due on or before today on
 * the business calendar. Date-only in; no clock time is read or implied.
 */
export function isCallbackDue(callbackDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!callbackDate) return false
  return callbackDate <= businessToday(now)
}
