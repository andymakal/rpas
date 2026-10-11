/**
 * MY WORK — shared serializable TYPES (Right Path).
 *
 * Carries ONLY the types that cross the client/server/composition boundary, with
 * NO '@gorules/zen-engine' import, so a 'use client' component can import these
 * without pulling the server-only ZEN engine into the browser bundle (the same
 * boundary the Daily Direction types module keeps).
 *
 * MY WORK organizes actionable work BY ACTIVITY (a business capability), across
 * both the shared Stewardship board and the 1035 project, for the signed-in
 * employee. Each business activity appears ONCE even when it is relevant to
 * several projects: the activity is the unit, and its sources are listed under
 * it. Work is SHARED by default; the per-activity view shows how much is
 * unclaimed, how much the employee has claimed, and whether the employee is
 * eligible to act — but it never hides shared work behind assignment.
 */

import type { WorkFunctionKey } from '@/lib/capabilities/work-functions'

/**
 * Where an activity's work comes from. The shared Stewardship board and each
 * project are distinct sources; one activity (e.g. Outreach) can draw from more
 * than one, which is why sources are listed under the single activity.
 */
export interface WorkSource {
  /** 'stewardship' for the shared board, 'project' for a project workflow. */
  kind: 'stewardship' | 'project'
  /** Human label for the source, e.g. "Shared Stewardship board" or a project name. */
  label: string
  /** Open item count from this source for this activity. */
  count: number
  /** Route that opens this source's work for this activity (the real customer work). */
  route: string
  /** The project id when kind = 'project'; null for the shared board. */
  projectId: string | null
}

/**
 * The priority band ZEN assigned to an activity group. Lower rank = higher
 * priority. These mirror the ordered bands in my-work-priority.json.
 */
export type PriorityBand =
  | 'due_commitment'
  | 'focus'
  | 'owned'
  | 'shared'
  | 'ineligible'

/** The independent presence facts handed to the MY WORK ZEN decision. */
export interface ActivityFacts {
  /** A promised callback for this activity has come due (customer commitment). */
  hasDueCommitment: boolean
  /** The employee is routably eligible for this activity. */
  isEligible: boolean
  /** Today's Focus currently elevates this activity (for this employee). */
  isFocusElevated: boolean
  /** The employee owns (has claimed) at least one item in this activity. */
  hasOwnedWork: boolean
}

/** The structured verdict ZEN returns for one activity group. */
export interface ActivityBandVerdict {
  band: PriorityBand
  rank: number
  reasonCode: string
}

/**
 * One activity group on the MY WORK surface: a single business activity, its
 * ZEN-assigned band, its counts, and the sources beneath it. Each activity
 * appears exactly once.
 */
export interface ActivityGroup {
  workFunction: WorkFunctionKey
  label: string
  description: string | null
  /** ZEN-owned band + rank; the UI orders by rank and groups by band. */
  band: PriorityBand
  rank: number
  reasonCode: string
  /** Short deterministic human reason for the band. */
  reason: string
  /** Total open items across all sources for this activity. */
  totalCount: number
  /** How many of those the signed-in employee has claimed (owned). */
  ownedCount: number
  /** How many are unclaimed/shared right now. */
  sharedCount: number
  /** How many are a due customer commitment. */
  dueCount: number
  /** Whether the employee is routably eligible for this activity. */
  isEligible: boolean
  /** Whether Today's Focus currently elevates this activity for this employee. */
  isFocusElevated: boolean
  /** The sources (shared board, projects) that feed this activity. */
  sources: WorkSource[]
}

/** The single serializable MY WORK state a server component hands the client. */
export interface MyWorkState {
  /** The signed-in employee's display name, or null when no producer record. */
  employeeName: string | null
  /** True when the user has no producer record (no personal work profile). */
  noProfile: boolean
  /** Activity groups, already ordered by ZEN rank then by activity sort order. */
  activities: ActivityGroup[]
  /** Active Today's Focus notes, for the "management direction" banner. */
  focusNotes: FocusNote[]
  /** True when nothing is actionable for this employee right now. */
  quiet: boolean
}

/** A currently-active focus, flattened for display on the MY WORK banner. */
export interface FocusNote {
  id: string
  scope: 'project' | 'activity'
  /** A human label for what is elevated (project name or activity label). */
  label: string
  note: string | null
  expiresAt: string
}
