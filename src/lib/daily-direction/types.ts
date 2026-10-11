/**
 * Daily Direction / Next Best Action shared TYPES (Right Path).
 *
 * Ported from IPF (bobpfromm/ipf-stewardship) src/lib/daily-direction-types.ts,
 * the established pattern: this module carries ONLY the serializable TYPES that
 * cross the client/server/composition boundary, and imports NO
 * '@gorules/zen-engine' runtime, so a 'use client' component can import these
 * types without pulling the server-only ZEN engine into the browser bundle. The
 * engine (./engine) re-exports everything here.
 *
 * Right Path first-slice scope: the candidates are assembled from the EXISTING
 * shared Stewardship outreach board (stewardship_outreach). Right Path does not
 * yet record employee capabilities, producer appointments, or exact-time
 * commitments, so this module deliberately introduces none of those concepts.
 * A date-only promised callback is surfaced as a due-callback PRIORITY, never as
 * an exact-time commitment.
 */

import type { OutreachQueue } from '@/lib/stewardship/queues'

// ---------------------------------------------------------------------------
// Candidate work (normalized inputs, assembled by the composition layer)
// ---------------------------------------------------------------------------

/**
 * One actionable Stewardship queue that currently has work, plus its count and
 * the route that opens it. Assembled by the composition layer from the real
 * board read; this is PRESENTATION over existing records, not a new concept.
 */
export interface QueueCandidate {
  /** The Stewardship queue key (ready-to-call, ready-to-email, ...). */
  queue: OutreachQueue
  /** Human label for the queue, e.g. "Ready to Call". */
  label: string
  /** How many open items are in this queue right now. */
  count: number
  /** Whether this queue is action work ('action') or a waiting state ('waiting'). */
  kind: 'action' | 'waiting'
  /** Route that opens this queue in the Stewardship board. */
  route: string
}

/**
 * A customer we promised to call back on or before today, judged on the
 * business calendar (not the server clock). This is DATE-ONLY due work: Right
 * Path records a date with no clock time, so it is surfaced as due action work,
 * never as a fixed-time commitment that interrupts or automatically outranks
 * everything. A specific clock time must never be invented or displayed for it.
 */
export interface DueCallback {
  /** The stewardship_outreach row id (opens that customer's call task). */
  id: string
  /** The customer's name, for the reason string. */
  personName: string
  /** The promised callback date (YYYY-MM-DD), date-only. */
  callbackDate: string
  /** Route that opens this customer's outreach work. */
  route: string
}

/**
 * The raw candidate work assembled from existing Stewardship reads, handed to
 * the engine for normalization + ZEN evaluation. Pure data: the composition
 * layer performs the reads; this feature decides no eligibility that ZEN owns.
 */
export interface DailyDirectionCandidates {
  /** Due/overdue promised callbacks (date-only), ordered oldest promise first. */
  dueCallbacks: DueCallback[]
  /** The actionable + waiting queues that currently have work. */
  queues: QueueCandidate[]
}

// ---------------------------------------------------------------------------
// Shared assistant state (the single serializable result)
// ---------------------------------------------------------------------------

/**
 * The kind of Next Best Action ZEN decided. 'outreach' is the single
 * equally-eligible outreach tier (ready-to-call, ready-to-email, and due
 * promised callbacks together); ZEN does not rank within it, so there is no
 * call-specific or email-specific or callback-specific verdict.
 */
export type NextActionKind =
  | 'outreach'
  | 'research_needed'
  | 'waiting'
  | 'none'

/**
 * The normalized facts handed to the Next Best Action ZEN decision. These are
 * independent PRESENCE signals: the composition reports what work exists and
 * ZEN alone decides the priority order between them. No TypeScript picks a
 * "top" queue, so no priority ordering is duplicated outside the rule.
 *
 * Ready-to-call, ready-to-email, and a due promised callback are all ordinary
 * outreach and are collapsed into one `hasOutreachWork` fact BECAUSE they are
 * equally eligible: reporting them separately would let the rule (or any
 * reader) infer a ranking that Right Path has not established. Research-needed
 * is the board's explicit exception path and is reported separately.
 */
export interface NextBestActionFacts {
  /** Any ordinary outreach exists: ready-to-call, ready-to-email, or a due callback. */
  hasOutreachWork: boolean
  /** Research-needed (exception) work exists. */
  hasResearchNeeded: boolean
  /** At least one waiting queue currently has work. */
  hasWaitingWork: boolean
}

/** The structured verdict ZEN returns. */
export interface NextBestActionVerdict {
  nextActionKind: NextActionKind
  reasonCode: string
}

/**
 * A ready-to-render summary row for the Assistant's "what's on the board"
 * breakdown. Derived from the SAME queue candidates handed to the decision; it
 * is never a ZEN fact and adds no business judgment.
 */
export interface AvailableWorkItem {
  queue: OutreachQueue
  label: string
  count: number
  kind: 'action' | 'waiting'
  route: string
}

/**
 * The single shared Daily Direction state. Plain serializable data: a server
 * component resolves it and passes it straight to the client Assistant.
 */
export interface DailyDirectionState {
  /** The kind of the Next Best Action ZEN decided. */
  nextActionKind: NextActionKind
  /** The machine-readable reason key ZEN produced. */
  reasonCode: string
  /** A short deterministic human-readable reason for the recommendation. */
  reason: string
  /**
   * The route for a SINGLE-destination recommendation (research_needed,
   * waiting). Null for the 'outreach' verdict, which has several equally
   * eligible destinations (see outreachOptions) and for 'none'. The UI must not
   * synthesize a single preferred route for outreach.
   */
  route: string | null
  /**
   * How many items the recommended next action covers, for a single-destination
   * verdict. 0 for 'outreach' (use outreachOptions) and 'none'.
   */
  actionCount: number
  /**
   * The equally-eligible outreach destinations for the 'outreach' verdict:
   * ready-to-call, ready-to-email, and (when due callbacks exist) the callback
   * queue, each with its count and route, presented WITHOUT ranking. Empty for
   * non-outreach verdicts. The UI shows these as co-equal choices.
   */
  outreachOptions: AvailableWorkItem[]
  /** The due callbacks surfaced on the board (date-only), oldest promise first. */
  dueCallbacks: DueCallback[]
  /** The full scannable board breakdown (action + waiting), for the briefing. */
  availableWork: AvailableWorkItem[]
  /** True when nothing needs attention right now (open capacity). */
  quiet: boolean
}
