/**
 * Daily Direction / Next Best Action Decision Engine (Right Path).
 *
 * Server-only module. Ported from IPF (bobpfromm/ipf-stewardship)
 * src/lib/daily-direction-engine.ts, the established GoRules ZEN decision layer.
 * It loads the Next Best Action ZEN model and uses it to decide the single Next
 * Best Action from the Right Path Stewardship board.
 *
 * Division of labor (same boundary as IPF):
 *   - GoRules ZEN owns ALL priority judgment: the ordering between a due
 *     callback, ready-to-call, ready-to-email, research-needed, other action
 *     work, waiting work, and open capacity. That ordering is the ordered
 *     decision-table rows in next-best-action.json, never TypeScript if/else.
 *   - TypeScript (this module) owns ONLY normalization: turning the assembled
 *     candidate work into the plain facts ZEN classifies, and turning ZEN's
 *     reasonCode + the concrete facts into a short deterministic human reason.
 *
 * This is NOT a temporary recommendation engine: ZEN is the decision layer. As
 * Right Path records more work (other queues, capabilities, appointments), add
 * inputs/rows to the ZEN model and candidates here; the shape stays the same.
 */

import { ZenEngine } from '@gorules/zen-engine'
import nextBestActionModel from '@/rules/next-best-action.json'
import { QUEUE_META, type OutreachQueue } from '@/lib/stewardship/queues'
import type {
  DailyDirectionCandidates,
  DailyDirectionState,
  QueueCandidate,
  AvailableWorkItem,
  NextActionKind,
  NextBestActionFacts,
  NextBestActionVerdict,
} from './types'

// Re-export the shared, serializable TYPES so every consumer importing from
// '@/lib/daily-direction/engine' keeps compiling; the ZEN runtime and all
// business logic stay owned by this server-only module.
export type {
  QueueCandidate,
  DueCallback,
  DailyDirectionCandidates,
  DailyDirectionState,
  AvailableWorkItem,
  NextActionKind,
  NextBestActionFacts,
  NextBestActionVerdict,
} from './types'

// ---------------------------------------------------------------------------
// Engine singleton (static loader, same pattern as IPF)
// ---------------------------------------------------------------------------

let engine: ZenEngine | null = null

function getEngine(): ZenEngine {
  if (!engine) {
    engine = new ZenEngine({
      loader: {
        type: 'static',
        content: {
          'next-best-action.json': nextBestActionModel,
        },
      },
    })
  }
  return engine
}

// ---------------------------------------------------------------------------
// ZEN evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the Next Best Action decision against the real ZEN engine. Exposed so
 * tests can exercise the decision-table rows directly.
 */
export async function evaluateNextBestAction(
  facts: NextBestActionFacts,
): Promise<NextBestActionVerdict> {
  const zen = getEngine()
  const response = await zen.evaluate('next-best-action.json', facts)
  return {
    nextActionKind: response.result.nextActionKind as NextActionKind,
    reasonCode: response.result.reasonCode as string,
  }
}

// ---------------------------------------------------------------------------
// Normalization (TypeScript, no IO)
// ---------------------------------------------------------------------------

/**
 * The priority order among ACTION queues used ONLY to name the single top
 * action queue as one `topActionQueue` fact. This is candidate SELECTION, not
 * the priority DECISION: ZEN rows r2-r5 own the actual ordering and decide the
 * nextActionKind + reasonCode from the named queue. This list deliberately
 * mirrors that ordering and must not diverge from it. Waiting queues are never
 * named here as a top action queue.
 */
const ACTION_QUEUE_PRECEDENCE: OutreachQueue[] = [
  'ready-to-call',
  'ready-to-email',
  'research-needed',
]

function pickTopActionQueue(queues: QueueCandidate[]): QueueCandidate | null {
  const action = queues.filter((q) => q.kind === 'action' && q.count > 0)
  for (const key of ACTION_QUEUE_PRECEDENCE) {
    const match = action.find((q) => q.queue === key)
    if (match) return match
  }
  return action[0] ?? null
}

// ---------------------------------------------------------------------------
// Reason prose (deterministic, mapped from the ZEN reasonCode + facts)
// ---------------------------------------------------------------------------

/**
 * Turn the ZEN-owned reasonCode plus the concrete facts into a short
 * deterministic human-readable reason. ZEN decides; this states the reason.
 * Always returns a non-empty string.
 */
export function buildReason(
  reasonCode: string,
  ctx: {
    dueCallbackCount: number
    firstDueCallbackName: string | null
    topActionQueueLabel: string | null
    topActionQueueCount: number
    waitingCount: number
  },
): string {
  switch (reasonCode) {
    case 'callback_due_today': {
      if (ctx.dueCallbackCount === 1) {
        const who = ctx.firstDueCallbackName ?? 'a customer'
        return `You promised ${who} a callback that is due. A kept commitment comes before ordinary queue work.`
      }
      return `${ctx.dueCallbackCount} customers are due the callback you promised. Kept commitments come before ordinary queue work.`
    }
    case 'ready_to_call_work': {
      const n = ctx.topActionQueueCount
      return `${n} ${n === 1 ? 'customer is' : 'customers are'} ready to call. A reached call moves a customer forward fastest, so that is where your attention is most useful.`
    }
    case 'ready_to_email_work': {
      const n = ctx.topActionQueueCount
      return `${n} ${n === 1 ? 'customer is' : 'customers are'} ready for the initial servicing-agent email. That is the next useful work.`
    }
    case 'research_needed_work': {
      const n = ctx.topActionQueueCount
      return `No call or email work is waiting. ${n} ${n === 1 ? 'item needs' : 'items need'} contact research before outreach can continue.`
    }
    case 'action_work': {
      const label = ctx.topActionQueueLabel ?? 'Action work'
      return `${label} is the next action work that needs attention.`
    }
    case 'all_waiting': {
      const n = ctx.waitingCount
      return `Nothing to push right now. ${n} ${n === 1 ? 'item is' : 'items are'} waiting on customers or carriers; they resurface when a reply, form, or carrier confirmation is due.`
    }
    case 'open_capacity':
      return 'Nothing needs your attention on the Stewardship board right now, so you have open capacity.'
    default:
      return 'No specific direction; you have open capacity.'
  }
}

// ---------------------------------------------------------------------------
// Full decision (normalize -> ZEN -> shared state)
// ---------------------------------------------------------------------------

/**
 * Decide the single Daily Direction / Next Best Action state from the assembled
 * candidate work. Pure: no IO. The composition layer supplies candidates from
 * existing Stewardship reads.
 */
export async function decideDailyDirection(
  candidates: DailyDirectionCandidates,
): Promise<DailyDirectionState> {
  const topAction = pickTopActionQueue(candidates.queues)
  const waitingQueues = candidates.queues.filter((q) => q.kind === 'waiting' && q.count > 0)
  const hasActionWork = topAction != null
  const hasWaitingWork = waitingQueues.length > 0
  const hasCallbackDue = candidates.dueCallbacks.length > 0

  const facts: NextBestActionFacts = {
    hasCallbackDue,
    hasActionWork,
    topActionQueue: topAction?.queue ?? 'none',
    hasWaitingWork,
  }

  const verdict = await evaluateNextBestAction(facts)

  const waitingCount = waitingQueues.reduce((sum, q) => sum + q.count, 0)
  const reason = buildReason(verdict.reasonCode, {
    dueCallbackCount: candidates.dueCallbacks.length,
    firstDueCallbackName: candidates.dueCallbacks[0]?.personName ?? null,
    topActionQueueLabel: topAction?.label ?? null,
    topActionQueueCount: topAction?.count ?? 0,
    waitingCount,
  })

  // Resolve the route + action count for the recommended next action.
  let route: string | null = null
  let actionCount = 0
  switch (verdict.nextActionKind) {
    case 'callback_due':
      route = candidates.dueCallbacks[0]?.route ?? null
      actionCount = candidates.dueCallbacks.length
      break
    case 'ready_to_call':
    case 'ready_to_email':
    case 'research_needed':
    case 'action':
      route = topAction?.route ?? null
      actionCount = topAction?.count ?? 0
      break
    case 'waiting':
      route = waitingQueues[0]?.route ?? null
      actionCount = waitingCount
      break
    case 'none':
      route = null
      actionCount = 0
      break
  }

  const availableWork: AvailableWorkItem[] = candidates.queues
    .filter((q) => q.count > 0)
    .map((q) => ({
      queue: q.queue,
      label: q.label,
      count: q.count,
      kind: q.kind,
      route: q.route,
    }))

  return {
    nextActionKind: verdict.nextActionKind,
    reasonCode: verdict.reasonCode,
    reason,
    route,
    actionCount,
    dueCallbacks: candidates.dueCallbacks,
    availableWork,
    quiet: verdict.nextActionKind === 'none',
  }
}

/** The display label for a Stewardship queue, from the shared queue meta. */
export function queueLabel(queue: OutreachQueue): string {
  return QUEUE_META[queue].label
}
