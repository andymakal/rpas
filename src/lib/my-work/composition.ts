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
import { QUEUE_META, deriveFollowUpRouting, type OutreachQueue } from '@/lib/stewardship/queues'
import { createTimeContext } from '@/lib/time'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import { buildProjectWorkflow, summarizeWorkflow } from '@/lib/projects/review-1035'
import {
  loadWorkFunctions,
  resolveCapabilityProfile,
} from '@/lib/capabilities/resolve'
import { isEligibleFor, type WorkFunctionKey } from '@/lib/capabilities/work-functions'
import {
  getActiveFocus,
  focusElevatesActivity,
  type ActiveFocus,
} from '@/lib/capabilities/todays-focus'
import { evaluateActivityBand, buildActivityReason } from './engine'
import type {
  ActivityFacts,
  ActivityGroup,
  FocusNote,
  MyWorkState,
  WorkSource,
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
  callback_date: string | null
  follow_up_due: string | null
  claimed_by_producer_id: string | null
  customer_prereviews: { decision: string | null; customer_id: string }
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

  // 3. Shared Stewardship board (the SAME read the board + Daily Direction use).
  // customer_id is selected so each item can be associated to the project(s) its
  // customer belongs to — the fix that lets a project focus elevate project work
  // that currently sits in a shared queue.
  const { data: boardData, error: boardErr } = await supabase
    .from('stewardship_outreach')
    .select(`
      id, queue, callback_date, follow_up_due, claimed_by_producer_id,
      customer_prereviews!inner ( decision, customer_id )
    `)
    .order('updated_at', { ascending: true })
  if (boardErr) throw new Error(`MY WORK board read failed: ${boardErr.message}`)

  const openRows = ((boardData ?? []) as unknown as BoardRow[]).filter(
    (r) => r.customer_prereviews?.decision == null,
  )

  // Project association for the open board customers: which project(s) each
  // customer belongs to. This is the ONE extra read that preserves the project
  // link for shared work (no activity is duplicated; the association is metadata
  // on the single shared source). Existing records are the truth.
  const boardCustomerIds = Array.from(
    new Set(openRows.map((r) => r.customer_prereviews.customer_id)),
  )
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

  // READ-ONLY follow-up routing: compute the effective queue the same way the
  // board route does, without writing (identical to the Daily Direction
  // composition). Overdue waiting-for-response items count as ready-to-call.
  const effectiveQueue = (r: BoardRow): OutreachQueue =>
    (deriveFollowUpRouting({ queue: r.queue, follow_up_due: r.follow_up_due }, now)?.queue as
      | OutreachQueue
      | undefined) ?? r.queue

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
  }
  const perQueue = new Map<OutreachQueue, QueueTally>()
  for (const r of openRows) {
    const q = effectiveQueue(r)
    const activity = STEWARDSHIP_ACTIVITY[q]
    if (!activity) continue // waiting queues are not actionable MY WORK
    const a = acc.get(activity)
    if (!a) continue

    const itemProjects = projectsByCustomer.get(r.customer_prereviews.customer_id) ?? new Set<string>()
    for (const pid of itemProjects) a.projectIds.add(pid)

    const t = perQueue.get(q) ?? { total: 0, ownedByMe: 0, availableToMe: 0, claimedByOthers: 0, notEligible: 0 }
    t.total += 1
    a.total += 1

    const eligible = itemEligible(activity, itemProjects)
    if (!eligible) {
      t.notEligible += 1
      perQueue.set(q, t)
      continue // ineligible items count toward total/awareness only
    }
    a.eligible += 1
    if (itemFocusElevated(activity, itemProjects)) a.focusEligible += 1
    if (q === 'ready-to-call' && isCallbackDue(r.callback_date, timeCtx)) a.dueEligible += 1

    const claimedBy = r.claimed_by_producer_id
    if (claimedBy && claimedBy === myProducerId) {
      a.owned += 1
      t.ownedByMe += 1
    } else if (claimedBy) {
      // Eligible to me, but ANOTHER employee has claimed it — never counted as
      // available/unclaimed work.
      a.claimedByOthers += 1
      t.claimedByOthers += 1
    } else {
      a.availableToMe += 1
      t.availableToMe += 1
    }
    perQueue.set(q, t)
  }

  // One source per contributing queue. Each links to the EMPLOYEE'S ELIGIBLE
  // work in that queue: agency-wide eligibility opens the whole queue; otherwise
  // the link carries the employee's eligible project scope so it opens only
  // their subset (not the whole queue). The source still shows the full queue
  // count for board visibility, plus the per-employee claim breakdown.
  for (const [q, t] of perQueue) {
    const activity = STEWARDSHIP_ACTIVITY[q]
    if (!activity) continue
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

    a.sources.push({
      kind: 'stewardship',
      label: `Shared Stewardship board — ${QUEUE_LABEL[q]}`,
      count: t.total,
      route: linkProjectId ? stewardshipRoute(q, linkProjectId) : stewardshipRoute(q),
      projectId: linkProjectId,
      ownedByMe: t.ownedByMe,
      availableToMe: t.availableToMe,
      claimedByOthers: t.claimedByOthers,
      notEligible: t.notEligible,
    })
  }

  // 4. The 1035 project workflow (the SAME derived read the project surface
  // uses). Map its derived per-customer stages onto activities: operations prep
  // (operations_prep) and Bob's determination (determination). Stewardship-stage
  // customers are already represented by the shared board above, so they are not
  // double-counted here.
  const { data: proj } = await supabase
    .from('projects')
    .select('id, name, project_types!inner ( name )')
    .eq('status', 'active')
    .eq('project_types.name', '1035 Exchange')
    .limit(1)
    .maybeSingle()

  if (proj) {
    const projectId = proj.id as string
    const projectName = (proj.name as string) || '1035 Exchange'
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
    ) => {
      if (count <= 0) return
      const a = acc.get(key)
      if (!a) return
      a.total += count
      a.projectIds.add(projectId)
      const eligible = itemEligible(key, projectSet)
      // Project-stage work has no claim model yet, so eligible items are all
      // available to pick up (none owned, none claimed-by-others); ineligible
      // items are shown for awareness only. The review route is already scoped
      // to this project.
      a.sources.push({
        kind: 'project',
        label: projectName,
        count,
        route: reviewRoute,
        projectId,
        ownedByMe: 0,
        availableToMe: eligible ? count : 0,
        claimedByOthers: 0,
        notEligible: eligible ? 0 : count,
      })
      if (!eligible) return // ineligible: counts to total/awareness only
      a.eligible += count
      a.availableToMe += count
      if (itemFocusElevated(key, projectSet)) a.focusEligible += count
    }
    addProjectActivity('operations_prep', prepCount)
    addProjectActivity('determination', determineCount)
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

    const facts: ActivityFacts = {
      // Right Path records no exact-time commitments yet; the band exists so the
      // IPF distinction holds, but it is false today.
      hasExactTimeCommitment: false,
      isEligible: eligible,
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
      isEligible: eligible,
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
  // ineligible or empty.
  const quiet = activities.every((a) => a.band === 'ineligible' || a.totalCount === 0)

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
