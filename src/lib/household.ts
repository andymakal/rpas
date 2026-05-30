/**
 * Household display name helpers.
 *
 * Builds the "John & Jane Smith" style name used in Triage cards, portal
 * cards, and referral headers when a case has household members.
 */

export type HouseholdMemberName = { first_name: string; last_name: string }

/**
 * Returns a display name that combines the primary contact and any
 * household members.
 *
 * Same last name:  "John & Jane Smith"
 * Mixed last names: "John Smith & Jane Doe"
 * Solo:            "John Smith"
 */
export function buildHouseholdName(
  primary:  HouseholdMemberName | null,
  members:  HouseholdMemberName[],
): string {
  if (!primary) return 'Unknown'
  if (members.length === 0) return `${primary.first_name} ${primary.last_name}`

  const all = [primary, ...members]

  // If every person shares the primary's last name, use the short form
  const sharedLastName = all.every(
    p => p.last_name.toLowerCase() === primary.last_name.toLowerCase()
  )

  if (sharedLastName) {
    return `${all.map(p => p.first_name).join(' & ')} ${primary.last_name}`
  }

  return all.map(p => `${p.first_name} ${p.last_name}`).join(' & ')
}
