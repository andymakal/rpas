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
 *     item, due on or before today on the server's local calendar day) is a
 *     due-callback PRIORITY, never an exact-time commitment. Right Path records
 *     no clock time for it, so none is invented or displayed.
 *   - No employee capabilities / ownership and no producer appointments are
 *     modeled: Right Path does not record them yet, so they are not invented.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { QUEUE_META, OUTREACH_QUEUES, deriveFollowUpRouting, type OutreachQueue } from '@/lib/stewardship/queues'
import { decideDailyDirection } from './engine'
import type { DailyDirectionState, QueueCandidate, DueCallback } from './types'

/** The Stewardship board route. The board is client-navigated, so the Assistant
 * links to the board surface itself; a `queue` hint is carried for future
 * deep-linking without changing the existing board behavior. */
const STEWARDSHIP_ROUTE = '/stewardship'

function routeForQueue(queue: OutreachQueue): string {
  return `${STEWARDSHIP_ROUTE}?queue=${encodeURIComponent(queue)}`
}

/** Today's date on the server's local calendar, as YYYY-MM-DD, for comparing
 * against the date-only callback_date. Date-only in, date-only out. */
function todayDateString(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

type BoardRow = {
  id: string
  queue: OutreachQueue
  call_reason: string | null
  callback_date: string | null
  follow_up_due: string | null
  customer_prereviews: {
    decision: string | null
    customers: { id: string; first_name: string; last_name: string }
  }
}

export interface DailyDirectionOptions {
  /** Evaluation instant. Injected for testability; defaults to now. */
  now?: Date
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
  const supabase = createAdminClient()

  // Deterministic follow-up routing, same as the board read: promote overdue
  // waiting-for-response items to Ready to Call (no-response) and persist the
  // move, so the Assistant sees the same board the operator will.
  const { data: waiting } = await supabase
    .from('stewardship_outreach')
    .select('id, follow_up_due')
    .eq('queue', 'waiting-for-response')
    .not('follow_up_due', 'is', null)
    .lte('follow_up_due', now.toISOString())
  for (const w of (waiting ?? []) as { id: string; follow_up_due: string | null }[]) {
    const patch = deriveFollowUpRouting(
      { queue: 'waiting-for-response', follow_up_due: w.follow_up_due },
      now,
    )
    if (patch) {
      await supabase.from('stewardship_outreach').update(patch).eq('id', w.id)
    }
  }

  const { data, error } = await supabase
    .from('stewardship_outreach')
    .select(`
      id, queue, call_reason, callback_date, follow_up_due,
      customer_prereviews!inner (
        decision,
        customers!inner ( id, first_name, last_name )
      )
    `)
    .order('updated_at', { ascending: true })

  if (error) {
    throw new Error(`Daily Direction board read failed: ${error.message}`)
  }

  // Only OPEN items (undecided pre-review) are stewardship work, exactly as the
  // board route filters.
  const rows = ((data ?? []) as unknown as BoardRow[]).filter(
    (r) => r.customer_prereviews?.decision == null,
  )

  // Per-queue counts across all open items.
  const counts = Object.fromEntries(
    OUTREACH_QUEUES.map((q) => [q, 0]),
  ) as Record<OutreachQueue, number>
  for (const r of rows) counts[r.queue] += 1

  const queues: QueueCandidate[] = OUTREACH_QUEUES.filter((q) => counts[q] > 0).map((q) => ({
    queue: q,
    label: QUEUE_META[q].label,
    count: counts[q],
    kind: QUEUE_META[q].kind,
    route: routeForQueue(q),
  }))

  // Due callbacks: an open ready-to-call item with a date-only callback_date on
  // or before today. Surfaced as a priority, never an exact-time commitment.
  const today = todayDateString(now)
  const dueCallbacks: DueCallback[] = rows
    .filter(
      (r) =>
        r.queue === 'ready-to-call' &&
        r.callback_date != null &&
        r.callback_date <= today,
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
