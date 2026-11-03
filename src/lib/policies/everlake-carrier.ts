/**
 * Everlake-eligible carrier rule — the single source of truth for which policies
 * are verified in the Everlake Agent Portal when establishing servicing-agent
 * status.
 *
 * Only the closed blocks that moved to Everlake are looked up there:
 *   - anything Allstate (Allstate, Allstate Life, Allstate Fixed Annuity, ...);
 *   - Lincoln Benefit Life (LBL — the old Allstate life block, NOT Lincoln
 *     Financial, a different company);
 *   - Everlake-branded carriers (Everlake Life, Everlake Assurance).
 *
 * Everything else (Protective, Foresters, Sammons, John Hancock, Lincoln
 * Financial / Lincoln Financial Group, CoreBridge, Equitable, Prudential, the
 * brokerage/mutual-fund lines, ...) is NOT verified in Everlake and must never
 * be shown on the Everlake verify surface. For those, if we wrote the business
 * we are already the servicing agent; a missing flag there is a separate
 * reconciliation, not an Everlake lookup.
 *
 * Deliberately a HARDCODED rule: these blocks are no longer being written, so
 * the set is effectively frozen and should essentially never change. It keys on
 * the carrier label only (the business rule is carrier-scoped, not product- or
 * policy-scoped: being the servicing agent on one of a customer's policies does
 * not grant visibility into the others, so each eligible policy is checked on
 * its own).
 *
 * IMPORTANT — ambiguity is excluded, never guessed. A bare "Lincoln" label is
 * NOT eligible: it is unresolved data that could be either Lincoln Benefit Life
 * (Everlake) or Lincoln Financial (not Everlake), and we must never send an
 * operator to look up a policy Everlake does not hold. Resolve bare "Lincoln" by
 * relabeling the data to its true carrier; it then falls on the correct side of
 * this rule automatically.
 */

/**
 * Whether a carrier's policies are verified in the Everlake Agent Portal.
 *
 * Case-insensitive and whitespace-tolerant. Matches:
 *   - any label containing "allstate";
 *   - any label containing "everlake";
 *   - exactly "Lincoln Benefit Life" (the only eligible Lincoln* label).
 *
 * A bare "Lincoln", "Lincoln Financial", or "Lincoln Financial Group" is NOT
 * eligible — only the full "Lincoln Benefit Life" is.
 */
export function isEverlakeCarrier(carrier: string | null | undefined): boolean {
  if (!carrier) return false
  const c = carrier.trim().toLowerCase()
  if (c.length === 0) return false
  if (c.includes('allstate')) return true
  if (c.includes('everlake')) return true
  // Lincoln Benefit Life ONLY. "lincoln" alone, "lincoln financial", and
  // "lincoln financial group" are a different company and are not eligible.
  if (c === 'lincoln benefit life') return true
  return false
}
