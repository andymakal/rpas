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
import { QUEUE_META, deriveFollowUpRouting, deriveEmailRouting, isWaitingFollowUpDue, callPopulationOf, isIntroductoryEmail, type OutreachQueue, type CallReason, type ResearchReason, type CallOutcome } from '@/lib/stewardship/queues'
import { createTimeContext } from '@/lib/time'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import { buildProjectWorkflow, summarizeWorkflow } from '@/lib/projects/review-1035'
import { activeProjectsWithWorkflow, onboardingCompleteForPolicies } from '@/lib/projects/workflows'
import { buildContactReview, summarizeContactReview } from '@/lib/projects/contact-review'
import { deriveOnboardingPopulation } from '@/lib/stewardship/derived-onboarding'
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
  ResponsibilityItem,
  WorkSource,
  WorkSourceProjectScope,
} from './types'
import type { ProducerCapabilityProfile, WorkFunction } from '@/lib/capabilities/work-functions'

const STEWARDSHIP_ROUTE = '/stewardship'

function stewardshipRoute(queue: OutreachQueue, projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}?queue=${encodeURIComponent(queue)}`
  // When the link is project-scoped (the employee is eligible for only that
  // project's items), carry the project id so the board opens exactly that
  // subset of the queue — not the whole shared queue.
  return projectId ? `${base}&project_id=${encodeURIComponent(projectId)}` : base
}

/**
/**
 * The Send Introductory Emails DIRECT WORKING SCREEN. This is the dedicated
 * continuous surface that lands straight on the first eligible customer and
 * advances automatically after each send — the same working-screen pattern as
 * Contact Research. Project scope is carried through so a project-scoped link
 * works exactly that project's first-touch population.
 *
 * (The board still exposes a `?population=` list view for each population as a
 * deep link, but My Work no longer routes any activity to that intermediate
 * list: both call populations and the introductory-email population open their
 * dedicated direct working screens.)
 */
function introductoryEmailsRoute(projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}/introductory-emails`
  return projectId ? `${base}?project_id=${encodeURIComponent(projectId)}` : base
}

/**
 * The Call Reachable Customers DIRECT WORKING SCREEN for the Available to Call
 * population. This is the dedicated continuous calling surface that lands
 * straight on the first available customer and advances automatically after each
 * recorded interaction — the same working-screen pattern as Contact Research and
 * Send Introductory Emails. Project scope is carried through so a project-scoped
 * link works exactly that project's Available to Call population. Calls Due is
 * worked on the same guided workbench in due mode (callsDueRoute).
 */
function availableToCallRoute(projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}/available-to-call`
  return projectId ? `${base}?project_id=${encodeURIComponent(projectId)}` : base
}

/**
 * The Make the Calls That Are Due DIRECT WORKING SCREEN for the Calls Due
 * population. The SAME guided calling workbench as availableToCallRoute, opened
 * in due mode: it lands straight on the first due customer (promised callback or
 * automatic retry that has come due), advances automatically after each recorded
 * interaction, and offers continuing with ordinary available calls when no due
 * calls remain. This replaces the board's intermediate Calls Due population
 * list; due work is now worked on the continuous calling surface, not browsed as
 * a list. Project scope is carried through so a
 * project-scoped link works exactly that project's Calls Due population.
 */
function callsDueRoute(projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}/calls-due`
  return projectId ? `${base}?project_id=${encodeURIComponent(projectId)}` : base
}

/**
 * The Servicing Access DIRECT WORKING SCREEN for the servicing-access
 * population: customers whose signed servicing-agent authorization is in hand
 * (the form has returned). It is the stage between Outreach and Operations
 * Preparation — save the signed form, prepare the carrier email, submit and
 * confirm, run the seven-day carrier follow-up, and record carrier confirmation,
 * which opens Operations Preparation automatically. Lands straight on the first
 * eligible customer with no intermediate list. Project scope is carried through.
 */
function servicingAccessRoute(projectId?: string | null): string {
  const base = `${STEWARDSHIP_ROUTE}/servicing-access`
  return projectId ? `${base}?project_id=${encodeURIComponent(projectId)}` : base
}

/**
 * Which stewardship queues map to which MY WORK activity. The shared board's
 * outreach queues (ready-to-call, ready-to-email, and the overdue follow-ups
 * routed into ready-to-call) are the Outreach activity. Waiting queues are not
 * actionable work and are excluded.
 *
 * research-needed is intentionally NOT mapped here. Contact research is now a
 * SINGLE consolidated activity ('research' / "Contact Research") sourced from
 * the project Contact Research read (buildContactReview), which covers every
 * customer missing a usable email or phone — a strict superset of the board's
 * research-needed population — so each customer is counted once in one activity
 * routed to one screen. The board's research-needed queue still exists as
 * onboarding state (its rows, transitions, and the board's own research view are
 * untouched); it simply no longer creates a second, overlapping My Work activity.
 */
const STEWARDSHIP_ACTIVITY: Partial<Record<OutreachQueue, WorkFunctionKey>> = {
  'ready-to-call': 'outreach',
  'ready-to-email': 'outreach',
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
  /** The address the prior introduction was sent to, for the replaced-address
   * re-offer of the introductory email. */
  intro_email_recipient: string | null
  callback_date: string | null
  follow_up_due: string | null
  /** Whether the signed authorization has returned, used to count the
   * servicing-access population (the stage between Outreach and Ops Prep). */
  form_received_at: string | null
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
   * Attempted-vs-unresolved presentation (populated only for Research today).
   * `unresolved` is the full unresolved population (each customer once) the
   * working queue shows; `unsuccessful` is the researched-but-nothing-found
   * subset. `total` above stays OUTSTANDING, so the recommendation is unchanged;
   * these drive only the summary's population figure and breakdown. Zero for
   * every activity that does not carry the distinction.
   */
  unresolved: number
  unsuccessful: number
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
  return { totalCount: 0, ownedCount: 0, availableCount: 0, claimedByOthersCount: 0, notEligibleCount: 0, dueCount: 0, unresolvedCount: 0, unsuccessfulCount: 0 }
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
      responsibilities: [],
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
      unresolved: 0,
      unsuccessful: 0,
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
      id, queue, call_reason, research_reason, last_call_outcome, email_sent_at, intro_email_recipient, callback_date, follow_up_due, form_received_at, refused_at, claimed_by_producer_id,
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
  // the per-queue tally and the call-population pass iterate this set.
  //
  // research-needed rows are intentionally NOT special-cased here anymore. They
  // survive into openRows (subject only to the onboarding gate), but they feed
  // no My Work activity: the tally loop skips them (research-needed is unmapped
  // in STEWARDSHIP_ACTIVITY) and the call population excludes them (a no-usable-
  // contact customer has no callable phone). Contact research is counted once,
  // from the project Contact Research read, in step 4 below. The old board-
  // sourced research dampening and unresolved/unsuccessful accumulation are
  // therefore removed; the project read (buildContactReview + summarize) now
  // owns the recommended-vs-exception split, and the board route keeps its own
  // independent research_unsuccessful flagging for the board view.
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

  // (Contact research is no longer accumulated from the board here; it is
  // sourced once from the project Contact Research read in step 4 below.)

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
      {
        queue: r.queue,
        follow_up_due: r.follow_up_due,
        has_usable_phone: !!r.customer_prereviews.customers?.phone?.trim(),
      },
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
      current_email: r.customer_prereviews.customers?.email ?? null,
      intro_email_recipient: r.intro_email_recipient,
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
  // INTRODUCTORY EMAILS: the first-touch subset of Ready to Email the employee
  // can act on. An introductory email is the OPENING servicing-agent email (it
  // carries the authorization form) sent to a customer whose workflow has not
  // started yet — effective queue ready-to-email AND no recorded activity
  // (no email_sent_at, no last_call_outcome, no promised callback_date). A
  // Ready-to-Email item that has already been emailed or called is NOT an
  // introduction, so this never assumes every Ready to Email needs an intro.
  // Counted here (not as a separate pass) so it reuses this loop's eligibility
  // and claim classification; it is an informational subset of the Outreach
  // activity and does NOT add to any activity total.
  let introEmails = 0
  const introEmailsByProject = new Map<string, number>()
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

    // Tally an introductory email: the shared first-touch predicate (the SAME
    // one the board route opens with), AND actionable by this employee (owned or
    // available — never a teammate's claimed item). A true subset of the
    // ready-to-email count the activity already carries. `q` is the effective
    // queue computed above (effectiveQueue), so the email re-derivation applies.
    const isIntroEmail =
      isIntroductoryEmail({
        effectiveQueue: q,
        emailSentAt: r.email_sent_at,
        lastCallOutcome: r.last_call_outcome as CallOutcome | null,
        callbackDate: r.callback_date,
        currentEmail: r.customer_prereviews.customers?.email ?? null,
        introEmailRecipient: r.intro_email_recipient,
      }) &&
      (cls.bucket === 'available' || cls.bucket === 'owned')
    if (isIntroEmail) {
      introEmails += 1
      for (const pid of itemProjects) {
        introEmailsByProject.set(pid, (introEmailsByProject.get(pid) ?? 0) + 1)
      }
    }

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
        const effPatch = deriveFollowUpRouting({ queue: r.queue, follow_up_due: r.follow_up_due, has_usable_phone: !!r.customer_prereviews.customers?.phone?.trim() }, now)
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
            // Both call populations open the SAME guided calling workbench for
            // exactly this project's slice: Available to Call in its default
            // mode, Calls Due in due mode. Neither uses the board's intermediate
            // population list anymore.
            route: population === 'available-to-call'
              ? availableToCallRoute(pid)
              : callsDueRoute(pid),
          }
        }
        return Object.keys(out).length > 0 ? out : undefined
      }

      if (callsDue > 0) {
        outreach.sources.push({
          kind: 'stewardship',
          label: 'Shared Stewardship board — Calls Due',
          count: callsDue,
          // Opens the Make the Calls That Are Due guided workbench (callable +
          // scheduled-due), landing straight on the first due customer — the
          // SAME set this counted, regardless of each item's stored queue —
          // instead of the board's intermediate population list.
          route: callsDueRoute(),
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
          // Opens the Call Reachable Customers direct working screen (callable,
          // not yet due), landing straight on the first available customer —
          // exactly the set this counted — instead of the board's list.
          route: availableToCallRoute(),
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

      // Introductory emails: the first-touch subset of Ready to Email, as an
      // informational source (it does NOT add to the activity total, which the
      // per-queue ready-to-email tally already carries). It opens the Ready to
      // Email queue — the same place the full email population is worked — so the
      // recommendation is directly reachable. Per-project scopes let the Project
      // filter show exactly a project's introductory emails.
      if (introEmails > 0) {
        const introScopes = ((): Record<string, WorkSourceProjectScope> | undefined => {
          if (introEmailsByProject.size === 0) return undefined
          const out: Record<string, WorkSourceProjectScope> = {}
          for (const [pid, n] of introEmailsByProject) {
            if (n <= 0) continue
            out[pid] = {
              count: n,
              ownedByMe: 0,
              availableToMe: n,
              claimedByOthers: 0,
              notEligible: 0,
              dueToMe: 0,
              // Opens exactly this project's introductory-email population on
              // the direct working screen (the SAME first-touch set this
              // counted), landing on the first eligible customer.
              route: introductoryEmailsRoute(pid),
            }
          }
          return Object.keys(out).length > 0 ? out : undefined
        })()
        outreach.sources.push({
          kind: 'stewardship',
          label: 'Shared Stewardship board — Introductory emails',
          count: introEmails,
          // Opens the Send Introductory Emails direct working screen (the
          // first-touch subset of Ready to Email), landing straight on the first
          // eligible customer — exactly the set this counted.
          route: introductoryEmailsRoute(),
          projectId: null,
          ownedByMe: 0,
          availableToMe: introEmails,
          claimedByOthers: 0,
          notEligible: 0,
          dueToMe: 0,
          informational: true,
          projectScopes: introScopes,
        })
      }

      // Servicing Access: the stage between Outreach and Operations Preparation.
      // The signed authorization is in hand (the form has returned) — its
      // effective queue is waiting-for-form or waiting-for-carrier, OR receipt
      // has been recorded — so the work is to save the signed form, prepare the
      // carrier email, submit, run the seven-day carrier follow-up, and record
      // the carrier's confirmation (which opens Operations Preparation). Counted
      // as an actionable Outreach source (the same outreach team does this work)
      // that this employee can pick up: eligible by the outreach capability and
      // not claimed by someone else. It opens the Servicing Access direct working
      // screen, landing straight on the first eligible customer — no intermediate
      // customer-list screen. It is NOT informational: this is actionable work
      // the My Work count should surface and route directly.
      let servicingAccess = 0
      const servicingAccessByProject = new Map<string, number>()
      for (const r of openRows) {
        const eq = effectiveQueue(r)
        const inServicingAccess =
          eq === 'waiting-for-form' ||
          eq === 'waiting-for-carrier' ||
          r.form_received_at != null
        if (!inServicingAccess) continue
        const itemProjects = projectsByCustomer.get(r.customer_prereviews.customer_id) ?? new Set<string>()
        if (!canActOnItem(profile, 'outreach', requiredQualByActivity.get('outreach') ?? null, itemProjects)) continue
        if (claimedByOther(r.claimed_by_producer_id, myProducerId)) continue
        servicingAccess += 1
        for (const pid of itemProjects) {
          servicingAccessByProject.set(pid, (servicingAccessByProject.get(pid) ?? 0) + 1)
        }
      }
      // Servicing Access is ALWAYS surfaced as a reachable entry point for an
      // outreach-eligible employee — even when zero customers are waiting right
      // now — so the screen (and its find-a-customer search, for a signed
      // authorization that just arrived) is reachable from My Work without the
      // board. It is INFORMATIONAL, so it never adds to the activity total or
      // the ZEN band: the count shown is the honest real number (0 when none),
      // and nothing invents a priority. When the employee is eligible only via
      // specific projects, the default route carries no project scope (the whole
      // servicing-access screen), while project scopes below open each project's
      // slice. We emit it whenever the employee can act on outreach at all, so a
      // quiet-but-eligible employee can still open it.
      const outreachEligibleAnywhere =
        agencyWideEligible('outreach') || scopedProjectsFor('outreach').size > 0
      if (servicingAccess > 0 || outreachEligibleAnywhere) {
        const saScopes = ((): Record<string, WorkSourceProjectScope> | undefined => {
          if (servicingAccessByProject.size === 0) return undefined
          const out: Record<string, WorkSourceProjectScope> = {}
          for (const [pid, n] of servicingAccessByProject) {
            if (n <= 0) continue
            out[pid] = {
              count: n,
              ownedByMe: 0,
              availableToMe: n,
              claimedByOthers: 0,
              notEligible: 0,
              dueToMe: 0,
              route: servicingAccessRoute(pid),
            }
          }
          return Object.keys(out).length > 0 ? out : undefined
        })()
        outreach.sources.push({
          kind: 'stewardship',
          label: 'Shared Stewardship board — Servicing access',
          count: servicingAccess,
          // Opens the Servicing Access direct working screen (signed
          // authorization in hand), landing straight on the first eligible
          // customer — exactly the set this counted — or, when none are waiting,
          // on the screen's find-a-customer entry for a newly-arrived
          // authorization.
          route: servicingAccessRoute(),
          projectId: null,
          ownedByMe: 0,
          availableToMe: servicingAccess,
          claimedByOthers: 0,
          notEligible: 0,
          dueToMe: 0,
          informational: true,
          projectScopes: saScopes,
        })
      }
    }
  }

  // (Removed: the old board-sourced Research activity link. Contact research is
  // now a single project-sourced activity, emitted in step 4 below, so there is
  // no separate board-research source to keep clickable here.)

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

    // Servicing Agent Onboarding — the first-touch OUTREACH populations, derived
    // from FACTS for members who have no outreach record yet. A freshly
    // populated project (e.g. a newly duplicated 1035 sweep) has real, workable
    // introductory-email and phone-call work the moment it is populated, before
    // anyone acts. My Work's shared-board pass (step 3) only sees members with
    // an existing stewardship_outreach row, so without this a brand-new project
    // shows no outreach work at all. We derive the record-less onboarding
    // population here — the SAME computation the board route uses (one shared
    // helper) — and surface its independent, NON-EXCLUSIVE populations:
    //   - Introductory Emails: every derived member whose opening action is a
    //     first-touch email (has a usable email).
    //   - Available to Call: every derived member who is callable (has a usable
    //     phone), regardless of whether they also qualify for an email. Missing
    //     one method never blocks the other — a member with both appears in
    //     both, counted as one customer per population, not forced to choose.
    // The no-usable-contact members flow through Contact Research (step 4a),
    // which already covers every member missing a usable method, so they are not
    // also added to Outreach here. No records are created; each source links to
    // the project-scoped board queue view, which lists these derived customers
    // and materializes the durable record on the first action.
    //
    // No duplication with the shared board: members already represented by an
    // open outreach row are excluded (boardCustomerIds), so a customer is counted
    // once across the recorded and derived sources.
    const derivedOnboarding = await deriveOnboardingPopulation(supabase, projectId, {
      memberCustomerIds: workflow.map((w) => w.customer_id),
      excludeCustomerIds: boardCustomerIds,
    })
    if (derivedOnboarding.length > 0) {
      const outreach = acc.get('outreach')
      if (outreach) {
        const eligible = itemEligible('outreach', projectSet)
        const status = activityCapabilityStatus('outreach', projectSet)
        const canPickUp = eligible || status === 'assist'
        const focusElevated = canPickUp && eligible && itemFocusElevated('outreach', projectSet)

        const introEmailCount = derivedOnboarding.filter((d) => d.isIntroEmail).length
        const availableToCallCount = derivedOnboarding.filter(
          (d) => d.callPopulation === 'available-to-call',
        ).length

        // The Outreach activity TOTAL counts each derived onboarding customer
        // once (the actionable onboarding work), regardless of how many channels
        // they qualify for — the per-population sources below are independent
        // views OF that work, not additional work. This mirrors how the board
        // pass counts one row once while still surfacing Calls / Emails as
        // separate populations.
        const derivedCustomerCount = derivedOnboarding.length
        outreach.total += derivedCustomerCount
        outreach.projectIds.add(projectId)
        if (canPickUp) {
          outreach.availableToMe += derivedCustomerCount
          if (eligible) {
            outreach.eligible += derivedCustomerCount
            if (focusElevated) outreach.focusEligible += derivedCustomerCount
          }
        }
        const b = projectBucket(outreach, projectId)
        b.totalCount += derivedCustomerCount
        if (canPickUp) b.availableCount += derivedCustomerCount
        else b.notEligibleCount += derivedCustomerCount

        // Independent, non-exclusive population sources. Each links to the
        // project-scoped board queue view that can work the derived (record-less)
        // customers: Ready to Email for introductions, Ready to Call for calls.
        // They are informational VIEWS of the activity's work (they do not add to
        // the activity total, which already counts each customer once above).
        if (introEmailCount > 0) {
          outreach.sources.push({
            kind: 'project',
            label: `${projectName} — Introductory emails`,
            count: introEmailCount,
            route: stewardshipRoute('ready-to-email', projectId),
            projectId,
            ownedByMe: 0,
            availableToMe: canPickUp ? introEmailCount : 0,
            claimedByOthers: 0,
            notEligible: canPickUp ? 0 : introEmailCount,
            dueToMe: 0,
            informational: true,
          })
        }
        if (availableToCallCount > 0) {
          outreach.sources.push({
            kind: 'project',
            label: `${projectName} — Available to call`,
            count: availableToCallCount,
            route: stewardshipRoute('ready-to-call', projectId),
            projectId,
            ownedByMe: 0,
            availableToMe: canPickUp ? availableToCallCount : 0,
            claimedByOthers: 0,
            notEligible: canPickUp ? 0 : availableToCallCount,
            dueToMe: 0,
            informational: true,
          })
        }
      }
    }
  }

  // 4a. Contact Research — the SINGLE consolidated contact-finding activity,
  // across ALL active projects that contain the review-preparation workflow, not
  // just the first. Each customer missing a usable email or phone (effective
  // usability, folding recorded-unusable channels) is counted once, in the
  // project they belong to, routed to that project's Contact Research screen.
  // The actionable (recommended) count is the outstanding needs_research
  // population; the No Usable Contact Information exception is visible but not
  // recommended, carried on the activity's unresolved/unsuccessful figures. This
  // runs over every eligible 1035 project so a customer in a second or later
  // 1035 project is never dropped from the consolidated population.
  {
    const research = acc.get('research')
    if (research) {
      // The projects to scan: all active review_preparation projects, or the
      // single legacy project when the workflow tables are absent (same fallback
      // the prep/determination resolution uses above).
      const contactResearchProjects: { id: string; name: string }[] =
        reviewProjects !== null ? reviewProjects : proj ? [proj] : []

      // DEDUP ACROSS PROJECTS. A customer who belongs to more than one active
      // review-preparation project is returned by buildContactReview once PER
      // project, so summing each project's summary double-counts the shared
      // population (e.g. 132 when the distinct population is 66). The activity's
      // HEADLINE totals (research.total/unresolved/unsuccessful and this
      // employee's pickable counts) must count each customer ONCE; the PER-
      // PROJECT source and projectTotals bucket keep that project's own full
      // subset so the Project filter still shows every customer that belongs to
      // it (a customer in two projects legitimately appears under each project's
      // filter, but is only one unit of work overall). We achieve this by giving
      // each customer a single "home" project — the first scanned project that
      // contains them — and feeding the activity-level totals only from a
      // customer's home project, while per-project counts use the full rows.
      const homeProjectByCustomer = new Map<string, string>()

      for (const crp of contactResearchProjects) {
        const crProjectId = crp.id
        const crProjectName = crp.name || 'Review Preparation'
        const crRoute = `/projects/${crProjectId}/contact-review`
        const crRows = await buildContactReview(supabase, crProjectId)
        const crSummary = summarizeContactReview(crRows)
        // Recommended outstanding research (every row whose research is not yet
        // exhausted — reachable missing-one AND no-usable-contact-but-outstanding),
        // so completed research is never re-recommended.
        const actionable = crSummary.actionable
        const unresolved = crSummary.total
        // The previously-unsuccessful population kept visible but not recommended.
        const unsuccessful = crSummary.total - crSummary.actionable
        if (unresolved <= 0) continue

        // The DISTINCT (not-yet-claimed-by-an-earlier-project) subset of this
        // project's rows, used for the activity-level totals so each customer is
        // counted once across projects. Per-project figures below still use the
        // full rows. Claim each distinct customer to this project as their home.
        const distinctRows = crRows.filter((row) => {
          if (homeProjectByCustomer.has(row.customer_id)) return false
          homeProjectByCustomer.set(row.customer_id, crProjectId)
          return true
        })
        const distinctSummary = summarizeContactReview(distinctRows)
        const distinctActionable = distinctSummary.actionable
        const distinctUnresolved = distinctSummary.total
        const distinctUnsuccessful = distinctSummary.total - distinctSummary.actionable

        const crProjectSet = new Set<string>([crProjectId])
        const eligible = itemEligible('research', crProjectSet)
        const status = activityCapabilityStatus('research', crProjectSet)
        const canPickUp = eligible || status === 'assist'

        research.projectIds.add(crProjectId)
        // Activity-level unresolved/unsuccessful count each customer ONCE (home
        // project only). The per-project bucket keeps THIS project's own full
        // subset so the Project filter is unchanged.
        research.unresolved += distinctUnresolved
        research.unsuccessful += distinctUnsuccessful
        const b = projectBucket(research, crProjectId)
        b.unresolvedCount = (b.unresolvedCount ?? 0) + unresolved
        b.unsuccessfulCount = (b.unsuccessfulCount ?? 0) + unsuccessful

        // The actionable (recommended) outstanding research feeds the activity
        // total (deduped, each customer once) and this employee's pickable
        // counts (also deduped), bucketed exactly as addProjectActivity does
        // (project-stage work has no claim model, so pickable -> available,
        // otherwise awareness-only notEligible). The per-project bucket uses the
        // project's FULL actionable subset.
        if (distinctActionable > 0) {
          research.total += distinctActionable
          if (canPickUp) {
            research.availableToMe += distinctActionable
            if (eligible) {
              research.eligible += distinctActionable
              if (itemFocusElevated('research', crProjectSet)) research.focusEligible += distinctActionable
            }
          }
        }
        if (actionable > 0) {
          // Per-project bucket: THIS project's full actionable subset (a shared
          // customer counts under each project's own filter).
          b.totalCount += actionable
          if (canPickUp) b.availableCount += actionable
          else b.notEligibleCount += actionable
          research.sources.push({
            kind: 'project',
            label: crProjectName,
            count: actionable,
            route: crRoute,
            projectId: crProjectId,
            ownedByMe: 0,
            availableToMe: canPickUp ? actionable : 0,
            claimedByOthers: 0,
            notEligible: canPickUp ? 0 : actionable,
            dueToMe: 0,
          })
        } else {
          // Only the No Usable Contact Information exception remains for this
          // project: no actionable work, but keep Contact Research visible and
          // clickable with an informational source landing on its screen.
          research.sources.push({
            kind: 'project',
            label: crProjectName,
            count: unresolved,
            route: crRoute,
            projectId: crProjectId,
            ownedByMe: 0,
            availableToMe: 0,
            claimedByOthers: 0,
            notEligible: 0,
            dueToMe: 0,
            informational: true,
          })
        }
      }
    }
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

    // An activity with an always-present reachable STANDING entry point stays
    // visible to an eligible employee even when it is otherwise empty, so a
    // standing working screen is never hidden just because no items are waiting
    // right now. Today this is Outreach's Servicing Access source (an
    // informational, zero-or-more count link): keeping the activity lets the
    // Available-work plan render the Servicing Access step at its real count
    // (0 when none) in working order. This adds no priority and inflates no
    // total — the source is informational, so the activity total stays the real
    // work (0 when quiet) and the ZEN band is the ordinary empty/shared band.
    const hasStandingEntryPoint = eligible && a.sources.some((s) => s.informational && !!s.route)

    // Drop activities with no work that are not a directed focus for this
    // eligible employee AND have no standing entry point. (An ineligible, empty
    // activity is simply not shown.) "No work" means no OUTSTANDING items AND no
    // unresolved population: an activity whose outstanding count has reached zero
    // but still has unresolved customers (e.g. Research with only
    // researched-unsuccessfully customers left) stays visible as long as
    // unresolved work remains.
    if (
      a.total === 0 &&
      a.unresolved === 0 &&
      !(focusElevated && eligible) &&
      !hasStandingEntryPoint
    ) continue

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
      // The full unresolved population and its attempted-unsuccessful subset,
      // carried only when the activity actually distinguishes them (Research
      // today). Left undefined otherwise, so a reader treats unresolved as equal
      // to the outstanding total.
      unresolvedCount: a.unresolved > 0 ? a.unresolved : undefined,
      unsuccessfulCount: a.unresolved > 0 ? a.unsuccessful : undefined,
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
  // An activity is "empty" for quiet purposes only when it has neither
  // outstanding work nor any unresolved population to keep visible. Research
  // with only researched-unsuccessfully customers left (outstanding 0, unresolved
  // > 0) is still work the employee can see and revisit, so it is not quiet.
  const activityIsEmpty = (a: ActivityGroup): boolean =>
    a.totalCount === 0 && (a.unresolvedCount ?? 0) === 0
  const quiet = activities.every((a) => AWARENESS_BANDS.has(a.band) || activityIsEmpty(a))

  const projectNameById = new Map<string, string>()
  for (const a of activities)
    for (const s of a.sources)
      if (s.projectId) projectNameById.set(s.projectId, s.label)

  return {
    employeeName: `${profile.firstName} ${profile.lastName}`.trim() || null,
    noProfile: false,
    activities,
    responsibilities: buildResponsibilities(profile, workFunctions),
    focusNotes: flattenFocus(focus, buildActivityLabelMap(workFunctions), projectNameById),
    quiet,
  }
}

function buildActivityLabelMap(
  workFunctions: { canonicalKey: WorkFunctionKey; label: string }[],
): Map<WorkFunctionKey, string> {
  return new Map(workFunctions.map((w) => [w.canonicalKey, w.label]))
}

/**
 * The employee's standing primary/support responsibilities, from their
 * capability assignments — INDEPENDENT of whether an activity currently has
 * work. Deduplicated by activity, primary winning over support, across every
 * scope (agency-wide or any project), in catalog order. This reads the SAME
 * producer_work_functions assignments the rest of the composition uses; it
 * derives no new eligibility and invents no content. Overqualified ('assist')
 * is NOT a standing responsibility, so it is excluded.
 */
function buildResponsibilities(
  profile: ProducerCapabilityProfile,
  workFunctions: WorkFunction[],
): ResponsibilityItem[] {
  const strongest = new Map<WorkFunctionKey, 'primary' | 'support'>()
  for (const e of profile.eligibilities) {
    if (e.assignment !== 'primary' && e.assignment !== 'support') continue
    const current = strongest.get(e.workFunction)
    if (current === 'primary') continue
    if (e.assignment === 'primary' || current == null) {
      strongest.set(e.workFunction, e.assignment)
    }
  }
  // Emit in catalog (sortOrder) order so the list reads consistently.
  const out: ResponsibilityItem[] = []
  for (const wf of workFunctions) {
    const routedAs = strongest.get(wf.canonicalKey)
    if (!routedAs) continue
    out.push({ workFunction: wf.canonicalKey, label: wf.label, routedAs })
  }
  return out
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
