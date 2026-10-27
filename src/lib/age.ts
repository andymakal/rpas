/**
 * Customer age from a stored date of birth — the single shared calculation.
 *
 * Right Path stores `customers.date_of_birth` as a `date` and never displays the
 * day (it is masked MM/xx/YYYY elsewhere). Age is DERIVED, never stored, and is
 * shown only when the DOB is a plausible full date; when it cannot be determined
 * this returns null so callers omit it rather than guess. The day is used only
 * for the birthday comparison; it is never rendered.
 *
 * This is the existing calculation promoted from the customer-overview surface
 * so every surface computes age one way.
 */
export function calcAge(iso: string | null | undefined): number | null {
  if (!iso) return null
  // Accept a full date (YYYY-MM-DD, or an ISO instant); require the date part.
  const datePart = iso.slice(0, 10)
  const m0 = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m0) return null
  const y = Number(m0[1])
  const m = Number(m0[2])
  const d = Number(m0[3])
  const dob = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - y
  const beforeBirthday =
    now.getUTCMonth() + 1 < m ||
    (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  // Guard against a nonsensical DOB (future date or implausible age): omit
  // rather than show a wrong number.
  if (age < 0 || age > 120) return null
  return age
}
