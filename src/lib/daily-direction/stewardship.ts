/**
 * Composition: Daily Direction from the shared Stewardship board (Right Path).
 *
 * Ported from the IPF composition pattern (src/composition/daily-direction.ts):
 * assemble the Daily Direction candidates from EXISTING repository reads only,
 * then hand them to the ZEN-backed engine. This is the only place a Supabase
 * client is created for Daily Direction.
 *
 * Right Path specifics (preserve settled decisions):
 *   - Single tenant: no practice_id. The admin (service-role) client is used,
 *     exactly as the existing /api/stewardship board read does, and the caller
 *     is already an internal admin (requireInternalAdmin at the surface).
 *   - Candidates come ONLY from the shared Stewardship outreach board
 *     (stewardship_outreach joined to open customer_prereviews -> customers),
 *     the SAME read the board route uses. No new table, column, or workflow
 *     state is introduced; existing Stewardship transitions are untouched.
 *   - A date-only promised callback (callback_date on an open ready-to-call
 *     item, due on or before today ON THE ACTOR'S CALENDAR) is DUE WORK, never
 *     an exact-time commitment and never a fixed-time interruption that
 *     automatically outranks everything. Right Path records no clock time for
 *     it, so none is invented or displayed. "Today" is the signed-in employee's
 *     own day (Andy Eastern, Bob/Angie Central), via the shared time module —
 *     never the server's clock and never a single hardcoded business zone.
 *   - READ-ONLY: evaluation never writes. It applies the board's follow-up
 *     routing rule in memory for counting but persists nothing; the board route
 *     remains the sole writer of that transition.
 *   - No employee capabilities / ownership and no producer appointments are
 *     modeled: Right Path does not record them yet, so they are not invented.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { QUEUE_META, OUTREACH_QUEUES, deriveFollowUpRouting, deriveEmailRouting, type OutreachQueue, type CallReason, type ResearchReason, type CallOutcome } from '@/lib/stewardship/queues'
import { readResearchedUnsuccessfullyBatch, stillNeedsResearchRecommendation } from '@/lib/stewardship/research-record'
import { createTimeContext } from '@/lib/time'
import { decideDailyDirection } from './engine'
import { isCallbackDue } from './business-calendar'
import type { DailyDirectionState, QueueCandidate, DueCallback } from './types'

/** The Stewardship board route. The board opens the matching queue list when it
 * receives a `queue` param, so the Assistant links straight into that queue. */
const STEWARDSHIP_ROUTE = '/stewardship'

function routeForQueue(queue: OutreachQueue): string {
  return `${STEWARDSHIP_ROUTE}?queue=${encodeURIComponent(queue)}`
}

type BoardRow = {
  id: string
  queue: OutreachQueue
  call_reason: string | null
  research_reason: string | null
  last_call_outcome: string | null
  email_sent_at: string | null
  callback_date: string | null
  follow_up_due: string | null
  refused_at: string | null
  customer_prereviews: {
    decision: string | null
    customers: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }
  }
}

export interface DailyDirectionOptions {
  /** Evaluation instant. Injected for testability; defaults to now. */
  now?: Date
  /**
   * The signed-in employee's detected IANA timezone (from the actor-timezone
   * cookie). Drives the actor-calendar "today" for date-only callback due work,
   * so each employee sees their own day. Null/absent falls back to the time
   * module's documented last resort (never a hardcoded business zone).
   */
  actorTimeZone?: string | null
}

/**
 * Assemble and decide the shared Daily Direction state from the live Stewardship
 * board. Mirrors the /api/stewardship board read (including the deterministic
 * follow-up promotion of overdue waiting-for-response items) so the Assistant
 * and the board can never disagree about what is actionable.
 */
export async function getDailyDirection(
  options: DailyDirectionOptions = {},
): Promise<DailyDirectionState> {
  const now = options.now ?? new Date()
  // The actor clock drives the date-only "due today" judgment. Built once here
  // and reused for every due test so a single employee's whole board is judged
  // on one consistent clock.
  const timeCtx = createTimeContext({ now, actorTimeZone: options.actorTimeZone })
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('stewardship_outreach')
    .select(`
      id, queue, call_reason, research_reason, last_call_outcome, email_sent_at, callback_date, follow_up_due, refused_at,
      customer_prereviews!inner (
        decision,
        customers!inner ( id, first_name, last_name, email, phone )
      )
    `)
    .order('updated_at', { ascending: true })

  if (error) {
    throw new Error(`Daily Direction board read failed: ${error.message}`)
  }

  // Only OPEN items (undecided pre-review) are stewardship work, exactly as the
  // board route filters.
  // Open items only, and never a refused one (an explicit refusal stops outreach
  // until a deliberate reopen), matching the board's suppression.
  const rows = ((data ?? []) as unknown as BoardRow[]).filter(
    (r) => r.customer_prereviews?.decision == null && r.refused_at == null,
  )

  // READ-ONLY follow-up routing. The board route persists the promotion of
  // overdue waiting-for-response items to Ready to Call; Daily Direction only
  // EVALUATES, so it applies the SAME deterministic rule (deriveFollowUpRouting)
  // in memory to decide which queue each row counts in, and writes nothing. The
  // operator opening the board is what durably moves the row. Computing the
  // effective queue here keeps the Assistant consistent with the board the
  // operator will see, without duplicating the board's write.
  const effectiveQueue = (r: BoardRow): OutreachQueue => {
    const followUp = deriveFollowUpRouting(
      { queue: r.queue, follow_up_due: r.follow_up_due },
      now,
    )?.queue as OutreachQueue | undefined
    if (followUp) return followUp
    // An untouched opening item whose email became usable after intake is
    // ready-to-email now (same live re-derivation the board and My Work use), so
    // the Assistant counts it as emailable instead of a call/research opener.
    const emailRouted = deriveEmailRouting({
      queue: r.queue,
      call_reason: r.call_reason as CallReason | null,
      research_reason: r.research_reason as ResearchReason | null,
      last_call_outcome: r.last_call_outcome as CallOutcome | null,
      email_sent_at: r.email_sent_at,
      callback_date: r.callback_date,
      refused_at: r.refused_at,
      has_usable_email: !!r.customer_prereviews.customers?.email?.trim(),
    })?.queue as OutreachQueue | undefined
    return emailRouted ?? r.queue
  }

  // Research-recommendation dampening. A research-needed item whose every
  // still-missing contact method has already been researched unsuccessfully is
  // no longer a research recommendation: the look-up has been done and nothing
  // was found, so the Assistant must stop surfacing it as research to do. The
  // item is NOT closed and still exists on the board for a deliberate re-check;
  // this only removes it from the recommended research count. A newly-added
  // email or phone makes that method present (no longer missing), which flips
  // the customer back to still-needing a recommendation on its own.
  const researchNeededRows = rows.filter((r) => effectiveQueue(r) === 'research-needed')
  const researchedByCustomer = await readResearchedUnsuccessfullyBatch(
    supabase,
    researchNeededRows.map((r) => r.customer_prereviews.customers.id),
  )
  const stillRecommendsResearch = (r: BoardRow): boolean => {
    const c = r.customer_prereviews.customers
    const researched = researchedByCustomer.get(c.id) ?? { email: false, phone: false }
    return stillNeedsResearchRecommendation(
      { hasEmail: !!c.email?.trim(), hasPhone: !!c.phone?.trim() },
      researched,
    )
  }

  // Per-queue counts across all open items, by effective (read-only) queue. A
  // research-needed item that is settled by research is excluded from the
  // research count (see above); every other queue is unaffected.
  const counts = Object.fromEntries(
    OUTREACH_QUEUES.map((q) => [q, 0]),
  ) as Record<OutreachQueue, number>
  for (const r of rows) {
    const q = effectiveQueue(r)
    if (q === 'research-needed' && !stillRecommendsResearch(r)) continue
    counts[q] += 1
  }

  const queues: QueueCandidate[] = OUTREACH_QUEUES.filter((q) => counts[q] > 0).map((q) => ({
    queue: q,
    label: QUEUE_META[q].label,
    count: counts[q],
    kind: QUEUE_META[q].kind,
    route: routeForQueue(q),
  }))

  // Due callbacks: an open ready-to-call item with a date-only callback_date on
  // or before today ON THE BUSINESS CALENDAR. This is date-only due work, never
  // an exact-time commitment: no clock time is read, invented, or displayed.
  const dueCallbacks: DueCallback[] = rows
    .filter(
      (r) =>
        effectiveQueue(r) === 'ready-to-call' &&
        isCallbackDue(r.callback_date, timeCtx),
    )
    .map((r) => {
      const c = r.customer_prereviews.customers
      return {
        id: r.id,
        personName: `${c.first_name} ${c.last_name}`.trim() || 'Customer',
        callbackDate: r.callback_date as string,
        route: routeForQueue('ready-to-call'),
      }
    })
    // Oldest promised callback first.
    .sort((a, b) => a.callbackDate.localeCompare(b.callbackDate))

  return decideDailyDirection({ dueCallbacks, queues })
}
