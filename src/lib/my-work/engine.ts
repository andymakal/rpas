/**
 * MY WORK priority engine (Right Path) — server-only.
 *
 * Ported from the IPF GoRules ZEN decision pattern (daily-direction-engine.ts).
 * It loads the MY WORK ZEN model and classifies each activity group into a
 * priority band. Division of labor is identical to Daily Direction:
 *   - GoRules ZEN owns ALL priority judgment (the band ordering in
 *     my-work-priority.json), never TypeScript if/else.
 *   - TypeScript (this module) owns ONLY normalization: turning assembled
 *     candidate activities into the plain presence facts ZEN classifies, and
 *     turning ZEN's reasonCode into a short deterministic human reason.
 *
 * This is NOT a second prioritization system: it is the SAME ZEN decision layer
 * the Daily Direction Assistant uses, extended to the capability/claim/focus
 * facts the IPF overlay adds. The Stewardship Daily Direction Assistant is
 * unchanged; this decides the cross-activity MY WORK ordering.
 */

import { ZenEngine } from '@gorules/zen-engine'
import myWorkModel from '@/rules/my-work-priority.json'
import type {
  ActivityFacts,
  ActivityBandVerdict,
  PriorityBand,
} from './types'

export type {
  WorkSource,
  PriorityBand,
  ActivityFacts,
  ActivityBandVerdict,
  ActivityGroup,
  MyWorkState,
  FocusNote,
} from './types'

let engine: ZenEngine | null = null

function getEngine(): ZenEngine {
  if (!engine) {
    engine = new ZenEngine({
      loader: {
        type: 'static',
        content: { 'my-work-priority.json': myWorkModel },
      },
    })
  }
  return engine
}

/**
 * Evaluate the priority band for ONE activity group's presence facts against the
 * real ZEN engine. Exposed so tests can exercise the decision-table rows.
 */
export async function evaluateActivityBand(
  facts: ActivityFacts,
): Promise<ActivityBandVerdict> {
  const zen = getEngine()
  const response = await zen.evaluate('my-work-priority.json', facts)
  return {
    band: response.result.band as PriorityBand,
    rank: Number(response.result.rank),
    reasonCode: response.result.reasonCode as string,
  }
}

/**
 * Turn the ZEN-owned reasonCode plus concrete counts into a short deterministic
 * human reason. ZEN decides the band; this states why, without re-ranking.
 */
export function buildActivityReason(
  reasonCode: string,
  ctx: { dueCount: number; ownedCount: number; sharedCount: number; label: string },
): string {
  switch (reasonCode) {
    case 'due_customer_commitment': {
      const n = ctx.dueCount
      return `${n} ${n === 1 ? 'customer commitment has' : 'customer commitments have'} come due. A promised callback outranks focus-based ordering.`
    }
    case 'focus_elevated':
      return `Management has elevated ${ctx.label} in Today's Focus, and you are eligible to work it.`
    case 'owned_work': {
      const n = ctx.ownedCount
      return `You have claimed ${n} ${n === 1 ? 'item' : 'items'} here. Owned work comes before unclaimed shared work.`
    }
    case 'eligible_shared_work': {
      const n = ctx.sharedCount
      return `${n} ${n === 1 ? 'item is' : 'items are'} unclaimed and shared. You are eligible to pick any of them up.`
    }
    case 'not_eligible':
      return `You are not currently eligible to work ${ctx.label}. It is shown for awareness; it is not routed to you.`
    default:
      return `${ctx.label} work.`
  }
}
