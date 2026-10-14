/**
 * Contact-research OUTCOME record for Servicing-Agent Onboarding (Right Path) —
 * server-only.
 *
 * Both contact-finding surfaces — the Stewardship Research Needed task and the
 * project Contact Review pass — can end in one of two durable outcomes for a
 * customer who is missing a usable email or phone:
 *
 *   - FOUND: the value is written to the customers row (handled by each
 *     surface's existing save path; nothing in this module).
 *   - NOT FOUND: research was completed and nothing usable turned up. That must
 *     be recorded durably, PER METHOD (email vs phone independently), with who
 *     and when — so the same missing method stops being recommended on every
 *     subsequent pass, while the worker can still research again on purpose and
 *     any newly available value re-opens the recommendation.
 *
 * Reuse, not reinvention. This records the NOT-FOUND outcome as an ordinary
 * `case_touches` row (the existing customer-history mechanism), identified by a
 * stable machine marker on the note — exactly the pattern the per-channel
 * outreach outcomes already use (see OUTCOME_MARKERS in outreach-attempts.ts).
 * It is NOT an outreach to the customer, so it deliberately uses markers the
 * attempt-history reader does not recognize as a contact attempt; it never
 * inflates the Nonresponsive attempt count.
 *
 * The durable TRUTH that drives recommendations stays simple and self-healing:
 * a method is "settled by research" only while it is BOTH still missing on the
 * customer record AND has a recorded unsuccessful-research touch. The moment a
 * value is filled in, the method is no longer missing, so the stale research
 * mark is irrelevant and the recommendation returns on its own. Researching
 * again simply records a fresh touch.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** The two contact methods contact research can resolve. */
export type ResearchMethod = 'email' | 'phone'

/**
 * The stable machine marker that identifies a `case_touches` note as a recorded
 * UNSUCCESSFUL contact-research outcome for a method. Carried on the note
 * because case_touches has no outcome column — the same device OUTCOME_MARKERS
 * uses. Distinct per method so email and phone research are tracked
 * independently, and distinct from the outreach-attempt markers so the
 * attempt-history reader (which matches on "servicing-agent onboarding ...")
 * never counts a research record as a contact attempt.
 */
export const RESEARCH_UNSUCCESSFUL_MARKERS: Record<ResearchMethod, string> = {
  email: '[research-email-not-found]',
  phone: '[research-phone-not-found]',
}

/**
 * The `case_touches.touch_type` a research record is stored under. Research is
 * an internal look-up, not a customer contact, but touch_type is a constrained
 * allow-list ('call','voicemail','text','email','missed_appointment','postal').
 * We store the record under the method's natural channel ('email' for email
 * research, 'call' for phone research) so the row is honestly typed; the
 * research marker and prose on the note are what make it a research record, and
 * the attempt-history reader excludes it because the note carries no
 * contact-attempt marker.
 */
const RESEARCH_TOUCH_TYPE: Record<ResearchMethod, string> = {
  email: 'email',
  phone: 'call',
}

const METHOD_LABEL: Record<ResearchMethod, string> = {
  email: 'email',
  phone: 'phone',
}

/** One row to insert into case_touches recording unsuccessful research. */
export interface ResearchTouchRow {
  customer_id: string
  case_id: null
  touch_type: string
  notes: string
  touched_at: string
  touched_by: string | null
}

/**
 * Build the case_touches row(s) that record contact research completed with
 * nothing usable found, for the given methods. One row per method so email and
 * phone are tracked independently. Pure: no IO — the caller inserts the rows and
 * owns attribution (touched_by) and the shared timestamp.
 */
export function buildResearchTouchRows(
  customerId: string,
  methods: readonly ResearchMethod[],
  touchedBy: string | null,
  touchedAt: string = new Date().toISOString(),
): ResearchTouchRow[] {
  const unique = Array.from(new Set(methods))
  return unique.map((m) => ({
    customer_id: customerId,
    case_id: null,
    touch_type: RESEARCH_TOUCH_TYPE[m],
    notes:
      `Contact research completed: no usable ${METHOD_LABEL[m]} found. ` +
      RESEARCH_UNSUCCESSFUL_MARKERS[m],
    touched_at: touchedAt,
    touched_by: touchedBy,
  }))
}

/** A usable value is present and non-blank. */
function present(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0
}

/**
 * The methods currently MISSING a usable value on a customer record — the
 * methods a "nothing usable found" research outcome should be recorded against.
 * A method already on file is never recorded as researched-unsuccessfully.
 */
export function contactMethodsStillMissing(
  contact: { email: string | null; phone: string | null },
): ResearchMethod[] {
  const out: ResearchMethod[] = []
  if (!present(contact.email)) out.push('email')
  if (!present(contact.phone)) out.push('phone')
  return out
}

/** Whether a note records an unsuccessful research outcome for the method. */
function noteRecordsResearch(note: string | null, method: ResearchMethod): boolean {
  if (!note) return false
  return note.toLowerCase().includes(RESEARCH_UNSUCCESSFUL_MARKERS[method].toLowerCase())
}

/**
 * Which methods have a recorded unsuccessful-research outcome in the customer's
 * history. This is the raw recorded FACT; combine it with current value presence
 * (see methodsSettledByResearch) to decide whether to still recommend research.
 */
export async function readResearchedUnsuccessfully(
  supabase: SupabaseClient,
  customerId: string,
): Promise<Record<ResearchMethod, boolean>> {
  const { data, error } = await supabase
    .from('case_touches')
    .select('notes')
    .eq('customer_id', customerId)

  if (error) {
    // A read failure must not fabricate a "settled" state: report nothing
    // researched so the recommendation errs toward still offering research.
    console.error('research-record read error:', error.message)
    return { email: false, phone: false }
  }

  const rows = (data ?? []) as { notes: string | null }[]
  return {
    email: rows.some((r) => noteRecordsResearch(r.notes, 'email')),
    phone: rows.some((r) => noteRecordsResearch(r.notes, 'phone')),
  }
}

/**
 * Batched variant of readResearchedUnsuccessfully for a set of customers, so a
 * surface that already reads many board rows can resolve the research facts in
 * ONE pass instead of per-customer. Returns a map keyed by customer id; a
 * customer with no research touch is absent (treat as all-false). A read failure
 * returns an empty map so recommendations err toward still offering research.
 */
export async function readResearchedUnsuccessfullyBatch(
  supabase: SupabaseClient,
  customerIds: readonly string[],
): Promise<Map<string, Record<ResearchMethod, boolean>>> {
  const out = new Map<string, Record<ResearchMethod, boolean>>()
  const unique = Array.from(new Set(customerIds))
  if (unique.length === 0) return out

  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300)
    const { data, error } = await supabase
      .from('case_touches')
      .select('customer_id, notes')
      .in('customer_id', chunk)
    if (error) {
      console.error('research-record batch read error:', error.message)
      continue
    }
    for (const r of (data ?? []) as { customer_id: string; notes: string | null }[]) {
      const prev = out.get(r.customer_id) ?? { email: false, phone: false }
      if (noteRecordsResearch(r.notes, 'email')) prev.email = true
      if (noteRecordsResearch(r.notes, 'phone')) prev.phone = true
      out.set(r.customer_id, prev)
    }
  }
  return out
}

/** Current presence of a usable contact value (present and non-blank). */
export interface ContactPresence {
  hasEmail: boolean
  hasPhone: boolean
}

/**
 * The methods that are SETTLED BY RESEARCH right now: still missing on the
 * customer record AND recorded researched-unsuccessfully. A method with a value
 * on file is never settled-by-research (the value makes research moot), so a
 * newly added email or phone re-opens that method automatically.
 */
export function methodsSettledByResearch(
  presence: ContactPresence,
  researched: Record<ResearchMethod, boolean>,
): Record<ResearchMethod, boolean> {
  return {
    email: !presence.hasEmail && researched.email,
    phone: !presence.hasPhone && researched.phone,
  }
}

/**
 * Whether a customer who is MISSING a usable email or phone should still be
 * recommended for contact research. Research is worth recommending only while at
 * least one still-missing method has NOT yet been researched unsuccessfully.
 * Once every still-missing method is settled by research, stop recommending —
 * the worker can still open the customer and research again deliberately, and a
 * found value flips the method back to present (so no longer settled).
 *
 * A customer who already has BOTH methods is not missing anything and is not a
 * research candidate regardless of history (returns false).
 */
export function stillNeedsResearchRecommendation(
  presence: ContactPresence,
  researched: Record<ResearchMethod, boolean>,
): boolean {
  const missingEmail = !presence.hasEmail
  const missingPhone = !presence.hasPhone
  if (!missingEmail && !missingPhone) return false
  const emailOutstanding = missingEmail && !researched.email
  const phoneOutstanding = missingPhone && !researched.phone
  return emailOutstanding || phoneOutstanding
}
