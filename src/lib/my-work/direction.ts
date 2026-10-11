/**
 * MY WORK — Daily Direction derivation (Right Path).
 *
 * This is the Daily Direction / Next Best Action doctrine from IPF
 * (bobpfromm/ipf-stewardship), applied to the work My Work already connects. It
 * adds NO new decision system and NO new work source: the priority order is the
 * one GoRules ZEN already produced for each activity (my-work-priority.json ->
 * ActivityGroup.band/rank). This module only READS that settled ordering to
 * answer the Assistant's three questions — what deserves attention next, why,
 * and where to go — and to separate Primary responsibilities from Support work.
 *
 * The division of labor is preserved exactly: ZEN owns the priority judgment
 * (which band an activity lands in); TypeScript here owns only normalization and
 * the operator-facing prose. It picks no winner ZEN did not already rank first.
 *
 * Pure: no IO, no Supabase, no ZEN runtime. It takes the ready MyWorkState the
 * server composition resolved and returns a serializable direction summary.
 */

import type { ActivityGroup, MyWorkState, PriorityBand } from './types'

/**
 * The bands that represent ACTIONABLE work the employee can act on right now.
 * 'assist' is included: overqualified work is pickable, so it is actionable
 * (just not routinely theirs). The two awareness-only bands (unassigned,
 * unlicensed) are deliberately excluded — they are shown for awareness, never
 * recommended as the next action.
 */
const ACTIONABLE_BANDS: ReadonlySet<PriorityBand> = new Set<PriorityBand>([
  'exact_time_commitment',
  'focus',
  'due_callback',
  'owned',
  'shared',
  'assist',
])

/**
 * How many items in this activity the employee can act on right now: the items
 * they own plus the unclaimed items available to them. A due callback is a
 * SUBSET of these (an owned or available ready-to-call item that happens to be
 * due), so dueCount is NOT added here — doing so would count those items twice.
 * dueCount is surfaced separately as a highlight within this total.
 */
function actionableCountOf(a: ActivityGroup): number {
  return a.ownedCount + a.availableCount
}

/**
 * Whether an activity is actionable for THIS employee right now: an actionable
 * band with at least one item this employee can act on (owned or available to
 * pick up). An activity with only teammate-claimed or not-eligible items is not
 * something to recommend.
 */
function isActionable(a: ActivityGroup): boolean {
  if (!ACTIONABLE_BANDS.has(a.band)) return false
  return actionableCountOf(a) > 0
}

/** The single destination the Assistant should offer for an activity: the first
 * source the employee can actually act on (owned or available items), falling
 * back to the activity's first source. Mirrors My Work's own source links, so
 * the recommendation is always directly reachable and never invents a route. */
function primaryRouteFor(a: ActivityGroup): string | null {
  const actionable = a.sources.find((s) => s.ownedByMe + s.availableToMe > 0)
  return (actionable ?? a.sources[0])?.route ?? null
}

/** How to label the single-action button for a given band. The verb matches the
 * work: owned/shared is "Pick up", a due callback is "Call back", focus is
 * "Work", assist is "Help with". No band invents a clock time. */
function actionVerb(a: ActivityGroup): string {
  switch (a.band) {
    case 'exact_time_commitment':
      return `Open ${a.label}`
    case 'due_callback':
      return `Open ${a.label}`
    case 'focus':
      return `Work ${a.label}`
    case 'owned':
      return `Continue ${a.label}`
    case 'assist':
      return `Help with ${a.label}`
    case 'shared':
    default:
      return `Open ${a.label}`
  }
}

/** The Assistant's lead heading for the recommended next action. Action-first,
 * naming the activity, never a ranked channel the data does not justify. */
function nextActionHeading(a: ActivityGroup): string {
  switch (a.band) {
    case 'exact_time_commitment':
      return `${a.label} needs you now`
    case 'focus':
      return `Start with ${a.label}`
    case 'due_callback':
      return `${a.label}: promised callbacks are due`
    case 'owned':
      return `Continue your ${a.label} work`
    case 'assist':
      return `You can help with ${a.label}`
    case 'shared':
    default:
      return `Pick up ${a.label}`
  }
}

// ---------------------------------------------------------------------------
// The serializable direction summary the Assistant renders.
// ---------------------------------------------------------------------------

/** One activity promoted to a Primary / Support listing row. Carries only what
 * the Assistant shows; the full ActivityGroup is still rendered below. */
export interface DirectionRow {
  workFunction: ActivityGroup['workFunction']
  label: string
  /** Items this employee can act on right now (owned + available + due). */
  actionableCount: number
  /** Due date-only callbacks within this activity (surfaced as due work). */
  dueCount: number
  band: PriorityBand
  route: string | null
}

/** One recommended next-action option. When several activities share the top
 * ZEN rank they are equally appropriate, so each is presented as its own option
 * with no invented ordering between them. */
export interface NextActionOption {
  workFunction: ActivityGroup['workFunction']
  label: string
  band: PriorityBand
  /** The deterministic reason, reused verbatim from the activity's own
   * ZEN-derived reason so the Assistant and the activity card never disagree. */
  reason: string
  heading: string
  actionLabel: string
  route: string | null
  actionableCount: number
  dueCount: number
}

/**
 * The single Daily Direction summary for My Work. 'quiet' mirrors MyWorkState:
 * nothing actionable right now. When not quiet, nextAction describes what to do
 * next; primary and support list the employee's actionable responsibilities
 * split by how the work is routed to them.
 */
export interface MyWorkDirection {
  /** True when the employee has no actionable work right now (open capacity). */
  quiet: boolean
  /**
   * The recommended next action, or null when quiet. GoRules ZEN owns the
   * priority: the options are EVERY actionable activity sharing the highest ZEN
   * rank. Usually that is one activity (a single recommendation). When more than
   * one activity ties at the top rank, they are equally appropriate — `tied` is
   * true and all co-equal options are presented WITHOUT a ranking, rather than
   * promoting the first catalog entry as the unique winner.
   */
  nextAction: {
    /** True when several activities share the top rank (co-equal choices). */
    tied: boolean
    /** The co-equal top-rank options; a single element in the common case. */
    options: NextActionOption[]
  } | null
  /** The employee's PRIMARY responsibilities that currently have actionable
   * work, highest priority first (ZEN rank order preserved). */
  primary: DirectionRow[]
  /** SUPPORT work the employee is routed to assist with, actionable, in rank
   * order. Kept distinct from primary so the Assistant separates the two. */
  support: DirectionRow[]
}

function toRow(a: ActivityGroup): DirectionRow {
  return {
    workFunction: a.workFunction,
    label: a.label,
    // owned + available only; due callbacks are a subset of these, not an
    // addition, so they are never double-counted.
    actionableCount: actionableCountOf(a),
    dueCount: a.dueCount,
    band: a.band,
    route: primaryRouteFor(a),
  }
}

/**
 * Derive the Daily Direction summary from the ready My Work state. ZEN already
 * ordered activities by rank; this reads that order, it does not re-rank.
 */
export function deriveMyWorkDirection(state: MyWorkState): MyWorkDirection {
  // activities arrive already sorted by ZEN rank then catalog order. The next
  // best action is driven by the ZEN RANK only; this reads that rank and never
  // re-ranks within it.
  const actionable = state.activities.filter(isActionable)

  if (actionable.length === 0) {
    return { quiet: true, nextAction: null, primary: [], support: [] }
  }

  // The highest-priority rank present among actionable work (lower rank = higher
  // priority). Every activity at this rank is EQUALLY appropriate: ZEN assigned
  // them the same priority, so there is no winner among them. Presenting the
  // first catalog entry as "the" recommendation would invent a ranking ZEN did
  // not make, so all top-rank activities are offered as co-equal options.
  const topRank = Math.min(...actionable.map((a) => a.rank))
  const topActivities = actionable.filter((a) => a.rank === topRank)

  const toOption = (a: ActivityGroup): NextActionOption => ({
    workFunction: a.workFunction,
    label: a.label,
    band: a.band,
    reason: a.reason,
    heading: nextActionHeading(a),
    actionLabel: actionVerb(a),
    route: primaryRouteFor(a),
    actionableCount: actionableCountOf(a),
    dueCount: a.dueCount,
  })

  const nextAction = {
    tied: topActivities.length > 1,
    options: topActivities.map(toOption),
  }

  // Split the actionable activities by how they are routed to the employee.
  // Primary responsibilities and support work are genuinely different framings
  // (the IPF capability-routing distinction), so they are listed separately.
  // 'assist' (overqualified) work is support-flavored help, grouped with
  // support so the primary list stays the employee's chief accountability.
  const primary = actionable.filter((a) => a.routedAs === 'primary').map(toRow)
  const support = actionable
    .filter((a) => a.routedAs === 'support' || a.band === 'assist')
    .map(toRow)

  return { quiet: false, nextAction, primary, support }
}
