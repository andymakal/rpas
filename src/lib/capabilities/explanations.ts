/**
 * Shared capability explanations (Right Path).
 *
 * One place that turns a CapabilityStatus into the human language every surface
 * uses, so the three distinct non-routable situations (overqualified-assist,
 * qualified-but-unassigned, confirmed-license-gap) read consistently across My
 * Work, the shared-board claim path, and any future workflow. GoRules owns the
 * DECISION and the reason codes; this module owns only the prose, written once
 * and reused — never re-hardcoded per screen.
 *
 * No server-only imports (pure strings), so a 'use client' component can import
 * it directly.
 */

import type { CapabilityStatus } from './work-functions'

/**
 * A short label for a capability standing, suitable for a tag or inline note.
 * Deliberately plain: it states the standing, not a priority judgment.
 */
export function capabilityStatusLabel(status: CapabilityStatus): string {
  switch (status) {
    case 'routable':
      return 'Routed to you'
    case 'assist':
      return 'You can assist'
    case 'unassigned':
      return 'Not assigned to you'
    case 'unlicensed':
      return 'Requires a license you have not established'
  }
}

/**
 * The full explanation for why an activity has its non-routable standing, used
 * on the My Work awareness rows and anywhere the standing must be explained.
 * `activityLabel` names the work (e.g. "Determination") so the sentence reads
 * naturally. Routable work needs no such explanation (it is simply routed), so
 * it returns a neutral statement for completeness.
 */
export function capabilityStatusExplanation(
  status: CapabilityStatus,
  activityLabel: string,
): string {
  switch (status) {
    case 'routable':
      return `${activityLabel} is routed to you.`
    case 'assist':
      return `You are qualified for ${activityLabel} but it is not routinely routed to you. You can still pick it up to assist when you have capacity.`
    case 'unassigned':
      return `${activityLabel} is not assigned to you. It is shown for awareness; a manager can assign it to you on the Team page.`
    case 'unlicensed':
      return `${activityLabel} requires a license you have not established, so it is not routed to you. It is shown for awareness.`
  }
}

/**
 * The reason a claim/pick-up is refused for a given standing, reused by the
 * shared-board claim endpoint so its message matches the My Work explanation.
 * Only the non-actionable standings refuse; 'routable' and 'assist' may act, so
 * they return null (no refusal). `activityLabel` names the activity.
 */
export function capabilityClaimRefusal(
  status: CapabilityStatus,
  activityLabel: string,
): string | null {
  switch (status) {
    case 'routable':
    case 'assist':
      return null // may act (routed, or overqualified assist)
    case 'unassigned':
      return `${activityLabel} is not assigned to you, so you cannot pick it up. Ask a manager to assign it to you on the Team page.`
    case 'unlicensed':
      return `${activityLabel} requires a license you have not established, so you cannot pick it up.`
  }
}
