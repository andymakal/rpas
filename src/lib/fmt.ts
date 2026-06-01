/**
 * Timezone-safe date formatting for React client components.
 *
 * toLocaleDateString() is NOT safe for SSR — the server (Vercel/UTC) and the
 * client (browser/local TZ) format the same timestamp into different date
 * strings, which causes React hydration error #418 consistently for cases
 * created in the evening US time.
 *
 * These helpers parse the UTC date part directly from the ISO string so the
 * output is identical on server and client regardless of timezone.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * "Jan 15, 2024" — uses the UTC date from the ISO string to avoid TZ drift.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  // Pull the calendar date out of the ISO string without any TZ conversion:
  //   "2024-01-15T03:00:00Z" → "2024-01-15" → Jan 15, 2024
  //   "2024-01-15" (date-only) → Jan 15, 2024
  const datePart = iso.slice(0, 10) // "YYYY-MM-DD"
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return '—'
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/**
 * Address normalization helpers.
 *
 * Applied on every customer save so addresses are consistent regardless
 * of how they were originally entered (all-caps, all-lowercase, mixed).
 *
 * Street:  title case, but cardinal directions and "PO" stay uppercase
 *          "123 ne main st apt 2b" → "123 NE Main St Apt 2B"
 * City:    standard title case  "BLOOMSBURG" → "Bloomsburg"
 * State:   always uppercase     "pa" → "PA"
 */

const STREET_UPPERCASE = new Set([
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
  'NNE', 'NNW', 'SSE', 'SSW', 'ENE', 'ESE', 'WNW', 'WSW',
  'PO', 'US', 'USA',
])

export function normalizeStreet(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  return raw.trim().replace(/\b\w+/g, w =>
    STREET_UPPERCASE.has(w.toUpperCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  )
}

export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  return raw.trim().replace(/\b\w+/g, w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  )
}

export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  return raw.trim().toUpperCase()
}

/**
 * Format notes for pasting into eAgent (or any compliance comments field).
 *
 * Prepends the current local date/time as a stamp so the entry is
 * self-documenting when pasted.  Uses local time intentionally — this
 * is triggered by a manual copy action in the browser, never SSR.
 *
 * Output:
 *   05/29/2026 10:34 AM
 *   [notes content]
 */
export function fmtEagentNote(notes: string): string {
  const now   = new Date()
  const date  = now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const time  = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} ${time}\n${notes}`
}

/**
 * "Jan 15" (no year) — same UTC-safe approach.
 */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const datePart = iso.slice(0, 10)
  const [, m, d] = datePart.split('-').map(Number)
  if (!m || !d) return '—'
  return `${MONTHS[m - 1]} ${d}`
}
