/**
 * Prepare Carrier Email — the short request an employee sends to the CARRIER to
 * process a returned servicing-agent authorization.
 *
 * Client-safe (no Node-only imports) so it can be used from the working-screen
 * UI. It is the carrier-facing counterpart to the customer-facing
 * servicing-agent-form-shared.ts prose: that module introduces the office to
 * the customer; this one asks the carrier to record the servicing-agent change
 * now that the signed authorization is in hand.
 *
 * The employee attaches the signed form and sends the email manually (the UI
 * opens a prepared draft via mailto), then confirms with "Email Sent". The
 * send itself is the existing submit-to-carrier transition; this module only
 * supplies the subject/body addressed to the appropriate carrier.
 */

/** The carriers named on the servicing request, de-duplicated for the email. */
export function uniqueCarriers(carriers: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of carriers) {
    const name = (c ?? '').trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

/**
 * Resolve the carrier email RECIPIENT for the prepared draft, from existing
 * contact information only — never invented.
 *
 * `known` maps a normalized carrier name (lowercased, trimmed) to its on-file
 * email address. Right Path does not store carrier email addresses today, so
 * this map is empty in practice and the result is null: the draft opens with an
 * EMPTY recipient and the UI tells the employee to add the carrier address.
 * When a carrier's address IS known and the request involves exactly one
 * carrier, that address is returned so the draft is pre-addressed. With more
 * than one carrier we do not guess a single recipient. This never fabricates an
 * address: an unknown carrier yields null.
 */
export function resolveCarrierRecipient(
  carriers: string[],
  known?: Record<string, string> | Map<string, string> | null,
): string | null {
  if (carriers.length !== 1 || !known) return null
  const key = carriers[0].trim().toLowerCase()
  const addr = known instanceof Map ? known.get(key) : known[key]
  const value = (addr ?? '').trim()
  return value.length > 0 ? value : null
}

/** Join carrier names for prose ("A", "A and B", "A, B, and C"). */
function joinCarriers(carriers: string[]): string {
  if (carriers.length === 0) return 'the carrier'
  if (carriers.length === 1) return carriers[0]
  if (carriers.length === 2) return `${carriers[0]} and ${carriers[1]}`
  return `${carriers.slice(0, -1).join(', ')}, and ${carriers[carriers.length - 1]}`
}

/** Subject line for the carrier request. Names the carrier when exactly one is
 * involved, so the carrier sees the relevant contract line up front. */
export function carrierEmailSubject(carriers: string[]): string {
  const named = carriers.length === 1 ? ` — ${carriers[0]}` : ''
  return `Servicing agent authorization for processing${named}`
}

/**
 * The short carrier request body: it states that a signed authorization is
 * attached and asks the carrier to process it, listing the policy numbers the
 * request covers. Kept brief and factual — a processing request, not a pitch.
 */
export function carrierEmailMessage(input: {
  carriers: string[]
  policyNumbers: string[]
  customerName: string
}): string {
  const who = input.customerName.trim() || 'our mutual customer'
  const carrierPhrase = joinCarriers(input.carriers)
  const policyLine =
    input.policyNumbers.length > 0
      ? `\n\nContract number(s): ${input.policyNumbers.join(', ')}.`
      : ''
  return (
    `Hello ${carrierPhrase},\n\n` +
    `Attached is the signed servicing agent authorization for ${who}. ` +
    `Please process it to record James Andrew Makal as the servicing agent on ` +
    `the contract(s) below, and confirm once it has been applied.` +
    policyLine +
    `\n\nThank you,\nJames Andrew Makal\namakal@allstate.com\n(814)808-7526`
  )
}
