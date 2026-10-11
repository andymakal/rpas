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
import { capabilityStatusExplanation } from '@/lib/capabilities/explanations'
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
  ctx: {
    dueCount: number
    ownedCount: number
    /** Unclaimed items the employee is eligible to pick up. */
    availableCount: number
    /** Eligible items already claimed by another employee. */
    claimedByOthersCount: number
    label: string
  },
): string {
  // A short note about work others already hold, appended where it clarifies
  // that not every eligible item is free to pick up.
  const othersNote =
    ctx.claimedByOthersCount > 0
      ? ` ${ctx.claimedByOthersCount} ${ctx.claimedByOthersCount === 1 ? 'is' : 'are'} already claimed by a teammate.`
      : ''

  switch (reasonCode) {
    case 'exact_time_commitment': {
      const n = ctx.dueCount
      return `${n} ${n === 1 ? 'customer has' : 'customers have'} an exact-time commitment now. A fixed appointment controls the day and comes before Today's Focus.`
    }
    case 'focus_elevated':
      return `Management has elevated ${ctx.label} in Today's Focus, and you are eligible to work it.`
    case 'due_callback': {
      const n = ctx.dueCount
      return `${n} promised ${n === 1 ? 'callback has' : 'callbacks have'} come due. Due work to pick up today; a date-only callback does not override Today's Focus and carries no set time.`
    }
    case 'owned_work': {
      const n = ctx.ownedCount
      return `You have claimed ${n} ${n === 1 ? 'item' : 'items'} here. Owned work comes before unclaimed shared work.${othersNote}`
    }
    case 'eligible_shared_work': {
      const n = ctx.availableCount
      if (n === 0 && ctx.claimedByOthersCount > 0) {
        return `No unclaimed work for you right now.${othersNote}`
      }
      return `${n} ${n === 1 ? 'item is' : 'items are'} unclaimed and available to you to pick up.${othersNote}`
    }
    // The three non-routable standings read from the SHARED capability
    // explanations so My Work, the claim path, and future workflows use one
    // consistent wording. ZEN owns the band + reason code; these only phrase it.
    case 'assist_available':
      return capabilityStatusExplanation('assist', ctx.label)
    case 'not_assigned':
      return capabilityStatusExplanation('unassigned', ctx.label)
    case 'not_licensed':
      return capabilityStatusExplanation('unlicensed', ctx.label)
    default:
      return `${ctx.label} work.`
  }
}
