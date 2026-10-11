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
    outreachCount: number
    dueCallbackCount: number
    researchCount: number
    waitingCount: number
  },
): string {
  switch (reasonCode) {
    case 'outreach_work': {
      // State the available outreach as a plain count. No editorializing about
      // which channel comes first (ZEN ranks none above the others), and no
      // invented narrative. A due promised callback is noted as due work.
      const n = ctx.outreachCount
      const base = `${n} ${n === 1 ? 'customer is' : 'customers are'} ready for outreach.`
      if (ctx.dueCallbackCount > 0) {
        const c = ctx.dueCallbackCount
        return `${base} ${c} ${c === 1 ? 'is a promised callback' : 'are promised callbacks'} that ${c === 1 ? 'has' : 'have'} come due.`
      }
      return base
    }
    case 'research_needed_work': {
      const n = ctx.researchCount
      return `${n} ${n === 1 ? 'customer needs' : 'customers need'} contact research before outreach can continue.`
    }
    case 'all_waiting': {
      const n = ctx.waitingCount
      return `${n} ${n === 1 ? 'item is' : 'items are'} waiting on a customer or carrier reply.`
    }
    case 'open_capacity':
      return 'The Stewardship board is clear. You have open capacity.'
    default:
      return 'You have open capacity.'
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
  const hasDueCallback = candidates.dueCallbacks.length > 0

  // The equally-eligible outreach destinations. A due callback is ordinary
  // outreach that happens to be due; it lives in Ready to Call, so the presence
  // of either ready-to-call work or a due callback means the call queue is an
  // option. None of these is ranked above the others.
  const outreachOptions: AvailableWorkItem[] = []
  const callQueueRoute = readyToCall?.route ?? candidates.dueCallbacks[0]?.route ?? null
  if ((readyToCall || hasDueCallback) && callQueueRoute) {
    // Count: open ready-to-call items (due callbacks are a subset of the call
    // queue, already included in that count; they are highlighted separately).
    const callCount = readyToCall?.count ?? 0
    outreachOptions.push({
      queue: 'ready-to-call',
      label: QUEUE_META['ready-to-call'].label,
      count: callCount,
      kind: 'action',
      route: callQueueRoute,
    })
  }
  if (readyToEmail) {
    outreachOptions.push({
      queue: 'ready-to-email',
      label: readyToEmail.label,
      count: readyToEmail.count,
      kind: 'action',
      route: readyToEmail.route,
    })
  }
  const hasOutreachWork = outreachOptions.length > 0

  // Independent presence facts: the composition reports WHAT work exists; ZEN
  // alone decides which comes first. Ready-to-call, ready-to-email, and due
  // callbacks are collapsed into one outreach fact precisely because Right Path
  // ranks none of them above the others.
  const facts: NextBestActionFacts = {
    hasOutreachWork,
    hasResearchNeeded: researchNeeded != null,
    hasWaitingWork: waitingQueues.length > 0,
  }

  const verdict = await evaluateNextBestAction(facts)

  // Resolve a SINGLE-destination route only for verdicts that genuinely have
  // one. 'outreach' has several equally eligible destinations (outreachOptions),
  // so it deliberately exposes NO single route; the UI shows the options.
  let route: string | null = null
  let actionCount = 0
  switch (verdict.nextActionKind) {
    case 'outreach':
      route = null
      actionCount = 0
      break
    case 'research_needed':
      route = researchNeeded?.route ?? null
      actionCount = researchNeeded?.count ?? 0
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

  const outreachCount = outreachOptions.reduce((sum, o) => sum + o.count, 0)
  const reason = buildReason(verdict.reasonCode, {
    outreachCount,
    dueCallbackCount: candidates.dueCallbacks.length,
    researchCount: researchNeeded?.count ?? 0,
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
    outreachOptions: verdict.nextActionKind === 'outreach' ? outreachOptions : [],
    dueCallbacks: candidates.dueCallbacks,
    availableWork,
    quiet: verdict.nextActionKind === 'none',
  }
}

/** The display label for a Stewardship queue, from the shared queue meta. */
export function queueLabel(queue: OutreachQueue): string {
  return QUEUE_META[queue].label
}
