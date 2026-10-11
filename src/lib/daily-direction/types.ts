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

/** The kind of the single Next Best Action ZEN decided. */
export type NextActionKind =
  | 'callback_due'
  | 'ready_to_call'
  | 'ready_to_email'
  | 'research_needed'
  | 'waiting'
  | 'none'

/**
 * The normalized facts handed to the Next Best Action ZEN decision. These are
 * independent PRESENCE signals: the composition reports what work exists and
 * ZEN alone decides the priority order between them. No TypeScript picks a
 * "top" queue, so no priority ordering is duplicated outside the rule.
 */
export interface NextBestActionFacts {
  /** A promised callback is DUE (date-only, on or before today on the business calendar). */
  hasCallbackDue: boolean
  /** Ready-to-call work exists. */
  hasReadyToCall: boolean
  /** Ready-to-email work exists. */
  hasReadyToEmail: boolean
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
  /** The kind of the single Next Best Action. */
  nextActionKind: NextActionKind
  /** The machine-readable reason key ZEN produced. */
  reasonCode: string
  /** A short deterministic human-readable reason for the recommendation. */
  reason: string
  /** The route to open for the Next Best Action, when one is knowable. */
  route: string | null
  /** How many items the recommended next action covers (queue count, or 1 for a callback). */
  actionCount: number
  /** The due callbacks surfaced on the board (date-only), oldest promise first. */
  dueCallbacks: DueCallback[]
  /** The full scannable board breakdown (action + waiting), for the briefing. */
  availableWork: AvailableWorkItem[]
  /** True when nothing needs attention right now (open capacity). */
  quiet: boolean
}
