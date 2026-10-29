/**
 * Customer History — the display model over the one durable history system
 * (case_touches). This is NOT a second history store. It reuses the existing
 * IPF attempt-grouping (`groupIntoAttempts`) so the several communications of
 * one interaction (a call plus the voicemail/text/email recorded with it, at a
 * shared timestamp) collapse into ONE readable event, while every underlying
 * case_touches row is preserved and still available on the event.
 *
 * Two halves, matching the GoRules division of labor used across stewardship:
 * TypeScript owns normalization and the operator-facing prose; nothing here
 * queries the database (the route supplies the rows) and nothing decides
 * eligibility or priority.
 *
 *   - buildCustomerHistory(rows, zone): the display events, newest first.
 *   - ACTIVITY_DESCRIPTIONS + describeActivity: the configurable vocabulary that
 *     turns a recorded touch into "what happened" prose. It is data, not a
 *     per-screen hardcode, so the phrasing can evolve centrally as workflows
 *     change without editing every screen.
 *   - describeNextHistoryEntry: the preview of the history entry the CURRENT
 *     workflow will record when the worker completes the open action, so a
 *     worker sees what completing the work will log (and never logs it twice by
 *     hand).
 */

import { DateTime } from 'luxon'
import { FALLBACK_ACTOR_TIME_ZONE, isValidTimeZone } from '@/lib/time'
import {
  groupIntoAttempts,
  parseOutcomeFromNote,
  noteIndicatesReached,
  noteIndicatesInbound,
  type Communication,
  type OutreachChannel,
  type ChannelOutcome,
} from './outreach-attempts'

/** The direction of a recorded communication, for presentations that title an
 * event by who initiated it. Derived from the stored note (the inbound marker
 * and the route's prefix wording); orthogonal to channel and outcome.
 *   - 'incoming'  a genuine customer-initiated response (email/call/text in).
 *   - 'automated' an inbound auto-reply (out-of-office, delivery receipt) — NOT
 *                 a genuine response and never engagement.
 *   - 'outgoing'  our reach-out to the customer (the default).
 * Only the new Relationship Timeline presentation reads this; the existing
 * Customer History card ignores it, so adding it changes no existing screen. */
export type HistoryDirection = 'incoming' | 'outgoing' | 'automated'

/** Whether a stored touch note records an AUTOMATED inbound reply. The touch
 * route prefixes such a note "Automated <channel> reply received"; it still
 * carries the inbound marker, so this narrows an inbound communication to the
 * automated case. */
function noteIndicatesAutomated(note: string | null): boolean {
  return !!note && /^Automated\s+\w+\s+reply received/i.test(note.trim())
}

/** Resolve the direction of one stored touch note from its markers/prefix. */
function directionOfNote(note: string | null): HistoryDirection {
  if (!noteIndicatesInbound(note)) return 'outgoing'
  return noteIndicatesAutomated(note) ? 'automated' : 'incoming'
}

/**
 * Whether a touch note's DIRECTION is actually KNOWN from how it was recorded,
 * as opposed to merely defaulting to outgoing. Direction is known when:
 *   - it carries the inbound marker (a recorded incoming/automated reply), or
 *   - it carries the outgoing "Servicing-agent onboarding <channel>" prefix the
 *     touch/transition routes write, or
 *   - it carries a recognized outcome/system marker or phrase that only an
 *     outgoing workflow action writes (reached, voicemail, bad number, etc.).
 * A bare legacy row with none of these has UNKNOWN direction, so the timeline
 * must not invent one — it falls back to the grouped summary heading.
 */
function directionIsKnown(note: string | null): boolean {
  if (!note) return false
  if (noteIndicatesInbound(note)) return true
  if (/^Servicing-agent onboarding\s+(?:call|voicemail|text|email|postal)\b/i.test(note.trim())) return true
  // An outgoing workflow outcome leaves one of these stable signatures.
  if (noteIndicatesReached(note)) return true
  if (/\[no-contact\]|\[channel-unusable/i.test(note)) return true
  for (const re of SYSTEM_OUTCOME_PHRASES) {
    if (re.test(stripMarkersAndPrefix(note))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Timeline event headings — the precise, event-specific titles the Relationship
// Timeline shows. Each names the ACTUAL recorded event (channel + direction +
// outcome, or milestone type), never a generic "incoming/outgoing" label.
// Additive: computed here and read only by the Relationship Timeline.
// ---------------------------------------------------------------------------

/** Title-case channel noun for a communication heading. */
const CHANNEL_NOUN: Partial<Record<OutreachChannel, string>> = {
  email: 'Email',
  text: 'Text',
  postal: 'Postal Mail',
}

/**
 * The precise heading for one grouped CONTACT interaction, derived from its
 * communications. Returns null when direction is unknown for every
 * communication (a legacy record), so the timeline falls back to the grouped
 * summary rather than inventing a direction.
 *
 * The lead communication is the one that defines the event: a reached/voicemail
 * call outcome leads; otherwise the first communication whose direction is
 * known. Headings map to the agreed vocabulary:
 *   call reached            -> Customer Reached
 *   call incoming           -> Incoming Call
 *   voicemail               -> Voicemail Left
 *   call unusable           -> Bad Number
 *   call no-answer/outgoing  -> No Answer
 *   email automated          -> Automated Email Reply
 *   email outgoing           -> Email Sent      | incoming -> Email Received
 *   email unusable           -> Email Undeliverable
 *   text  automated          -> Automated Text Reply
 *   text  outgoing           -> Text Sent        | incoming -> Text Received
 *   postal outgoing          -> Postal Mail Sent | incoming -> Postal Mail Received
 *
 * An AUTOMATED inbound reply (out-of-office, delivery receipt) is a distinct,
 * non-genuine event. It is titled "Automated … Reply" and is NEVER shown as a
 * genuine "Received" communication. This is presentation only; it does not
 * touch the engagement rule — an automated reply still never marks the customer
 * engaged (that is decided when the touch is recorded, not here).
 */
function contactHeading(comms: HistoryCommunication[]): string | null {
  if (comms.length === 0) return null

  // Prefer a call that reached, then a voicemail (a voicemail channel means one
  // was left regardless of the [no-contact] marker, which only says the call
  // did not reach), then any communication whose direction is known. This names
  // the meaningful event in a grouped interaction without inventing anything.
  // "Customer Reached" and "Voicemail Left" carry no direction, so they are
  // safe even for a legacy row; the direction-bearing headings below are only
  // reached via `knownDirected`, so a legacy row of unknown direction never
  // produces an invented "Received"/"Sent"/"Incoming" heading.
  const reachedCall = comms.find((c) => c.channel === 'call' && c.reached)
  const voicemail = comms.find((c) => c.channel === 'voicemail')
  const knownDirected = comms.find(
    (c) => c.direction === 'incoming' || c.direction === 'automated' || directionKnownFor(c),
  )
  const lead = reachedCall ?? voicemail ?? knownDirected
  if (!lead) return null

  // Three-way direction, so an automated reply is never conflated with a
  // genuine incoming communication.
  const automated = lead.direction === 'automated'
  const incoming = lead.direction === 'incoming'

  switch (lead.channel) {
    case 'call':
      if (lead.reached) return 'Customer Reached'
      if (automated) return 'Automated Call Reply'
      if (incoming) return 'Incoming Call'
      if (lead.outcome === 'unusable') return 'Bad Number'
      return 'No Answer'
    case 'voicemail':
      return 'Voicemail Left'
    case 'email':
      if (automated) return 'Automated Email Reply'
      if (lead.outcome === 'unusable') return 'Email Undeliverable'
      return incoming ? 'Email Received' : 'Email Sent'
    case 'text':
      if (automated) return 'Automated Text Reply'
      return incoming ? 'Text Received' : 'Text Sent'
    case 'postal':
      return incoming ? `${CHANNEL_NOUN.postal} Received` : `${CHANNEL_NOUN.postal} Sent`
    default:
      return null
  }
}

/** Per-communication direction-known flag, carried from the note at build time
 * so contactHeading can prefer a communication whose direction is settled. */
const DIRECTION_KNOWN = new WeakMap<HistoryCommunication, boolean>()
function directionKnownFor(c: HistoryCommunication): boolean {
  return DIRECTION_KNOWN.get(c) === true
}

/** The precise heading for a workflow MILESTONE event (follow-up scheduled /
 * completed / refusal), from the already-derived summary. */
function milestoneHeading(summary: string): string {
  if (/completed/i.test(summary)) return 'Follow-up Completed'
  if (/follow-up/i.test(summary)) return 'Follow-up Scheduled'
  if (/refus/i.test(summary)) return 'Customer Declined'
  if (/contact updated/i.test(summary)) return 'Customer Contact Updated'
  return summary
}

// ---------------------------------------------------------------------------
// Raw input — one case_touches row, exactly as stored. The route selects these
// columns and hands them over; this module never reads the database itself.
// ---------------------------------------------------------------------------

export interface HistoryTouchRow {
  id: string
  touch_type: string
  notes: string | null
  touched_at: string
  touched_by: string | null
}

// Raw input — one project-enrollment fact: the single membership row that first
// added a customer to a project (project_customers), already joined to the
// project name and, when known, the operator who ran the draw. One row per
// customer per project (the membership is deduped at write time), so this
// yields exactly one "Added to Project" event per project. This module never
// reads the database itself; the route selects these and hands them in.
export interface HistoryEnrollmentRow {
  /** project_customers.id — a stable key for the event. */
  id: string
  /** The project the customer was added to (projects.name). */
  project_name: string
  /** When the customer was first added (project_customers.added_at, ISO). */
  added_at: string
  /** Who ran the draw that added them (a resolved display name), when known. */
  added_by: string | null
}

// ---------------------------------------------------------------------------
// Display model — one grouped event (one interaction) and the individual
// communications it comprises (preserved, never collapsed away).
// ---------------------------------------------------------------------------

/** One preserved underlying communication within a grouped event. */
export interface HistoryCommunication {
  id: string
  channel: OutreachChannel
  outcome: ChannelOutcome
  reached: boolean
  /** Who initiated this communication, derived from the stored note. Defaults
   * to 'outgoing'. Read only by the Relationship Timeline presentation. */
  direction?: HistoryDirection
  /** The genuine employee-typed note, with internal machine markers and the
   * system boilerplate stripped. Null when the worker typed nothing. */
  detail: string | null
  /** The system-generated description of what the recorded action was (e.g.
   * "Introductory email sent with servicing-agent authorization form."),
   * derived automatically from the stored note. Null when the note carries no
   * recognizable system sentence. Shown below the summary/attribution line so
   * the history explains what actually happened without the worker typing it. */
  systemDescription: string | null
}

/** One readable history event: the several communications of a single
 * interaction, summarized once, with who recorded it and when. */
export interface HistoryEvent {
  /** Grouping key: the shared ISO instant of the interaction. */
  at: string
  /** The one-line "what happened" summary for the whole interaction. */
  summary: string
  /** The system-generated description of the completed action, shown under the
   * summary/attribution line so the entry explains what actually happened
   * (e.g. "Introductory email sent with servicing-agent authorization form.").
   * Generated automatically from the recorded touch; null when the recorded
   * information does not support a description. */
  description?: string | null
  /** Who recorded it (the employee name on the touches), when known. */
  by: string | null
  /** True when any communication in the interaction reached the customer. */
  reached: boolean
  /** What kind of event this is, so the card can render the right affordance:
   * a customer communication ('contact'), an internal research record
   * ('research'), a project enrollment ('enrollment'), or a Customer
   * Interaction workflow milestone ('milestone') such as a scheduled or
   * completed follow-up or a recorded refusal. Defaults to 'contact' when
   * absent. */
  kind?: 'contact' | 'research' | 'enrollment' | 'milestone'
  /** The direction of the interaction, for presentations that title an event by
   * who initiated it (the Relationship Timeline). An interaction is 'incoming'
   * when any of its communications is a genuine customer-initiated response,
   * 'automated' when its only inbound communication is an auto-reply, and
   * 'outgoing' otherwise. Only a 'contact' event carries a meaningful direction;
   * research, enrollment, and milestone events leave it 'outgoing'. The existing
   * Customer History card ignores this field. */
  direction?: HistoryDirection
  /** The precise, event-specific heading for the Relationship Timeline (e.g.
   * "Email Received", "Customer Reached", "Voicemail Left", "Follow-up
   * Scheduled"). It names the ACTUAL event from the recorded channel, direction,
   * outcome, and milestone type — never a generic "incoming/outgoing" label.
   * Additive: only the Relationship Timeline reads it; the existing Customer
   * History card ignores it and keeps its grouped `summary`. Null when no
   * confident heading can be derived (e.g. a legacy record of unknown
   * direction), so the timeline falls back to the grouped summary rather than
   * inventing direction. */
  timelineHeading?: string | null
  /** For an enrollment event, the project the customer was added to, shown as
   * the detail line under the summary. Unused for other kinds. */
  projectName?: string
  /** The underlying communications, preserved. */
  communications: HistoryCommunication[]
}

// ---------------------------------------------------------------------------
// Configurable activity descriptions.
//
// The phrasing that turns a recorded channel + outcome into human prose lives
// here as DATA, so it is tuned in one place as workflows evolve rather than
// being hardcoded into each screen. A channel maps to its reached / touch /
// no_contact / unusable wording. `describeActivity` resolves one communication;
// `summarizeInteraction` composes the one-line event summary from the mix of
// channels in an interaction.
// ---------------------------------------------------------------------------

export type ActivityOutcomeKey = 'reached' | 'touch' | 'no_contact' | 'unusable'

type ChannelDescriptions = Partial<Record<ActivityOutcomeKey, string>> & { touch: string }

/** The default, configurable vocabulary. Override via `describeActivity`'s
 * `overrides` argument (or extend this map) as workflows change; screens read
 * it rather than embedding their own strings. */
export const ACTIVITY_DESCRIPTIONS: Record<OutreachChannel, ChannelDescriptions> = {
  call: {
    reached: 'Reached',
    touch: 'Called',
    no_contact: 'No Answer',
    unusable: 'Bad Number',
  },
  voicemail: {
    // A voicemail touch_type exists only because a voicemail was left, so it
    // always reads "Voicemail" — the [no-contact] marker on it means the call
    // did not reach, not that no voicemail was left.
    touch: 'Voicemail',
    no_contact: 'Voicemail',
    unusable: 'Voicemail unavailable',
  },
  text: {
    touch: 'Text',
    no_contact: 'Text not sent',
    unusable: 'Text unusable',
  },
  email: {
    touch: 'Email',
    no_contact: 'Email not sent',
    unusable: 'Email unusable',
  },
  postal: {
    touch: 'Postal mail',
    no_contact: 'Postal not sent',
    unusable: 'Mailing address unusable',
  },
}

/** Resolve the configurable phrase for one communication. A reached call uses
 * the `reached` phrasing; otherwise the per-outcome phrasing, falling back to
 * the channel's `touch` phrase. `overrides` lets a caller adjust the vocabulary
 * without editing the shared map. */
export function describeActivity(
  channel: OutreachChannel,
  outcome: ChannelOutcome,
  reached: boolean,
  overrides?: Partial<Record<OutreachChannel, Partial<ChannelDescriptions>>>,
): string {
  const base = ACTIVITY_DESCRIPTIONS[channel]
  const over = overrides?.[channel]
  const key: ActivityOutcomeKey = reached && channel === 'call' ? 'reached' : outcome
  return over?.[key] ?? base[key] ?? over?.touch ?? base.touch
}

// ---------------------------------------------------------------------------
// Note cleaning — strip the internal machine markers so the detail reads as
// clean prose. Mirrors the dark screen's cleanTouchNote; kept here so the
// shared history card does not depend on a page component.
// ---------------------------------------------------------------------------

/** The system-generated outcome phrases the workflow writes onto a touch note.
 * They duplicate what the concise summary already says, so they are stripped
 * from the displayed detail; only a genuine employee-typed note survives. The
 * list mirrors the fixed phrases the stewardship PATCH / call-outcome paths
 * write (see /api/stewardship/[id]). A trailing clause after a period (e.g.
 * "Follow-up auto-scheduled.") is also system prose and is removed. */
const SYSTEM_OUTCOME_PHRASES: readonly RegExp[] = [
  // Reached-call sentences. "Spoke with customer." is the lead for every reached
  // outcome, but the agreed / callback / declined CONTINUATIONS are system prose
  // too and must be stripped WHOLE — otherwise the bare "Spoke with customer."
  // alone would be removed and the real continuation (e.g. "Customer requested a
  // callback on 2026-11-05.") would be mistaken for an employee note. Each full
  // sentence is matched first; only then the bare lead, anchored to end-of-note
  // so it never partially strips one of the longer reached sentences.
  /^Spoke with customer\.\s*Customer agreed to authorize our office as servicing agent\.\s*Authorization form (?:emailed|sent by postal mail)\.\s*Awaiting signed authorization\.?/i,
  /^Spoke with customer\.\s*Customer requested a callback(\s+on\s+\S+)?\.?/i,
  /^Spoke with customer\.\s*Customer declined servicing-agent authorization\.\s*Further outreach stopped unless deliberately reopened\.?/i,
  /^Spoke with customer\.\s*$/i,
  // Didn't-reach call sentences (no-answer, with or without a voicemail left).
  /^Called customer\.\s*No answer\.(\s*Voicemail left\.)?\s*Next call scheduled\.?/i,
  /^Called customer\.\s*Number is not working\.\s*Customer referred to Contact Research\.?/i,
  // Legacy sentences kept so existing history still cleans correctly.
  /^Reached the customer\.?/i,
  /^Left a voicemail\.?(\s*Follow-up auto-scheduled\.?)?/i,
  /^Bad number\.?(\s*Moved to Research Needed\.?)?/i,
  /^Customer declined\.?(\s*Outreach stopped until deliberately reopened\.?)?/i,
  /^Customer asked for a callback(\s+on\s+\S+)?\.?/i,
  /^Contact research completed: no usable (?:email|phone|mailing address) found\.?/i,
  // The authorization-email / form-sent confirmations the send paths write.
  // These are system descriptions, redundant with the concise channel summary.
  /^1035 servicing-agent authorization email sent to the customer(\s+at\s+\S+)?\.?/i,
  /^Servicing-agent authorization form sent to the customer(\s+\w+)?\.?/i,
]

/**
 * Strip the internal machine markers AND the system-generated boilerplate so
 * the displayed detail is only a genuine employee-typed note (or nothing). It
 * removes the "Servicing-agent onboarding <channel>" prefix the routes prepend,
 * the fixed system outcome phrases, and every outcome/research marker. What
 * remains is the operator's own words, which are preserved. Display only; it
 * never changes the stored note.
 */
export function cleanHistoryNote(note: string | null): string | null {
  if (!note) return null
  let cleaned = note
    // Every stored machine marker, including the address research marker and the
    // inbound-direction marker (an internal flag that must never be displayed).
    .replace(/\[research-(?:email|phone|address)-not-found\]/gi, '')
    .replace(/\[channel-unusable(?::[^\]]*)?\]/gi, '')
    .replace(/\[no-contact\]/gi, '')
    .replace(/\[reached\]/gi, '')
    .replace(/\[inbound\]/gi, '')
    .replace(/\[email-availability:[^\]]*\]/gi, '')
    .replace(/\[name-change\]/gi, '')
    .replace(/\[contact-update\]/gi, '')
    // The outgoing "Servicing-agent onboarding <channel>" boilerplate prefix,
    // and the inbound "Customer <channel> response received" / "Automated
    // <channel> reply received" prefixes the touch route prepends — with or
    // without the trailing ": " (employee note) or "." (no note). Stripping
    // these leaves only the operator's own words as the displayed message.
    .replace(/^Servicing-agent onboarding\s+(?:call|voicemail|text|email|postal)\s*[:.]?\s*/i, '')
    .replace(/^Customer\s+(?:call|voicemail|text|email|postal)\s+response received\s*[:.]?\s*/i, '')
    .replace(/^Automated\s+(?:call|voicemail|text|email|postal)\s+reply received\s*[:.]?\s*/i, '')
    .trim()
  // Remove a leading system outcome phrase; a genuine employee note (if any)
  // follows it and is kept.
  for (const re of SYSTEM_OUTCOME_PHRASES) {
    const next = cleaned.replace(re, '').trim()
    if (next !== cleaned) { cleaned = next; break }
  }
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : null
}

// ---------------------------------------------------------------------------
// System description — the companion to cleanHistoryNote. Where cleanHistoryNote
// keeps ONLY the operator's own words, this recovers the system-generated
// sentence the workflow wrote, normalized into one readable description of what
// the recorded action actually was. It is derived automatically from the stored
// note; the worker never types it. Shown under the summary/attribution line so
// the entry explains what happened (e.g. an introductory email that carried the
// authorization form), while any genuine employee note is still preserved
// separately by cleanHistoryNote. Display only; it never changes the stored
// note and never invents facts the note does not support.
// ---------------------------------------------------------------------------

/** Remove the internal machine markers and the "Servicing-agent onboarding
 * <channel>" prefix, returning the remaining prose (both the system sentence
 * and any employee note). The description extractor works from this. */
function stripMarkersAndPrefix(note: string): string {
  return note
    .replace(/\[research-(?:email|phone|address)-not-found\]/gi, '')
    .replace(/\[channel-unusable(?::[^\]]*)?\]/gi, '')
    .replace(/\[no-contact\]/gi, '')
    .replace(/\[reached\]/gi, '')
    .replace(/\[inbound\]/gi, '')
    .replace(/\[email-availability:[^\]]*\]/gi, '')
    .replace(/\[name-change\]/gi, '')
    .replace(/\[contact-update\]/gi, '')
    .replace(/^Servicing-agent onboarding\s+(?:call|voicemail|text|email|postal)\s*[:.]?\s*/i, '')
    .replace(/^Customer\s+(?:call|voicemail|text|email|postal)\s+response received\s*[:.]?\s*/i, '')
    .replace(/^Automated\s+(?:call|voicemail|text|email|postal)\s+reply received\s*[:.]?\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The stored system sentences mapped to clean, operator-facing descriptions.
 * The left side matches exactly the fixed sentences the stewardship routes
 * write (see /api/stewardship/[id]); the right side is the readable description
 * shown in Customer History. Keeping the mapping here, as data, means the
 * description phrasing evolves centrally rather than being re-derived per
 * screen. Anything not matched falls back to the stored sentence itself (with
 * markers/prefix already stripped), so a new system sentence still shows
 * meaningfully until it is given a tuned description here. */
const SYSTEM_DESCRIPTIONS: ReadonlyArray<{ match: RegExp; describe: string }> = [
  // ── The required servicing-agent call-outcome language ──────────────────────
  // These are the authoritative, operator-facing history sentences. The stored
  // note now carries the same wording, so the displayed description reads it
  // back verbatim (the callback rule re-formats the embedded date).
  {
    // Reached · agreed · form emailed.
    match: /^Spoke with customer\.\s*Customer agreed to authorize our office as servicing agent\.\s*Authorization form emailed\.\s*Awaiting signed authorization\.?$/i,
    describe:
      'Spoke with customer. Customer agreed to authorize our office as servicing agent. Authorization form emailed. Awaiting signed authorization.',
  },
  {
    // Reached · agreed · form mailed.
    match: /^Spoke with customer\.\s*Customer agreed to authorize our office as servicing agent\.\s*Authorization form sent by postal mail\.\s*Awaiting signed authorization\.?$/i,
    describe:
      'Spoke with customer. Customer agreed to authorize our office as servicing agent. Authorization form sent by postal mail. Awaiting signed authorization.',
  },
  {
    // Reached · wants callback (date preserved from the stored sentence).
    match: /^Spoke with customer\.\s*Customer requested a callback(\s+on\s+(\S+))?\.?$/i,
    describe: 'Spoke with customer. Customer requested a callback.',
  },
  {
    // Reached · not interested.
    match: /^Spoke with customer\.\s*Customer declined servicing-agent authorization\.\s*Further outreach stopped unless deliberately reopened\.?$/i,
    describe:
      'Spoke with customer. Customer declined servicing-agent authorization. Further outreach stopped unless deliberately reopened.',
  },
  {
    // Didn't reach · voicemail left.
    match: /^Called customer\.\s*No answer\.\s*Voicemail left\.\s*Next call scheduled\.?$/i,
    describe: 'Called customer. No answer. Voicemail left. Next call scheduled.',
  },
  {
    // Didn't reach · no voicemail.
    match: /^Called customer\.\s*No answer\.\s*Next call scheduled\.?$/i,
    describe: 'Called customer. No answer. Next call scheduled.',
  },
  {
    // Bad number.
    match: /^Called customer\.\s*Number is not working\.\s*Customer referred to Contact Research\.?$/i,
    describe: 'Called customer. Number is not working. Customer referred to Contact Research.',
  },
  // ── The introductory / form-send confirmations ──────────────────────────────
  {
    // The introductory 1035 email: the authorization form rides with it, so the
    // description names the form rather than echoing the terse "Email" summary.
    match: /^1035 servicing-agent authorization email sent to the customer(\s+at\s+\S+)?\.?$/i,
    describe: 'Introductory email sent with servicing-agent authorization form.',
  },
  {
    match: /^1035 servicing-agent authorization letter mailed to the customer by postal mail\.?$/i,
    describe: 'Introductory letter mailed with servicing-agent authorization form.',
  },
  {
    // A form re-send with no reached completion (the reached sentence above owns
    // the reached · agreed interaction).
    match: /^Servicing-agent authorization form sent to the customer by email\.?$/i,
    describe: 'Servicing-agent authorization form sent by email.',
  },
  {
    match: /^Servicing-agent authorization form sent to the customer by postal mail\.?$/i,
    describe: 'Servicing-agent authorization form sent by postal mail.',
  },
  // ── Legacy sentences (pre-standard history still reads meaningfully) ────────
  {
    match: /^Reached the customer\.?$/i,
    describe: 'Spoke with customer.',
  },
  {
    match: /^Left a voicemail\.?(\s*Follow-up auto-scheduled\.?)?$/i,
    describe: 'Called customer. No answer. Voicemail left. Next call scheduled.',
  },
  {
    match: /^Bad number\.?(\s*Moved to Research Needed\.?)?$/i,
    describe: 'Called customer. Number is not working. Customer referred to Contact Research.',
  },
  {
    match: /^Customer declined\.?(\s*Outreach stopped until deliberately reopened\.?)?$/i,
    describe:
      'Spoke with customer. Customer declined servicing-agent authorization. Further outreach stopped unless deliberately reopened.',
  },
  {
    match: /^Customer asked for a callback(\s+on\s+(\S+))?\.?$/i,
    // Preserve the date when the stored sentence carries one.
    describe: 'Spoke with customer. Customer requested a callback.',
  },
]

/**
 * Build the system-generated description for one stored touch note. Returns the
 * readable description of what the recorded action was, or null when the note
 * carries no recognizable system sentence (so the display shows no empty line).
 *
 * The note is structured as: [system sentence] [optional employee note]
 * [machine markers]. This recovers the system sentence only; cleanHistoryNote
 * recovers the employee note. The two are complementary and never overlap, so a
 * worker's own words are preserved while the system still explains the action.
 */
export function describeHistoryNote(note: string | null): string | null {
  if (!note) return null
  const strippedFull = stripMarkersAndPrefix(note)
  if (!strippedFull) return null

  // Isolate the SYSTEM SENTENCE from any trailing employee note so the exact,
  // end-anchored SYSTEM_DESCRIPTIONS matchers still apply when the worker added
  // their own words (otherwise a callback/declined sentence with a note would
  // fall through to the raw fallback and, e.g., show an unformatted date). The
  // employee note is recovered separately by cleanHistoryNote and never folded
  // in here, so the two stay complementary and never overlap.
  const employeeNoteEarly = cleanHistoryNote(note)
  const stripped =
    employeeNoteEarly && strippedFull.endsWith(employeeNoteEarly)
      ? strippedFull.slice(0, strippedFull.length - employeeNoteEarly.length).trim()
      : strippedFull
  if (!stripped) return null

  // Match a known system sentence at the START of the stripped prose. The
  // mapped description is used; a trailing employee note (if any) is NOT folded
  // in here — it is shown separately via cleanHistoryNote.
  for (const { match, describe } of SYSTEM_DESCRIPTIONS) {
    const m = stripped.match(match)
    if (m) {
      // Callback keeps its date when present (capture group on the callback
      // rule). The required phrasing is "requested a callback on <date>"; the
      // legacy sentence used "asked for a callback" — honor whichever the
      // matched description uses so the displayed date reads consistently.
      if (/requested a callback/i.test(describe) && m[2]) {
        const when = formatCallbackDate(m[2])
        return when ? `Spoke with customer. Customer requested a callback on ${when}.` : describe
      }
      if (/asked for a callback/i.test(describe) && m[2]) {
        const when = formatCallbackDate(m[2])
        return when ? `Customer asked for a callback on ${when}.` : describe
      }
      return describe
    }
  }

  // Research sentences carry their meaning in the concise summary already, so
  // they produce no separate description line.
  if (/^Contact research completed:/i.test(stripped)) return null

  // An unmapped system sentence: show the stored sentence itself. The employee
  // note was already removed above, so `stripped` is the system part only and
  // new workflow actions still read meaningfully until tuned above.
  return stripped.length > 0 ? stripped : null
}

/** The channels this module treats as customer-history communications. Mirrors
 * the outreach channels; other touch types are ignored so the history stays
 * about customer contact. */
const HISTORY_CHANNELS: ReadonlySet<string> = new Set([
  'call',
  'voicemail',
  'text',
  'email',
  'postal',
])

/** The touch_type recorded contact research is stored under (see
 * research-record.ts). It is internal research, not a customer communication,
 * so it is shown as its own distinct, concise history event. */
const RESEARCH_TOUCH_TYPE = 'research'

/** The touch_type Customer Interaction WORKFLOW MILESTONES are stored under: a
 * follow-up scheduled, a follow-up completed, or a recorded refusal. These are
 * administrative outreach events, NOT telephone calls or any customer
 * communication, so they are recorded under their own type and shown as their
 * own distinct history event — the same pattern research uses. They must never
 * be stored as 'call' (which would fabricate a phone call that did not happen).
 * The note text is the human-readable milestone description. */
const WORKFLOW_TOUCH_TYPE = 'workflow'

/** Which contact method an unsuccessful-research touch note refers to, from its
 * stable marker. null when the note carries no recognizable research marker. */
function researchMethodOfNote(note: string | null): 'email' | 'phone' | 'address' | null {
  if (!note) return null
  const n = note.toLowerCase()
  if (n.includes('[research-email-not-found]')) return 'email'
  if (n.includes('[research-phone-not-found]')) return 'phone'
  if (n.includes('[research-address-not-found]')) return 'address'
  return null
}

const RESEARCH_METHOD_LABEL: Record<'email' | 'phone' | 'address', string> = {
  email: 'email',
  phone: 'phone',
  address: 'mailing address',
}

/**
 * Build the recorded-research history events from the research touches, grouped
 * so the per-method rows written together in one research pass (shared
 * timestamp) read as ONE concise "Research Unsuccessful" event naming the
 * methods. Internal research is distinct from outreach, so these are their own
 * events rather than folded into a call attempt. The redundant system sentence
 * on each note is not shown; the concise label carries the meaning.
 */
function buildResearchEvents(rows: HistoryTouchRow[]): HistoryEvent[] {
  const researchRows = rows.filter((r) => r.touch_type === RESEARCH_TOUCH_TYPE)
  if (researchRows.length === 0) return []

  // Group by the shared touched_at (one research pass).
  const byAt = new Map<string, HistoryTouchRow[]>()
  for (const r of researchRows) {
    const list = byAt.get(r.touched_at) ?? []
    list.push(r)
    byAt.set(r.touched_at, list)
  }

  const events: HistoryEvent[] = []
  for (const [at, group] of byAt) {
    const methods = group
      .map((r) => researchMethodOfNote(r.notes))
      .filter((m): m is 'email' | 'phone' | 'address' => m != null)
    const methodLabels = Array.from(new Set(methods)).map((m) => RESEARCH_METHOD_LABEL[m])
    // "Research Unsuccessful (email, phone)" — concise, the methods in parens.
    const summary = methodLabels.length > 0
      ? `Research Unsuccessful (${methodLabels.join(', ')})`
      : 'Research Unsuccessful'
    const by = group.map((r) => r.touched_by).find((n) => !!n) ?? null
    events.push({
      at,
      summary,
      by,
      reached: false,
      kind: 'research',
      // Preserve the underlying rows, but suppress the redundant system note:
      // cleanHistoryNote strips the research sentence, leaving detail null.
      communications: group.map((r) => ({
        id: r.id,
        channel: 'email' as OutreachChannel, // nominal; research is not a channel
        outcome: 'no_contact' as ChannelOutcome,
        reached: false,
        detail: cleanHistoryNote(r.notes),
        // The concise summary already carries the meaning; no description line.
        systemDescription: null,
      })),
    })
  }
  return events
}

/**
 * Build the Customer Interaction WORKFLOW MILESTONE events: a scheduled
 * follow-up, a completed follow-up, or a recorded refusal. These are
 * administrative outreach events, not customer communications, so — exactly like
 * research — they are their own distinct, concise events rather than folded into
 * a contact attempt, and they are NEVER rendered as a telephone call. The stored
 * note is already human-readable, so it is shown directly (markers/prefix
 * stripped) as the event detail; the summary is a short label by milestone type.
 */
function buildWorkflowEvents(rows: HistoryTouchRow[]): HistoryEvent[] {
  const workflowRows = rows.filter((r) => r.touch_type === WORKFLOW_TOUCH_TYPE)
  if (workflowRows.length === 0) return []

  return workflowRows.map((r) => {
    const note = r.notes ?? ''
    // A short, honest summary by milestone type, derived from the stored note.
    // The note itself (self-describing prose written by the route) is shown as
    // the detail line, so no communication is fabricated.
    const summary =
      /follow-up completed/i.test(note) ? 'Follow-up completed'
      : /follow-up/i.test(note) ? 'Follow-up scheduled'
      : /\[contact-update\]/i.test(note) || /^Customer name corrected/i.test(note) || /\[name-change\]/i.test(note) ? 'Customer Contact Updated'
      : /\[email-availability:/i.test(note) || /^Email (availability|marked)/i.test(note) ? 'Email availability updated'
      : /declined|refus/i.test(note) ? 'Customer refusal'
      : 'Workflow update'
    return {
      at: r.touched_at,
      summary,
      // Show the stored milestone note as the description line (it is already
      // operator-facing prose); strip any machine markers/prefix for cleanliness.
      description: stripMarkersAndPrefix(note) || null,
      by: r.touched_by,
      reached: false,
      kind: 'milestone' as const,
      timelineHeading: milestoneHeading(summary),
      communications: [],
    }
  })
}

/**
 * Build the project-enrollment history events. One "Added to Project" event per
 * membership row — the membership is deduped at write time (one row per
 * customer per project, keyed on the FIRST run that added them), so subsequent
 * draws that re-include an already-enrolled customer never produce a second
 * event. The event carries the operator attribution and the first-added
 * timestamp, with the project name shown as the detail line. These are a
 * distinct kind, never folded into a contact or research event.
 */
function buildEnrollmentEvents(rows: HistoryEnrollmentRow[]): HistoryEvent[] {
  return rows.map((r) => ({
    at: r.added_at,
    summary: 'Added to Project',
    by: r.added_by,
    reached: false,
    kind: 'enrollment' as const,
    projectName: r.project_name,
    communications: [],
  }))
}

function zoneOf(actorTimeZone: string | null): string {
  return isValidTimeZone(actorTimeZone) ? (actorTimeZone as string) : FALLBACK_ACTOR_TIME_ZONE
}

/**
 * Compose the one-line summary for a whole interaction from its communications.
 * A reached call leads (it is the meaningful outcome); otherwise the channels
 * are listed in the recorded order. Preserves honesty: it describes exactly the
 * channels that were recorded, nothing more.
 */
function summarizeInteraction(
  comms: HistoryCommunication[],
  overrides?: Partial<Record<OutreachChannel, Partial<ChannelDescriptions>>>,
): string {
  if (comms.length === 0) return 'Contact recorded'

  const reachedCall = comms.find((c) => c.channel === 'call' && c.reached)
  if (reachedCall) {
    const others = comms.filter((c) => c !== reachedCall)
    const lead = describeActivity('call', reachedCall.outcome, true, overrides)
    if (others.length === 0) return lead
    // Combine the reached call with its other channels into ONE concise entry,
    // the same "·"-joined format the Next History Entry preview uses, e.g.
    // "Reached · Form Sent".
    const rest = others.map((c) => describeActivity(c.channel, c.outcome, c.reached, overrides))
    return [lead, ...rest].join(' \u00b7 ')
  }

  const phrases = comms.map((c) => describeActivity(c.channel, c.outcome, c.reached, overrides))
  if (phrases.length === 1) return phrases[0]
  // Join the attempt's channels into one concise line, e.g.
  // "No Answer · Voicemail · Text".
  return phrases.join(' \u00b7 ')
}

/**
 * Build the display customer history from raw case_touches rows. Groups the
 * communications of one interaction into one event (reusing the IPF grouping),
 * newest event first, preserving every underlying communication. Rows whose
 * touch_type is not a contact channel are ignored.
 */
export function buildCustomerHistory(
  rows: HistoryTouchRow[],
  actorTimeZone: string | null,
  overrides?: Partial<Record<OutreachChannel, Partial<ChannelDescriptions>>>,
  enrollmentRows: HistoryEnrollmentRow[] = [],
): HistoryEvent[] {
  const contactRows = rows.filter((r) => HISTORY_CHANNELS.has(r.touch_type))

  // Map rows to the grouping input; keep a parallel lookup to the source row so
  // the preserved communications carry their id and cleaned detail.
  const byAt = new Map<string, HistoryTouchRow[]>()
  const comms: Communication[] = contactRows.map((r) => {
    const list = byAt.get(r.touched_at) ?? []
    list.push(r)
    byAt.set(r.touched_at, list)
    return {
      channel: r.touch_type as OutreachChannel,
      at: r.touched_at,
      outcome: parseOutcomeFromNote(r.notes),
      reached: noteIndicatesReached(r.notes),
    }
  })

  const attempts = groupIntoAttempts(comms, actorTimeZone)

  const events: HistoryEvent[] = attempts.map((a) => {
    // Recover the source rows for this attempt by its communications' instants.
    // The grouping preserves communication order; match each back to a row,
    // consuming matched rows so duplicate-timestamp channels map 1:1.
    const used = new Set<HistoryTouchRow>()
    const communications: HistoryCommunication[] = a.communications.map((c) => {
      const candidates = byAt.get(c.at) ?? []
      const row =
        candidates.find((r) => !used.has(r) && r.touch_type === c.channel) ??
        candidates.find((r) => !used.has(r))
      if (row) used.add(row)
      const note = row?.notes ?? null
      const comm: HistoryCommunication = {
        id: row?.id ?? `${c.at}-${c.channel}`,
        channel: c.channel,
        outcome: c.outcome ?? 'touch',
        reached: c.reached === true,
        direction: directionOfNote(note),
        detail: cleanHistoryNote(note),
        systemDescription: describeHistoryNote(note),
      }
      // Record whether this communication's direction is actually known (vs a
      // legacy row defaulting to outgoing), so the heading builder can prefer a
      // settled communication and fall back cleanly when none is known.
      DIRECTION_KNOWN.set(comm, directionIsKnown(note))
      return comm
    })
    // Attribution: the employee name on any communication in the interaction.
    const by =
      a.communications
        .map((c) => (byAt.get(c.at) ?? []).find((r) => r.touch_type === c.channel)?.touched_by)
        .find((n) => !!n) ?? null
    // The system description shown under the summary. For a single-communication
    // interaction it is that communication's description. When several channels
    // group into one attempt the terse summary already lists them, so a single
    // description line would misrepresent the mix — EXCEPT the reached · agreed ·
    // form interaction, where a reached call and the form send are recorded
    // together and the form touch carries the ONE authoritative sentence for the
    // whole interaction. There, show that sentence so the required history
    // language appears even though the interaction has two communications.
    const agreedFormDescription = communications.find(
      (c) =>
        (c.channel === 'email' || c.channel === 'postal') &&
        !!c.systemDescription &&
        /agreed to authorize our office as servicing agent/i.test(c.systemDescription),
    )?.systemDescription ?? null
    // The CALL communication's sentence is the authoritative description for a
    // telephone interaction (reached outcomes, and the didn't-reach "Called
    // customer…" language). When a call grouped with extra channel touches
    // (e.g. a voicemail-left plus a text/email), the required call sentence is
    // still the one to show; the extra channels remain preserved as their own
    // detail/summary. The agreed·form interaction is the one exception: there
    // the form touch owns the full sentence (a reached call grouped with the
    // form send), so it takes precedence.
    const callDescription = communications.find(
      (c) => c.channel === 'call' && !!c.systemDescription,
    )?.systemDescription ?? null
    const description =
      communications.length === 1
        ? communications[0].systemDescription
        : (agreedFormDescription ?? callDescription)
    // The interaction's direction: a genuine incoming response if any
    // communication is incoming; else automated if the only inbound one is an
    // auto-reply; else outgoing. Lets the Relationship Timeline title the event
    // by who initiated it without changing the grouped summary.
    const direction: HistoryDirection = communications.some((c) => c.direction === 'incoming')
      ? 'incoming'
      : communications.some((c) => c.direction === 'automated')
        ? 'automated'
        : 'outgoing'
    return {
      at: a.at,
      summary: summarizeInteraction(communications, overrides),
      description,
      by,
      reached: a.reached,
      kind: 'contact' as const,
      direction,
      // The precise, event-specific timeline heading (null for a legacy record
      // of unknown direction, so the timeline falls back to the summary).
      timelineHeading: contactHeading(communications),
      communications,
    }
  })

  // Include the recorded contact-research activity (including unsuccessful
  // research) as its own concise events, then interleave newest-first with the
  // communication events. Research is distinct from a contact attempt, so it is
  // never folded into a call interaction.
  const researchEvents = buildResearchEvents(rows)

  // Customer Interaction workflow milestones (follow-up scheduled/completed,
  // refusal) are their own concise events, interleaved like research — recorded
  // in the one history store but never shown as a telephone call.
  const workflowEvents = buildWorkflowEvents(rows)

  // Project enrollments are their own events, interleaved chronologically with
  // the communication and research events. They come from the deduped
  // membership records, not case_touches, so they add to the one history
  // without a separate history system and without duplicating on re-draws.
  const enrollmentEvents = buildEnrollmentEvents(enrollmentRows)

  // Newest first for the card (the grouping returns oldest-first).
  return [...events, ...researchEvents, ...workflowEvents, ...enrollmentEvents].sort(
    (x, y) => new Date(y.at).getTime() - new Date(x.at).getTime(),
  )
}

/** Format an instant as the customer-history display timestamp:
 * MM/DD/YYYY, h:mm AM/PM, on the actor's calendar. */
export function formatHistoryTimestamp(at: string, actorTimeZone: string | null): string {
  const dt = DateTime.fromISO(at, { zone: zoneOf(actorTimeZone) })
  const valid = dt.isValid ? dt : DateTime.fromJSDate(new Date(at), { zone: zoneOf(actorTimeZone) })
  if (!valid.isValid) return at
  return valid.toFormat('LL/dd/yyyy, h:mm a')
}

// ---------------------------------------------------------------------------
// Next History Entry — the preview of what completing the CURRENT workflow will
// record. The worker sees what the system will log on their behalf, so they do
// not separately log the same activity. This is configurable per activity, not
// hardcoded on each screen: the screen names its activity; the phrasing lives
// here and evolves centrally.
// ---------------------------------------------------------------------------

/** The activities a working screen can be performing. Keep in step with the
 * stewardship queues / working screens. */
export type WorkflowActivity =
  | 'introductory-email'
  | 'calling'
  | 'contact-research'
  | 'record-attempt'
  | 'form-sent'
  | 'follow-up'
  | 'servicing-access'

export interface NextHistoryEntryPreview {
  /** The one-line description of the entry that completing the work will log. */
  summary: string
  /** The system-generated description line that the recorded entry will show
   * under its summary/attribution, so the preview matches exactly what
   * Customer History will display once the work is completed. */
  description?: string
  /** A short clarifying note about how/when it is recorded. */
  note?: string
}

/**
 * Describe the history entry the current workflow will record on completion.
 * `outcome` lets the preview reflect a chosen call result where the screen
 * already knows it (e.g. the guided call flow); omit it for the general case.
 */
export function describeNextHistoryEntry(
  activity: WorkflowActivity,
  options?: {
    /** The customer first name, to personalize the preview where useful. */
    customerName?: string | null
    /** A chosen call outcome, when the screen already knows it. */
    callOutcome?: 'reached' | 'voicemail' | 'bad-number' | 'not-interested' | 'callback' | null
  },
): NextHistoryEntryPreview {
  // Concise labels only — no generic system explanation. The preview reads as
  // the entry that will be recorded, in the same vocabulary the history uses.
  switch (activity) {
    case 'introductory-email':
      return {
        summary: 'Email',
        description: 'Introductory email sent with servicing-agent authorization form.',
      }
    case 'contact-research':
      return { summary: 'Contact Research' }
    case 'form-sent':
      return { summary: 'Form Sent' }
    case 'follow-up':
      return { summary: 'Follow-up' }
    case 'servicing-access':
      return { summary: 'Servicing Access' }
    case 'calling': {
      const o = options?.callOutcome
      if (o === 'reached') return { summary: 'Reached' }
      if (o === 'callback') return { summary: 'Reached \u00b7 Callback Scheduled' }
      if (o === 'bad-number') return { summary: 'No Answer \u00b7 Bad Number' }
      return { summary: o === 'voicemail' ? 'No Answer \u00b7 Voicemail' : 'No Answer' }
    }
    case 'record-attempt':
    default:
      return { summary: 'Outreach attempt' }
  }
}

/**
 * The Next History Entry preview for Contact Research, built from the methods
 * the worker has FILLED on the contact card during this task versus what was
 * missing when it opened. Reflects the actual selection: "Contact Updated
 * (email, phone)" once something previously missing is now present; otherwise
 * null, so the preview stays blank until there is something to record (a filled
 * value, or the deliberate Nothing Usable action which records research).
 */
export function describeContactResearchSelection(
  before: { hasEmail: boolean; hasPhone: boolean; hasAddress: boolean },
  now: { hasEmail: boolean; hasPhone: boolean; hasAddress: boolean },
): NextHistoryEntryPreview | null {
  const filled: string[] = []
  if (!before.hasEmail && now.hasEmail) filled.push('email')
  if (!before.hasPhone && now.hasPhone) filled.push('phone')
  if (!before.hasAddress && now.hasAddress) filled.push('mailing address')
  if (filled.length === 0) return null
  return { summary: `Contact Updated (${filled.join(', ')})` }
}

// ---------------------------------------------------------------------------
// Unified contact edit — one combined change set, one history entry.
//
// The shared CustomerContactCard edits every durable contact fact together
// (name, email, phone, mailing address, the three verifications, email
// availability, Do Not Text, Text Undeliverable, and the customer alert) and
// commits them in ONE save that records exactly ONE "Customer Contact Updated"
// history entry preserving the prior and new values for audit.
//
// Both halves live here as shared logic so neither the card nor any host screen
// re-derives the diff or the recorded prose:
//   - `describeContactUpdate(before, after)` builds the live Next History Entry
//     preview of the pending change (null when nothing changed), so the preview
//     component renders the combined pending change without page-specific logic.
//   - `buildContactUpdateHistoryNote(before, after)` builds the single
//     case_touches 'workflow' note the route records, naming each changed fact's
//     prior -> new value so the previous value is preserved in history.
// Both read the same `ContactSnapshot` shape, so the preview and the recorded
// entry describe the identical set of changes in the identical order.
// ---------------------------------------------------------------------------

/** The stable machine marker identifying a case_touches 'workflow' note as a
 * unified contact update, so the Customer History display titles it "Customer
 * Contact Updated" while hiding the marker. */
export const CONTACT_UPDATE_MARKER = '[contact-update]'

/** The durable contact facts a unified edit can change, in one flat shape read
 * by both the preview and the recorded-note builder. Values are the stored
 * values (name components, the active email/phone, the four address parts, the
 * three verification timestamps, the durable email-availability fact, the two
 * texting restrictions, and the single customer alert). This mirrors the subset
 * of the customers row the card and the contact route already read/write; it
 * introduces no new field. */
export interface ContactSnapshot {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  email_availability: EmailAvailabilitySnapshot
  sms_opt_out: boolean
  text_undeliverable: boolean
  contact_alert: string | null
}

/** The email-availability values the snapshot carries. Kept as a local string
 * union (not an import) so this display module stays dependency-free; it mirrors
 * the stored `customers.email_availability` domain (null = unknown). */
export type EmailAvailabilitySnapshot =
  | 'available'
  | 'no_address'
  | 'undeliverable'
  | null

/** Human label for an email-availability value in the history prose. */
const EMAIL_AVAILABILITY_PROSE: Record<Exclude<EmailAvailabilitySnapshot, null>, string> = {
  available: 'on file',
  no_address: 'No Usable Email',
  undeliverable: 'Undeliverable',
}

/** Collapse whitespace and trim; empty becomes null, so "present" is consistent
 * between the preview, the note, and the card. */
function trimOrNull(v: string | null): string | null {
  if (v == null) return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t.length ? t : null
}

function fullNameOf(s: Pick<ContactSnapshot, 'first_name' | 'last_name'>): string {
  const n = `${trimOrNull(s.first_name) ?? ''} ${trimOrNull(s.last_name) ?? ''}`.trim()
  return n || '(none)'
}

function addressOf(s: ContactSnapshot): string {
  const street = trimOrNull(s.street)
  const city = trimOrNull(s.city)
  const state = trimOrNull(s.state)
  const zip = trimOrNull(s.zip)
  const cityStateZip = [[city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(' ').trim()
  const full = [street, cityStateZip].filter(Boolean).join(', ')
  return full || '(none)'
}

/** A value shown in prose, or "(none)" when empty, so prior -> new reads clearly
 * even when one side is blank. */
function valueOrNone(v: string | null): string {
  return trimOrNull(v) ?? '(none)'
}

/** One described difference between two snapshots: a short label for the
 * combined preview summary, and a full prior -> new sentence for the recorded
 * audit note. `order` is a stable sort key so the preview and the note list the
 * same changes in the same order. */
interface ContactChange {
  order: number
  /** Short label for the combined preview summary (e.g. "email", "phone"). */
  label: string
  /** The audit sentence naming the prior and new value. */
  sentence: string
}

/**
 * Diff two contact snapshots into the ordered list of changes. This is the ONE
 * place the unified edit decides what counts as a change, shared by the live
 * preview and the recorded note so they never disagree. Returns an empty array
 * when nothing changed (so no history entry is recorded and the preview stays
 * blank). Verification is reported as checked/unchecked; an edited value that
 * also clears its own verification reports the value change only, since the
 * cleared verification is an automatic consequence, not a separate operator act.
 */
function diffContact(before: ContactSnapshot, after: ContactSnapshot): ContactChange[] {
  const changes: ContactChange[] = []

  // Name (first/last considered together as the displayed full name).
  if (
    (trimOrNull(before.first_name) ?? null) !== (trimOrNull(after.first_name) ?? null) ||
    (trimOrNull(before.last_name) ?? null) !== (trimOrNull(after.last_name) ?? null)
  ) {
    changes.push({
      order: 0,
      label: 'name',
      sentence: `Name changed from "${fullNameOf(before)}" to "${fullNameOf(after)}".`,
    })
  }

  // Email value.
  const emailChanged = (trimOrNull(before.email) ?? null) !== (trimOrNull(after.email) ?? null)
  if (emailChanged) {
    changes.push({
      order: 1,
      label: 'email',
      sentence: `Email changed from "${valueOrNone(before.email)}" to "${valueOrNone(after.email)}".`,
    })
  }

  // Email availability (the durable fact), reported when it moved and is not
  // merely the automatic "available" that accompanies saving a usable email.
  if ((before.email_availability ?? null) !== (after.email_availability ?? null)) {
    const fromLabel = before.email_availability ? EMAIL_AVAILABILITY_PROSE[before.email_availability] : 'unknown'
    const toLabel = after.email_availability ? EMAIL_AVAILABILITY_PROSE[after.email_availability] : 'unknown'
    // Skip the purely-automatic transition to "available" that always rides with
    // a saved usable email — the email change sentence already conveys it.
    const automaticAvailable = after.email_availability === 'available' && emailChanged
    if (!automaticAvailable) {
      changes.push({
        order: 2,
        label: 'email availability',
        sentence: `Email availability changed from ${fromLabel} to ${toLabel}.`,
      })
    }
  }

  // Phone value.
  if ((trimOrNull(before.phone) ?? null) !== (trimOrNull(after.phone) ?? null)) {
    changes.push({
      order: 3,
      label: 'phone',
      sentence: `Phone changed from "${valueOrNone(before.phone)}" to "${valueOrNone(after.phone)}".`,
    })
  }

  // Do Not Text.
  if (before.sms_opt_out !== after.sms_opt_out) {
    changes.push({
      order: 4,
      label: after.sms_opt_out ? 'Do Not Text set' : 'Do Not Text cleared',
      sentence: after.sms_opt_out
        ? 'Do Not Text was set (texting disabled; calling unaffected).'
        : 'Do Not Text was cleared.',
    })
  }

  // Text Undeliverable (recorded against the number on file).
  if (before.text_undeliverable !== after.text_undeliverable) {
    changes.push({
      order: 5,
      label: after.text_undeliverable ? 'Text Undeliverable recorded' : 'Text Undeliverable cleared',
      sentence: after.text_undeliverable
        ? 'Text Undeliverable was recorded for the number on file.'
        : 'Text Undeliverable was cleared.',
    })
  }

  // Mailing address (edited as one group).
  const addrChanged =
    (trimOrNull(before.street) ?? null) !== (trimOrNull(after.street) ?? null) ||
    (trimOrNull(before.city) ?? null) !== (trimOrNull(after.city) ?? null) ||
    (trimOrNull(before.state) ?? null) !== (trimOrNull(after.state) ?? null) ||
    (trimOrNull(before.zip) ?? null) !== (trimOrNull(after.zip) ?? null)
  if (addrChanged) {
    changes.push({
      order: 6,
      label: 'mailing address',
      sentence: `Mailing address changed from "${addressOf(before)}" to "${addressOf(after)}".`,
    })
  }

  // Verification changes, reported only when NOT the automatic clear that
  // accompanies editing that field's value (an edited value always resets its
  // own verification; that is a consequence, not a separate act).
  const verifyField = (
    order: number,
    label: string,
    beforeAt: string | null,
    afterAt: string | null,
    valueEdited: boolean,
  ) => {
    const wasVerified = !!beforeAt
    const isVerified = !!afterAt
    if (wasVerified === isVerified) return
    // An edit that cleared verification is already implied by the value change.
    if (valueEdited && wasVerified && !isVerified) return
    changes.push({
      order,
      label: isVerified ? `${label} verified` : `${label} verification cleared`,
      sentence: isVerified
        ? `${label} marked customer verified.`
        : `${label} verification cleared.`,
    })
  }
  verifyField(7, 'Email', before.email_verified_at, after.email_verified_at, emailChanged)
  verifyField(
    8, 'Phone', before.phone_verified_at, after.phone_verified_at,
    (trimOrNull(before.phone) ?? null) !== (trimOrNull(after.phone) ?? null),
  )
  verifyField(9, 'Address', before.address_verified_at, after.address_verified_at, addrChanged)

  // Customer alert.
  if ((trimOrNull(before.contact_alert) ?? null) !== (trimOrNull(after.contact_alert) ?? null)) {
    const had = !!trimOrNull(before.contact_alert)
    const has = !!trimOrNull(after.contact_alert)
    changes.push({
      order: 10,
      label: !had && has ? 'alert added' : !has ? 'alert cleared' : 'alert updated',
      sentence: !has
        ? 'Customer alert was cleared.'
        : `Customer alert ${had ? 'updated' : 'added'}: "${valueOrNone(after.contact_alert)}".`,
    })
  }

  return changes.sort((a, b) => a.order - b.order)
}

/**
 * The live Next History Entry preview for a unified contact edit: what the one
 * Save will record. Returns null when nothing has changed, so the preview stays
 * blank until there is something to record (and "no changes means no history"
 * reads the same in the preview as in the recorded result). The summary lists
 * the changed facts; the description previews the exact audit sentences the
 * recorded entry will carry, so the preview matches the logged entry.
 */
export function describeContactUpdate(
  before: ContactSnapshot,
  after: ContactSnapshot,
): NextHistoryEntryPreview | null {
  const changes = diffContact(before, after)
  if (changes.length === 0) return null
  return {
    summary: `Customer Contact Updated (${changes.map((c) => c.label).join(', ')})`,
    description: changes.map((c) => c.sentence).join(' '),
  }
}

/**
 * The single case_touches 'workflow' note the contact route records for a
 * unified edit, naming each changed fact's prior -> new value so the previous
 * value is preserved for audit. Returns null when nothing changed, so the route
 * records no entry for a no-op. The hidden `CONTACT_UPDATE_MARKER` lets the
 * Customer History display title the event "Customer Contact Updated" while the
 * sentences read as plain prose.
 */
export function buildContactUpdateHistoryNote(
  before: ContactSnapshot,
  after: ContactSnapshot,
): string | null {
  const changes = diffContact(before, after)
  if (changes.length === 0) return null
  return `${changes.map((c) => c.sentence).join(' ')} ${CONTACT_UPDATE_MARKER}`
}

// ---------------------------------------------------------------------------
// Dynamic Next History Entry — built live from the selections the worker is
// making in the workflow, so the preview reflects exactly what completing the
// open action will record, combined into ONE entry. This is the same honesty
// the recorded history keeps: it names only the channels/outcomes the worker
// has actually chosen, in concise labels, joined with the same "·" separator
// the grouped history uses. The screen owns the live selection; the phrasing
// lives here.
// ---------------------------------------------------------------------------

/** The live call-workbench selection the preview is built from. Mirrors the
 * guided call flow's state: whether the customer was reached, and the channels
 * / decision chosen on each branch. Nothing here is recorded until the worker
 * completes the action; this only previews it. */
export interface CallSelection {
  /** The reach decision so far: not yet chosen, reached, or not reached. */
  reach: 'reached' | 'not-reached' | null
  // Didn't-reach branch — only channels actually completed are previewed.
  voicemailLeft?: boolean | null
  textSent?: boolean
  emailSent?: boolean
  badNumber?: boolean
  // Reached branch — the customer's decision and, for a callback, the date.
  decision?: 'agreed' | 'callback' | 'not-interested' | null
  callbackDate?: string | null
  /** Whether the authorization form has been confirmed sent on the reached ·
   * agreed path, so the preview can fold "Form Sent" into the entry. */
  formSent?: boolean
  /** The chosen authorization-form delivery method on the reached · agreed
   * path, so the preview names the pending send accurately (emailed vs mailed)
   * WITHOUT claiming it has already gone out. */
  formDeliveryMethod?: 'email' | 'postal' | null
  /** The optional Call Notes the worker has typed, folded into the preview's
   * note so it reads exactly as what completion will record. */
  note?: string | null
}

/**
 * Build the Next History Entry preview for the guided call flow from the live
 * selections. Returns null when the worker has not chosen enough to record
 * anything yet (no reach decision), so the preview only appears once the work
 * can generate a history event. Otherwise it composes ONE concise entry from
 * the chosen outcome and channels, e.g. "No Answer · Voicemail · Text · Email"
 * or "Reached · Form Sent".
 */
export function describeCallSelection(
  selection: CallSelection,
  options?: { customerName?: string | null; note?: string | null },
): NextHistoryEntryPreview | null {
  const who = options?.customerName?.trim() || 'the customer'
  // The note folded into the preview: the explicit option wins, else the live
  // Call Notes the worker has typed on the selection. Either way the preview
  // reflects exactly what completion will save with the interaction.
  const extraNote = (options?.note ?? selection.note)?.trim() || undefined

  // Bad number is a distinct terminal outcome regardless of the reach choice.
  // The description is the exact sentence the completion will record.
  if (selection.badNumber) {
    return {
      summary: 'No Answer · Bad Number',
      description: 'Called customer. Number is not working. Customer referred to Contact Research.',
      note: extraNote,
    }
  }

  if (selection.reach === 'not-reached') {
    // Only completed channels are previewed, matching how the attempt records.
    const parts = ['No Answer']
    if (selection.voicemailLeft) parts.push('Voicemail')
    if (selection.textSent) parts.push('Text')
    if (selection.emailSent) parts.push('Email')
    // The recorded call sentence is honest about whether a voicemail was left;
    // the extra channels (text/email) are preserved alongside but the call line
    // is the one the preview shows as the description.
    const description = selection.voicemailLeft
      ? 'Called customer. No answer. Voicemail left. Next call scheduled.'
      : 'Called customer. No answer. Next call scheduled.'
    return { summary: parts.join(' \u00b7 '), description, note: extraNote }
  }

  if (selection.reach === 'reached') {
    if (selection.decision === 'callback') {
      const when = selection.callbackDate ? formatCallbackDate(selection.callbackDate) : null
      return {
        summary: when ? `Reached · Callback Scheduled ${when}` : 'Reached · Callback Scheduled',
        description: when
          ? `Spoke with customer. Customer requested a callback on ${when}.`
          : 'Spoke with customer. Customer requested a callback.',
        note: extraNote,
      }
    }
    if (selection.decision === 'not-interested') {
      return {
        summary: 'Reached · Not Interested',
        description:
          'Spoke with customer. Customer declined servicing-agent authorization. Further outreach stopped unless deliberately reopened.',
        note: extraNote,
      }
    }
    if (selection.decision === 'agreed') {
      // Never describe an unsent form as sent. Completing this path records the
      // reached call AND sends the form in one step. BEFORE the send is
      // confirmed the preview uses FUTURE-TENSE wording for the pending delivery
      // ("Authorization form to be emailed / to be mailed"), so it accurately
      // previews a form that has NOT gone out yet. Only once the send is
      // confirmed (formSent) does it read as the completed, past-tense entry the
      // history actually records. The method-aware clause appears once a method
      // is chosen; until then the preview names the agreement without a channel.
      // The summary likewise distinguishes the still-pending agreement
      // ("Reached · Agreed") from the completed send ("Reached · Form Sent").
      const method = selection.formDeliveryMethod ?? null
      const pendingClause =
        method === 'postal' ? ' Authorization form to be mailed.'
        : method === 'email' ? ' Authorization form to be emailed.'
        : ''
      const sentClause =
        method === 'postal' ? ' Authorization form sent by postal mail. Awaiting signed authorization.'
        : method === 'email' ? ' Authorization form emailed. Awaiting signed authorization.'
        : ''
      const deliveryClause = selection.formSent ? sentClause : pendingClause
      return {
        summary: selection.formSent ? 'Reached · Form Sent' : 'Reached · Agreed',
        description:
          `Spoke with customer. Customer agreed to authorize our office as servicing agent.${deliveryClause}`,
        note: extraNote,
      }
    }
    // Reached but no decision captured yet.
    return { summary: `Reached ${who}`.trim(), description: 'Spoke with customer.', note: extraNote }
  }

  // No reach decision yet: nothing to record.
  return null
}

/** Format a date-only callback as MM/DD/YYYY for the preview. Parses a bare
 * date at noon so a timezone shift never rolls it a day. */
function formatCallbackDate(raw: string): string | null {
  if (!raw) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

/**
 * The Next History Entry preview for the introductory-email send, built from
 * whether the email has been confirmed sent. Combines into one concise entry;
 * an optional note is folded in. Kept here so the phrasing stays central and
 * concise ("Email", or "Email · Form Sent" when the authorization form rode
 * with it).
 */
export function describeIntroEmailSelection(
  options?: { note?: string | null; formIncluded?: boolean },
): NextHistoryEntryPreview {
  const extraNote = options?.note?.trim() || undefined
  return {
    summary: options?.formIncluded ? 'Email \u00b7 Form Sent' : 'Email',
    // Matches describeHistoryNote's description for the recorded intro-email
    // touch, so the preview reads identically to the logged history entry.
    description: 'Introductory email sent with servicing-agent authorization form.',
    note: extraNote,
  }
}

// ---------------------------------------------------------------------------
// Customer Interaction — the Next History Entry preview for the conversation
// working screen. Unlike the guided call flow (one staged interaction), the
// Customer Interaction column offers several INDEPENDENT actions: recording one
// incoming/outgoing communication, setting a follow-up commitment, recording
// receipt of the signed authorization, or recording a refusal. Each is its own
// history entry, so the preview describes exactly ONE prepared action and NEVER
// combines them. The screen reports which action the worker is preparing; the
// phrasing lives here, reusing the same vocabulary the recorded history uses.
// ---------------------------------------------------------------------------

/** The single action the Customer Interaction worker is currently preparing, as
 * reported live by the action column. Exactly one kind is previewed at a time;
 * independent actions are never merged into one entry. Null fields mean the
 * worker has not supplied that detail yet. */
export type InteractionSelection =
  | {
      kind: 'communication'
      /** Who initiated it: a genuine incoming response, an inbound automated
       * reply, or our outgoing reply. */
      direction: 'incoming' | 'automated' | 'outgoing'
      /** The channel being recorded. */
      channel: 'email' | 'call' | 'text'
      /** The employee-typed note, folded into the preview exactly as it will be
       * saved with the communication. */
      note?: string | null
    }
  | {
      kind: 'follow-up'
      /** The chosen follow-up date (YYYY-MM-DD), or null before one is picked. */
      date: string | null
    }
  | { kind: 'authorization' }
  | { kind: 'refusal' }

/** Title-case channel noun for an interaction communication heading. */
const INTERACTION_CHANNEL_NOUN: Record<'email' | 'call' | 'text', string> = {
  email: 'Email',
  call: 'Call',
  text: 'Text',
}

/**
 * Build the Next History Entry preview for the Customer Interaction screen from
 * the single action the worker is preparing. Returns null when there is nothing
 * to record yet (an empty compose, or a follow-up with no date), so the preview
 * stays blank until the selected action can generate a history entry. It never
 * combines independent actions: each call describes exactly one.
 *
 * The communication heading matches the recorded event-specific headings:
 *   email   incoming -> Email Received | outgoing -> Email Sent | automated -> Automated Email Reply
 *   call    incoming -> Incoming Call  | outgoing -> Call        (a recorded call touch)
 *   text    incoming -> Text Received  | outgoing -> Text Sent  | automated -> Automated Text Reply
 * Nothing is claimed as already done; the preview names what completing the
 * selected action WILL record.
 */
export function describeInteractionSelection(
  selection: InteractionSelection | null,
): NextHistoryEntryPreview | null {
  if (!selection) return null

  switch (selection.kind) {
    case 'communication': {
      const noun = INTERACTION_CHANNEL_NOUN[selection.channel]
      const note = selection.note?.trim() || undefined
      let summary: string
      if (selection.direction === 'automated') {
        summary = `Automated ${noun} Reply`
      } else if (selection.channel === 'call') {
        summary = selection.direction === 'incoming' ? 'Incoming Call' : 'Call'
      } else {
        summary = `${noun} ${selection.direction === 'incoming' ? 'Received' : 'Sent'}`
      }
      return { summary, note }
    }
    case 'follow-up': {
      const when = selection.date ? formatCallbackDate(selection.date) : null
      return {
        summary: when ? `Follow-up Scheduled ${when}` : 'Follow-up Scheduled',
        description: when
          ? `Follow-up scheduled for ${when}.`
          : 'A follow-up will be scheduled on the date you choose.',
      }
    }
    case 'authorization':
      return {
        summary: 'Authorization Received',
        description: 'Signed servicing-agent authorization recorded. Customer moves to Servicing Access.',
      }
    case 'refusal':
      return {
        summary: 'Customer Declined',
        description:
          'Customer declined servicing-agent authorization. Further outreach stopped unless deliberately reopened.',
      }
  }
}
