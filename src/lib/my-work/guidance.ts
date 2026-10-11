/**
 * MY WORK — practical how-to-approach guidance (Right Path).
 *
 * One place that turns an activity (WorkFunctionKey) into short, descriptive
 * guidance for HOW to approach that kind of work day to day: what the work is,
 * and whether it suits quiet focus time or belongs in a live phone-call session.
 *
 * This is deliberately NOT a priority system and NOT a schedule. GoRules ZEN
 * still owns the priority band and the per-activity reason; this module adds
 * only descriptive, always-true practice guidance alongside them. It invents no
 * deadline, no mandatory calling window, and no required order of work — it just
 * helps a worker recognize which items are heads-down work and which need a
 * phone, so they can fit each to the time they have.
 *
 * Pure strings, no server-only imports, so a 'use client' component can import
 * it directly (same boundary as capabilities/explanations.ts).
 */

import type { WorkFunctionKey } from '@/lib/capabilities/work-functions'

/**
 * The work MODE an activity (or an outreach channel) is best suited to. This is
 * about the KIND of effort, not a time of day the system enforces:
 *   - 'quiet'  Heads-down work that needs no live conversation. It fits focused
 *              quiet time and can be done whenever the worker has capacity
 *              (emails, research, document preparation).
 *   - 'calls'  Live phone outreach to a customer. Best done during appropriate
 *              calling hours, as a matter of ordinary practice — the system sets
 *              no required window and no deadline.
 */
export type WorkMode = 'quiet' | 'calls'

/** A short human label + icon-friendly note for a work mode. */
export const WORK_MODE_NOTE: Record<WorkMode, string> = {
  quiet:
    'Suits quiet focus time — heads-down work you can do whenever you have capacity.',
  calls:
    'Best during appropriate calling hours, when you can reach customers by phone.',
}

/** Descriptive guidance for one activity: what it is and how to approach it. */
export interface ActivityGuidance {
  /** Plain description of what this work actually is. */
  whatItIs: string
  /** The work mode this activity is best suited to, when it has a single clear
   * mode. Outreach spans both channels, so it is handled per source instead
   * (see outreachChannelMode); its activity-level mode is null. */
  workMode: WorkMode | null
  /** A one-line practice note shown with the activity, or null to omit. */
  note: string | null
}

/**
 * Guidance per activity. Research and Operations Preparation get the full
 * explanation the request calls for; Outreach is intentionally light at the
 * activity level because its two channels (email vs call) carry different modes
 * and are surfaced per source. Determination and office support are included for
 * completeness so no activity renders without a description.
 */
export const ACTIVITY_GUIDANCE: Record<WorkFunctionKey, ActivityGuidance> = {
  outreach: {
    whatItIs:
      'Contacting customers to establish servicing access. Emails are quiet work you can send any time; calls are for live phone conversations.',
    // Outreach spans both modes; the per-channel split carries the mode.
    workMode: null,
    note: null,
  },
  research: {
    whatItIs:
      'Resolving missing or unusable contact information — finding a working email or phone when a customer has none on file or the one we had has failed.',
    workMode: 'quiet',
    note: WORK_MODE_NOTE.quiet,
  },
  operations_prep: {
    whatItIs:
      'Collecting each policy’s carrier statement and reprojection and preparing the customer for evaluation, so a determination can be made.',
    workMode: 'quiet',
    note: WORK_MODE_NOTE.quiet,
  },
  determination: {
    whatItIs:
      'Making the customer-level candidacy decision for a project (for example, the 1035 Candidate / Not a Candidate determination).',
    workMode: 'quiet',
    note: null,
  },
  office_support: {
    whatItIs:
      'Ordinary office business that is not tied to a specific project workflow.',
    workMode: null,
    note: null,
  },
}

/**
 * The work mode for a specific OUTREACH channel, identified from the shared
 * board source label (the queue the source links to). Emails are quiet work;
 * calls are live phone outreach. Returns null for a source whose channel is not
 * an outreach channel (so callers simply omit a channel note there).
 */
export function outreachChannelMode(sourceLabel: string): WorkMode | null {
  if (/email/i.test(sourceLabel)) return 'quiet'
  if (/call/i.test(sourceLabel)) return 'calls'
  return null
}

/** Convenience: the guidance for an activity, always defined for every key. */
export function activityGuidance(key: WorkFunctionKey): ActivityGuidance {
  return ACTIVITY_GUIDANCE[key]
}
