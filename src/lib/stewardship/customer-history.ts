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
  type Communication,
  type OutreachChannel,
  type ChannelOutcome,
} from './outreach-attempts'

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
  /** The touch note with internal machine markers stripped, for display. */
  detail: string | null
}

/** One readable history event: the several communications of a single
 * interaction, summarized once, with who recorded it and when. */
export interface HistoryEvent {
  /** Grouping key: the shared ISO instant of the interaction. */
  at: string
  /** The one-line "what happened" summary for the whole interaction. */
  summary: string
  /** Who recorded it (the employee name on the touches), when known. */
  by: string | null
  /** True when any communication in the interaction reached the customer. */
  reached: boolean
  /** What kind of event this is, so the card can render the right affordance:
   * a customer communication ('contact') or an internal research record
   * ('research'). Defaults to 'contact' when absent. */
  kind?: 'contact' | 'research'
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
    // Every stored machine marker, including the address research marker.
    .replace(/\[research-(?:email|phone|address)-not-found\]/gi, '')
    .replace(/\[channel-unusable(?::[^\]]*)?\]/gi, '')
    .replace(/\[no-contact\]/gi, '')
    .replace(/\[reached\]/gi, '')
    // The "Servicing-agent onboarding <channel>" boilerplate prefix, with or
    // without the trailing ": " (employee note) or "." (no note).
    .replace(/^Servicing-agent onboarding\s+(?:call|voicemail|text|email|postal)\s*[:.]?\s*/i, '')
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
      })),
    })
  }
  return events
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
      return {
        id: row?.id ?? `${c.at}-${c.channel}`,
        channel: c.channel,
        outcome: c.outcome ?? 'touch',
        reached: c.reached === true,
        detail: cleanHistoryNote(row?.notes ?? null),
      }
    })
    // Attribution: the employee name on any communication in the interaction.
    const by =
      a.communications
        .map((c) => (byAt.get(c.at) ?? []).find((r) => r.touch_type === c.channel)?.touched_by)
        .find((n) => !!n) ?? null
    return {
      at: a.at,
      summary: summarizeInteraction(communications, overrides),
      by,
      reached: a.reached,
      kind: 'contact' as const,
      communications,
    }
  })

  // Include the recorded contact-research activity (including unsuccessful
  // research) as its own concise events, then interleave newest-first with the
  // communication events. Research is distinct from a contact attempt, so it is
  // never folded into a call interaction.
  const researchEvents = buildResearchEvents(rows)

  // Newest first for the card (the grouping returns oldest-first).
  return [...events, ...researchEvents].sort(
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

export interface NextHistoryEntryPreview {
  /** The one-line description of the entry that completing the work will log. */
  summary: string
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
      return { summary: 'Email' }
    case 'contact-research':
      return { summary: 'Contact Research' }
    case 'form-sent':
      return { summary: 'Form Sent' }
    case 'follow-up':
      return { summary: 'Follow-up' }
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
  const extraNote = options?.note?.trim() || undefined

  // Bad number is a distinct terminal outcome regardless of the reach choice.
  if (selection.badNumber) {
    return { summary: 'No Answer · Bad Number', note: extraNote }
  }

  if (selection.reach === 'not-reached') {
    // Only completed channels are previewed, matching how the attempt records.
    const parts = ['No Answer']
    if (selection.voicemailLeft) parts.push('Voicemail')
    if (selection.textSent) parts.push('Text')
    if (selection.emailSent) parts.push('Email')
    return { summary: parts.join(' \u00b7 '), note: extraNote }
  }

  if (selection.reach === 'reached') {
    if (selection.decision === 'callback') {
      const when = selection.callbackDate ? formatCallbackDate(selection.callbackDate) : null
      return {
        summary: when ? `Reached · Callback Scheduled ${when}` : 'Reached · Callback Scheduled',
        note: extraNote,
      }
    }
    if (selection.decision === 'not-interested') {
      return { summary: 'Reached · Not Interested', note: extraNote }
    }
    if (selection.decision === 'agreed') {
      return {
        summary: selection.formSent ? 'Reached · Form Sent' : 'Reached',
        note: extraNote,
      }
    }
    // Reached but no decision captured yet.
    return { summary: `Reached ${who}`.trim(), note: extraNote }
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
    note: extraNote,
  }
}
