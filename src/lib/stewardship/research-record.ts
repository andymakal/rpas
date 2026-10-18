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
 * `case_touches` row (the existing customer-history mechanism) under the
 * dedicated 'research' touch_type, with the per-method outcome carried on the
 * note via a stable machine marker — the same device the per-channel outreach
 * outcomes use (see OUTCOME_MARKERS in outreach-attempts.ts). Because it is
 * internal research and NOT a customer communication, the 'research' type keeps
 * it visibly distinct in customer history, and the attempt-history reader (which
 * counts only genuine outreach channels) never mistakes it for a contact
 * attempt, so it never inflates the Nonresponsive attempt count.
 *
 * The durable TRUTH that drives recommendations stays simple and self-healing:
 * a method is "settled by research" only while it is BOTH still missing on the
 * customer record AND has a recorded unsuccessful-research touch. The moment a
 * value is filled in, the method is no longer missing, so the stale research
 * mark is irrelevant and the recommendation returns on its own. Researching
 * again simply records a fresh touch.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** The contact methods contact research can resolve. Email, telephone, and
 * mailing address are independent contact methods: research works whichever is
 * missing, and a found value on any one is progress on its own. */
export type ResearchMethod = 'email' | 'phone' | 'address'

/**
 * The stable machine marker that identifies a `case_touches` note as a recorded
 * UNSUCCESSFUL contact-research outcome for a method. Carried on the note
 * because case_touches has no outcome column — the same device OUTCOME_MARKERS
 * uses. Distinct per method so email, phone, and address research are tracked
 * independently, and distinct from the outreach-attempt markers so the
 * attempt-history reader (which matches on "servicing-agent onboarding ...")
 * never counts a research record as a contact attempt.
 */
export const RESEARCH_UNSUCCESSFUL_MARKERS: Record<ResearchMethod, string> = {
  email: '[research-email-not-found]',
  phone: '[research-phone-not-found]',
  address: '[research-address-not-found]',
}

/**
 * The `case_touches.touch_type` a research record is stored under. Internal
 * contact research is NOT a customer communication, so it is recorded under its
 * own dedicated 'research' type (added by migration
 * 20261103000002_case_touches_research_type.sql) rather than mislabeled as a
 * 'call' or 'email' touch. Customer history can then show it as internal
 * research, and the attempt-history reader — which counts only genuine outreach
 * channels (call/voicemail/text/email/postal) — never mistakes it for a contact
 * attempt. The per-method outcome is still carried on the note marker, so the
 * recommendation reads are unchanged; email and phone stay independently
 * tracked by the marker, not by the touch_type.
 */
const RESEARCH_TOUCH_TYPE = 'research'

const METHOD_LABEL: Record<ResearchMethod, string> = {
  email: 'email',
  phone: 'phone',
  address: 'mailing address',
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
    touch_type: RESEARCH_TOUCH_TYPE,
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

/** A mailing address is usable only when all four parts are on file, mirroring
 * the shared CustomerContactCard's addressUsable. */
function addressPresent(
  contact: { street?: string | null; address_line1?: string | null; city?: string | null; state?: string | null; zip?: string | null },
): boolean {
  const street = present(contact.street) || present(contact.address_line1)
  return street && present(contact.city) && present(contact.state) && present(contact.zip)
}

/**
 * The methods currently MISSING a usable value on a customer record — the
 * methods a "nothing usable found" research outcome should be recorded against.
 * A method already on file is never recorded as researched-unsuccessfully.
 * Email, phone, and mailing address are independent; each is checked on its own.
 */
export function contactMethodsStillMissing(
  contact: {
    email: string | null; phone: string | null
    street?: string | null; address_line1?: string | null
    city?: string | null; state?: string | null; zip?: string | null
  },
): ResearchMethod[] {
  const out: ResearchMethod[] = []
  if (!present(contact.email)) out.push('email')
  if (!present(contact.phone)) out.push('phone')
  if (!addressPresent(contact)) out.push('address')
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
    return { email: false, phone: false, address: false }
  }

  const rows = (data ?? []) as { notes: string | null }[]
  return {
    email: rows.some((r) => noteRecordsResearch(r.notes, 'email')),
    phone: rows.some((r) => noteRecordsResearch(r.notes, 'phone')),
    address: rows.some((r) => noteRecordsResearch(r.notes, 'address')),
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
      const prev = out.get(r.customer_id) ?? { email: false, phone: false, address: false }
      if (noteRecordsResearch(r.notes, 'email')) prev.email = true
      if (noteRecordsResearch(r.notes, 'phone')) prev.phone = true
      if (noteRecordsResearch(r.notes, 'address')) prev.address = true
      out.set(r.customer_id, prev)
    }
  }
  return out
}

/** Current presence of a usable contact value (present and non-blank). Email,
 * phone, and mailing address are independent methods. */
export interface ContactPresence {
  hasEmail: boolean
  hasPhone: boolean
  hasAddress: boolean
}

/**
 * The methods that are SETTLED BY RESEARCH right now: still missing on the
 * customer record AND recorded researched-unsuccessfully. A method with a value
 * on file is never settled-by-research (the value makes research moot), so a
 * newly added email, phone, or address re-opens that method automatically.
 */
export function methodsSettledByResearch(
  presence: ContactPresence,
  researched: Record<ResearchMethod, boolean>,
): Record<ResearchMethod, boolean> {
  return {
    email: !presence.hasEmail && researched.email,
    phone: !presence.hasPhone && researched.phone,
    address: !presence.hasAddress && researched.address,
  }
}

/**
 * Whether a customer who is MISSING a usable email, phone, or mailing address
 * should still be recommended for contact research. Research is worth
 * recommending only while at least one still-missing method has NOT yet been
 * researched unsuccessfully. Once every still-missing method is settled by
 * research, stop recommending — the worker can still open the customer and
 * research again deliberately, and a found value flips the method back to
 * present (so no longer settled).
 *
 * A customer who already has every method is not missing anything and is not a
 * research candidate regardless of history (returns false).
 */
export function stillNeedsResearchRecommendation(
  presence: ContactPresence,
  researched: Record<ResearchMethod, boolean>,
): boolean {
  const missingEmail = !presence.hasEmail
  const missingPhone = !presence.hasPhone
  const missingAddress = !presence.hasAddress
  if (!missingEmail && !missingPhone && !missingAddress) return false
  const emailOutstanding = missingEmail && !researched.email
  const phoneOutstanding = missingPhone && !researched.phone
  const addressOutstanding = missingAddress && !researched.address
  return emailOutstanding || phoneOutstanding || addressOutstanding
}
