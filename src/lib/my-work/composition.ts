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
import { deriveFollowUpRouting, type OutreachQueue } from '@/lib/stewardship/queues'
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

function stewardshipRoute(queue: OutreachQueue): string {
  return `${STEWARDSHIP_ROUTE}?queue=${encodeURIComponent(queue)}`
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

type BoardRow = {
  id: string
  queue: OutreachQueue
  callback_date: string | null
  follow_up_due: string | null
  claimed_by_producer_id: string | null
  customer_prereviews: { decision: string | null }
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
  total: number
  owned: number
  due: number
  sources: WorkSource[]
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
      owned: 0,
      due: 0,
      sources: [],
    })
  }

  // 3. Shared Stewardship board (the SAME read the board + Daily Direction use).
  const { data: boardData, error: boardErr } = await supabase
    .from('stewardship_outreach')
    .select(`
      id, queue, callback_date, follow_up_due, claimed_by_producer_id,
      customer_prereviews!inner ( decision )
    `)
    .order('updated_at', { ascending: true })
  if (boardErr) throw new Error(`MY WORK board read failed: ${boardErr.message}`)

  const openRows = ((boardData ?? []) as unknown as BoardRow[]).filter(
    (r) => r.customer_prereviews?.decision == null,
  )

  // READ-ONLY follow-up routing: compute the effective queue the same way the
  // board route does, without writing (identical to the Daily Direction
  // composition). Overdue waiting-for-response items count as ready-to-call.
  const effectiveQueue = (r: BoardRow): OutreachQueue =>
    (deriveFollowUpRouting({ queue: r.queue, follow_up_due: r.follow_up_due }, now)?.queue as
      | OutreachQueue
      | undefined) ?? r.queue

  // Tally the shared board into Outreach / Research accumulators.
  const boardCountByActivity = new Map<WorkFunctionKey, { total: number; owned: number; due: number }>()
  for (const r of openRows) {
    const q = effectiveQueue(r)
    const activity = STEWARDSHIP_ACTIVITY[q]
    if (!activity) continue // waiting queues are not actionable MY WORK
    const bucket = boardCountByActivity.get(activity) ?? { total: 0, owned: 0, due: 0 }
    bucket.total += 1
    if (r.claimed_by_producer_id && r.claimed_by_producer_id === myProducerId) bucket.owned += 1
    if (q === 'ready-to-call' && isCallbackDue(r.callback_date, timeCtx)) bucket.due += 1
    boardCountByActivity.set(activity, bucket)
  }
  for (const [activity, bucket] of boardCountByActivity) {
    const a = acc.get(activity)
    if (!a || bucket.total === 0) continue
    a.total += bucket.total
    a.owned += bucket.owned
    a.due += bucket.due
    // One source per stewardship activity; links straight into its board queue.
    const route = activity === 'research' ? stewardshipRoute('research-needed') : stewardshipRoute('ready-to-call')
    a.sources.push({
      kind: 'stewardship',
      label: 'Shared Stewardship board',
      count: bucket.total,
      route,
      projectId: null,
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

    if (prepCount > 0) {
      const a = acc.get('operations_prep')
      if (a) {
        a.total += prepCount
        a.sources.push({
          kind: 'project',
          label: projectName,
          count: prepCount,
          route: reviewRoute,
          projectId,
        })
      }
    }
    if (determineCount > 0) {
      const a = acc.get('determination')
      if (a) {
        a.total += determineCount
        a.sources.push({
          kind: 'project',
          label: projectName,
          count: determineCount,
          route: reviewRoute,
          projectId,
        })
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
    const projectIds = a.sources
      .map((s) => s.projectId)
      .filter((p): p is string => p != null)
    const eligible =
      isEligibleFor(profile, a.workFunction) ||
      projectIds.some((pid) => isEligibleFor(profile, a.workFunction, pid))
    const focusElevated =
      focusElevatesActivity(focus, a.workFunction) ||
      projectIds.some((pid) => focusElevatesActivity(focus, a.workFunction, pid))

    // Drop activities with no work that are not a directed focus for this
    // eligible employee. (An ineligible, empty activity is simply not shown.)
    if (a.total === 0 && !(focusElevated && eligible)) continue

    const facts: ActivityFacts = {
      hasDueCommitment: a.due > 0,
      isEligible: eligible,
      isFocusElevated: focusElevated,
      hasOwnedWork: a.owned > 0,
    }
    const verdict = await evaluateActivityBand(facts)
    const sharedCount = Math.max(a.total - a.owned, 0)
    activities.push({
      workFunction: a.workFunction,
      label: a.label,
      description: a.description,
      band: verdict.band,
      rank: verdict.rank,
      reasonCode: verdict.reasonCode,
      reason: buildActivityReason(verdict.reasonCode, {
        dueCount: a.due,
        ownedCount: a.owned,
        sharedCount,
        label: a.label,
      }),
      totalCount: a.total,
      ownedCount: a.owned,
      sharedCount,
      dueCount: a.due,
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
