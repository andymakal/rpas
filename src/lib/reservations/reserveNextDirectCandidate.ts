'use client'

/**
 * reserveNextDirectCandidate — the direct-working "pick the next customer"
 * primitive shared by the continuous outreach screens (Send Introductory
 * Emails and the guided calling workbench).
 *
 * WHY THIS EXISTS
 *
 * The direct-working screens land straight on one customer and advance by
 * reserving the next available stewardship_outreach row (the reservation
 * subject is that row id). That works for RECORDED outreach, but a newly
 * populated project surfaces its members as DERIVED (virtual) onboarding items
 * that have no outreach row yet (id === null). The board's intermediate queue
 * list already handles those: it materializes the durable record on an
 * operator's first action (POST /api/stewardship/ensure-one) and then works the
 * real id. The direct screens had no such seam, so record-less customers could
 * not be reserved or opened and silently fell through to the queue list.
 *
 * This helper lifts that exact create-on-first-action seam into the direct
 * flow, unchanged in meaning: walk the ordered candidate list; for a virtual
 * candidate, materialize it (idempotently) into its real outreach id the moment
 * it is about to be worked; then reserve the FIRST candidate that is actually
 * free, resolving virtual candidates to real ids as it goes. A candidate that
 * cannot be materialized (no known policy, test record) is skipped, exactly as
 * the board would skip it. Materialization fires only when a candidate is about
 * to be reserved — never for the whole list up front — so it stays a
 * first-action write, not a read-time one.
 *
 * It layers on top of the existing reservation hook (reserveNext) and changes
 * no reservation, claim, or history behavior: a recorded candidate takes the
 * same path it always did.
 */

/** One direct-working candidate. A recorded item carries its real outreach
 * `id`; a derived (record-less) onboarding item carries `virtual: true` with a
 * null `id` and the `customer_id` to materialize on first action. */
export interface DirectCandidate {
  id: string | null
  virtual?: boolean
  customer_id?: string | null
}

/**
 * Materialize a derived onboarding customer into their durable outreach row and
 * return its id. Idempotent on the server: an existing open row's id is
 * returned unchanged, so this never duplicates a record or disturbs history.
 * Returns null when the customer cannot be started (no known policy, test
 * record) or on a transport error — the caller then skips this candidate.
 */
async function materialize(customerId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/stewardship/ensure-one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: customerId }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    return (json?.data?.outreach_id as string | null) ?? null
  } catch {
    return null
  }
}

/** The resolved next customer: the reserved real outreach id, or null when no
 * candidate could be reserved (empty, all held by teammates, or none could be
 * materialized). */
export type DirectReserveResult = string | null

/**
 * Reserve the next workable customer from an ordered candidate list, resolving
 * record-less (virtual) candidates to real outreach ids on demand.
 *
 * Walks the candidates in order. A recorded candidate is reserved directly via
 * `reserveNext` (its existing behavior, including atomically skipping any a
 * teammate holds). A virtual candidate is first materialized into its real
 * outreach id (create-on-first-action), then that id is offered to
 * `reserveNext`; a virtual candidate that cannot be materialized is skipped.
 *
 * To preserve the atomic "skip anything a teammate is live on" guarantee while
 * still materializing lazily, the resolution runs one candidate at a time:
 * each still-virtual candidate is resolved to a real id just before it is
 * offered, and the already-real ids ahead of it are offered together so a free
 * recorded customer is taken without a needless write. The first id
 * `reserveNext` returns is the reserved customer.
 *
 * @param candidates ordered, still-to-do candidates (the activity's own scope).
 * @param reserveNext the reservation hook's reserveNext (atomic, teammate-aware).
 * @returns the reserved real outreach id, or null when none could be reserved.
 */
export async function reserveNextDirectCandidate(
  candidates: DirectCandidate[],
  reserveNext: (candidateIds: string[]) => Promise<string | null>,
): Promise<DirectReserveResult> {
  // Fast path: when nothing is virtual, this is exactly the original call —
  // offer every real id and let the hook reserve the first free one.
  if (!candidates.some(c => c.virtual)) {
    return reserveNext(
      candidates.map(c => c.id).filter((id): id is string => !!id),
    )
  }

  // Mixed list: resolve lazily in order. Accumulate the real ids seen so far and,
  // each time a virtual candidate is reached, materialize it and offer the batch
  // (leading real ids + this newly real id) to reserveNext. The hook reserves the
  // first free one atomically, so a free recorded customer ahead of the virtual
  // one is still taken without creating a record, and teammate-held items are
  // still skipped. Only candidates actually reached get materialized.
  const leadingReal: string[] = []
  for (const c of candidates) {
    if (!c.virtual) {
      if (c.id) leadingReal.push(c.id)
      continue
    }
    if (!c.customer_id) continue // malformed virtual item — skip
    const realId = await materialize(c.customer_id)
    if (!realId) continue // cannot start (no policy / test record) — skip
    const reserved = await reserveNext([...leadingReal, realId])
    if (reserved) return reserved
    // Nothing in this batch was free (every leading real id and the just-created
    // one are held by teammates). The materialized row is real now, so fold it
    // into the leading set and keep walking.
    leadingReal.push(realId)
  }

  // After the last candidate, any trailing real ids not yet offered (a tail of
  // recorded items after the final virtual one) still need a chance. Offer the
  // full accumulated real set once more; returns the first free one or null.
  if (leadingReal.length > 0) return reserveNext(leadingReal)
  return null
}
