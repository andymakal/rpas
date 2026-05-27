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
 * "Jan 15" (no year) — same UTC-safe approach.
 */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const datePart = iso.slice(0, 10)
  const [, m, d] = datePart.split('-').map(Number)
  if (!m || !d) return '—'
  return `${MONTHS[m - 1]} ${d}`
}
