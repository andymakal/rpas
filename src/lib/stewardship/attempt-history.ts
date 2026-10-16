/**
 * Attempt-history reads for Servicing-Agent Onboarding (Right Path) —
 * server-only.
 *
 * The single place that turns a customer's durable communication history
 * (case_touches) into the grouped-attempt facts the cadence and the
 * Nonresponsive judgment consume. Individual communications are preserved in
 * case_touches exactly as logged; this read GROUPS them into attempts (by actor
 * day) without mutating anything. It is the IO companion to the pure
 * outreach-attempts normalization.
 *
 * Scope: only the onboarding OUTREACH communications count toward attempts. The
 * onboarding workflow logs its outreach touches with a stable description prefix
 * ("Servicing-agent onboarding call: ...", "1035 servicing-agent authorization
 * email sent ...", etc.), and the authorization-form sends. We therefore count
 * the customer's call / voicemail / text / email / postal touches that belong to
 * the servicing-agent onboarding, identified by that description, so unrelated
 * case touches never inflate the attempt count.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  groupIntoAttempts,
  countCallAttempts,
  countOutreachAttempts,
  countUnsuccessfulAttempts,
  unusableChannels,
  parseOutcomeFromNote,
  noteIndicatesReached,
  type Communication,
  type OutreachAttempt,
  type OutreachChannel,
} from './outreach-attempts'

/** The channels we treat as outreach communications. */
const OUTREACH_CHANNELS: ReadonlySet<string> = new Set([
  'call',
  'voicemail',
  'text',
  'email',
  'postal',
])

/**
 * Marker substrings that identify a touch as a servicing-agent onboarding
 * CONTACT ATTEMPT — a genuine reach-out to the customer. The onboarding routes
 * write these notes; matching on them keeps unrelated case touches (ordinary
 * case calls/emails) out of the attempt count. Lowercased comparison.
 *
 * Included: the recorded onboarding call outcomes, the ad-hoc multi-channel
 * touches, the introductory authorization email (a real first contact attempt),
 * and the follow-up chases.
 */
const ONBOARDING_CONTACT_MARKERS: readonly string[] = [
  'servicing-agent onboarding call',      // recorded call/voicemail outcome
  'servicing-agent onboarding voicemail', // ad-hoc voicemail
  'servicing-agent onboarding text',      // ad-hoc text
  'servicing-agent onboarding email',     // ad-hoc email
  'servicing-agent onboarding postal',    // ad-hoc postal
  'servicing-agent onboarding follow-up', // a chase
  'servicing-agent authorization email',  // the introductory email (first contact)
]

/**
 * Note substrings that are onboarding LOGISTICS, not a cold contact attempt:
 * sending or receiving the authorization FORM, and reopening. These must never
 * inflate the attempt count even though they mention servicing-agent.
 */
const ONBOARDING_LOGISTICS_MARKERS: readonly string[] = [
  'authorization form sent',   // form delivery, not a contact attempt
  'form returned',             // inbound receipt
  'onboarding reopened',       // administrative reopen
]

function isOnboardingContactAttempt(notes: string | null): boolean {
  if (!notes) return false
  const n = notes.toLowerCase()
  if (ONBOARDING_LOGISTICS_MARKERS.some((m) => n.includes(m))) return false
  return ONBOARDING_CONTACT_MARKERS.some((m) => n.includes(m))
}

export interface AttemptHistory {
  attempts: OutreachAttempt[]
  /** Grouped attempts that included a phone call (call/voicemail). */
  callAttempts: number
  /** All grouped outreach attempts across all channels (successful or not). */
  outreachAttempts: number
  /** Grouped attempts that did NOT reach the customer. The correct basis for the
   * seven-attempt Nonresponsive advisory (a reached attempt is a success). */
  unsuccessfulAttempts: number
  /** Channels recorded as unusable (number/mailbox/address cannot deliver).
   * Serializable list so the contact-options read can subtract an exhausted
   * channel without re-deriving. */
  unusableChannels: OutreachChannel[]
}

/**
 * Read and group a customer's servicing-agent onboarding outreach communications
 * into attempts. Pure counting is delegated to outreach-attempts; this only
 * supplies the IO. Non-onboarding touches and non-outreach channels are
 * excluded.
 */
export async function getAttemptHistory(
  supabase: SupabaseClient,
  customerId: string,
  actorTimeZone: string | null,
  options?: {
    /**
     * The start instant of the CURRENT onboarding run (the open pre-review's
     * created_at). Only touches at or after this instant count, so a prior
     * completed run's attempts never inflate this run's counts or cadence. When
     * omitted, all onboarding touches for the customer are counted (back-compat).
     */
    since?: string | null
  },
): Promise<AttemptHistory> {
  let query = supabase
    .from('case_touches')
    .select('touch_type, touched_at, notes')
    .eq('customer_id', customerId)
    .order('touched_at', { ascending: true })

  // Scope to the current run. A small backward tolerance absorbs the sub-second
  // skew between a pre-review's created_at and the first touch recorded in the
  // same operation, so the run's own first attempt is never excluded by a race.
  if (options?.since) {
    const sinceMs = new Date(options.since).getTime()
    if (Number.isFinite(sinceMs)) {
      const bound = new Date(sinceMs - 5000).toISOString()
      query = query.gte('touched_at', bound)
    }
  }

  const { data, error } = await query

  if (error) {
    // A read failure must not fabricate attempts. Report zero attempts so the
    // cadence falls back to its first-attempt spacing rather than guessing.
    console.error('attempt-history read error:', error.message)
    return { attempts: [], callAttempts: 0, outreachAttempts: 0, unsuccessfulAttempts: 0, unusableChannels: [] }
  }

  const rows = (data ?? []) as { touch_type: string; touched_at: string; notes: string | null }[]
  const communications: Communication[] = rows
    .filter((r) => OUTREACH_CHANNELS.has(r.touch_type) && isOnboardingContactAttempt(r.notes))
    .map((r) => ({
      channel: r.touch_type as OutreachChannel,
      at: r.touched_at,
      // The per-channel outcome is carried on the note marker (case_touches has
      // no outcome column). A plainly recorded channel reads as a completed
      // touch; markers denote ordinary non-response or an unusable channel.
      outcome: parseOutcomeFromNote(r.notes),
      // A reached call makes its attempt successful (excluded from the
      // unsuccessful-attempt total).
      reached: noteIndicatesReached(r.notes),
    }))

  const attempts = groupIntoAttempts(communications, actorTimeZone)
  return {
    attempts,
    callAttempts: countCallAttempts(attempts),
    outreachAttempts: countOutreachAttempts(attempts),
    unsuccessfulAttempts: countUnsuccessfulAttempts(attempts),
    unusableChannels: Array.from(unusableChannels(attempts)),
  }
}

/**
 * Batched read of the channels recorded UNUSABLE for each of many customers, in
 * one pass over case_touches. A channel is unusable when a recorded onboarding
 * outreach communication on it carried the 'unusable' outcome (wrong/
 * disconnected number, full/unset mailbox, bouncing text, invalid email) — the
 * same recorded fact getAttemptHistory surfaces per customer, computed here for
 * a whole set so a list read (e.g. Contact Research) does not issue one query
 * per customer.
 *
 * Returns a map keyed by customer id; a customer with no unusable channel is
 * absent (treat as the empty set). A read failure returns an empty map so a
 * caller errs toward treating channels as still usable rather than fabricating
 * an exhausted state. Only onboarding outreach touches are considered, the same
 * scope getAttemptHistory uses, so unrelated case touches never mark a channel
 * unusable. Grouping into attempts is unnecessary here: usability is a per-
 * communication fact, so the 'unusable' outcome on any single communication
 * marks that channel for the customer.
 */
export async function readUnusableChannelsByCustomer(
  supabase: SupabaseClient,
  customerIds: readonly string[],
): Promise<Map<string, Set<OutreachChannel>>> {
  const out = new Map<string, Set<OutreachChannel>>()
  const unique = Array.from(new Set(customerIds))
  if (unique.length === 0) return out

  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300)
    const { data, error } = await supabase
      .from('case_touches')
      .select('customer_id, touch_type, notes')
      .in('customer_id', chunk)
    if (error) {
      console.error('unusable-channel batch read error:', error.message)
      continue
    }
    for (const r of (data ?? []) as { customer_id: string; touch_type: string; notes: string | null }[]) {
      if (!OUTREACH_CHANNELS.has(r.touch_type)) continue
      if (!isOnboardingContactAttempt(r.notes)) continue
      if (parseOutcomeFromNote(r.notes) !== 'unusable') continue
      const set = out.get(r.customer_id) ?? new Set<OutreachChannel>()
      set.add(r.touch_type as OutreachChannel)
      out.set(r.customer_id, set)
    }
  }
  return out
}
