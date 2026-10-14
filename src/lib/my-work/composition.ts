/**
 * MY WORK composition (server-only) — Right Path.
 *
 * Ported from the IPF composition pattern (src/composition/daily-direction.ts):
 * assemble candidate work from EXISTING repository reads only, then hand each
 * activity group to the ZEN-backed engine. This is the only place MY WORK
 * creates a Supabase client.
 *
 * It organizes real, actionable work BY ACTIVITY for the signed-in employee,
 * across the shared Stewardship board and the 1035 project. Settled decisions
 * preserved:
 *   - Existing records are the durable truth. No activity is duplicated and no
 *     task database is created: counts come from stewardship_outreach and the
 *     derived 1035 workflow (buildProjectWorkflow), the SAME reads those
 *     surfaces use. Each business activity appears ONCE; its sources are listed
 *     beneath it.
 *   - Work is SHARED by default. The board is never filtered by claim; the view
 *     reports owned vs unclaimed counts but shows all of it.
 *   - Capability decides eligibility; a promised callback (customer commitment)
 *     outranks Today's Focus; focus elevates only eligible work and never
 *     disables other work. ALL of that ordering is decided by ZEN, not here.
 *   - "Today" for a due date-only callback is the signed-in employee's calendar
 *     (via the shared time module), never the server clock.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { QUEUE_META, deriveFollowUpRouting, deriveEmailRouting, isWaitingFollowUpDue, callPopulationOf, type OutreachQueue, type CallReason, type ResearchReason, type CallOutcome } from '@/lib/stewardship/queues'
import { createTimeContext } from '@/lib/time'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import { buildProjectWorkflow, summarizeWorkflow } from '@/lib/projects/review-1035'
import { activeProjectsWithWorkflow, onboardingCompleteForPolicies } from '@/lib/projects/workflows'
import { buildContactReview, summarizeContactReview } from '@/lib/projects/contact-review'
import {
  loadWorkFunctions,
  resolveCapabilityProfile,
} from '@/lib/capabilities/resolve'
import {
  canActOnItem,
  claimedByOther,
  classifyCapability,
  isEligibleFor,
  type CapabilityStatus,
  type QualificationKey,
  type WorkFunctionKey,
} from '@/lib/capabilities/work-functions'
import {
  getActiveFocus,
  focusElevatesActivity,
  type ActiveFocus,
} from '@/lib/capabilities/todays-focus'
import { evaluateActivityBand, buildActivityReason } from './engine'
import type {
  ActivityFacts,
  ActivityGroup,
  ActivityProjectCounts,
  FocusNote,
  MyWorkState,
  PriorityBand,
  WorkSource,
  WorkSourceProjectScope,
} from './types'

const STEWARDSHIP_ROUTE = '/stewardship'

function stewardshipRoute(queue: OutreachQueue, projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}?queue=${encodeURIComponent(queue)}`
  // When the link is project-scoped (the employee is eligible for only that
  // project's items), carry the project id so the board opens exactly that
  // subset of the queue — not the whole shared queue.
  return projectId ? `${base}&project_id=${encodeURIComponent(projectId)}` : base
}

/**
 * A link to a derived ACTION POPULATION on the board (not a single stored
 * queue). The populations are callability-based, so a customer callable from
 * Ready to Email still appears under the call populations. The board opens
 * exactly the customers the population counted (Rule 1): the same derivation
 * runs on the board route, so the counted and opened sets match.
 */
function populationRoute(population: 'available-to-call' | 'calls-due', projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}?population=${encodeURIComponent(population)}`
  return projectId ? `${base}&project_id=${encodeURIComponent(projectId)}` : base
}

/**
 * Which stewardship queues map to which activity. The shared board's outreach
 * queues (ready-to-call, ready-to-email, and the overdue follow-ups routed into
 * ready-to-call) are the Outreach activity; research-needed is the Research
 * (exception) activity. Waiting queues are not actionable work and are excluded.
 */
const STEWARDSHIP_ACTIVITY: Partial<Record<OutreachQueue, WorkFunctionKey>> = {
  'ready-to-call': 'outreach',
  'ready-to-email': 'outreach',
  'research-needed': 'research',
}

/**
 * How one shared-board item counts toward THIS employee's My Work tally. Pure
 * and exported so the two settled rules below are directly testable without a
 * live board read:
 *
 *   1. Overqualified-ASSIST employees see shared work they can PICK UP. Assist
 *      is pickable (consistent with the claim path, where canActOn('assist') is
 *      true), so an assist-capable item is actionable — owned/available/
 *      claimed-by-others — not awareness-only. Only truly non-actionable
 *      standings (unassigned / unlicensed) are awareness ('notEligible'). Assist
 *      never feeds routable eligibility, so GoRules priorities are unchanged
 *      (the ZEN isEligible fact is driven only by routable work).
 *   2. A due callback is counted as MY due work only when it is mine to act on —
 *      owned by me or unclaimed. A due callback already claimed by ANOTHER
 *      employee is that teammate's commitment and is never my due callback.
 */
export type BoardItemBucket =
  | 'owned'
  | 'available'
  | 'claimedByOthers'
  | 'notEligible'

export interface BoardItemClassification {
  bucket: BoardItemBucket
  /** Feeds the routable eligible-item count (and thus the ZEN isEligible fact). */
  routableEligible: boolean
  /** Counts as a due callback FOR THIS EMPLOYEE (owned-by-me or unclaimed). */
  countsAsMyDueCallback: boolean
}

export function classifyBoardItem(input: {
  /** The employee is ROUTABLY eligible (primary/support) for this item. */
  routableEligible: boolean
  /** The employee is overqualified (assist) for this item. */
  assistCapable: boolean
  /** Who has claimed the item: this employee, another, or no one (null). */
  claimedBy: 'me' | 'other' | null
  /** Whether the item is a due date-only promised callback. */
  isDueCallback: boolean
}): BoardItemClassification {
  const canPickUp = input.routableEligible || input.assistCapable
  if (!canPickUp) {
    // Unassigned / unlicensed: shown for awareness only.
    return { bucket: 'notEligible', routableEligible: false, countsAsMyDueCallback: false }
  }
  if (input.claimedBy === 'me') {
    return {
      bucket: 'owned',
      routableEligible: input.routableEligible,
      countsAsMyDueCallback: input.isDueCallback,
    }
  }
  if (input.claimedBy === 'other') {
    // A teammate's claim: never available to me, and never MY due callback.
    return {
      bucket: 'claimedByOthers',
      routableEligible: input.routableEligible,
      countsAsMyDueCallback: false,
    }
  }
  // Unclaimed and pickable by me.
  return {
    bucket: 'available',
    routableEligible: input.routableEligible,
    countsAsMyDueCallback: input.isDueCallback,
  }
}

/** Short queue label for a per-queue shared-board source (so the email-only
 * queue reads as such and links to the right queue). */
const QUEUE_LABEL: Record<OutreachQueue, string> = {
  'ready-to-email': QUEUE_META['ready-to-email'].label,
  'ready-to-call': QUEUE_META['ready-to-call'].label,
  'research-needed': QUEUE_META['research-needed'].label,
  'waiting-for-response': QUEUE_META['waiting-for-response'].label,
  'waiting-for-form': QUEUE_META['waiting-for-form'].label,
  'waiting-for-carrier': QUEUE_META['waiting-for-carrier'].label,
}

type BoardRow = {
  id: string
  queue: OutreachQueue
  call_reason: string | null
  research_reason: string | null
  last_call_outcome: string | null
  email_sent_at: string | null
  callback_date: string | null
  follow_up_due: string | null
  refused_at: string | null
  claimed_by_producer_id: string | null
  customer_prereviews: {
    decision: string | null
    customer_id: string
    // Contact facts, so the call / email populations are derived from actual
    // callability/emailability rather than solely the stored queue (Rule 1).
    customers: { phone: string | null; email: string | null }
  }
}

export interface MyWorkOptions {
  /** The signed-in auth user id (maps to a producer). */
  authUserId: string
  /** Evaluation instant. Injected for testability; defaults to now. */
  now?: Date
  /** The signed-in employee's detected IANA timezone (actor-calendar "today"). */
  actorTimeZone?: string | null
}

/**
 * Internal accumulator for one activity while sources are tallied, before ZEN.
 */
interface Accum {
  workFunction: WorkFunctionKey
  label: string
  description: string | null
  /** Total items in this activity (every item, regardless of eligibility). */
  total: number
  sources: WorkSource[]
  /**
   * Per-ITEM facts are aggregated here so a project-scoped focus or eligibility
   * applies ONLY to the items it actually covers, never to the whole activity:
   *   - eligible: items the employee is eligible to work (agency-wide
   *     eligibility covers all; a project-scoped eligibility covers only items
   *     whose customer belongs to that project).
   *   - focusEligible: eligible items that are ALSO focus-elevated (a project
   *     focus covers only that project's items; an agency-wide activity focus
   *     covers all). Focus never elevates ineligible items.
   *   - dueEligible: eligible items with a due DATE-ONLY callback.
   *   - owned: eligible items the employee has claimed.
   * These counts drive the ZEN facts, so the activity's band reflects the
   * elevated/eligible PORTION, not an unrelated-customer union.
   */
  eligible: number
  focusEligible: number
  dueEligible: number
  owned: number
  /** Eligible to me AND unclaimed (available to pick up right now). */
  availableToMe: number
  /** Eligible to me but claimed by ANOTHER employee. */
  claimedByOthers: number
  /**
   * Every project this activity's work belongs to (union across items). Used
   * ONLY for display (the sources already name their project) and for deciding
   * whether to surface an empty, focus-directed activity; never to grant
   * eligibility or focus to unrelated items.
   */
  projectIds: Set<string>
  /**
   * The authoritative per-project aggregate of this activity's counts, keyed by
   * project id, built from the SAME per-item bucketing as the activity totals
   * (each customer once, including ready-to-call). This is what the Project
   * filter reads for its headline numbers, so a filtered total never drops a
   * ready-to-call customer and never double-counts a customer with multiple
   * contact methods. Includes both shared-board items (via the per-queue
   * project partition) and project-scoped activities (operations prep, etc.).
   */
  projectTotals: Map<string, ActivityProjectCounts>
}

/** A mutable per-project count bucket used while aggregating; serialized to the
 * ActivityProjectCounts shape on the ActivityGroup at the end. */
function emptyProjectCounts(): ActivityProjectCounts {
  return { totalCount: 0, ownedCount: 0, availableCount: 0, claimedByOthersCount: 0, notEligibleCount: 0, dueCount: 0 }
}

/** Add one activity's project bucket, creating it if absent. */
function projectBucket(a: Accum, projectId: string): ActivityProjectCounts {
  let b = a.projectTotals.get(projectId)
  if (!b) { b = emptyProjectCounts(); a.projectTotals.set(projectId, b) }
  return b
}

/**
 * Assemble and decide the MY WORK state for the signed-in employee. Reads the
 * live shared board and the 1035 workflow, groups by activity, resolves
 * capability + focus + claims, and lets ZEN assign each activity's priority band.
 */
export async function getMyWork(options: MyWorkOptions): Promise<MyWorkState> {
  const now = options.now ?? new Date()
  const timeCtx = createTimeContext({ now, actorTimeZone: options.actorTimeZone })
  const supabase = createAdminClient()

  // 1. Who is the employee, and what are they eligible for.
  const [profile, workFunctions, focus] = await Promise.all([
    resolveCapabilityProfile(options.authUserId),
    loadWorkFunctions(),
    getActiveFocus(now),
  ])

  if (!profile) {
    // No producer record: no personal work profile. Return an empty, quiet
    // state rather than inventing eligibility.
    return {
      employeeName: null,
      noProfile: true,
      activities: [],
      focusNotes: flattenFocus(focus, new Map()),
      quiet: true,
    }
  }

  const myProducerId = profile.producerId

  // 2. Seed one accumulator per catalog activity, so every activity appears
  // exactly once (even when it currently has zero items — those are dropped at
  // the end unless the employee is eligible and it is focus-elevated).
  const acc = new Map<WorkFunctionKey, Accum>()
  for (const wf of workFunctions) {
    acc.set(wf.canonicalKey, {
      workFunction: wf.canonicalKey,
      label: wf.label,
      description: wf.description,
      total: 0,
      sources: [],
      eligible: 0,
      focusEligible: 0,
      dueEligible: 0,
      owned: 0,
      availableToMe: 0,
      claimedByOthers: 0,
      projectIds: new Set<string>(),
      projectTotals: new Map<string, ActivityProjectCounts>(),
    })
  }

  // The projects this employee holds a project-scoped (routable) eligibility in,
  // per activity. Used to build an eligible-scoped deep link when the employee
  // is NOT agency-wide eligible: the link carries the project scope so it opens
  // exactly the subset they can act on, not the whole queue.
  const scopedProjectsFor = (activity: WorkFunctionKey): Set<string> => {
    const out = new Set<string>()
    for (const e of profile.eligibilities) {
      if (e.workFunction !== activity) continue
      if (e.assignment !== 'primary' && e.assignment !== 'support') continue
      if (e.projectId) out.add(e.projectId)
    }
    return out
  }
  const agencyWideEligible = (activity: WorkFunctionKey): boolean => isEligibleFor(profile, activity)

  // Per-item eligibility + focus helpers. An item's project set decides which
  // project-scoped eligibilities/focuses apply to it; agency-wide ones always
  // apply. This is the heart of the project-scoping fix: a focus or eligibility
  // on project A affects an item ONLY when that item belongs to project A.
  const itemEligible = (activity: WorkFunctionKey, itemProjects: Set<string>): boolean => {
    if (isEligibleFor(profile, activity)) return true // agency-wide
    for (const pid of itemProjects) if (isEligibleFor(profile, activity, pid)) return true
    return false
  }
  const itemFocusElevated = (activity: WorkFunctionKey, itemProjects: Set<string>): boolean => {
    if (focusElevatesActivity(focus, activity)) return true // agency-wide activity focus
    for (const pid of itemProjects) if (focusElevatesActivity(focus, activity, pid)) return true
    return false
  }

  // The required-qualification gate per activity, from the catalog (the single
  // source of truth). Used to tell a confirmed license gap apart from merely
  // being unassigned.
  const requiredQualByActivity = new Map<WorkFunctionKey, QualificationKey | null>(
    workFunctions.map((w) => [w.canonicalKey, w.requiredQualification]),
  )

  // Resolve the employee's capability STANDING for an activity across the scopes
  // that matter to it (agency-wide plus every project the activity's work
  // touches), returning the strongest standing found. This is what distinguishes
  // routable / assist / unassigned / unlicensed — the three+ situations that
  // must route differently — instead of one undifferentiated boolean. ZEN still
  // owns the band; this only supplies the facts.
  const RANK: Record<CapabilityStatus, number> = {
    routable: 0,
    assist: 1,
    unassigned: 2,
    unlicensed: 3,
  }
  const activityCapabilityStatus = (
    activity: WorkFunctionKey,
    scopeProjects: Set<string>,
  ): CapabilityStatus => {
    const required = requiredQualByActivity.get(activity) ?? null
    // Always consider agency-wide (projectId null); add each relevant project.
    let best = classifyCapability(profile, activity, required, null)
    for (const pid of scopeProjects) {
      const s = classifyCapability(profile, activity, required, pid)
      if (RANK[s] < RANK[best]) best = s
    }
    return best
  }

  // Resolve how a ROUTABLE activity is routed to this employee: primary vs
  // support. This reads the stored assignment type (producer_work_functions)
  // directly, so it never invents a responsibility the employee does not hold.
  // Across the scopes the activity touches (agency-wide plus every project its
  // work belongs to), a PRIMARY assignment wins over a SUPPORT one, because the
  // employee's primary accountability is the stronger framing to surface. Only
  // routable assignments count here; 'overqualified' is assist, not routing.
  // Returns 'none' when the employee has no routable assignment for the work.
  const routedAssignmentFor = (
    activity: WorkFunctionKey,
    scopeProjects: Set<string>,
  ): 'primary' | 'support' | 'none' => {
    const applies = (projectId: string | null): boolean =>
      projectId === null || scopeProjects.has(projectId)
    let sawSupport = false
    for (const e of profile.eligibilities) {
      if (e.workFunction !== activity) continue
      if (!applies(e.projectId)) continue
      if (e.assignment === 'primary') return 'primary'
      if (e.assignment === 'support') sawSupport = true
    }
    return sawSupport ? 'support' : 'none'
  }

  // 3. Shared Stewardship board (the SAME read the board + Daily Direction use).
  // customer_id is selected so each item can be associated to the project(s) its
  // customer belongs to — the fix that lets a project focus elevate project work
  // that currently sits in a shared queue.
  const { data: boardData, error: boardErr } = await supabase
    .from('stewardship_outreach')
    .select(`
      id, queue, call_reason, research_reason, last_call_outcome, email_sent_at, callback_date, follow_up_due, refused_at, claimed_by_producer_id,
      customer_prereviews!inner ( decision, customer_id, customers!inner ( phone, email ) )
    `)
    .order('updated_at', { ascending: true })
  if (boardErr) throw new Error(`MY WORK board read failed: ${boardErr.message}`)

  // Open items only, and never a refused one (explicit refusal stops outreach),
  // matching the board's suppression. This is the DECISION/REFUSED gate; the
  // onboarding-complete gate is applied just below once policy facts are read.
  const openRowsBase = ((boardData ?? []) as unknown as BoardRow[]).filter(
    (r) => r.customer_prereviews?.decision == null && r.refused_at == null,
  )

  // The customers appearing on the open board, used both for the project
  // membership read and the onboarding-complete derivation below.
  const boardCustomerIds = Array.from(
    new Set(openRowsBase.map((r) => r.customer_prereviews.customer_id)),
  )

  // Onboarding-complete suppression — the SAME authoritative fact the project
  // board uses (/api/stewardship/route.ts). A customer whose applicable
  // (permanent) servicing access is confirmed has ADVANCED past onboarding
  // (into Review Preparation), so a lingering open outreach row for them is NOT
  // onboarding work and must not be counted or recommended. Completion is
  // DERIVED from service_policies.sa_status via the one shared predicate
  // (onboardingCompleteForPolicies), never re-derived here. Only a customer who
  // actually HAS policies and whose permanent ones are all confirmed is treated
  // as advanced (matching the board's `policies.length > 0` guard), so a
  // customer with no known policy is never dropped by accident.
  const onboardingCompleteCustomerIds = new Set<string>()
  if (boardCustomerIds.length > 0) {
    const policiesByCustomer = new Map<string, { product_type: string | null; sa_status: string | null }[]>()
    for (let i = 0; i < boardCustomerIds.length; i += 300) {
      const chunk = boardCustomerIds.slice(i, i + 300)
      const { data: pols } = await supabase
        .from('service_policies')
        .select('customer_id, product_type, sa_status, is_test')
        .in('customer_id', chunk)
        .eq('is_test', false)
      for (const p of (pols ?? []) as { customer_id: string; product_type: string | null; sa_status: string | null }[]) {
        const list = policiesByCustomer.get(p.customer_id) ?? []
        list.push({ product_type: p.product_type, sa_status: p.sa_status })
        policiesByCustomer.set(p.customer_id, list)
      }
    }
    for (const [cid, policies] of policiesByCustomer) {
      if (policies.length > 0 && onboardingCompleteForPolicies(policies)) {
        onboardingCompleteCustomerIds.add(cid)
      }
    }
  }

  // The final open set: decision/refused gate AND the onboarding-complete gate,
  // so My Work and the project board count the same onboarding population. Both
  // the per-queue tally and the call-population pass iterate this set, so the
  // suppression applies everywhere a customer could be counted.
  const openRows = openRowsBase.filter(
    (r) => !onboardingCompleteCustomerIds.has(r.customer_prereviews.customer_id),
  )

  // Project association for the open board customers: which project(s) each
  // customer belongs to. This is the ONE extra read that preserves the project
  // link for shared work (no activity is duplicated; the association is metadata
  // on the single shared source). Existing records are the truth.
  const projectsByCustomer = new Map<string, Set<string>>()
  if (boardCustomerIds.length > 0) {
    const { data: memberships } = await supabase
      .from('project_customers')
      .select('customer_id, project_id')
      .in('customer_id', boardCustomerIds)
    for (const m of (memberships ?? []) as { customer_id: string; project_id: string }[]) {
      const set = projectsByCustomer.get(m.customer_id) ?? new Set<string>()
      set.add(m.project_id)
      projectsByCustomer.set(m.customer_id, set)
    }
  }

  // READ-ONLY effective-queue routing, computed the same way the board route
  // does, without writing (identical to the Daily Direction composition):
  //   1. Overdue waiting-for-response items count as ready-to-call (follow-up).
  //   2. An UNTOUCHED opening item whose email became usable after intake counts
  //      as ready-to-email (email routing). This is the live re-derivation that
  //      makes a newly-added email surface in Ready to Email without a
  //      stored-queue backfill — the email analogue of the live callability the
  //      call population already uses. Only one of the two can apply to a given
  //      item (follow-up targets waiting-for-response; email targets the two
  //      untouched opening states), so their order does not matter.
  const effectiveQueue = (r: BoardRow): OutreachQueue => {
    const followUp = deriveFollowUpRouting(
      { queue: r.queue, follow_up_due: r.follow_up_due },
      now,
    )?.queue as OutreachQueue | undefined
    if (followUp) return followUp
    const emailRouted = deriveEmailRouting({
      queue: r.queue,
      call_reason: r.call_reason as CallReason | null,
      research_reason: r.research_reason as ResearchReason | null,
      last_call_outcome: r.last_call_outcome as CallOutcome | null,
      email_sent_at: r.email_sent_at,
      callback_date: r.callback_date,
      refused_at: r.refused_at,
      has_usable_email: !!r.customer_prereviews.customers?.email?.trim(),
    })?.queue as OutreachQueue | undefined
    return emailRouted ?? r.queue
  }

  // Tally the shared board PER ITEM. Outreach is split by its actual queue so
  // each source links to the RIGHT queue (ready-to-call vs ready-to-email),
  // never always to calls. Research is its own activity. For every item we judge
  // eligibility and focus against the item's OWN projects, so a project-scoped
  // focus/eligibility only ever counts items that belong to that project. We also
  // record the per-queue claim breakdown for THIS employee (owned / available /
  // claimed-by-others / not-eligible) so the source can be stated precisely.
  interface QueueTally {
    total: number
    ownedByMe: number
    availableToMe: number
    claimedByOthers: number
    notEligible: number
    /** Items that are DUE for THIS employee (promised callback or cadence retry
     * at its scheduled date; owned-by-me or unclaimed). A subset of the
     * actionable items, never counted on top of them. */
    dueToMe: number
  }
  const emptyTally = (): QueueTally => ({
    total: 0, ownedByMe: 0, availableToMe: 0, claimedByOthers: 0, notEligible: 0, dueToMe: 0,
  })
  const perQueue = new Map<OutreachQueue, QueueTally>()
  // The SAME tally, partitioned by the project each item's customer belongs to,
  // so a shared source can report its per-project subset for the Project filter.
  // An item whose customer belongs to no project contributes only to perQueue
  // (agency-wide), never to a project partition — unrelated work stays out of a
  // project's filtered view. An item in several projects counts under each.
  const perQueueProject = new Map<OutreachQueue, Map<string, QueueTally>>()
  const bumpProjectTally = (
    queue: OutreachQueue,
    itemProjects: Set<string>,
    apply: (t: QueueTally) => void,
  ) => {
    if (itemProjects.size === 0) return
    let byProject = perQueueProject.get(queue)
    if (!byProject) { byProject = new Map<string, QueueTally>(); perQueueProject.set(queue, byProject) }
    for (const pid of itemProjects) {
      const pt = byProject.get(pid) ?? emptyTally()
      apply(pt)
      byProject.set(pid, pt)
    }
  }
  for (const r of openRows) {
    const q = effectiveQueue(r)
    // A waiting item (awaiting the signed form or carrier confirmation) is NOT
    // actionable while its follow-up window is open. But once that window
    // lapses, the chase IS actionable outreach work — the same outreach team
    // follows up — so a DUE waiting item is tallied under the Outreach activity
    // (its source still links to its own waiting queue). A not-yet-due waiting
    // item remains non-actionable and is skipped.
    const dueWaiting = isWaitingFollowUpDue(
      { queue: r.queue, follow_up_due: r.follow_up_due, refused_at: r.refused_at },
      now,
    )
    const activity = dueWaiting ? 'outreach' : STEWARDSHIP_ACTIVITY[q]
    if (!activity) continue // waiting (not yet due) queues are not actionable MY WORK
    // The queue a due-waiting source links to is the item's REAL queue (so the
    // worker lands on the signature/carrier chase list), not the outreach queue.
    const sourceQueue: OutreachQueue = dueWaiting ? r.queue : q
    const a = acc.get(activity)
    if (!a) continue

    const itemProjects = projectsByCustomer.get(r.customer_prereviews.customer_id) ?? new Set<string>()
    for (const pid of itemProjects) a.projectIds.add(pid)

    const t = perQueue.get(sourceQueue) ?? emptyTally()
    t.total += 1
    a.total += 1

    // A call is DUE (not merely available) when it has reached its scheduled
    // moment: either a promised CALLBACK that has come due, or an automatic
    // CADENCE retry whose scheduled date has arrived (the item was promoted from
    // waiting-for-response to Ready to Call by the follow-up routing because its
    // follow_up_due lapsed). "Available to Call" is a Ready-to-Call item that is
    // actionable now but not on a scheduled due date. This is the Rule-5
    // distinction, expressed as presentation over the SAME single workflow — the
    // customer is never duplicated; one item is either due or available, not
    // both. Only the call queue carries this distinction.
    const isCadencePromoted = q === 'ready-to-call' && r.queue === 'waiting-for-response'
    const callbackDueNow = q === 'ready-to-call' && isCallbackDue(r.callback_date, timeCtx)
    const isCallDue = callbackDueNow || isCadencePromoted

    // Classify this item for THIS employee. Assist-capable items are pickable
    // (consistent with the claim path); only unassigned/unlicensed are
    // awareness-only. A due item counts as mine only when owned-by-me or
    // unclaimed — a teammate's claimed commitment is never my due work. The
    // item's standing is judged against its OWN projects. isDueCallback carries
    // the broader "call due" sense (promised callback OR cadence retry) so the
    // ZEN due_callback band fires for a due cadence retry too, keeping scheduled
    // calls prioritized above merely-available ones.
    const rawClaimedBy = r.claimed_by_producer_id
    const cls = classifyBoardItem({
      routableEligible: itemEligible(activity, itemProjects),
      assistCapable: activityCapabilityStatus(activity, itemProjects) === 'assist',
      claimedBy: rawClaimedBy == null ? null : rawClaimedBy === myProducerId ? 'me' : 'other',
      isDueCallback: isCallDue,
    })

    // Record this item into each project partition it belongs to, with the EXACT
    // same bucketing the agency-wide tally uses below, so a project's filtered
    // counts are a true subset of the shared source rather than a separate
    // derivation. Project tallies own their own total (they start empty), so the
    // full set of increments is applied here. An item with no project touches no
    // partition, keeping unrelated work out of every project's filtered view.
    bumpProjectTally(sourceQueue, itemProjects, (pt) => {
      pt.total += 1
      if (cls.bucket === 'notEligible') { pt.notEligible += 1; return }
      if (cls.countsAsMyDueCallback) pt.dueToMe += 1
      switch (cls.bucket) {
        case 'owned': pt.ownedByMe += 1; break
        case 'claimedByOthers': pt.claimedByOthers += 1; break
        case 'available': pt.availableToMe += 1; break
      }
    })

    // Mirror the SAME per-item bucketing into the activity's authoritative
    // per-project aggregate. This counts each customer ONCE per project across
    // every queue (including ready-to-call), independent of which sources are
    // later emitted or suppressed — so the Project filter's headline total is
    // correct even though the ready-to-call per-queue source is not displayed.
    for (const pid of itemProjects) {
      const b = projectBucket(a, pid)
      b.totalCount += 1
      if (cls.bucket === 'notEligible') { b.notEligibleCount += 1; continue }
      if (cls.countsAsMyDueCallback) b.dueCount += 1
      switch (cls.bucket) {
        case 'owned': b.ownedCount += 1; break
        case 'claimedByOthers': b.claimedByOthersCount += 1; break
        case 'available': b.availableCount += 1; break
      }
    }

    if (cls.bucket === 'notEligible') {
      t.notEligible += 1
      perQueue.set(sourceQueue, t)
      continue // unassigned / unlicensed: awareness only
    }

    // Count a due call that is mine to act on (owned-by-me or unclaimed) toward
    // the "Calls Due" tally for this queue, so the source can report Calls Due
    // separately from Available to Call without double-counting.
    if (cls.countsAsMyDueCallback) t.dueToMe += 1

    // Only ROUTABLE eligibility feeds the eligible-item count that drives the
    // ZEN isEligible fact; assist stays non-routable but pickable, so it never
    // becomes routed work (the GoRules priorities are unchanged).
    if (cls.routableEligible) {
      a.eligible += 1
      if (itemFocusElevated(activity, itemProjects)) a.focusEligible += 1
    }
    if (cls.countsAsMyDueCallback) a.dueEligible += 1

    switch (cls.bucket) {
      case 'owned':
        a.owned += 1
        t.ownedByMe += 1
        break
      case 'claimedByOthers':
        // Pickable by me, but ANOTHER employee has claimed it — never counted as
        // available/unclaimed work.
        a.claimedByOthers += 1
        t.claimedByOthers += 1
        break
      case 'available':
        a.availableToMe += 1
        t.availableToMe += 1
        break
    }
    perQueue.set(sourceQueue, t)
  }

  // One source per contributing queue. Each links to the EMPLOYEE'S ELIGIBLE
  // work in that queue: agency-wide eligibility opens the whole queue; otherwise
  // the link carries the employee's eligible project scope so it opens only
  // their subset (not the whole queue). The source still shows the full queue
  // count for board visibility, plus the per-employee claim breakdown.
  for (const [q, t] of perQueue) {
    // A waiting queue only reaches perQueue when its items are follow-up-due, in
    // which case the chase is Outreach work; the action queues map as usual.
    const activity = STEWARDSHIP_ACTIVITY[q] ?? 'outreach'
    const a = acc.get(activity)
    if (!a || t.total === 0) continue

    // Decide the eligible-scoped route. If the employee can act on only part of
    // the queue via project scope, link to that project's items in the queue.
    const scopedProjects = scopedProjectsFor(activity)
    const eligibleViaProjectOnly = !agencyWideEligible(activity) && scopedProjects.size > 0
    // Pick the single project scope that actually overlaps this activity's work
    // (its own projectIds). With one project today there is exactly one; if more
    // ever apply, the first overlapping scope is used for the direct link and
    // the breakdown still reflects all eligible items.
    const linkProjectId = eligibleViaProjectOnly
      ? ([...scopedProjects].find((pid) => a.projectIds.has(pid)) ?? null)
      : null

    const route = linkProjectId ? stewardshipRoute(q, linkProjectId) : stewardshipRoute(q)

    // Per-project breakdown of THIS queue source, for the Project filter. Each
    // entry opens exactly that project's subset of the queue on the board
    // (?project_id=…), with counts that are a true subset of this source. A
    // source with no project items simply carries no scopes.
    const scopesForQueue = (queue: OutreachQueue): Record<string, WorkSourceProjectScope> | undefined => {
      const byProject = perQueueProject.get(queue)
      if (!byProject || byProject.size === 0) return undefined
      const out: Record<string, WorkSourceProjectScope> = {}
      for (const [pid, pt] of byProject) {
        if (pt.total === 0) continue
        out[pid] = {
          count: pt.total,
          ownedByMe: pt.ownedByMe,
          availableToMe: pt.availableToMe,
          claimedByOthers: pt.claimedByOthers,
          notEligible: pt.notEligible,
          dueToMe: pt.dueToMe,
          route: stewardshipRoute(queue, pid),
        }
      }
      return Object.keys(out).length > 0 ? out : undefined
    }

    // The call population (Calls Due + Available to Call) is NOT emitted from the
    // per-queue tally, because callability is independent of the stored queue: a
    // customer with a usable phone is callable even while they sit in Ready to
    // Email. It is computed over ALL callable open items in a dedicated pass
    // below, so a callable customer appears in the call population regardless of
    // queue (Rule 1), without duplicating the workflow. The per-queue tally still
    // drives the activity total and the email / research sources.
    if (q === 'ready-to-call') continue

    // A waiting queue in perQueue is a follow-up-due chase (signature/carrier),
    // so label it as the follow-up it is rather than the raw waiting label.
    const sourceLabel = q === 'waiting-for-form'
      ? 'Shared Stewardship board — Signature follow-up due'
      : q === 'waiting-for-carrier'
        ? 'Shared Stewardship board — Carrier follow-up due'
        : `Shared Stewardship board — ${QUEUE_LABEL[q]}`

    a.sources.push({
      kind: 'stewardship',
      label: sourceLabel,
      count: t.total,
      route,
      projectId: linkProjectId,
      ownedByMe: t.ownedByMe,
      availableToMe: t.availableToMe,
      claimedByOthers: t.claimedByOthers,
      notEligible: t.notEligible,
      dueToMe: t.dueToMe,
      projectScopes: scopesForQueue(q),
    })
  }

  // 3b. The CALL population (Calls Due + Available to Call), derived from
  // callability — NOT the stored queue (Rule 1). A customer with a usable phone
  // is callable even while they sit in Ready to Email awaiting a reply, so every
  // callable open actionable item is in the call population. The item is still
  // ONE workflow; appearing in the call population alongside, say, the email
  // population is the required "every applicable action population", not a
  // duplicate workflow. These two sources are informational sub-populations of
  // the Outreach activity: they do NOT add to the activity total (that is driven
  // once by the per-queue tally), so the headline count never inflates. An item
  // is Calls Due when its scheduled call has arrived (promised callback due, or
  // a cadence retry whose date lapsed), otherwise Available to Call; it is in
  // exactly one of the two. The links open the Ready-to-Call board population.
  {
    const outreach = acc.get('outreach')
    if (outreach) {
      let callsDue = 0
      let availableToCall = 0
      // Per-project subsets of the two call populations, so the Project filter
      // can show exactly a project's callable work. Keyed by project id.
      const callsDueByProject = new Map<string, number>()
      const availableToCallByProject = new Map<string, number>()
      const bumpCall = (m: Map<string, number>, projects: Set<string>) => {
        for (const pid of projects) m.set(pid, (m.get(pid) ?? 0) + 1)
      }
      for (const r of openRows) {
        // The shared call-population definition (also used by the board route) so
        // the counted set and the opened set always match.
        // Due status reads from durable row state: a cadence retry promoted in
        // memory here carries call_reason 'no-response' via deriveFollowUpRouting,
        // matching the persisted value the board stamps, so counting and the
        // opened list agree and stay stable across refreshes.
        const effPatch = deriveFollowUpRouting({ queue: r.queue, follow_up_due: r.follow_up_due }, now)
        const effCallReason = (effPatch?.call_reason as CallReason | undefined) ?? (r.call_reason as CallReason | null) ?? null
        const population = callPopulationOf({
          effectiveQueue: effectiveQueue(r),
          callReason: effCallReason,
          hasUsablePhone: !!r.customer_prereviews.customers?.phone?.trim(),
          callbackDue: isCallbackDue(r.callback_date, timeCtx),
        })
        if (!population) continue
        // Eligibility + claim: only count items this employee can actually pick
        // up, judged against the item's own projects. Uses the SAME shared tests
        // (canActOnItem / claimedByOther) the board route applies when it opens a
        // population view, so the counted set and the opened list cannot diverge.
        const itemProjects = projectsByCustomer.get(r.customer_prereviews.customer_id) ?? new Set<string>()
        if (!canActOnItem(profile, 'outreach', requiredQualByActivity.get('outreach') ?? null, itemProjects)) continue
        if (claimedByOther(r.claimed_by_producer_id, myProducerId)) continue

        if (population === 'calls-due') { callsDue += 1; bumpCall(callsDueByProject, itemProjects) }
        else { availableToCall += 1; bumpCall(availableToCallByProject, itemProjects) }
      }

      // Build per-project scopes for a call population: each entry opens exactly
      // that project's slice of the population on the board, counts matching.
      const callScopes = (
        byProject: Map<string, number>,
        population: 'calls-due' | 'available-to-call',
        due: boolean,
      ): Record<string, WorkSourceProjectScope> | undefined => {
        if (byProject.size === 0) return undefined
        const out: Record<string, WorkSourceProjectScope> = {}
        for (const [pid, n] of byProject) {
          if (n <= 0) continue
          out[pid] = {
            count: n,
            ownedByMe: 0,
            availableToMe: n,
            claimedByOthers: 0,
            notEligible: 0,
            dueToMe: due ? n : 0,
            route: populationRoute(population, pid),
          }
        }
        return Object.keys(out).length > 0 ? out : undefined
      }

      if (callsDue > 0) {
        outreach.sources.push({
          kind: 'stewardship',
          label: 'Shared Stewardship board — Calls Due',
          count: callsDue,
          // Opens the Calls Due population (callable + scheduled-due), the SAME
          // set this counted, regardless of each item's stored queue.
          route: populationRoute('calls-due'),
          projectId: null,
          ownedByMe: 0,
          availableToMe: callsDue,
          claimedByOthers: 0,
          notEligible: 0,
          dueToMe: callsDue,
          informational: true,
          projectScopes: callScopes(callsDueByProject, 'calls-due', true),
        })
      }
      if (availableToCall > 0) {
        outreach.sources.push({
          kind: 'stewardship',
          label: 'Shared Stewardship board — Available to Call',
          count: availableToCall,
          // Opens the Available to Call population (callable, not yet due).
          route: populationRoute('available-to-call'),
          projectId: null,
          ownedByMe: 0,
          availableToMe: availableToCall,
          claimedByOthers: 0,
          notEligible: 0,
          dueToMe: 0,
          informational: true,
          projectScopes: callScopes(availableToCallByProject, 'available-to-call', false),
        })
      }
    }
  }

  // 4. The 1035 project workflow (the SAME derived read the project surface
  // uses). Map its derived per-customer stages onto activities: operations prep
  // (operations_prep) and Bob's determination (determination). Stewardship-stage
  // customers are already represented by the shared board above, so they are not
  // double-counted here.
  // Which project owns the review-preparation work is resolved from the
  // WORKFLOW WIRING (data), not the project type name: the first ACTIVE project
  // that contains the review_preparation workflow. Fallback (pre-migration, when
  // the workflow tables are absent): the seeded "1035 Exchange" active project,
  // so behavior is unchanged until the migration lands. No records are created
  // here — the counts are DERIVED from facts.
  let proj: { id: string; name: string } | null = null
  const reviewProjects = await activeProjectsWithWorkflow(supabase, 'review_preparation')
  if (reviewProjects === null) {
    const { data: legacy } = await supabase
      .from('projects')
      .select('id, name, project_types!inner ( name )')
      .eq('status', 'active')
      .eq('project_types.name', '1035 Exchange')
      .limit(1)
      .maybeSingle()
    proj = legacy ? { id: legacy.id as string, name: legacy.name as string } : null
  } else {
    proj = reviewProjects[0] ?? null
  }

  if (proj) {
    const projectId = proj.id
    const projectName = proj.name || 'Review Preparation'
    const workflow = await buildProjectWorkflow(supabase, projectId)
    const summary = summarizeWorkflow(workflow)
    const prepCount = summary.by.operations_prep
    const determineCount = summary.by.bob_evaluation
    const reviewRoute = `/projects/${projectId}/review`
    // Contact Review is its own continuous workflow (not a 1035 stage), so it
    // carries its OWN route and its OWN live count: the project customers still
    // missing a usable email or phone, each counted once — the same read model
    // the Contact Review surface uses, so My Work and the surface never disagree.
    const contactReviewRoute = `/projects/${projectId}/contact-review`
    const contactReviewCount = summarizeContactReview(
      await buildContactReview(supabase, projectId),
    ).total

    // These project activities are inherently scoped to this project, so
    // eligibility and focus are judged against THIS project only (never
    // agency-wide-by-accident). The whole prep/determination count is treated
    // as one project-scoped partition.
    const projectSet = new Set<string>([projectId])
    const addProjectActivity = (
      key: WorkFunctionKey,
      count: number,
      // The source route for this activity. 1035-stage work opens the review
      // workflow; Contact Review opens its own continuous workflow. Defaults to
      // the review route so the existing callers are unchanged.
      route: string = reviewRoute,
    ) => {
      if (count <= 0) return
      const a = acc.get(key)
      if (!a) return
      a.total += count
      a.projectIds.add(projectId)
      const eligible = itemEligible(key, projectSet)
      // An overqualified (assist) employee is not routed this work but MAY pick
      // it up to help, so its items are available to them even without a
      // routable assignment. Unassigned / unlicensed items are awareness-only.
      const status = activityCapabilityStatus(key, projectSet)
      const canPickUp = eligible || status === 'assist'
      // Project-stage work has no claim model yet, so pickable items are all
      // available (none owned, none claimed-by-others); awareness-only items are
      // shown for awareness. The route is already scoped to this project.
      a.sources.push({
        kind: 'project',
        label: projectName,
        count,
        route,
        projectId,
        ownedByMe: 0,
        availableToMe: canPickUp ? count : 0,
        claimedByOthers: 0,
        notEligible: canPickUp ? 0 : count,
        dueToMe: 0,
      })
      // Mirror into the activity's per-project aggregate so the Project filter's
      // headline count includes this project-scoped work with the same bucketing
      // (pickable -> available, otherwise awareness-only notEligible). No claim
      // model on project-stage work yet, so none is owned or due here.
      const b = projectBucket(a, projectId)
      b.totalCount += count
      if (canPickUp) b.availableCount += count
      else b.notEligibleCount += count

      if (!canPickUp) return // awareness-only: counts to total/awareness only
      a.availableToMe += count
      // Only routable eligibility feeds the eligible-item count (which drives
      // the ZEN isEligible fact); assist stays non-routable but pickable.
      if (eligible) {
        a.eligible += count
        if (itemFocusElevated(key, projectSet)) a.focusEligible += count
      }
    }
    addProjectActivity('operations_prep', prepCount)
    addProjectActivity('determination', determineCount)
    // Contact Review: a quiet-work activity routed to its own continuous
    // workflow. Eligibility mirrors Contact Research (migration
    // 20261027000001), so an employee who can do research sees it here and
    // opens it straight from My Work — no navigating through Projects.
    addProjectActivity('contact_review', contactReviewCount, contactReviewRoute)
  }

  // 4b. FAILED Initial Analysis handoffs. When onboarding completed but the
  // handoff that creates the analysis-prep review errored, the pre-review
  // carries handoff_status = 'failed'. Those are real preparation work that did
  // not get created, so they surface here as Operations Preparation work (the
  // same employees who do prep), routed to the Reviews surface where they are
  // listed and retried inline — no separate screen. Agency-wide (not project
  // scoped). Eligibility mirrors operations_prep; an assist-capable hand may
  // also pick them up.
  {
    const { count: failedCount } = await supabase
      .from('customer_prereviews')
      .select('id', { count: 'exact', head: true })
      .eq('handoff_status', 'failed')
    const failed = failedCount ?? 0
    if (failed > 0) {
      const a = acc.get('operations_prep')
      if (a) {
        const agencyWide = new Set<string>() // agency-wide standing (no project scope)
        const eligible = isEligibleFor(profile, 'operations_prep')
        const status = activityCapabilityStatus('operations_prep', agencyWide)
        const canPickUp = eligible || status === 'assist'
        a.total += failed
        a.sources.push({
          kind: 'stewardship',
          label: 'Failed Initial Analysis handoff — needs retry',
          count: failed,
          route: '/reviews?handoff=failed',
          projectId: null,
          ownedByMe: 0,
          availableToMe: canPickUp ? failed : 0,
          claimedByOthers: 0,
          notEligible: canPickUp ? 0 : failed,
          dueToMe: 0,
        })
        if (canPickUp) {
          a.availableToMe += failed
          if (eligible) a.eligible += failed
        }
      }
    }
  }

  // 5. Decide each activity's priority band via ZEN. An activity is included
  // when it has work OR when it is focus-elevated for an eligible employee
  // (so a management focus on empty work still surfaces as a directed, quiet
  // row). Eligibility and focus are evaluated per activity; a project-scoped
  // eligibility/focus is matched against any project source on the activity.
  const activities: ActivityGroup[] = []
  for (const a of acc.values()) {
    // Eligibility and focus come from PER-ITEM aggregation, so a project-scoped
    // focus/eligibility only ever reflects items that actually belong to that
    // project — never the whole activity, and never unrelated customers.
    const eligible = a.eligible > 0
    const focusElevated = a.focusEligible > 0

    // Drop activities with no work that are not a directed focus for this
    // eligible employee. (An ineligible, empty activity is simply not shown.)
    if (a.total === 0 && !(focusElevated && eligible)) continue

    // The employee's capability STANDING for this activity, across the scopes it
    // touches. This distinguishes the non-routable situations so each routes
    // differently: 'assist' (overqualified) is actionable; 'unassigned' and
    // 'unlicensed' are awareness-only, with distinct reasons. Routable work is
    // already covered by isEligible.
    const capabilityStatus = activityCapabilityStatus(a.workFunction, a.projectIds)

    const facts: ActivityFacts = {
      // Right Path records no exact-time commitments yet; the band exists so the
      // IPF distinction holds, but it is false today.
      hasExactTimeCommitment: false,
      isEligible: eligible,
      // Overqualified-assist and a confirmed license gap are mutually exclusive
      // with routable eligibility; they only steer the non-routable rows.
      canAssist: capabilityStatus === 'assist',
      licenseGap: capabilityStatus === 'unlicensed',
      isFocusElevated: focusElevated,
      hasDueCallback: a.dueEligible > 0,
      hasOwnedWork: a.owned > 0,
    }
    const verdict = await evaluateActivityBand(facts)
    // Counts shown reflect the whole activity (recorded once). The claim-state
    // breakdown is this employee's: owned, available-to-me (unclaimed+eligible),
    // claimed-by-others (eligible but someone else's), and not-eligible.
    const notEligibleCount = Math.max(a.total - a.eligible, 0)
    activities.push({
      workFunction: a.workFunction,
      label: a.label,
      description: a.description,
      band: verdict.band,
      rank: verdict.rank,
      reasonCode: verdict.reasonCode,
      reason: buildActivityReason(verdict.reasonCode, {
        dueCount: a.dueEligible,
        ownedCount: a.owned,
        availableCount: a.availableToMe,
        claimedByOthersCount: a.claimedByOthers,
        label: a.label,
      }),
      totalCount: a.total,
      ownedCount: a.owned,
      availableCount: a.availableToMe,
      claimedByOthersCount: a.claimedByOthers,
      notEligibleCount,
      dueCount: a.dueEligible,
      projectTotals: a.projectTotals.size > 0 ? Object.fromEntries(a.projectTotals) : undefined,
      isEligible: eligible,
      capabilityStatus,
      // Only a routable activity carries a primary/support framing; the
      // non-routable standings (assist/unassigned/unlicensed) are 'none'.
      routedAs:
        capabilityStatus === 'routable'
          ? routedAssignmentFor(a.workFunction, a.projectIds)
          : 'none',
      isFocusElevated: focusElevated,
      sources: a.sources,
    })
  }

  // Order by ZEN rank (band), then by the catalog sort order within a band.
  const sortOrder = new Map(workFunctions.map((w) => [w.canonicalKey, w.sortOrder]))
  activities.sort((x, y) => {
    if (x.rank !== y.rank) return x.rank - y.rank
    return (sortOrder.get(x.workFunction) ?? 0) - (sortOrder.get(y.workFunction) ?? 0)
  })

  // The employee has nothing actionable when every surfaced activity is either
  // awareness-only (unassigned / unlicensed) or empty. Assist-capable work is
  // actionable (the employee may pick it up), so it does NOT count as quiet.
  const AWARENESS_BANDS = new Set<PriorityBand>(['unassigned', 'unlicensed'])
  const quiet = activities.every((a) => AWARENESS_BANDS.has(a.band) || a.totalCount === 0)

  const projectNameById = new Map<string, string>()
  for (const a of activities)
    for (const s of a.sources)
      if (s.projectId) projectNameById.set(s.projectId, s.label)

  return {
    employeeName: `${profile.firstName} ${profile.lastName}`.trim() || null,
    noProfile: false,
    activities,
    focusNotes: flattenFocus(focus, buildActivityLabelMap(workFunctions), projectNameById),
    quiet,
  }
}

function buildActivityLabelMap(
  workFunctions: { canonicalKey: WorkFunctionKey; label: string }[],
): Map<WorkFunctionKey, string> {
  return new Map(workFunctions.map((w) => [w.canonicalKey, w.label]))
}

/** Flatten active focus into display notes with a human label. */
function flattenFocus(
  focus: ActiveFocus[],
  activityLabels: Map<WorkFunctionKey, string>,
  projectNames?: Map<string, string>,
): FocusNote[] {
  return focus.map((f) => {
    let label: string
    if (f.scope === 'project') {
      label = (f.projectId && projectNames?.get(f.projectId)) || 'a project'
    } else {
      label = (f.workFunction && activityLabels.get(f.workFunction)) || 'an activity'
    }
    return { id: f.id, scope: f.scope, label, note: f.note, expiresAt: f.expiresAt }
  })
}
