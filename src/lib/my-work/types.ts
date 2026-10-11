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

import type { CapabilityStatus, WorkFunctionKey } from '@/lib/capabilities/work-functions'

/**
 * Where an activity's work comes from. The shared Stewardship board and each
 * project are distinct sources; one activity (e.g. Outreach) can draw from more
 * than one, which is why sources are listed under the single activity.
 */
export interface WorkSource {
  /** 'stewardship' for the shared board, 'project' for a project workflow. */
  kind: 'stewardship' | 'project'
  /** Human label for the source, e.g. "Shared Stewardship board — Ready to Call". */
  label: string
  /** Total open item count in this source (the whole shared queue / project stage). */
  count: number
  /**
   * Route that opens the EMPLOYEE'S ELIGIBLE work in this source — not the whole
   * queue when they are eligible for only part of it. For a shared-board source
   * the employee is eligible for only via a project, the route carries that
   * project scope (?queue=…&project_id=…) so it opens exactly their eligible
   * subset; for agency-wide eligibility it opens the whole queue. The ordinary
   * shared board remains fully visible via its own navigation; this link just
   * takes the worker straight to what they can act on.
   */
  route: string
  /** The project id when the link/source is project-scoped; null otherwise. */
  projectId: string | null
  /**
   * Claim-state breakdown for THIS employee within this source. These never
   * overlap: an item is exactly one of ownedByMe, availableToMe, claimedByOthers
   * (for items the employee is eligible for), or notEligible.
   */
  ownedByMe: number
  /** Eligible to this employee AND currently unclaimed (available to pick up). */
  availableToMe: number
  /** Eligible to this employee but already claimed by ANOTHER employee. */
  claimedByOthers: number
  /** Items in this source the employee is NOT eligible to perform. */
  notEligible: number
}

/**
 * The priority band ZEN assigned to an activity group. Lower rank = higher
 * priority. These mirror the ordered bands in my-work-priority.json.
 *
 * The IPF distinction is preserved: an exact-time fixed commitment
 * (exact_time_commitment) controls the day and outranks focus, while a
 * date-only due callback (due_callback) is due work surfaced below focus.
 */
export type PriorityBand =
  | 'exact_time_commitment'
  | 'focus'
  | 'due_callback'
  | 'owned'
  | 'shared'
  | 'assist'
  | 'unassigned'
  | 'unlicensed'

/** The independent presence facts handed to the MY WORK ZEN decision. */
export interface ActivityFacts {
  /**
   * An IMMINENT TAGGED EXACT-TIME fixed commitment exists for this activity.
   * This is the only commitment that outranks Today's Focus. Right Path records
   * no exact-time commitments yet, so this is false today — but it is modeled so
   * the IPF exact-time vs date-only distinction holds.
   */
  hasExactTimeCommitment: boolean
  /** The employee is ROUTABLY eligible (primary/support in scope) for this
   * activity: this work is routinely routed to them. */
  isEligible: boolean
  /**
   * The employee is OVERQUALIFIED for this activity: capable but not routinely
   * routed it. Not routed, but may still ASSIST (pick up/claim). Mutually
   * exclusive with isEligible (routable already covers that case).
   */
  canAssist: boolean
  /**
   * A CONFIRMED missing required license for this activity (an affirmative
   * qualification gap). Distinguishes 'unlicensed' from merely 'unassigned'
   * when the employee is neither routable nor assist-capable. An unknown
   * (unestablished) license is NOT a gap and leaves this false.
   */
  licenseGap: boolean
  /** Today's Focus currently elevates this activity (for this employee). */
  isFocusElevated: boolean
  /**
   * A DATE-ONLY promised callback for this activity has come due. Due work,
   * surfaced prominently, but NOT a fixed-time interruption: it does not outrank
   * Today's Focus, and it carries no clock time.
   */
  hasDueCallback: boolean
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
  /** Total open items across all sources for this activity (recorded once). */
  totalCount: number
  /** How many of those the signed-in employee has claimed (owned). */
  ownedCount: number
  /**
   * How many are unclaimed AND available to this employee (eligible + unclaimed).
   * This is work the employee can pick up right now; it excludes items claimed
   * by someone else.
   */
  availableCount: number
  /**
   * How many eligible items are already claimed by ANOTHER employee. Shown so a
   * worker never mistakes someone else's commitment for free shared work.
   */
  claimedByOthersCount: number
  /** How many items the employee is NOT eligible to perform (for awareness). */
  notEligibleCount: number
  /** How many are a due date-only promised callback (eligible to this employee). */
  dueCount: number
  /** Whether the employee is routably eligible for this activity. */
  isEligible: boolean
  /**
   * The employee's capability standing for this activity, driving how the UI
   * presents a non-routable activity: 'routable' (routed + claimable), 'assist'
   * (overqualified, may help), 'unassigned' (qualified but not assigned), or
   * 'unlicensed' (confirmed license gap). Mirrors the ZEN band's distinction.
   */
  capabilityStatus: CapabilityStatus
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
