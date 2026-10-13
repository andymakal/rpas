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
 * Marker substrings that identify a touch as servicing-agent onboarding
 * outreach. The onboarding route writes these notes; matching on them keeps
 * unrelated case touches (ordinary case calls/emails) out of the attempt count.
 * Lowercased comparison.
 */
const ONBOARDING_NOTE_MARKERS: readonly string[] = [
  'servicing-agent onboarding',
  'servicing-agent authorization',
  'servicing-agent form',
  '1035 servicing-agent',
]

function isOnboardingOutreachNote(notes: string | null): boolean {
  if (!notes) return false
  const n = notes.toLowerCase()
  return ONBOARDING_NOTE_MARKERS.some((m) => n.includes(m))
}

export interface AttemptHistory {
  attempts: OutreachAttempt[]
  /** Grouped attempts that included a phone call (call/voicemail). */
  callAttempts: number
  /** Grouped outreach attempts across all channels (the Nonresponsive basis). */
  outreachAttempts: number
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
): Promise<AttemptHistory> {
  const { data, error } = await supabase
    .from('case_touches')
    .select('touch_type, touched_at, notes')
    .eq('customer_id', customerId)
    .order('touched_at', { ascending: true })

  if (error) {
    // A read failure must not fabricate attempts. Report zero attempts so the
    // cadence falls back to its first-attempt spacing rather than guessing.
    console.error('attempt-history read error:', error.message)
    return { attempts: [], callAttempts: 0, outreachAttempts: 0 }
  }

  const rows = (data ?? []) as { touch_type: string; touched_at: string; notes: string | null }[]
  const communications: Communication[] = rows
    .filter((r) => OUTREACH_CHANNELS.has(r.touch_type) && isOnboardingOutreachNote(r.notes))
    .map((r) => ({ channel: r.touch_type as OutreachChannel, at: r.touched_at }))

  const attempts = groupIntoAttempts(communications, actorTimeZone)
  return {
    attempts,
    callAttempts: countCallAttempts(attempts),
    outreachAttempts: countOutreachAttempts(attempts),
  }
}
