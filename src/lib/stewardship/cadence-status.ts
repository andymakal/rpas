/**
 * Outreach cadence-status decision wrapper (Right Path) — server-only.
 *
 * The thin TypeScript boundary around the ZEN outreach-cadence decision
 * (src/rules/outreach-cadence.json), following the same pattern as the Daily
 * Direction / My Work / contact-options engines:
 *   - ZEN owns the business judgment: whether an outreach run has reached the
 *     point of being flagged "Nonresponsive — Review Contact Strategy".
 *   - TypeScript owns the deterministic attempt counting + day-math (see
 *     outreach-attempts.ts and call-cadence.ts) and turns ZEN's recommendation
 *     code into operator-facing prose.
 *
 * The flag is a RECOMMENDATION ONLY. Nothing here (or in ZEN) stops outreach,
 * closes the item, or changes the queue. A human decides whether to continue,
 * change strategy, defer, or stop.
 */

import { ZenEngine } from '@gorules/zen-engine'
import outreachCadenceModel from '@/rules/outreach-cadence.json'

let engine: ZenEngine | null = null

function getEngine(): ZenEngine {
  if (!engine) {
    engine = new ZenEngine({
      loader: {
        type: 'static',
        content: { 'outreach-cadence.json': outreachCadenceModel },
      },
    })
  }
  return engine
}

export type CadenceStatus = 'active' | 'nonresponsive'

export interface CadenceVerdict {
  status: CadenceStatus
  recommendation: string
  /** True when ZEN flagged the run nonresponsive (recommendation only). */
  isNonresponsive: boolean
}

/**
 * Evaluate the cadence status for a run with `unsuccessfulAttempts` grouped
 * unsuccessful outreach attempts. ZEN decides the status; this returns it with a
 * convenience boolean.
 */
export async function evaluateCadenceStatus(unsuccessfulAttempts: number): Promise<CadenceVerdict> {
  const zen = getEngine()
  const response = await zen.evaluate('outreach-cadence.json', {
    unsuccessfulAttempts: Math.max(0, Math.floor(unsuccessfulAttempts || 0)),
  })
  const status = response.result.cadenceStatus as CadenceStatus
  return {
    status,
    recommendation: response.result.recommendation as string,
    isNonresponsive: status === 'nonresponsive',
  }
}

/** The operator-facing label for a nonresponsive flag. */
export const NONRESPONSIVE_LABEL = 'Nonresponsive — Review Contact Strategy'

/**
 * Deterministic prose for a cadence recommendation code. ZEN decides the code;
 * this states it. The nonresponsive note recommends reconsidering contact
 * information, communication method, or timing, and is explicit that outreach is
 * not stopped — a person decides.
 */
export function cadenceRecommendationText(recommendation: string, attempts: number): string {
  switch (recommendation) {
    case 'review_contact_strategy':
      return (
        `${attempts} outreach attempts have not reached this customer. ` +
        'Review the contact strategy: reconsider the contact information, the ' +
        'communication method, or the timing. Outreach is not stopped — decide ' +
        'whether to continue, change approach, defer, or stop.'
      )
    case 'continue_cadence':
    default:
      return 'Outreach is on its automatic cadence.'
  }
}
