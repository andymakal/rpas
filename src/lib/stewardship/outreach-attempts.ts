/**
 * Outreach-attempt grouping for Servicing-Agent Onboarding (Right Path).
 *
 * Adapts the established IPF outreach-grouping model (ipf-stewardship ADR 0010;
 * episode_outreach_groupings) to Right Path's existing case_touches history. The
 * IPF model is reused rather than re-invented:
 *
 *   - An outreach ATTEMPT ("grouping" in IPF) is ONE coordinated reach-out: a
 *     call plus the voicemail / text / and (when available) email outcomes,
 *     recorded TOGETHER with a single timestamp. Multiple channel communications
 *     in one attempt count as ONE attempt.
 *   - Every INDIVIDUAL communication is preserved (each is its own durable
 *     case_touches row); grouping never collapses or loses one.
 *   - Per-channel OUTCOMES distinguish a real contact touch from ordinary
 *     non-response and from an UNUSABLE channel (a number/mailbox/address that
 *     cannot deliver): exactly IPF's call reached/not_reached/unusable,
 *     voicemail left/not_left/unusable, text sent/not_sent/unusable, email
 *     sent/not_sent/unusable. A touch counts only for voicemail left / text sent
 *     / email sent (and a reached call); an 'unusable' channel is NOT a touch.
 *   - Channel outcomes NEVER influence cadence or timing (IPF Decision Engine
 *     Boundary); they inform attempt counting and contact-method usability only.
 *
 * Right Path adaptations (preserve settled architecture):
 *   - No new grouping table and no separate workflow infrastructure. The
 *     grouping key is the SHARED touch timestamp the onboarding touch route
 *     already writes (all channels of one attempt share one touched_at), so an
 *     attempt is reconstructed from existing case_touches without a new concept.
 *   - Outcomes that case_touches cannot store in a column are carried on the
 *     touch note via a stable machine marker (see parseOutcomeFromNote); a
 *     plain recorded channel with no marker reads as a completed touch, matching
 *     how the touch route logs an actually-completed channel.
 *   - No IPF three-strike termination, agency rewarm, tenancy, or practice
 *     concepts are imported.
 *
 * Pure normalization (the TypeScript half of the GoRules division of labor): no
 * database access and no eligibility/priority judgment (ZEN owns those).
 */

import { DateTime } from 'luxon'
import { FALLBACK_ACTOR_TIME_ZONE, isValidTimeZone } from '@/lib/time'

/** The communication channels that can appear in an outreach attempt. */
export type OutreachChannel = 'call' | 'voicemail' | 'text' | 'email' | 'postal'

/**
 * A per-channel outcome, mirroring the IPF grouping outcome vocabulary mapped
 * onto Right Path channels:
 *   - 'touch'      a real completed contact touch (voicemail left, text sent,
 *                  email sent, postal sent) or a call that was placed.
 *   - 'no_contact' an ordinary non-response (call not answered, touch simply not
 *                  made) that still represents a genuine attempt.
 *   - 'unusable'   the channel itself cannot deliver (wrong/disconnected number,
 *                  full/unset mailbox, bouncing text, invalid email). NOT a
 *                  touch; marks the channel as exhausted for usability.
 */
export type ChannelOutcome = 'touch' | 'no_contact' | 'unusable'

/**
 * One individual communication from the customer's history. Maps directly to a
 * case_touches row (touch_type + touched_at + notes); the caller filters to the
 * onboarding outreach touches before passing them in. The outcome is derived
 * from the note marker (or defaults to a completed touch for a plainly recorded
 * channel).
 */
export interface Communication {
  /** The channel used, from case_touches.touch_type. */
  channel: OutreachChannel
  /** When the communication happened (ISO instant, from touched_at). */
  at: string
  /** The per-channel outcome (defaults to 'touch' when a channel was recorded
   * with no explicit marker, i.e. an actually-completed channel). */
  outcome?: ChannelOutcome
  /** True when this communication REACHED the customer (a reached call). A
   * reached contact makes its attempt SUCCESSFUL, so the attempt does not count
   * toward the unsuccessful-attempt (Nonresponsive) total. Derived from the
   * reached note marker by the attempt-history reader. */
  reached?: boolean
}

/**
 * One grouped outreach attempt: the shared instant it happened and the channel
 * communications it comprised. Mirrors an IPF grouping.
 */
export interface OutreachAttempt {
  /** The attempt's grouping key: the shared ISO instant of its communications. */
  at: string
  /** The attempt's actor-calendar day (YYYY-MM-DD), for display. */
  day: string
  /** The individual channel communications that make up this one attempt. */
  communications: Communication[]
  /** True when the attempt included a phone CALL channel (call or voicemail). */
  includedCall: boolean
  /** True when at least one channel in the attempt was a real completed touch. */
  includedTouch: boolean
  /** True when the attempt REACHED the customer (a reached call). A reached
   * attempt is SUCCESSFUL and is excluded from the unsuccessful-attempt total. */
  reached: boolean
}

/**
 * How close (in milliseconds) two communications must be to count as the SAME
 * attempt. The onboarding touch route writes every channel of one attempt with
 * an identical timestamp, so an exact match is the common case; a small
 * tolerance absorbs sub-second insert skew without ever merging two deliberate
 * reach-outs (which are minutes or days apart). This replaces the earlier
 * coarse "by calendar day" grouping, which wrongly merged two separate same-day
 * reach-outs into one attempt and split a single late-night attempt across the
 * actor midnight.
 */
const ATTEMPT_WINDOW_MS = 2000

function actorDay(at: string, actorTimeZone: string | null): string {
  const zone = isValidTimeZone(actorTimeZone) ? (actorTimeZone as string) : FALLBACK_ACTOR_TIME_ZONE
  const dt = DateTime.fromISO(at, { zone })
  if (dt.isValid) return dt.toFormat('yyyy-LL-dd')
  const fromJs = DateTime.fromJSDate(new Date(at), { zone })
  return fromJs.isValid ? fromJs.toFormat('yyyy-LL-dd') : at.slice(0, 10)
}

/** Whether a channel's completed-touch outcome counts as a real touch. A call
 * channel is a contact touch when placed (outcome 'touch'); an unusable or
 * no_contact channel is never a touch. */
function isTouch(c: Communication): boolean {
  return (c.outcome ?? 'touch') === 'touch'
}

/**
 * Group a customer's individual communications into outreach attempts by SHARED
 * timestamp (IPF grouping semantics over case_touches). Communications within
 * ATTEMPT_WINDOW_MS of the attempt's first communication join that attempt;
 * a later communication opens a new attempt. Ordered oldest attempt first; the
 * individual communications are preserved within each attempt.
 */
export function groupIntoAttempts(
  communications: Communication[],
  actorTimeZone: string | null,
): OutreachAttempt[] {
  const sorted = communications
    .map((c) => ({ c, t: new Date(c.at).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)

  const groups: { anchor: number; comms: Communication[] }[] = []
  for (const { c, t } of sorted) {
    const current = groups[groups.length - 1]
    if (current && t - current.anchor <= ATTEMPT_WINDOW_MS) {
      current.comms.push(c)
    } else {
      groups.push({ anchor: t, comms: [c] })
    }
  }

  return groups.map((g) => {
    const at = g.comms[0].at
    return {
      at,
      day: actorDay(at, actorTimeZone),
      communications: g.comms,
      includedCall: g.comms.some((c) => c.channel === 'call' || c.channel === 'voicemail'),
      includedTouch: g.comms.some(isTouch),
      reached: g.comms.some((c) => c.reached === true),
    }
  })
}

/**
 * How many unsuccessful CALL attempts have been made: grouped attempts that
 * included a phone call channel. Drives the escalating call-cadence index. (A
 * reached call advances the workflow out of the call cadence entirely, so every
 * call attempt still in the call flow is an unsuccessful one for cadence
 * purposes.)
 */
export function countCallAttempts(attempts: OutreachAttempt[]): number {
  return attempts.filter((a) => a.includedCall).length
}

/**
 * The total number of grouped outreach attempts across ALL channels, successful
 * or not. Every grouped reach-out counts once regardless of how many channels it
 * touched. Use countUnsuccessfulAttempts for the Nonresponsive threshold.
 */
export function countOutreachAttempts(attempts: OutreachAttempt[]): number {
  return attempts.length
}

/**
 * The number of genuinely UNSUCCESSFUL outreach attempts: grouped attempts that
 * did NOT reach the customer. This is the correct basis for the seven-attempt
 * Nonresponsive advisory (the rule is about repeated failures to reach, so an
 * attempt that reached the customer must not count). A reached attempt also
 * advances the workflow out of the call flow, so in practice the run is already
 * engaged; excluding it here keeps the advisory honest if outreach later resumes.
 */
export function countUnsuccessfulAttempts(attempts: OutreachAttempt[]): number {
  return attempts.filter((a) => !a.reached).length
}

/**
 * Which contact channels have been marked UNUSABLE across the attempt history.
 * A channel is unusable when a recorded communication on it had the 'unusable'
 * outcome (the number/mailbox/address cannot deliver). This is the data the
 * contact-method usability derivation subtracts, so an exhausted channel is not
 * offered as an available action. Reusing the IPF usability FACT (recorded,
 * never inferred) without importing its early-rewarm recommendation.
 */
export function unusableChannels(attempts: OutreachAttempt[]): Set<OutreachChannel> {
  const out = new Set<OutreachChannel>()
  for (const a of attempts) {
    for (const c of a.communications) {
      if (c.outcome === 'unusable') out.add(c.channel)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Note markers (Right Path case_touches has no outcome column, so the per-
// channel outcome is carried on the touch note via a stable machine marker)
// ---------------------------------------------------------------------------

/**
 * The stable machine markers appended to a touch note to record a per-channel
 * outcome that case_touches cannot store in a column. A plainly recorded channel
 * with NO marker reads as a completed touch (the touch route only logs channels
 * the worker actually completed), matching the IPF rule that a recorded send is
 * a touch. These are deliberately unobtrusive and human-readable.
 */
export const OUTCOME_MARKERS: Record<ChannelOutcome, string> = {
  touch: '',
  no_contact: '[no-contact]',
  unusable: '[channel-unusable]',
}

/**
 * The marker that records a call REACHED the customer, so the attempt is
 * SUCCESSFUL and excluded from the unsuccessful-attempt (Nonresponsive) total.
 * Kept separate from OUTCOME_MARKERS because "reached" is a success signal, not
 * a per-channel non-response/usability outcome.
 */
export const REACHED_MARKER = '[reached]'

/** The common prefix of every unusable marker, matched so BOTH the bare legacy
 * form `[channel-unusable]` and the value-scoped form `[channel-unusable:<value>]`
 * are recognized as unusable. (OUTCOME_MARKERS.unusable keeps the bare form for
 * writing when no value is known.) */
const UNUSABLE_MARKER_PREFIX = '[channel-unusable'

/** Derive a per-channel outcome from a touch note. Absence of a marker means a
 * completed touch; the markers above denote ordinary non-response or an unusable
 * channel. Case-insensitive, tolerant of surrounding prose. Recognizes both the
 * bare and the value-scoped unusable markers. */
export function parseOutcomeFromNote(note: string | null): ChannelOutcome {
  if (!note) return 'touch'
  const n = note.toLowerCase()
  if (n.includes(UNUSABLE_MARKER_PREFIX)) return 'unusable'
  if (n.includes(OUTCOME_MARKERS.no_contact)) return 'no_contact'
  return 'touch'
}

/**
 * Value-scoped unusable. A channel being "unusable" is a property of the SPECIFIC
 * value that failed (a particular bad number, a particular bounced address), not
 * of the channel forever: replacing the failed value with a new one must restore
 * eligibility. To make that possible the unusable outcome records the failed
 * value alongside the marker, as `[channel-unusable:<normalized value>]`. The
 * normalized form is lowercase+trim for email and digits-only for phone, so a
 * later comparison against the current value on file is format-insensitive.
 *
 * buildUnusableMarker produces the marker to store; unusableValueFromNote reads
 * the normalized failed value back (null when the note carries the bare,
 * value-less legacy marker). The bare marker still parses as 'unusable' via
 * parseOutcomeFromNote, so legacy history keeps its meaning.
 */
export function normalizeUnusableValue(channel: OutreachChannel, value: string | null): string | null {
  if (value == null) return null
  if (channel === 'email') {
    const t = value.trim().toLowerCase()
    return t.length > 0 ? t : null
  }
  // call / voicemail / text / postal: compare phones by their digits only.
  const digits = value.replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

/** The stored unusable marker, value-scoped when the failed value is known. */
export function buildUnusableMarker(channel: OutreachChannel, value: string | null): string {
  const norm = normalizeUnusableValue(channel, value)
  // e.g. "[channel-unusable:2155550100]" or "[channel-unusable:x@y.com]"; the
  // bare marker when the value is unknown (keeps legacy behavior).
  return norm ? `[channel-unusable:${norm}]` : OUTCOME_MARKERS.unusable
}

/**
 * The normalized failed value recorded on an unusable note, or null when the
 * note carries the bare value-less marker (legacy) or is not unusable. Reads the
 * `[channel-unusable:<value>]` form written by buildUnusableMarker.
 */
export function unusableValueFromNote(note: string | null): string | null {
  if (!note) return null
  const m = note.match(/\[channel-unusable:([^\]]+)\]/i)
  return m ? m[1].trim().toLowerCase() : null
}

/** Whether a touch note records that the call REACHED the customer. */
export function noteIndicatesReached(note: string | null): boolean {
  return !!note && note.toLowerCase().includes(REACHED_MARKER)
}

/**
 * The marker that records a communication was INBOUND — the customer reached out
 * to us (an incoming email, phone call, or text) rather than us contacting them.
 * A genuine inbound response is what moves a customer into Customer Interaction
 * (it stamps the engagement signal); the marker lets the history read an
 * incoming communication distinctly from an outgoing one. Kept separate from the
 * per-channel outcome markers because direction is orthogonal to outcome.
 */
export const INBOUND_MARKER = '[inbound]'

/** Whether a touch note records an INBOUND (customer-initiated) communication. */
export function noteIndicatesInbound(note: string | null): boolean {
  return !!note && note.toLowerCase().includes(INBOUND_MARKER)
}
