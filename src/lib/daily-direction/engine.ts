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

/** Find a queue candidate by key, or null when it has no open work. */
function queueByKey(queues: QueueCandidate[], key: OutreachQueue): QueueCandidate | null {
  return queues.find((q) => q.queue === key && q.count > 0) ?? null
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
    recommendedLabel: string | null
    recommendedCount: number
    waitingCount: number
  },
): string {
  switch (reasonCode) {
    case 'callback_due': {
      if (ctx.dueCallbackCount === 1) {
        const who = ctx.firstDueCallbackName ?? 'a customer'
        return `You promised ${who} a callback that is now due. A kept commitment that has come due is the action work to pick up first.`
      }
      return `${ctx.dueCallbackCount} customers are due the callback you promised. A promised callback that has come due is the action work to pick up first.`
    }
    case 'outreach_work': {
      // ZEN decided ordinary outreach is the next action. The reason states the
      // recommended queue and its count without ranking calls against emails.
      const label = ctx.recommendedLabel ?? 'Outreach'
      const n = ctx.recommendedCount
      return `${n} ${n === 1 ? 'customer is' : 'customers are'} in ${label}. That is the next outreach work to pick up.`
    }
    case 'research_needed_work': {
      const n = ctx.recommendedCount
      return `No ordinary outreach is waiting. ${n} ${n === 1 ? 'item needs' : 'items need'} contact research (the exception path) before outreach can continue.`
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
  const readyToCall = queueByKey(candidates.queues, 'ready-to-call')
  const readyToEmail = queueByKey(candidates.queues, 'ready-to-email')
  const researchNeeded = queueByKey(candidates.queues, 'research-needed')
  const waitingQueues = candidates.queues.filter((q) => q.kind === 'waiting' && q.count > 0)
  const waitingCount = waitingQueues.reduce((sum, q) => sum + q.count, 0)

  // Independent presence facts: the composition reports WHAT work exists; ZEN
  // alone decides which comes first. No TypeScript ordering here.
  const facts: NextBestActionFacts = {
    hasCallbackDue: candidates.dueCallbacks.length > 0,
    hasReadyToCall: readyToCall != null,
    hasReadyToEmail: readyToEmail != null,
    hasResearchNeeded: researchNeeded != null,
    hasWaitingWork: waitingQueues.length > 0,
  }

  const verdict = await evaluateNextBestAction(facts)

  // Resolve the route + count + label for whatever ZEN chose. This is a pure
  // lookup of the already-decided verdict, not a second priority decision.
  let route: string | null = null
  let actionCount = 0
  let recommendedLabel: string | null = null
  switch (verdict.nextActionKind) {
    case 'callback_due':
      // Date-only due callbacks open the Ready to Call queue (where they live).
      route = candidates.dueCallbacks[0]?.route ?? readyToCall?.route ?? null
      actionCount = candidates.dueCallbacks.length
      recommendedLabel = QUEUE_META['ready-to-call'].label
      break
    case 'ready_to_call':
      route = readyToCall?.route ?? null
      actionCount = readyToCall?.count ?? 0
      recommendedLabel = readyToCall?.label ?? null
      break
    case 'ready_to_email':
      route = readyToEmail?.route ?? null
      actionCount = readyToEmail?.count ?? 0
      recommendedLabel = readyToEmail?.label ?? null
      break
    case 'research_needed':
      route = researchNeeded?.route ?? null
      actionCount = researchNeeded?.count ?? 0
      recommendedLabel = researchNeeded?.label ?? null
      break
    case 'waiting':
      route = waitingQueues[0]?.route ?? null
      actionCount = waitingCount
      recommendedLabel = waitingQueues[0]?.label ?? null
      break
    case 'none':
      route = null
      actionCount = 0
      break
  }

  const reason = buildReason(verdict.reasonCode, {
    dueCallbackCount: candidates.dueCallbacks.length,
    firstDueCallbackName: candidates.dueCallbacks[0]?.personName ?? null,
    recommendedLabel,
    recommendedCount: actionCount,
    waitingCount,
  })

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
