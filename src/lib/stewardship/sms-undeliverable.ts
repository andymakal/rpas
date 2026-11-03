import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildUnusableMarker,
  normalizeUnusableValue,
  parseOutcomeFromNote,
  unusableValueFromNote,
} from './outreach-attempts'

/**
 * Text-delivery-failure (Text Undeliverable) reads and writes for the shared
 * Customer Contact Card.
 *
 * This REUSES Right Path's existing recorded text-delivery-failure mechanism —
 * the value-scoped unusable fact carried on a `case_touches` text row as
 * `[channel-unusable:<digits>]` (see `./outreach-attempts`). It does NOT create a
 * duplicate customer field or a separate texting system. A failure is a property
 * of the SPECIFIC number that failed (the normalized digits), so replacing the
 * number on file restores text availability on its own — the same value-scoping
 * the outreach attempt-history read applies.
 *
 * Why its own helper rather than the onboarding attempt-history read: the
 * onboarding read (`readUnusableChannelsByCustomer`) only counts touches that
 * carry a servicing-agent-onboarding marker, because those feed the onboarding
 * attempt count. The Contact Card is a GENERAL reusable surface, not the
 * onboarding workflow, so its text-failure marks must NOT inflate onboarding
 * attempts. This helper therefore writes a plain (non-onboarding) note and reads
 * any `touch_type = 'text'` row carrying the unusable marker, matching on the
 * value-scoped digits exactly like the shared normalization. An ordinary unsent
 * text is never written here — only a deliberate delivery-failure record is.
 */

const TEXT_UNDELIVERABLE_MARKER = '[sms-undeliverable]'

/** The plain, human-readable Customer History sentence for a card-recorded text
 * delivery failure, plus the value-scoped unusable marker that ties it to the
 * failed number and the stable `[sms-undeliverable]` marker identifying its
 * source. The bracketed markers are hidden by the Customer History display. */
function textUndeliverableNote(phone: string | null): string {
  const unusable = buildUnusableMarker('text', phone)
  const digits = normalizeUnusableValue('text', phone)
  const shown = digits ? `the number on file (${phone})` : 'the number on file'
  return `Text marked undeliverable: a text to ${shown} failed to deliver; texting to this number is disabled until the number is replaced. ${unusable} ${TEXT_UNDELIVERABLE_MARKER}`
}

/**
 * Record a text-delivery failure for the number currently on file. Writes ONE
 * `case_touches` text row carrying the value-scoped unusable marker, so the
 * failure is tied to that number's digits and a later replacement restores
 * texting automatically. Returns false (and writes nothing) when there is no
 * number to fail. Best-effort attribution via `touched_by` is left to the caller
 * if desired; the card route passes the acting employee name.
 */
export async function recordTextUndeliverable(
  admin: SupabaseClient,
  customerId: string,
  phone: string | null,
  touchedBy: string | null,
): Promise<boolean> {
  const digits = normalizeUnusableValue('text', phone)
  if (!digits) return false // no usable number on file to mark undeliverable
  const { error } = await admin.from('case_touches').insert({
    customer_id: customerId,
    case_id: null,
    touch_type: 'text',
    notes: textUndeliverableNote(phone),
    touched_at: new Date().toISOString(),
    touched_by: touchedBy,
  })
  if (error) {
    console.error('sms undeliverable record error:', error)
    return false
  }
  return true
}

/**
 * Whether the number CURRENTLY on file has a recorded text-delivery failure.
 * Value-scoped: a text row marked unusable counts only while the normalized
 * failed digits still match the digits of the current phone, so replacing the
 * number clears the state on its own. A bare (value-less, legacy) unusable text
 * mark is treated as unusable regardless, the conservative behavior. Returns
 * false on any read error so the card errs toward texting being available rather
 * than fabricating a failure.
 */
export async function isTextUndeliverableForCurrentNumber(
  admin: SupabaseClient,
  customerId: string,
  phone: string | null,
): Promise<boolean> {
  const currentDigits = normalizeUnusableValue('text', phone)
  if (!currentDigits) return false // no number on file: nothing to be undeliverable
  const { data, error } = await admin
    .from('case_touches')
    .select('touch_type, notes')
    .eq('customer_id', customerId)
    .eq('touch_type', 'text')
  if (error) {
    console.error('sms undeliverable read error:', error.message)
    return false
  }
  for (const r of (data ?? []) as { touch_type: string; notes: string | null }[]) {
    if (parseOutcomeFromNote(r.notes) !== 'unusable') continue
    const failed = unusableValueFromNote(r.notes)
    if (failed == null) return true // legacy value-less mark: conservatively unusable
    if (failed === currentDigits) return true // the failed number is still on file
  }
  return false
}
