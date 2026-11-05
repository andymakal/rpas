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
  // The Outreach activity stays in the plan when it carries the always-present
  // Servicing Access standing source, even if it is not otherwise actionable, so
  // Servicing Access is a reachable Available-work step (showing 0 when no forms
  // await processing). Like hasUnresolvedOnly, this is PLAN-ONLY: such an
  // activity is not added to primary/support/work-mode groups, and it does not
  // by itself make the briefing non-quiet below.
  const hasServicingAccessStandingStep = (a: ActivityGroup): boolean =>
    a.workFunction === 'outreach' && outreachServicingAccess(a) != null
  // The full workflow spine stays in the plan even when a step is empty, so the
  // operator sees the whole pipeline and watches work move through it as the
  // Verify gate releases customers. The composition only keeps a zeroed spine
  // activity for an ELIGIBLE employee, so an activity present here is already
  // one this worker is meant to see. A spine step at zero renders as "0" rather
  // than vanishing.
  // The plan shows every activity the composition kept EXCEPT the awareness-only
  // standings (unassigned / unlicensed), which belong in the full inventory, not
  // the working plan. Visibility is decided in ONE place — the composition's
  // capability rule (if you're capable of an activity you see it, at its real
  // count, 0 or not) — so this layer only drops the awareness bands and orders
  // the rest; it no longer re-derives visibility from actionable / unresolved /
  // standing / spine conditions.
  // Drop only the TRULY awareness-only rows: an unassigned/unlicensed activity
  // that has NO project source (not part of a project this worker is on). A
  // project step the composition deliberately kept — including a capable step
  // that happens to be empty, whose band can read 'unassigned' at zero because
  // the band is derived from the (now empty) item set rather than the standing
  // assignment — stays in the plan so the full workflow spine is always visible.
  // (The composition already decided visibility by capability; this layer must
  // not re-drop a kept project step just because its zero-item band looks
  // unassigned.)
  const AWARENESS_ONLY = new Set<PriorityBand>(['unassigned', 'unlicensed'])
  const hasProjectSource = (a: ActivityGroup): boolean =>
    a.sources.some((s) => s.kind === 'project')
  // A kept project step must also be THIS worker's. The composition can emit a
  // project source for an activity the worker has no standing in (so the band
  // reads unassigned/unlicensed), which would otherwise show a step they can
  // never work (for example Determination at 0 for a non-producer). Their
  // standing responsibilities (primary/support at ANY scope, including a
  // project-scoped assignment that reads unassigned while the step is empty)
  // or an assist/routable capability status mark a step as theirs.
  const myFunctions = new Set<string>(state.responsibilities.map((r) => r.workFunction))
  const isMine = (a: ActivityGroup): boolean =>
    myFunctions.has(a.workFunction) ||
    a.capabilityStatus === 'routable' ||
    a.capabilityStatus === 'assist'
  const planActivities = state.activities
    .filter((a) => !AWARENESS_ONLY.has(a.band) || (hasProjectSource(a) && isMine(a)))
    .sort(byFixedWorkflowOrder)

  // QUIET is about actual ACTIONABLE work, not the always-visible spine. The
  // spine keeps the pipeline on screen even when every step is empty, so it must
  // NOT by itself make the briefing read "you have work". A day is quiet when
  // nothing is actionable and nothing has unresolved/standing work to do —
  // regardless of the zeroed spine steps still shown for orientation.
  const hasActionableWork = state.activities.some(
    (a) => isActionable(a) || hasUnresolvedOnly(a) || hasServicingAccessStandingStep(a),
  )

  if (!hasActionableWork) {
    // Nothing to do, but STILL show the spine (at zero) so the operator sees the
    // workflow. Primary/support/work-mode groups stay empty (those are actionable
    // work only); the plan carries the zeroed spine for orientation.
    return {
      quiet: true,
      fixedTimeCommitments,
      projectsWithAvailableWork,
      workingPlan: planActivities.length > 0 ? buildWorkingPlan(planActivities) : [],
      primary: [],
      support: [],
      workModeGroups: [],
    }
  }

  // The recommended WORKING PLAN: an ordered sequence of concrete steps built
  // from the actionable activities, with Outreach expanded into its real
  // sub-populations. Available Work ALWAYS follows the fixed workflow order
  // (find missing contact information, send introductory emails, make the calls
  // that are due, process servicing access,
  // advance operations preparation), enforced by sorting planActivities with
  // byFixedWorkflowOrder above. ZEN priority still classifies each activity's
  // band (which drives the yellow highlight and the Priorities column), but it
  // no longer reorders these steps. Every step's count/route is read from
  // resolved work.
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

/**
 * A route opens the dedicated DIRECT WORKING screen (land on the first eligible
 * customer, advance automatically) rather than an intermediate board queue list.
 * The direct screens live at /stewardship/introductory-emails and
 * /stewardship/available-to-call; a plain /stewardship?queue=... link is the
 * board list, which the working plan must never use for these sub-populations.
 */
function isDirectWorkingRoute(route: string | null | undefined): boolean {
  return !!route && /\/stewardship\/(introductory-emails|calls-due)\b/.test(route)
}

/**
 * Find an outreach informational sub-population across ALL matching sources, not
 * just the first.
 *
 * The composition emits the SAME sub-population (Introductory emails / Available
 * to Call) as more than one informational source: the recorded Shared
 * Stewardship board source AND the derived record-less onboarding source for a
 * project. These describe DISJOINT customer sets (the derived population excludes
 * every customer already represented by a recorded outreach row), so summing
 * their actionable counts includes all eligible recorded AND record-less
 * customers while counting each customer exactly once.
 *
 * Previously this took the FIRST matching source, so once a single recorded
 * outreach customer existed the recorded source (count 1) shadowed the derived
 * population (the 100+ record-less members), and the step both under-counted and
 * routed to the recorded source's screen. Aggregating fixes the count; the route
 * is chosen to open the COMPLETE population on the direct working screen.
 *
 * Route selection: prefer a direct-working route (the dedicated screen that
 * lands on the first eligible customer and auto-advances). When every matching
 * source's work is in ONE project, use that project's scoped direct-working
 * route so the screen opens exactly the full project population; otherwise use
 * the unscoped direct-working route, which loads the employee's entire eligible
 * population. A board-queue route is used only as a last resort when no source
 * exposes a direct-working route at all.
 */
function outreachSubPopulation(
  outreach: ActivityGroup,
  match: RegExp,
  opts?: { standing?: boolean },
): { count: number; route: string | null } | null {
  const matching = outreach.sources.filter(
    (src) => src.informational && match.test(src.label),
  )
  if (matching.length === 0) return null

  // Total actionable work across every matching source (recorded + derived).
  // The sets are disjoint by construction, so this counts each customer once.
  let count = 0
  for (const s of matching) count += s.ownedByMe + s.availableToMe
  // A STANDING sub-population stays a reachable step even at zero: the plan
  // shows the whole outreach workflow, and a 0 is the honest signal that the
  // step is cleared (time to refresh the population) rather than a reason to
  // hide it. A non-standing sub-population keeps the original "drop at zero"
  // behavior. The composition always emits the source for an outreach-eligible
  // employee, so at zero there is still a usable unscoped route below.
  if (count <= 0 && !opts?.standing) return null

  // The distinct projects that actually carry actionable work for this
  // sub-population, gathered from each source's own project and its per-project
  // scopes. Used to decide whether a single project's direct screen covers the
  // whole population.
  const projectsWithWork = new Set<string>()
  for (const s of matching) {
    if (s.projectId && s.ownedByMe + s.availableToMe > 0) projectsWithWork.add(s.projectId)
    if (s.projectScopes) {
      for (const [pid, scope] of Object.entries(s.projectScopes)) {
        if (scope.ownedByMe + scope.availableToMe > 0) projectsWithWork.add(pid)
      }
    }
  }

  // Choose the route that opens the COMPLETE population on the direct working
  // screen. When all work is one project, prefer that project's scoped
  // direct-working route (from any source's top-level route or project scope);
  // otherwise prefer an unscoped direct-working route. Fall back to a
  // direct-working route from a project scope, then to any source route.
  let route: string | null = null
  if (projectsWithWork.size === 1) {
    const onlyPid = [...projectsWithWork][0]
    for (const s of matching) {
      const scoped = s.projectScopes?.[onlyPid]?.route
      if (isDirectWorkingRoute(scoped)) { route = scoped!; break }
    }
  }
  if (!route) {
    // An unscoped direct-working route (no project_id) loads the whole eligible
    // population; a scoped one is still direct-working. Prefer unscoped when the
    // work spans projects, else accept any direct-working top-level route.
    const unscoped = matching.find(
      (s) => isDirectWorkingRoute(s.route) && !/project_id=/.test(s.route ?? ''),
    )?.route
    const anyTopLevel = matching.find((s) => isDirectWorkingRoute(s.route))?.route
    route =
      (projectsWithWork.size > 1 ? unscoped : undefined) ??
      anyTopLevel ??
      unscoped ??
      null
  }
  if (!route) {
    // Last resort: a direct-working route from any project scope, else the first
    // source's route (board queue) so the step is never unreachable.
    for (const s of matching) {
      if (!s.projectScopes) continue
      const scoped = Object.values(s.projectScopes).find((sc) => isDirectWorkingRoute(sc.route))?.route
      if (scoped) { route = scoped; break }
    }
    if (!route) route = matching[0].route
  }

  return { count, route }
}

/**
 * The Servicing Access sub-population source, read WITHOUT the count>0 gate the
 * other outreach sub-populations use. The composition always emits this
 * informational source for an outreach-eligible employee (count 0 or more), so
 * Servicing Access stays a reachable Available-work step even when no forms are
 * awaiting processing — the task is to keep it clickable, showing 0 when
 * appropriate. The count is the real pending-work figure (owned + available)
 * and the route preserves the composition's project/eligibility scoping.
 */
function outreachServicingAccess(
  outreach: ActivityGroup,
): { count: number; route: string | null } | null {
  const s = outreach.sources.find(
    (src) => src.informational && /servicing access/i.test(src.label),
  )
  if (!s) return null
  return { count: s.ownedByMe + s.availableToMe, route: s.route }
}

/**
 * The Customer Interaction standing source, read the same way as Servicing
 * Access (WITHOUT a count>0 gate): the composition always emits this
 * informational source for an outreach-eligible employee (count 0 or more), so
 * Customer Interaction stays a reachable Available-work step — between calling
 * and Servicing Access — even when no conversations are active right now, with
 * its find-a-customer search ready the moment a response arrives. The count is
 * the real engaged-pre-authorization figure (owned + available).
 */
function outreachCustomerInteraction(
  outreach: ActivityGroup,
): { count: number; route: string | null } | null {
  const s = outreach.sources.find(
    (src) => src.informational && /customer interaction/i.test(src.label),
  )
  if (!s) return null
  return { count: s.ownedByMe + s.availableToMe, route: s.route }
}

/**
 * The fixed workflow order Available Work always follows, by work function. The
 * six operator-facing steps run research -> outreach (introductory emails, then
 * due calls, then servicing access) ->
 * operations preparation; the Outreach sub-steps are sequenced inside
 * buildWorkingPlan. Any work function not listed here keeps a stable position
 * after the known steps, so a new activity is never dropped. ZEN still computes
 * each activity's priority band (driving the yellow highlight and the Priorities
 * column); this order deliberately does NOT depend on that band.
 */
const FIXED_WORKFLOW_ORDER: ActivityGroup['workFunction'][] = [
  // Verify Servicing Agent is the GATE and the first thing done: a policy must
  // have a definite servicing-agent answer before any capture/review work on it
  // can proceed, so it leads the fixed workflow order.
  'verify_servicing_agent',
  'research',
  'outreach',
  'operations_prep',
]

/**
/** Comparator that places activities in the fixed workflow order above.
 * Unlisted work functions sort after all listed ones, preserving their relative
 * order (a stable sort keeps the incoming ZEN-rank order among them). */
function byFixedWorkflowOrder(x: ActivityGroup, y: ActivityGroup): number {
  const rank = (wf: ActivityGroup['workFunction']): number => {
    const i = FIXED_WORKFLOW_ORDER.indexOf(wf)
    return i === -1 ? FIXED_WORKFLOW_ORDER.length : i
  }
  return rank(x.workFunction) - rank(y.workFunction)
}

/**
 * Build the ordered working plan from the actionable activities (already placed
 * in the fixed workflow order by byFixedWorkflowOrder). Each activity becomes
 * one step, except Outreach which expands into its real sub-populations in
 * working order: introductory emails first (efficient initial outreach), then
 * calls, with due calls distinguished from other callable customers. Operations
 * Preparation is its own step, work that is ready to advance independently of
 * ongoing outreach.
 *
 * This introduces NO priority: the activity order is the fixed workflow order
 * applied before this call, and the Outreach sub-steps are a fixed, descriptive
 * working sequence over the SAME outreach work (not a re-ranking). Counts and
 * routes are read from the resolved activity/sources.
 */
export function buildWorkingPlan(actionable: ActivityGroup[]): PlanStep[] {
  const steps: PlanStep[] = []
  for (const a of actionable) {
    const emphasis = a.band === 'focus' || a.band === 'exact_time_commitment' || a.band === 'due_callback'
    switch (a.workFunction) {
      case 'verify_servicing_agent': {
        // The gate: confirm per policy whether we are the servicing agent before
        // any capture/review work proceeds. The count is the unverified-policy
        // figure the composition resolved (each policy is one unit of work).
        steps.push({
          key: 'verify_servicing_agent',
          title: 'Verify servicing agent',
          reason:
            'Before anything else, confirm whether we are the servicing agent on each policy by looking it up in the Everlake portal. Until a policy has a definite answer, no capture or review work on it can proceed.',
          count: actionableCountOf(a),
          actionLabel: 'Start verifying',
          route: primaryRouteFor(a),
          emphasis,
        })
        break
      }
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
          // The headline is only the customers NOT YET researched. Those already
          // researched without success are retry work (a separate, lowest-priority
          // Assistant step) and must not inflate the Available Work figure.
          count: Math.max(0, unresolved - (a.unsuccessfulCount ?? 0)),
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
        // All three call/email sub-populations are STANDING steps: they stay in
        // the plan even at zero so the full outreach workflow is always visible
        // and a 0 reads as "this step is cleared — refresh the population when
        // every step is 0", rather than the step silently vanishing. The
        // composition always emits their informational sources for an outreach-
        // eligible employee, so each has a usable route even at zero. Customer
        // Interaction and Servicing Access below are already standing the same
        // way; this brings the email/call sub-steps in line.
        const intro = outreachSubPopulation(a, /introductory email/i, { standing: true })
        const callsDue = outreachSubPopulation(a, /calls due/i, { standing: true })
        const unableToCall = outreachSubPopulation(a, /unable to call/i, { standing: true })

        if (intro) {
          steps.push({
            key: 'outreach:intro',
            title: 'Send introductory emails',
            reason:
              'A first email (carrying the authorization form) is efficient initial outreach before calling, for customers not yet contacted.',
            count: intro.count,
            actionLabel: 'Send introductory emails',
            route: intro.route,
            emphasis,
          })
        }
        if (callsDue) {
          steps.push({
            key: 'outreach:calls-due',
            title: 'Make the calls that are due',
            reason:
              'These customers are owed a call: a first call, a cadence retry whose business day has arrived, or a promised callback that has come due.',
            count: callsDue.count,
            actionLabel: 'Open Calls Due',
            // Due calls are emphasized only when there actually are some; an
            // empty standing step is not highlighted as urgent work.
            emphasis: callsDue.count > 0 ? true : emphasis,
            route: callsDue.route,
          })
        }
        // People We Can't Call sits directly under the calls that are due: the
        // same reaching-the-customer work, the branch where there is no phone to
        // dial. A STANDING step (shown even at zero), so the outreach workflow is
        // always visible and a newly-populated no-phone customer has a home.
        if (unableToCall) {
          steps.push({
            key: 'outreach:unable-to-call',
            title: "People we can't call",
            reason:
              'These customers are in outreach but have no phone number on file. Research a phone to drop them back into calling; if none can be found, reach them by email or postal mail.',
            count: unableToCall.count,
            actionLabel: "Open People We Can't Call",
            route: unableToCall.route,
            emphasis,
          })
        }
        // Customer Interaction sits between calling and Servicing Access in the
        // working order: a customer who has genuinely responded (reached, a
        // promised callback, or a recorded inbound response) is in an active
        // conversation worked after routine calling and before a signed
        // authorization is in hand. Like Servicing Access it is ALWAYS shown as
        // a reachable step for an outreach-eligible employee, even at count 0 (a
        // response can arrive at any time and the screen's find-a-customer search
        // starts the work), so it is NOT gated on count > 0. The count is the
        // real engaged-pre-authorization figure from the composition's
        // informational source (0 when none); the route preserves project scope.
        const customerInteraction = outreachCustomerInteraction(a)
        if (customerInteraction) {
          steps.push({
            key: 'outreach:customer-interaction',
            title: 'Work active customer conversations',
            reason:
              'These customers have responded and are in an active conversation, but the signed authorization has not come back yet. Record incoming responses, outgoing replies, conversation notes, and follow-up commitments; the signed form moves them on to Servicing Access.',
            count: customerInteraction.count,
            actionLabel: 'Open Customer Interaction',
            route: customerInteraction.route,
            emphasis,
          })
        }
        // Servicing Access sits between calling and operations preparation in the
        // working order: a signed authorization in hand is worked after outreach
        // reaches the customer and before operations collects documents. It is
        // ALWAYS shown as a reachable step for an outreach-eligible employee,
        // even at count 0 (a signed authorization can arrive at any time and the
        // screen's find-a-customer search starts the work), so unlike the other
        // outreach sub-populations it is NOT gated on count > 0. The count is the
        // real pending-work figure from the composition's informational source
        // (0 when none), and the route preserves project/eligibility scope.
        const servicingAccess = outreachServicingAccess(a)
        if (servicingAccess) {
          steps.push({
            key: 'outreach:servicing-access',
            title: 'Process servicing access',
            reason:
              'A signed servicing-agent authorization is in hand: save the form, send it to the carrier, follow up, and record confirmation, which opens Operations Preparation. Open it any time a signed authorization arrives.',
            count: servicingAccess.count,
            actionLabel: 'Open Servicing Access',
            route: servicingAccess.route,
            emphasis,
          })
        }
        // Fallback: outreach exists but no sub-population surfaced at all — e.g.
        // an employee who is not outreach-eligible, so the composition emitted
        // none of the standing sources. Offer the activity directly so the step
        // is never silently dropped. For an eligible employee the three standing
        // call/email steps (plus Customer Interaction and Servicing Access) are
        // always present, so this fallback does not fire and no redundant
        // "Continue outreach" row is added on top of them.
        const hasAnyOutreachStep = !!intro || !!callsDue || !!unableToCall
        if (!hasAnyOutreachStep && !servicingAccess && !customerInteraction) {
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
