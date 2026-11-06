'use client'

/**
 * ContactSearch — the "find this person" SUBASSEMBLY. It composes the source
 * Legos (GatewaySearchSource, FastPeopleSearchSource) in order; each source is
 * its own self-contained Lego with its own terms, cap, and copy behavior. A new
 * lookup source later is a new source Lego dropped in here, not a rewrite.
 *
 * Which sources show is decided here:
 *   - Gateway is the Allstate system, so it is shown ONLY when the customer has
 *     an Allstate policy number (the search key). No policy number means there
 *     is nothing to search in Gateway — a non-customer referral — so the source
 *     is omitted entirely rather than shown as a search that cannot work.
 *   - Fast People Search works for anyone (name + city/state), so it is always
 *     shown.
 *
 * Used by every contact-research surface (project Contact Review, Stewardship
 * Research Needed, People We Can't Call). It never reads or writes the customer
 * record — the worker reads the result and types what they find into the
 * Customer Contact card.
 */

import { GatewaySearchSource } from './GatewaySearchSource'
import { FastPeopleSearchSource } from './FastPeopleSearchSource'

export function ContactSearch({
  lastName,
  firstName,
  fallbackName,
  policyNumbers,
  city,
  state,
}: {
  lastName: string | null
  firstName?: string | null
  fallbackName?: string
  /** Every distinct Allstate policy number on file, de-duplicated. When empty,
   * the Gateway source is omitted (no Allstate record to search). */
  policyNumbers: readonly string[]
  city?: string | null
  state?: string | null
}) {
  const hasPolicy = (policyNumbers ?? []).some((p) => (p ?? '').trim().length > 0)

  return (
    <div className="space-y-2.5">
      {/* Gateway only when there is an Allstate policy number to search with. */}
      {hasPolicy && (
        <GatewaySearchSource
          lastName={lastName}
          fallbackName={fallbackName}
          policyNumbers={policyNumbers}
        />
      )}
      {/* Fast People Search works for anyone. */}
      <FastPeopleSearchSource
        firstName={firstName}
        lastName={lastName}
        fallbackName={fallbackName}
        city={city}
        state={state}
      />
    </div>
  )
}
