/**
 * MY WORK — the four UNIVERSAL work classes (Right Path).
 *
 * The spec's four classes describe the PURPOSE of an activity, not a separate
 * workflow, database, or set of screens. They are a classification laid over the
 * SAME resolved work the Assistant recommends and the working plan lists; they
 * introduce no new count, no new route, and no new priority.
 *
 * Classification keys off the PlanStep.key (the business activity), NOT the
 * WorkFunctionKey, because the single `outreach` work function expands into
 * sub-steps that belong to DIFFERENT classes by purpose: a first introductory
 * email is Preparation, a call is Outreach, an active conversation is Customer
 * Engagement, and processing a returned authorization is Casework. "Classify by
 * business purpose, not by the screen used to perform it" is exactly this.
 *
 * Pure strings and a lookup — no server-only imports — so the 'use client'
 * My Work surface imports it directly (same boundary as guidance.ts).
 */

import type { PlanStep } from './direction'

/** The four universal classes, in their canonical working order (Preparation →
 * Outreach → Customer Engagement → Casework). Universal across Right Path; a
 * future project may introduce different activities within the same classes. */
export type WorkClass =
  | 'preparation'
  | 'outreach'
  | 'customer_engagement'
  | 'casework'

/** The canonical display order of the classes. */
export const WORK_CLASS_ORDER: readonly WorkClass[] = [
  'preparation',
  'outreach',
  'customer_engagement',
  'casework',
]

/** How each class is presented: a short label and a one-line description of the
 * PURPOSE the class serves. The descriptions are the spec's own definitions. */
export const WORK_CLASS_META: Record<
  WorkClass,
  { label: string; purpose: string }
> = {
  preparation: {
    label: 'Preparation',
    purpose:
      'Gather information and prepare customers or cases for productive activity. Quiet work that can be done any time, including after hours.',
  },
  outreach: {
    label: 'Outreach',
    purpose:
      'Initiate contact and attempt to establish communication. Live calling work, best during appropriate calling hours.',
  },
  customer_engagement: {
    label: 'Customer Engagement',
    purpose:
      'Manage established customer dialogue, responses, appointments, and decisions while a conversation is live.',
  },
  casework: {
    label: 'Casework',
    purpose:
      'Substantive research, analysis, administrative processing, and professional work required to serve customers.',
  },
}

/**
 * Map a working-plan step to its universal class, by the step's business
 * purpose. The mapping is authoritative for the nine activities present today
 * and confirmed against the catalog:
 *
 *   Preparation          verify servicing agent, find missing contact
 *                        information, send introductory emails
 *   Outreach             make the calls that are due, call other reachable
 *                        customers
 *   Customer Engagement  work active customer conversations
 *   Casework             process servicing access, advance operations
 *                        preparation, determination
 *
 * A step whose key is not explicitly mapped (a future activity, or the bare
 * `outreach` fallback step the plan emits only when no sub-population surfaced)
 * falls to Casework so it is never dropped from Available Work — new activities
 * belong to one of the same four classes by definition.
 */
const STEP_CLASS: Record<string, WorkClass> = {
  // Preparation
  verify_servicing_agent: 'preparation',
  research: 'preparation',
  'outreach:intro': 'preparation',
  // Outreach
  'outreach:calls-due': 'outreach',
  'outreach:calls-other': 'outreach',
  // Customer Engagement
  'outreach:customer-interaction': 'customer_engagement',
  // Casework
  'outreach:servicing-access': 'casework',
  operations_prep: 'casework',
  determination: 'casework',
}

/** The universal class for a plan step. Unmapped keys fall to Casework so no
 * activity is ever lost from Available Work. */
export function classOfStep(step: Pick<PlanStep, 'key'>): WorkClass {
  return STEP_CLASS[step.key] ?? 'casework'
}

/** One class with the plan steps that belong to it and a rolled-up actionable
 * count (the sum of each step's headline count). Steps keep their own counts and
 * routes; the class count is only a roll-up for the collapsed class row. */
export interface WorkClassGroup {
  workClass: WorkClass
  label: string
  purpose: string
  steps: PlanStep[]
  /** Sum of the steps' headline counts (unresolvedCount ?? count). A roll-up for
   * the collapsed class header; never a new source of truth. */
  totalCount: number
}

/** The headline figure a step shows (the unresolved population when the step
 * distinguishes attempted-vs-unresolved, else its actionable count). Matches the
 * working plan's own headline so the class roll-up and the step agree. */
function stepHeadline(step: PlanStep): number {
  return step.unresolvedCount ?? step.count
}

/**
 * Group the working plan into the four universal classes, preserving each
 * class's canonical order and, within a class, the plan's existing step order
 * (the fixed workflow order the Assistant already applied). A class with no
 * steps is omitted so the surface never shows an empty class for a worker who
 * has no such work; the steps carry their own zero counts when a step is a
 * standing-at-zero step the plan deliberately kept.
 */
export function groupPlanByClass(plan: PlanStep[]): WorkClassGroup[] {
  const byClass = new Map<WorkClass, PlanStep[]>()
  for (const step of plan) {
    const wc = classOfStep(step)
    const list = byClass.get(wc) ?? []
    list.push(step)
    byClass.set(wc, list)
  }
  const groups: WorkClassGroup[] = []
  for (const wc of WORK_CLASS_ORDER) {
    const steps = byClass.get(wc)
    if (!steps || steps.length === 0) continue
    groups.push({
      workClass: wc,
      label: WORK_CLASS_META[wc].label,
      purpose: WORK_CLASS_META[wc].purpose,
      steps,
      totalCount: steps.reduce((n, s) => n + stepHeadline(s), 0),
    })
  }
  return groups
}
