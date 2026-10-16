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
import { activityGuidance, outreachChannelMode, type WorkMode } from './guidance'

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

/**
 * The single Daily Direction summary for My Work. 'quiet' mirrors MyWorkState:
 * nothing actionable right now. When not quiet, workingPlan is the ordered,
 * advisory sequence of steps to work; primary and support list the employee's
 * actionable responsibilities split by how the work is routed to them.
 */
/**
 * The honest fixed-time-commitment summary for the daily briefing. Right Path
 * records no exact-time (clock) appointments yet — only date-only promised
 * callbacks — so `known` is almost always false today. When it IS false we must
 * NOT claim the employee has no appointments: we only know Right Path holds none
 * on record, which is a different (and weaker) statement. The IPF exact-time vs
 * date-only distinction is preserved: only the `exact_time_commitment` band is a
 * genuine clock commitment; a due_callback is due work, not a fixed appointment.
 */
export interface FixedTimeCommitmentSummary {
  /**
   * True only when Right Path actually holds one or more exact-time commitments
   * for this employee right now. False means "none on record", NOT "none exist".
   */
  known: boolean
  /** The fixed-time commitment activities (the `exact_time_commitment` band),
   * each with a direct route, when any are known. Empty when `known` is false. */
  items: DirectionRow[]
}

export interface MyWorkDirection {
  /** True when the employee has no actionable work right now (open capacity). */
  quiet: boolean
  /**
   * Fixed-time (clock) commitments for the briefing. These are exempt from the
   * Project/Activity filters upstream, so they stay visible regardless of what
   * the employee has filtered to — a customer commitment is never hidden. When
   * none are on record we report that honestly rather than asserting there are
   * no appointments (Right Path cannot establish that today).
   */
  fixedTimeCommitments: FixedTimeCommitmentSummary
  /**
   * How many distinct active projects currently have work AVAILABLE to this
   * employee (owned or unclaimed-and-eligible), across the shared board and the
   * project workflows. Derived from the same resolved sources the view renders;
   * it introduces no new count and no new priority — it just summarizes breadth
   * for the briefing. Zero when the employee's actionable work is all
   * agency-wide (not tied to a project) or there is none.
   */
  projectsWithAvailableWork: number
  /**
   * The recommended WORKING PLAN: an ordered, advisory sequence of concrete
   * steps telling the employee WHAT to do, WHY, and how to begin each. Empty
   * when quiet. The order is the ZEN priority band plus the catalog working
   * order the composition already applied (research -> contact review ->
   * outreach -> operations preparation), with Outreach expanded into
   * introductory emails, due calls, then other callable customers. It is a
   * presentation of the already-ranked work, not a competing priority, and the
   * employee may work the steps in any order.
   */
  workingPlan: PlanStep[]
  /** The employee's PRIMARY responsibilities that currently have actionable
   * work, highest priority first (ZEN rank order preserved). */
  primary: DirectionRow[]
  /** SUPPORT work the employee is routed to assist with, actionable, in rank
   * order. Kept distinct from primary so the Assistant separates the two. */
  support: DirectionRow[]
  /**
   * The actionable work grouped by HOW it is done: quiet focus work vs live
   * phone outreach, each with its own counts and direct links. Outreach is split
   * per channel (emails -> quiet, calls -> phone outreach). Empty when quiet.
   * This is a practical presentation of the same ZEN-ordered work; it introduces
   * no new priority and forces no order between the groups.
   */
  workModeGroups: WorkModeGroup[]
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

  // The honest fixed-time-commitment summary and the active-project breadth are
  // part of EVERY briefing, including a quiet one: an employee with no routine
  // work could still have a fixed appointment, and the honest "none on record"
  // statement must appear rather than silence that reads as "no appointments".
  const fixedTimeCommitments = deriveFixedTimeCommitments(state)
  const projectsWithAvailableWork = countProjectsWithAvailableWork(actionable)

  // Activities that belong in the WORKING PLAN. This is the actionable set plus
  // any activity that has UNRESOLVED work to keep visible even with zero
  // outstanding — currently Contact Research with only researched-unsuccessfully
  // customers left (outstanding 0, unresolved > 0). Such an activity must stay in
  // the plan so the worker can still see it and try again; it is added in its
  // existing rank position (activities arrive rank-ordered) and is NOT added to
  // primary/support/work-mode groups or the quiet decision — only the plan shows it.
  const hasUnresolvedOnly = (a: ActivityGroup): boolean =>
    !isActionable(a) && (a.unresolvedCount ?? 0) > 0
  const planActivities = state.activities.filter(
    (a) => isActionable(a) || hasUnresolvedOnly(a),
  )

  if (planActivities.length === 0) {
    return {
      quiet: true,
      fixedTimeCommitments,
      projectsWithAvailableWork,
      workingPlan: [],
      primary: [],
      support: [],
      workModeGroups: [],
    }
  }

  // The recommended WORKING PLAN: an ordered sequence of concrete steps, built
  // from the activities ZEN already ranked (and the catalog working-order
  // tiebreak the composition applied), with Outreach expanded into its real
  // sub-populations. This replaces the old co-equal "any of these" options with
  // a single practical plan. It adds no priority of its own — the order is the
  // ZEN+catalog order, and every step's count/route is read from resolved work.
  const workingPlan = buildWorkingPlan(planActivities)

  // Split the actionable activities by how they are routed to the employee.
  // Primary responsibilities and support work are genuinely different framings
  // (the IPF capability-routing distinction), so they are listed separately.
  // 'assist' (overqualified) work is support-flavored help, grouped with
  // support so the primary list stays the employee's chief accountability.
  const primary = actionable.filter((a) => a.routedAs === 'primary').map(toRow)
  const support = actionable
    .filter((a) => a.routedAs === 'support' || a.band === 'assist')
    .map(toRow)

  // Group the SAME actionable work by HOW it is done — quiet focus work vs live
  // phone outreach — so the Assistant can direct the day practically. This is a
  // presentation of kinds of work, not a new priority: ZEN rank order is
  // preserved within each group and no cross-group ranking is invented.
  const workModeGroups = buildWorkModeGroups(actionable)

  return {
    quiet: false,
    fixedTimeCommitments,
    projectsWithAvailableWork,
    workingPlan,
    primary,
    support,
    workModeGroups,
  }
}

// ---------------------------------------------------------------------------
// The recommended working plan.
// ---------------------------------------------------------------------------

/** One concrete step in the recommended working plan: a specific body of work
 * to do, why it comes where it does, how much of it there is, and a direct
 * action to begin. Steps are advisory and ordered; the employee may work them
 * in any order. */
export interface PlanStep {
  /** Stable identifier for keys/tests (e.g. 'research', 'outreach:intro'). */
  key: string
  /** WHAT to do — a short imperative title. */
  title: string
  /** WHY — a short deterministic rationale, never a clock time. */
  reason: string
  /** How many items this step covers (actionable to this employee). */
  count: number
  /**
   * The full UNRESOLVED population for this step, counting each customer once —
   * the same figure the full work list shows (currently Research only). When
   * present it is the headline the plan displays (so the plan and the full list
   * agree); the attempted-vs-unresolved split is `unsuccessfulCount`. Absent for
   * steps that do not distinguish attempted from unresolved, where `count` is the
   * figure to show.
   */
  unresolvedCount?: number
  /**
   * Of `unresolvedCount`, how many have been attempted but remain unresolved
   * (Research: researched unsuccessfully). The not-yet-attempted count is
   * `unresolvedCount - unsuccessfulCount`. Absent when the step has no such
   * distinction.
   */
  unsuccessfulCount?: number
  /** The direct-action button label (how to begin). */
  actionLabel: string
  /** Where beginning the step goes; null when no reachable route. */
  route: string | null
  /** True for a genuine commitment/exception step (focus, due calls) so the UI
   * can give it light emphasis without implying urgency ZEN did not set. */
  emphasis?: boolean
}

/** Find an outreach informational sub-population source by its label fragment,
 * returning its actionable count and route. These are emitted by the
 * composition (Introductory emails / Calls Due / Available to Call) as
 * informational sources that do not inflate the activity total. */
function outreachSubPopulation(
  outreach: ActivityGroup,
  match: RegExp,
): { count: number; route: string | null } | null {
  const s = outreach.sources.find((src) => src.informational && match.test(src.label))
  if (!s) return null
  const count = s.ownedByMe + s.availableToMe
  if (count <= 0) return null
  return { count, route: s.route }
}

/**
 * Build the ordered working plan from the actionable activities (already in ZEN
 * rank + catalog working order). Each activity becomes one step, except Outreach
 * which expands into its real sub-populations in working order: introductory
 * emails first (efficient initial outreach), then calls — due calls distinguished
 * from other callable customers. Operations Preparation is its own step, work
 * that is ready to advance independently of ongoing outreach.
 *
 * This introduces NO priority: the activity order is the ZEN+catalog order the
 * composition produced, and the Outreach sub-steps are a fixed, descriptive
 * working sequence over the SAME outreach work (not a re-ranking). Counts and
 * routes are read from the resolved activity/sources.
 */
export function buildWorkingPlan(actionable: ActivityGroup[]): PlanStep[] {
  const steps: PlanStep[] = []
  for (const a of actionable) {
    const emphasis = a.band === 'focus' || a.band === 'exact_time_commitment' || a.band === 'due_callback'
    switch (a.workFunction) {
      case 'research': {
        // Contact Research is now the SINGLE consolidated contact-finding step:
        // one activity covering every customer missing a usable email or phone,
        // whether they are missing one method or both. Show the full UNRESOLVED
        // population (outstanding + the No Usable Contact Information exception
        // that research came up empty on), counting each customer once — the SAME
        // total and breakdown the activity already carries. The recommendation is
        // driven by the actionable outstanding count; the unresolved figure and
        // its unsuccessful breakdown are presentation only. When the activity
        // carries no unresolved distinction, fall back to the actionable count.
        const unresolved = a.unresolvedCount ?? actionableCountOf(a)
        steps.push({
          key: 'research',
          title: 'Find missing contact information',
          reason:
            'These customers are missing a usable email or phone — some have none at all, some are missing one. Finding a working contact method keeps them reachable and prepares them for outreach.',
          count: unresolved,
          unresolvedCount: a.unresolvedCount,
          unsuccessfulCount: a.unsuccessfulCount,
          actionLabel: 'Start contact research',
          route: primaryRouteFor(a),
          emphasis,
        })
        break
      }
      case 'outreach': {
        // Expand Outreach into its real sub-populations, in working order:
        // introductory emails, then due calls, then other callable customers.
        // Each sub-population is read from the composition's informational
        // sources, so the counts match the board and nothing is double-counted.
        const intro = outreachSubPopulation(a, /introductory email/i)
        const callsDue = outreachSubPopulation(a, /calls due/i)
        const otherCalls = outreachSubPopulation(a, /available to call/i)

        if (intro) {
          steps.push({
            key: 'outreach:intro',
            title: 'Send introductory emails',
            reason:
              'A first email (carrying the authorization form) is efficient initial outreach before calling, for customers not yet contacted.',
            count: intro.count,
            actionLabel: 'Open Ready to Email',
            route: intro.route,
            emphasis,
          })
        }
        if (callsDue) {
          steps.push({
            key: 'outreach:calls-due',
            title: 'Make the calls that are due',
            reason:
              'A promised callback or scheduled follow-up has come due for these customers. Due calls come before other calling.',
            count: callsDue.count,
            actionLabel: 'Open Calls Due',
            route: callsDue.route,
            emphasis: true,
          })
        }
        if (otherCalls) {
          steps.push({
            key: 'outreach:calls-other',
            title: 'Call other reachable customers',
            reason:
              'These customers are callable now with no scheduled time. Good calling-hours work once due calls are handled.',
            count: otherCalls.count,
            actionLabel: 'Open Available to Call',
            route: otherCalls.route,
            emphasis,
          })
        }
        // Fallback: outreach is actionable but carries no recognized sub-
        // population (e.g. only follow-up chases). Offer the activity directly
        // so the step is never silently dropped.
        if (!intro && !callsDue && !otherCalls) {
          steps.push({
            key: 'outreach',
            title: 'Continue outreach',
            reason: a.reason,
            count: actionableCountOf(a),
            actionLabel: 'Open outreach',
            route: primaryRouteFor(a),
            emphasis,
          })
        }
        break
      }
      case 'operations_prep': {
        steps.push({
          key: 'operations_prep',
          title: 'Advance operations preparation',
          reason:
            'This work is ready to move forward now, independently of ongoing outreach.',
          count: actionableCountOf(a),
          actionLabel: 'Open operations preparation',
          route: primaryRouteFor(a),
          emphasis,
        })
        break
      }
      default: {
        // Determination, office support, and any future activity: one plain
        // step using the activity's own ZEN reason, so nothing is dropped and no
        // new wording is invented for work without a tailored plan entry.
        steps.push({
          key: a.workFunction,
          title: a.label,
          reason: a.reason,
          count: actionableCountOf(a),
          actionLabel: `Open ${a.label}`,
          route: primaryRouteFor(a),
          emphasis,
        })
      }
    }
  }
  return steps
}

// ---------------------------------------------------------------------------
// Briefing summaries (fixed-time commitments, active-project breadth).
// ---------------------------------------------------------------------------

/**
 * The honest fixed-time-commitment summary. Only the `exact_time_commitment`
 * band is a genuine clock commitment (a due_callback is due work, not a fixed
 * appointment), and only one with items the employee can act on is surfaced.
 * When none are present we report `known: false` — "none on record" — rather
 * than asserting the employee has no appointments, because Right Path does not
 * yet hold exact-time commitments and so cannot establish their absence.
 */
export function deriveFixedTimeCommitments(state: MyWorkState): FixedTimeCommitmentSummary {
  const items = state.activities
    .filter((a) => a.band === 'exact_time_commitment' && actionableCountOf(a) > 0)
    .map(toRow)
  return { known: items.length > 0, items }
}

/**
 * Count the DISTINCT active projects that currently have work AVAILABLE to this
 * employee (owned or unclaimed-and-eligible). A project counts when any
 * actionable activity has a project-scoped source with such work, either as the
 * source's own project (projectId) or as a shared source's per-project slice
 * (projectScopes[pid]). Agency-wide work tied to no project does not add to the
 * count. This reads the resolved sources only; it introduces no new count and
 * no new ordering.
 */
export function countProjectsWithAvailableWork(actionable: ActivityGroup[]): number {
  const projects = new Set<string>()
  for (const a of actionable) {
    for (const s of a.sources) {
      if (s.projectId && s.ownedByMe + s.availableToMe > 0) {
        projects.add(s.projectId)
      }
      if (s.projectScopes) {
        for (const [pid, scope] of Object.entries(s.projectScopes)) {
          if (scope.ownedByMe + scope.availableToMe > 0) projects.add(pid)
        }
      }
    }
  }
  return projects.size
}

// ---------------------------------------------------------------------------
// Work-mode grouping (quiet focus work vs live phone outreach).
// ---------------------------------------------------------------------------

/** One actionable item inside a work-mode group. For a single-mode activity it
 * is the activity itself; for Outreach it is ONE channel (email or calls), so
 * the two channels can sit in different groups with their own counts/links. */
export interface WorkModeItem {
  /** The activity this item belongs to (for keys and labels). */
  workFunction: ActivityGroup['workFunction']
  /** Human label: the activity, or the channel for a split Outreach item
   * (e.g. "Outreach — emails", "Outreach — calls"). */
  label: string
  /** Items the employee can act on in this item right now (owned + available).
   * For an Outreach channel this is the per-channel source count the employee
   * can act on; for a single-mode activity it is the activity's actionable
   * count. */
  actionableCount: number
  /** ZEN band, carried so the group can preserve rank order and the UI can tag
   * due/owned work consistently with the activity cards. */
  band: PriorityBand
  /** ZEN rank, used only to order WITHIN a group (never across groups). */
  rank: number
  /** Direct link to this specific work (the channel's queue, or the activity's
   * actionable source). Reused verbatim from the WorkSource route. */
  route: string | null
}

/** The two kinds of effort the Assistant separates. 'quiet' is heads-down work
 * (emails, research, operations prep); 'calls' is live phone outreach during
 * appropriate calling hours. Both are offered as available choices — the
 * grouping informs, it does not force an order. */
export interface WorkModeGroup {
  mode: WorkMode
  items: WorkModeItem[]
  /** Total actionable across the group's items (sum of actionableCount). */
  totalActionable: number
}

/** Build the quiet / calls groups from the actionable activities. Outreach is
 * split per channel using its own WorkSource rows (ready-to-email -> quiet,
 * ready-to-call -> calls); every other actionable activity uses its single
 * work mode from the shared guidance. Rank order is preserved within a group. */
export function buildWorkModeGroups(actionable: ActivityGroup[]): WorkModeGroup[] {
  const quiet: WorkModeItem[] = []
  const calls: WorkModeItem[] = []

  for (const a of actionable) {
    if (a.workFunction === 'outreach') {
      // Split Outreach into its channels using the per-channel sources, so the
      // ready-to-email count lands in quiet and the ready-to-call count lands in
      // live phone outreach — reusing the counts and routes the composition set.
      for (const s of a.sources) {
        const mode = outreachChannelMode(s.label)
        if (!mode) continue
        const actionableCount = s.ownedByMe + s.availableToMe
        if (actionableCount <= 0) continue
        const item: WorkModeItem = {
          workFunction: a.workFunction,
          label: mode === 'calls' ? 'Outreach — calls' : 'Outreach — emails',
          actionableCount,
          band: a.band,
          rank: a.rank,
          route: s.route,
        }
        ;(mode === 'calls' ? calls : quiet).push(item)
      }
      continue
    }

    // Single-mode activities: use the activity's guidance work mode. Only quiet
    // modes exist among the non-outreach activities today; a 'calls' single-mode
    // activity would route here too if one is ever added. An activity with no
    // catalog guidance (e.g. a future work function not yet described) simply
    // does not join a work-mode group rather than causing a failure.
    const mode = activityGuidance(a.workFunction)?.workMode ?? null
    if (!mode) continue
    const actionableCount = actionableCountOf(a)
    if (actionableCount <= 0) continue
    const item: WorkModeItem = {
      workFunction: a.workFunction,
      label: a.label,
      actionableCount,
      band: a.band,
      rank: a.rank,
      route: primaryRouteFor(a),
    }
    ;(mode === 'calls' ? calls : quiet).push(item)
  }

  // Preserve ZEN rank order within each group (lower rank first); the activities
  // arrived rank-ordered, and the per-channel split keeps that order.
  const byRank = (x: WorkModeItem, y: WorkModeItem) => x.rank - y.rank
  quiet.sort(byRank)
  calls.sort(byRank)

  const groups: WorkModeGroup[] = []
  if (quiet.length > 0) {
    groups.push({ mode: 'quiet', items: quiet, totalActionable: sumActionable(quiet) })
  }
  if (calls.length > 0) {
    groups.push({ mode: 'calls', items: calls, totalActionable: sumActionable(calls) })
  }
  return groups
}

function sumActionable(items: WorkModeItem[]): number {
  return items.reduce((n, i) => n + i.actionableCount, 0)
}
