/**
 * MY WORK — Assistant ranking (Right Path).
 *
 * The Assistant answers "what should I work on now, and why?" It is NOT a menu:
 * it offers only steps that have real actionable work, in an order decided by
 * the GoRules ZEN rule src/rules/my-work-assistant.json. ZEN owns the ordering.
 * This module owns only normalization (turning a working-plan step and the clock
 * into the rule's facts), the research-backlog threshold, and the short
 * operator-facing notes. It ranks nothing itself beyond sorting by the rank ZEN
 * returned.
 *
 * Because ZEN is server-only (a native module) and the clock moves, the server
 * evaluates every step under each combination of the two facts that change
 * without a data refresh (call hours open/closed, research backlog large/small)
 * and ships the table. The client then picks the combination for the current
 * time, so the Assistant flips at 9 am and 6 pm Eastern with no server round trip.
 *
 * Pure: no IO, no ZEN import, client-safe.
 */

import type { WorkFunctionKey } from '@/lib/capabilities/work-functions'
import type { PlanStep } from './direction'

/** The not-yet-researched backlog above which contact research moves ahead of
 * the calls. A single number to tune as the team learns what works. */
export const RESEARCH_BACKLOG_LARGE_ABOVE = 25

export type AssistantBand =
  | 'focus'
  | 'gate'
  | 'finish'
  | 'late_stage'
  | 'research_large'
  | 'calls'
  | 'prep'
  | 'workflow'
  | 'retry'
  | 'not_now'

/** The facts the ZEN rule decides over for one step. */
export interface AssistantStepFacts {
  stepKey: string
  isCallWork: boolean
  callHoursOpen: boolean
  isFocusElevated: boolean
  researchBacklogLarge: boolean
}

/** ZEN's answer for one step. */
export interface AssistantVerdict {
  band: AssistantBand
  rank: number
  reasonCode: string
}

/** The four clock/backlog combinations the server pre-evaluates. */
export type VerdictCombo = 'open-large' | 'open-small' | 'closed-large' | 'closed-small'

/** Verdicts for every known step under every combination. */
export type AssistantVerdicts = Record<VerdictCombo, Record<string, AssistantVerdict>>

export function verdictCombo(callHoursOpen: boolean, researchLarge: boolean): VerdictCombo {
  return `${callHoursOpen ? 'open' : 'closed'}-${researchLarge ? 'large' : 'small'}` as VerdictCombo
}

/** Every step key the Assistant can rank: the working plan's nine steps, the bare
 * outreach fallback, and the research retry split out of Contact Research. */
export const ASSISTANT_STEP_KEYS: readonly string[] = [
  'verify_servicing_agent',
  'research',
  'research:retry',
  'outreach:intro',
  'outreach:calls-due',
  'outreach:customer-interaction',
  'outreach:servicing-access',
  'outreach',
  'operations_prep',
  'determination',
]

/** The work function a step belongs to, so Today's Focus (set per work function)
 * can elevate its steps. */
const STEP_WORK_FUNCTION: Record<string, WorkFunctionKey> = {
  verify_servicing_agent: 'verify_servicing_agent',
  research: 'research',
  'research:retry': 'research',
  'outreach:intro': 'outreach',
  'outreach:calls-due': 'outreach',
  'outreach:customer-interaction': 'outreach',
  'outreach:servicing-access': 'outreach',
  outreach: 'outreach',
  operations_prep: 'operations_prep',
  determination: 'determination',
}

/** Live phone work: the only steps held back by call hours. */
const CALL_STEPS = new Set(['outreach:calls-due'])

/** Normalize one step and the current conditions into the rule's facts. A retry
 * is never focus-elevated: Focus points at fresh work, not at retries. */
export function assistantStepFacts(
  stepKey: string,
  callHoursOpen: boolean,
  researchBacklogLarge: boolean,
  focusedFunctions: ReadonlySet<string>,
): AssistantStepFacts {
  const wf = STEP_WORK_FUNCTION[stepKey]
  return {
    stepKey,
    isCallWork: CALL_STEPS.has(stepKey),
    callHoursOpen,
    isFocusElevated: stepKey !== 'research:retry' && wf != null && focusedFunctions.has(wf),
    researchBacklogLarge,
  }
}

// ---------------------------------------------------------------------------
// Client side: turn the working plan + ZEN verdicts into the Assistant's list.
// ---------------------------------------------------------------------------

/** One thing the Assistant offers: a step with real work, ZEN's verdict, and a
 * short note on why it is where it is. */
export interface AssistantItem {
  step: PlanStep
  band: AssistantBand
  rank: number
  /** Short note shown with the item, or null when the position speaks for itself. */
  note: string | null
}

/** Used only if ZEN could not be evaluated: keep the plan's own order and hold
 * nothing back, so the Assistant degrades to a plain list rather than failing. */
const UNRANKED: AssistantVerdict = { band: 'workflow', rank: 50, reasonCode: 'workflow' }

const NOTES: Partial<Record<AssistantBand, string>> = {
  focus: "Management put this in Today's Focus.",
  gate: 'New policies cannot move until we know whether we are the servicing agent.',
  finish: 'Closest to done. Finishing it clears the pipeline.',
  late_stage: 'Further along the pipeline. Finishing it keeps customers moving through.',
  research_large: 'The research backlog is large enough to hold up outreach.',
  calls: 'Call hours are open.',
  retry: 'Already tried once. Lowest priority.',
}

/**
 * Split Contact Research into the customers not yet researched (real work) and
 * those already tried without success (a separate, lowest-priority retry). The
 * working plan carries them together as one unresolved figure.
 */
function expandPlan(plan: PlanStep[]): PlanStep[] {
  const out: PlanStep[] = []
  for (const s of plan) {
    if (s.key === 'research' && s.unresolvedCount != null) {
      const retry = s.unsuccessfulCount ?? 0
      const outstanding = Math.max(0, s.unresolvedCount - retry)
      out.push({ ...s, count: outstanding, unresolvedCount: undefined, unsuccessfulCount: undefined })
      if (retry > 0) {
        out.push({
          key: 'research:retry',
          title: 'Retry contact research',
          reason:
            'These customers were researched once without finding a usable email or phone. Worth another look when the rest of the work is done.',
          count: retry,
          actionLabel: 'Retry contact research',
          route: s.route,
        })
      }
    } else {
      out.push(s)
    }
  }
  return out
}

/**
 * The Assistant's list: only steps with actionable work, in ZEN's order, with
 * anything ZEN says is not recommended right now (call work after hours) left
 * out. Ties keep the working plan's own order. Everything not offered here is
 * still in Available Work.
 */
export function rankAssistantItems(
  plan: PlanStep[],
  verdicts: AssistantVerdicts | null,
  callHoursOpen: boolean,
): AssistantItem[] {
  const expanded = expandPlan(plan)
  const researchCount = expanded.find((s) => s.key === 'research')?.count ?? 0
  const researchLarge = researchCount > RESEARCH_BACKLOG_LARGE_ABOVE
  const table = verdicts?.[verdictCombo(callHoursOpen, researchLarge)] ?? null

  return expanded
    .map((step, index) => ({ step, index, verdict: table?.[step.key] ?? UNRANKED }))
    .filter((x) => x.step.count > 0 && x.verdict.band !== 'not_now')
    .sort((a, b) => a.verdict.rank - b.verdict.rank || a.index - b.index)
    .map(({ step, verdict }) => ({
      step,
      band: verdict.band,
      rank: verdict.rank,
      note: NOTES[verdict.band] ?? null,
    }))
}

/**
 * When the research backlog is large it leads, and the calls are the other
 * reasonable choice. Offer them as a single "or" beside the pick rather than a
 * second list. Null when there is no such pair.
 */
export function assistantAlternative(items: AssistantItem[]): AssistantItem | null {
  const pick = items[0]
  if (!pick || pick.band !== 'research_large') return null
  return items.find((i) => i.band === 'calls') ?? null
}
