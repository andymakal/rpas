import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { normalizeEmailInput, normalizePhoneInput } from '@/lib/contact-input'
import { validatePersonName } from '@/lib/person-name'
import {
  type EmailAvailability,
  type SelectableEmailAvailability,
  EMAIL_AVAILABILITY_LABEL,
  isSelectableEmailAvailability,
} from '@/lib/email-availability'
import {
  recordTextUndeliverable,
  isTextUndeliverableForCurrentNumber,
} from '@/lib/stewardship/sms-undeliverable'
import {
  buildContactUpdateHistoryNote,
  type ContactSnapshot,
} from '@/lib/stewardship/customer-history'
import {
  normalizeDobParts,
  wouldDowngradeExactDob,
  formatDobParts,
  formatDobDisplay,
  dobPrecisionFromToken,
  readStoredDob,
  type DobParts,
  type DobSourceParts,
} from '@/lib/stewardship/dob'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * PATCH /api/customers/[id]/contact
 *
 * The single shared write endpoint behind the reusable CustomerContactCard.
 * It corrects a customer's durable contact facts IN PLACE on the customers row
 * and records (or clears) the customer-verified confirmation on the same row.
 * It never creates a duplicate contact record, never touches workflow status
 * (stewardship_outreach, prereviews, projects), and introduces no new field:
 * email/phone/street/city/state/zip and the three *_verified_at timestamps all
 * already live on customers.
 *
 * Two request shapes, exactly one per call:
 *
 * SAVE A FIELD — Body is one of:
 *   { field: 'email',   email: string | null }
 *   { field: 'phone',   phone: string | null }
 *   { field: 'address', street, city, state, zip }   (edited as one group)
 *   Values run through the shared contact-input normalization so the rules the
 *   form applies are enforced here too and invalid formatting cannot bypass the
 *   UI. An empty value clears the field(s). A changed value ALSO clears that
 *   field's verification: a customer-confirmed value that is then edited is no
 *   longer the value the customer confirmed, so its *_verified_at is reset to
 *   null in the same write.
 *
 * VERIFY A FIELD — Body:
 *   { field: 'email' | 'phone' | 'address', verified: boolean }
 *   Stamps (verified true) or clears (false) the matching *_verified_at. A
 *   missing or unusable value cannot be marked verified: there is nothing to
 *   confirm, so the request is rejected 400 and nothing is written.
 *
 * SET EMAIL AVAILABILITY — Body:
 *   { field: 'email_availability', availability: 'no_address' | 'undeliverable' }
 *   Records a "no usable email" reason as an informational durable customer
 *   fact (customers.email_availability) and writes ONE Customer History entry
 *   (case_touches 'workflow') with the acting employee and timestamp. It is
 *   save-only-changed, so repeating the same status writes nothing and never
 *   creates a duplicate entry. 'undeliverable' additionally removes the failed
 *   address from active use (email -> null) while preserving it in the history
 *   note. 'available' is never set here — saving a usable email sets it. It is
 *   informational: it suppresses no research, routes no queue, and never closes
 *   a case, stops servicing, or removes the customer from a project.
 *
 * Saving a usable email returns the card to the normal state: availability goes
 * to 'available' and any prior No Usable Email / Undeliverable reason is cleared.
 *
 * Verification, editing, and availability are independent operations; the same
 * card drives them, but a single request does exactly one.
 */

type ContactField = 'email' | 'phone' | 'address'

const VERIFIED_COLUMN: Record<ContactField, 'email_verified_at' | 'phone_verified_at' | 'address_verified_at'> = {
  email: 'email_verified_at',
  phone: 'phone_verified_at',
  address: 'address_verified_at',
}

type CustomerContactRow = {
  id: string
  first_name: string | null
  last_name: string | null
  /** Recorded middle name(s). */
  middle_name: string | null
  /** Generational suffix as typed ("Jr", "III"). */
  suffix: string | null
  /** The name the customer is called ("Goes by" / preferred first). */
  goes_by: string | null
  /** Preference for the suffix in the familiar name (null = include). */
  suffix_in_familiar: boolean | null
  email: string | null
  phone: string | null
  street: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  email_availability: EmailAvailability | null
  contact_alert: string | null
  /** Do Not Text — the durable customer-level texting opt-out. */
  sms_opt_out: boolean | null
  /** Exact date of birth (YYYY-MM-DD) when fully known, else null. */
  date_of_birth: string | null
  /** Partial date of birth (masked 'MM/xx/YYYY' / 'xx/xx/YYYY', no day) when the
   * exact date is not fully known, else null. */
  date_of_birth_approx: string | null
}

const SELECT =
  'id, first_name, last_name, middle_name, suffix, goes_by, suffix_in_familiar, ' +
  'email, phone, street, address_line1, city, state, zip, ' +
  'email_verified_at, phone_verified_at, address_verified_at, email_availability, contact_alert, ' +
  'sms_opt_out, date_of_birth, date_of_birth_approx'

/** The stable machine marker that identifies a case_touches 'workflow' note as
 * an email-availability change, carrying the new status. Bracketed so the
 * Customer History display (cleanHistoryNote / stripMarkersAndPrefix) hides it
 * while keeping the human-readable sentence. Covers the selectable reasons plus
 * 'missing' (a reset to unknown) and the system-set 'available'. */
function emailAvailabilityMarker(status: SelectableEmailAvailability | 'available'): string {
  return `[email-availability:${status}]`
}

/**
 * Resolve the signed-in employee's display name for the history record, the
 * same best-effort attribution the contact-review route uses: prefer
 * staff_profiles.display_name, fall back to the email local-part. Never blocks
 * the save.
 */
async function resolveEmployeeName(admin: AdminClient): Promise<string | null> {
  try {
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return null
    const { data: profile } = await admin
      .from('staff_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
    return profile?.display_name ?? user.email?.split('@')[0] ?? null
  } catch {
    return null
  }
}

/**
 * The self-describing Customer History sentence for an email-availability
 * change, plus the machine marker. Recorded as ONE 'workflow' case_touches row
 * (buildWorkflowEvents renders it as a milestone). For 'undeliverable' the prior
 * failed address is named in the sentence so it is preserved in history even
 * though it is removed from active use.
 */
function emailAvailabilityNote(
  status: SelectableEmailAvailability | 'available',
  priorEmail: string | null,
): string {
  const marker = emailAvailabilityMarker(status)
  switch (status) {
    case 'missing':
      return priorEmail
        ? `Email availability reset to ${EMAIL_AVAILABILITY_LABEL.missing} (unknown): ${priorEmail} was removed from active use. ${marker}`
        : `Email availability reset to ${EMAIL_AVAILABILITY_LABEL.missing} (unknown). ${marker}`
    case 'no_address':
      return priorEmail
        ? `Email availability set to ${EMAIL_AVAILABILITY_LABEL.no_address}: ${priorEmail} was removed from active use. ${marker}`
        : `Email availability set to ${EMAIL_AVAILABILITY_LABEL.no_address}: no usable email address on file. ${marker}`
    case 'undeliverable':
      return priorEmail
        ? `Email marked ${EMAIL_AVAILABILITY_LABEL.undeliverable}: ${priorEmail} permanently failed and was removed from active use. ${marker}`
        : `Email marked ${EMAIL_AVAILABILITY_LABEL.undeliverable}. ${marker}`
    case 'available':
      return priorEmail
        ? `Email availability restored: a usable address (${priorEmail}) is on file. ${marker}`
        : `Email availability set to on file. ${marker}`
  }
}

/**
 * Record ONE email-availability change in the single durable history system
 * (case_touches, 'workflow'), attributed to the acting employee with a
 * timestamp. Best-effort: a history-write failure is logged but never fails the
 * save (the durable fact on the customer row is the source of truth). The caller
 * guarantees this is only invoked when the status ACTUALLY changed, so no
 * duplicate entry is created for a no-op.
 */
async function recordEmailAvailabilityHistory(
  admin: AdminClient,
  customerId: string,
  status: SelectableEmailAvailability | 'available',
  priorEmail: string | null,
): Promise<void> {
  const touchedBy = await resolveEmployeeName(admin)
  const { error } = await admin.from('case_touches').insert({
    customer_id: customerId,
    case_id: null,
    touch_type: 'workflow',
    notes: emailAvailabilityNote(status, priorEmail),
    touched_at: new Date().toISOString(),
    touched_by: touchedBy,
  })
  if (error) {
    console.error('email-availability history record error:', error)
  }
}

/** Collapse internal whitespace and trim; null when nothing meaningful remains. */
function cleanLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.replace(/\s+/g, ' ').trim()
  return v.length > 0 ? v : null
}

/** State: collapse, trim, uppercase (US two-letter convention), null when empty. */
function cleanState(raw: unknown): string | null {
  const v = cleanLine(raw)
  return v ? v.toUpperCase() : null
}

/** The customer's stored mailing street, matching the app-wide convention of
 * preferring `street` and falling back to the (in practice empty) address_line1. */
function storedStreet(c: CustomerContactRow): string | null {
  return (c.street ?? c.address_line1 ?? '')?.trim() || null
}

/** A mailing address is usable only when street, city, state, and ZIP are all
 * present — the same completeness test the stewardship/postal paths apply. */
function addressUsable(street: string | null, city: string | null, state: string | null, zip: string | null): boolean {
  return !!(street && city && state && zip)
}

/**
 * Return the customer-contact row to the card, enriched with the resolved
 * `text_undeliverable` fact for the number CURRENTLY on file. The card reads
 * `sms_opt_out` (Do Not Text) straight off the row and `text_undeliverable`
 * (Text Undeliverable) from this resolved, value-scoped read, so its texting
 * status is correct the instant any write returns — including a phone change,
 * which clears a stale delivery-failure because the failed digits no longer
 * match. Every success path returns through here so the two texting facts are
 * always present and consistent.
 */
async function respondWithContact(admin: AdminClient, row: CustomerContactRow) {
  const [text_undeliverable, ageInfo, dobInfo] = await Promise.all([
    isTextUndeliverableForCurrentNumber(admin, row.id, row.phone),
    // Re-derive the best-available-precision age on every write so the identity
    // header stays correct after a DOB edit (or any edit) — age only, never a
    // DOB/day. Matches the GET half so initial and post-write display agree.
    resolveCustomerAge(admin, row.id),
    // Re-resolve the best-available-precision DOB for the card display on every
    // write, so a just-saved DOB (or one promoted from a linked policy) shows at
    // its true precision. Matches the GET half.
    resolveCustomerDob(admin, row),
  ])
  return Response.json({ data: { ...row, text_undeliverable, ...ageInfo, ...dobInfo } })
}

/** The resolved DOB the card displays, at its best available precision. */
export interface DobDisplayInfo {
  /** The DOB formatted for display ("MM/DD/YYYY" / "MM/YYYY" / "YYYY"), or null
   * when nothing usable is on file. The card's scoped full-DOB exception. */
  dob_display: string | null
  /** Where the displayed DOB came from. 'exact'/'customer_partial' are stored on
   * the customer; 'linked_policy' is the reliable owner-DOB consensus across the
   * customer's policies (never the policy insured); 'none' = nothing to show. */
  dob_source: DobSourceParts['source']
  /** True when the displayed DOB is NOT a confirmed exact date stored on the
   * customer (a partial, or one derived from linked policies), so the card can
   * label it as not-yet-confirmed — mirroring the approximate-age treatment. */
  dob_approximate: boolean
  /** The resolved parts for seeding the editor. A partial/linked source carries
   * a blank day; the operator confirms and saves it onto the customer. */
  dob_month: number | null
  dob_day: number | null
  dob_year: number | null
}

/**
 * Resolve the customer's best-available-precision DOB for the shared card's
 * display, reusing the SQL resolver project_customer_dob_display: exact
 * customers.date_of_birth (the only source with a day), else
 * customers.date_of_birth_approx (month/year), else the reliable consensus of
 * the customer's linked owner_dob_approx (single agreed year, month only if all
 * agree; conflicting years => none). Owner source only — never the policy
 * insured. No day is ever fabricated from a partial source.
 *
 * On any failure it falls back to the DOB stored directly on the row (exact
 * date / partial approx), so the card still shows what is on the customer even
 * if the linked-policy resolver is unavailable, never a wrong value.
 */
async function resolveCustomerDob(
  admin: AdminClient,
  row: CustomerContactRow,
): Promise<DobDisplayInfo> {
  try {
    const { data } = await admin.rpc('project_customer_dob_display', { p_customer_id: row.id })
    const r = (data ?? [])[0] as
      | { dob_year: number | null; dob_month: number | null; dob_day: number | null; dob_precision: string; dob_source: string }
      | undefined
    if (r) {
      const parts: DobSourceParts = {
        year: r.dob_year,
        month: r.dob_month,
        day: r.dob_day,
        precision: dobPrecisionFromToken(r.dob_precision),
        source: (r.dob_source as DobSourceParts['source']) ?? 'none',
      }
      return {
        dob_display: formatDobParts(parts),
        dob_source: parts.source,
        dob_approximate: parts.source === 'customer_partial' || parts.source === 'linked_policy',
        dob_month: parts.month,
        dob_day: parts.day,
        dob_year: parts.year,
      }
    }
  } catch (e) {
    console.error('customer contact dob resolve error:', e)
  }
  // Fallback: what is stored directly on the customer row.
  const fallback = readStoredDobFallback(row.date_of_birth, row.date_of_birth_approx)
  return fallback
}

/** DOB display derived ONLY from the stored customer columns, used when the
 * linked-policy resolver is unavailable. */
function readStoredDobFallback(
  exact: string | null,
  approx: string | null,
): DobDisplayInfo {
  const s = readStoredDob(exact, approx)
  return {
    dob_display: formatDobDisplay(exact, approx),
    dob_source: s.precision === 'exact' ? 'exact' : s.precision === 'none' ? 'none' : 'customer_partial',
    dob_approximate: s.precision !== 'exact' && s.precision !== 'none',
    dob_month: s.month,
    dob_day: s.day,
    dob_year: s.year,
  }
}

/**
 * Resolve the customer's best-available-precision age for the shared card's
 * identity header, reusing the project age logic (exact date_of_birth, else the
 * agreed masked policy DOB, UNKNOWN on conflict — never guessed). Age only; the
 * day/DOB is never exposed. A read failure yields a null age so the card simply
 * omits it rather than showing a wrong value.
 */
async function resolveCustomerAge(
  admin: AdminClient,
  customerId: string,
): Promise<{ age: number | null; age_approximate: boolean }> {
  try {
    const { data } = await admin.rpc('project_customer_ages', { p_customer_ids: [customerId] })
    const row = (data ?? [])[0] as { age: number | null; is_approximate: boolean } | undefined
    return { age: row?.age ?? null, age_approximate: row?.is_approximate === true }
  } catch (e) {
    console.error('customer contact age resolve error:', e)
    return { age: null, age_approximate: false }
  }
}

/**
 * GET /api/customers/[id]/contact
 *
 * The read half of the single shared contact endpoint behind the self-contained
 * CustomerContactCard. The card fetches its OWN customer with just an id, so a
 * host no longer assembles the contact object, the name/age header, or the
 * texting facts by hand. It returns exactly the shape the card renders and the
 * PATCH half returns on a write, so initial display and post-write display are
 * identical:
 *
 *   - the durable customer-contact facts (name, email, phone, mailing address,
 *     the three *_verified_at timestamps, email_availability, contact_alert,
 *     and the durable Do Not Text opt-out sms_opt_out),
 *   - the resolved per-number `text_undeliverable` fact (Text Undeliverable),
 *   - the best-available-precision `age` / `age_approximate` (reused project age
 *     logic; age only, no DOB exposed).
 *
 * Same auth as the write (internal admin via service-role), same single
 * customers row, no new field, no workflow side effects. Age is derived, not
 * stored; `text_undeliverable` is resolved, not stored.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: customerId } = await params
  const supabase = createAdminClient()

  const { data: row, error: readErr } = await supabase
    .from('customers')
    .select(SELECT)
    .eq('id', customerId)
    .eq('is_test', false)
    .maybeSingle<CustomerContactRow>()
  if (readErr) {
    console.error('customer contact read error:', readErr)
    return Response.json({ error: readErr.message }, { status: 500 })
  }
  if (!row) {
    return Response.json({ error: 'Customer not found.' }, { status: 404 })
  }

  return respondWithContact(supabase, row)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: customerId } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const field = body.field
  if (
    field !== 'name' && field !== 'email' && field !== 'phone' && field !== 'address' &&
    field !== 'email_availability' && field !== 'alert' &&
    field !== 'sms' && field !== 'sms_undeliverable' && field !== 'contact'
  ) {
    return Response.json(
      { error: 'A field of contact, name, email, phone, address, email_availability, alert, sms, or sms_undeliverable is required.' },
      { status: 400 },
    )
  }

  // Load the current record first: edits compare against it to decide whether
  // verification must be cleared, and verify actions check the value is usable.
  const { data: before, error: readErr } = await supabase
    .from('customers')
    .select(SELECT)
    .eq('id', customerId)
    .eq('is_test', false)
    .maybeSingle<CustomerContactRow>()
  if (readErr) {
    console.error('customer contact read error:', readErr)
    return Response.json({ error: readErr.message }, { status: 500 })
  }
  if (!before) {
    return Response.json({ error: 'Customer not found.' }, { status: 404 })
  }

  // ── UNIFIED CONTACT UPDATE (one save, one history entry) ──────────────────
  // Body: { field: 'contact', ...only the changed facts }
  //   first_name?, last_name?        name components (string | null)
  //   email?                          active email (string | null)
  //   phone?                          phone number (string | null)
  //   street?, city?, state?, zip?    mailing address group (string | null)
  //   email_verified?, phone_verified?, address_verified?   verification (bool)
  //   email_availability?             'missing' | 'no_address' | 'undeliverable'
  //   do_not_text?                    Do Not Text opt-out (bool)
  //   mark_undeliverable?             record a text-delivery failure (bool)
  //   alert?                          customer alert (string | null)
  //
  // This is the shared card's ONE save. It applies every changed durable contact
  // fact in a SINGLE customers-row update, reusing the exact same normalization,
  // validation, and verification-clearing the per-field branches apply (so
  // invalid formatting cannot bypass the UI and an edited value still clears its
  // own verification), and records EXACTLY ONE "Customer Contact Updated"
  // case_touches 'workflow' history row naming each changed fact's prior -> new
  // value. A no-op (nothing changed) writes nothing and records no history. It
  // never touches workflow status — same as every other branch here.
  if (field === 'contact') {
    const str = (v: unknown): v is string => typeof v === 'string'
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

    const patch: Partial<CustomerContactRow> = {}
    let changed = false

    // ── Name (first, middle, last, suffix, goes-by, suffix-in-familiar) ──
    // The SAME centralized normalization and validation the form applies runs
    // here so invalid input cannot bypass the UI: capitalization and multi-word
    // names are preserved, nothing is inferred, and at least a first or last
    // name must remain. Save-only-changed per column; an omitted field keeps
    // its stored value. The suffix-in-familiar preference is accepted as
    // boolean|null (null = no preference / include).
    const nameTouched =
      has('first_name') || has('last_name') || has('middle_name') ||
      has('suffix') || has('goes_by') || has('suffix_in_familiar')
    if (nameTouched) {
      const rawPart = (key: string, stored: string | null): string | null => {
        const v = (body as Record<string, unknown>)[key]
        return has(key) ? (str(v) ? v : null) : stored
      }
      for (const key of ['first_name', 'last_name', 'middle_name', 'suffix', 'goes_by']) {
        const v = (body as Record<string, unknown>)[key]
        if (has(key) && v != null && !str(v)) {
          return Response.json({ error: `${key} must be a string or null.` }, { status: 400 })
        }
      }
      const rawPref = (body as Record<string, unknown>).suffix_in_familiar
      if (has('suffix_in_familiar') && rawPref != null && typeof rawPref !== 'boolean') {
        return Response.json({ error: 'suffix_in_familiar must be a boolean or null.' }, { status: 400 })
      }
      const result = validatePersonName({
        firstName: rawPart('first_name', before.first_name),
        middleName: rawPart('middle_name', before.middle_name),
        lastName: rawPart('last_name', before.last_name),
        suffix: rawPart('suffix', before.suffix),
        goesBy: rawPart('goes_by', before.goes_by),
        suffixInFamiliar: has('suffix_in_familiar')
          ? (rawPref as boolean | null)
          : (before.suffix_in_familiar ?? null),
      })
      if (result.status === 'invalid') {
        return Response.json({ error: result.reason }, { status: 400 })
      }
      const v = result.value
      // The familiar-suffix preference is only meaningful with a suffix on file.
      const nextPref = v.suffix ? v.suffixInFamiliar : null
      if ((v.firstName ?? null) !== (before.first_name ?? null)) { patch.first_name = v.firstName; changed = true }
      if ((v.lastName ?? null) !== (before.last_name ?? null)) { patch.last_name = v.lastName; changed = true }
      if ((v.middleName ?? null) !== (before.middle_name ?? null)) { patch.middle_name = v.middleName; changed = true }
      if ((v.suffix ?? null) !== (before.suffix ?? null)) { patch.suffix = v.suffix; changed = true }
      if ((v.goesBy ?? null) !== (before.goes_by ?? null)) { patch.goes_by = v.goesBy; changed = true }
      if ((nextPref ?? null) !== (before.suffix_in_familiar ?? null)) { patch.suffix_in_familiar = nextPref; changed = true }
    }

    // ── Date of birth (entered as separate month / day / year parts) ──
    // The card sends the three raw parts; the SAME normalization the form
    // applies runs here so invalid formatting cannot bypass the UI. An exact
    // date (all three parts) targets date_of_birth; a partial date (year, and
    // optionally month, with a blank day) targets date_of_birth_approx — the
    // two are mutually exclusive, so storing one clears the other and a known
    // exact DOB is never downgraded to a less precise value. An all-blank entry
    // is a valid clear (both columns null). The day is never fabricated or
    // stored on the approx column. Save-only-changed per column.
    if (has('dob_month') || has('dob_day') || has('dob_year')) {
      const partOf = (k: string): string => {
        const v = (body as Record<string, unknown>)[k]
        return typeof v === 'string' ? v : v == null ? '' : String(v)
      }
      const parts: DobParts = {
        month: has('dob_month') ? partOf('dob_month') : '',
        day: has('dob_day') ? partOf('dob_day') : '',
        year: has('dob_year') ? partOf('dob_year') : '',
      }
      const dob = normalizeDobParts(parts)
      if (dob.status === 'invalid') {
        return Response.json({ error: dob.reason }, { status: 400 })
      }
      // Never silently downgrade a known EXACT DOB to partial info: reject a
      // partial entry when the record already holds a full date. Correcting an
      // exact DOB (to another exact date) or clearing it entirely is allowed.
      if (wouldDowngradeExactDob(
        { date_of_birth: before.date_of_birth ?? null, date_of_birth_approx: before.date_of_birth_approx ?? null },
        dob,
      )) {
        return Response.json(
          { error: 'A full date of birth is already on file and cannot be replaced with a partial date. Enter the complete date, or clear it.' },
          { status: 400 },
        )
      }
      if ((dob.date_of_birth ?? null) !== (before.date_of_birth ?? null)) {
        patch.date_of_birth = dob.date_of_birth
        changed = true
      }
      if ((dob.date_of_birth_approx ?? null) !== (before.date_of_birth_approx ?? null)) {
        patch.date_of_birth_approx = dob.date_of_birth_approx
        changed = true
      }
    }

    // ── Email value + availability ──
    // Track the running email state so a usable email flips availability to
    // 'available' and a selected reason clears the address, exactly as the
    // single-field branches do.
    let nextEmail: string | null = before.email
    let emailVerifyCleared = false
    if (has('email')) {
      const r = normalizeEmailInput(str(body.email) ? (body.email as string) : null)
      if (r.status === 'invalid') {
        return Response.json({ error: r.reason ?? 'Invalid email address.' }, { status: 400 })
      }
      if ((r.value ?? null) !== (before.email ?? null)) {
        patch.email = r.value
        patch.email_verified_at = null
        emailVerifyCleared = true
        nextEmail = r.value ?? null
        changed = true
      }
      // Entering a usable email returns to the on-file state and clears a prior
      // No Usable Email / Undeliverable reason.
      if (r.value) {
        const clearable = before.email_availability === 'no_address' || before.email_availability === 'undeliverable'
        if ((clearable || before.email_availability == null) && before.email_availability !== 'available') {
          patch.email_availability = 'available'
          changed = true
        }
      }
    }
    // An explicit availability reason selection clears the active email and its
    // verification; 'missing' resets the fact to unknown (NULL).
    if (has('email_availability')) {
      const status = body.email_availability
      if (!isSelectableEmailAvailability(status)) {
        return Response.json(
          { error: 'email_availability must be one of: missing, no_address, undeliverable.' },
          { status: 400 },
        )
      }
      const storedValue: EmailAvailability | null = status === 'missing' ? null : status
      // The reason removes any active address from use.
      if ((before.email_availability ?? null) !== storedValue || before.email?.trim()) {
        patch.email_availability = storedValue
        patch.email = null
        patch.email_verified_at = null
        nextEmail = null
        emailVerifyCleared = true
        changed = true
      }
    }

    // ── Phone ──
    let nextPhone: string | null = before.phone
    let phoneVerifyCleared = false
    if (has('phone')) {
      const r = normalizePhoneInput(str(body.phone) ? (body.phone as string) : null)
      if (r.status === 'invalid') {
        return Response.json({ error: r.reason ?? 'Invalid phone number.' }, { status: 400 })
      }
      if ((r.value ?? null) !== (before.phone ?? null)) {
        patch.phone = r.value
        patch.phone_verified_at = null
        phoneVerifyCleared = true
        nextPhone = r.value ?? null
        changed = true
      }
    }

    // ── Mailing address (edited as one group) ──
    let addrVerifyCleared = false
    if (has('street') || has('city') || has('state') || has('zip')) {
      const beforeStreet = storedStreet(before)
      const street = has('street') ? cleanLine(body.street) : beforeStreet
      const city = has('city') ? cleanLine(body.city) : before.city
      const state = has('state') ? cleanState(body.state) : before.state
      const zip = has('zip') ? cleanLine(body.zip) : before.zip
      const addrChanged =
        (street ?? null) !== (beforeStreet ?? null) ||
        (city ?? null) !== (before.city ?? null) ||
        (state ?? null) !== (before.state ?? null) ||
        (zip ?? null) !== (before.zip ?? null)
      if (addrChanged) {
        patch.street = street
        patch.city = city
        patch.state = state
        patch.zip = zip
        patch.address_verified_at = null
        addrVerifyCleared = true
        changed = true
      }
    }

    // ── Verification (per field) ──
    // Verified reflects the value that will be on file after this save. A field
    // whose value changed in THIS request has its verification auto-cleared
    // above; an explicit verify request can still re-affirm it against the new
    // value. A missing/unusable value cannot be verified.
    const verifyOne = (
      key: 'email_verified' | 'phone_verified' | 'address_verified',
      col: 'email_verified_at' | 'phone_verified_at' | 'address_verified_at',
      usable: boolean,
      currentAt: string | null,
      autoCleared: boolean,
    ): Response | null => {
      if (!has(key)) return null
      const want = body[key]
      if (typeof want !== 'boolean') {
        return Response.json({ error: `${key} must be a boolean.` }, { status: 400 })
      }
      if (want && !usable) {
        return Response.json(
          { error: `There is no usable ${key.replace('_verified', '')} on file to mark as customer verified.` },
          { status: 400 },
        )
      }
      // The effective current timestamp after any auto-clear from a value edit.
      const effectiveAt = autoCleared ? null : currentAt
      const isVerified = !!effectiveAt
      if (want === isVerified) return null
      patch[col] = want ? new Date().toISOString() : null
      changed = true
      return null
    }
    const emailUsable = !!(nextEmail && nextEmail.trim())
    const phoneUsable = !!(nextPhone && nextPhone.trim())
    const nextStreet = patch.street !== undefined ? patch.street : storedStreet(before)
    const nextCity = patch.city !== undefined ? patch.city : before.city
    const nextState = patch.state !== undefined ? patch.state : before.state
    const nextZip = patch.zip !== undefined ? patch.zip : before.zip
    const addrUsable = addressUsable(nextStreet, nextCity, nextState, nextZip)
    const vEmail = verifyOne('email_verified', 'email_verified_at', emailUsable, before.email_verified_at, emailVerifyCleared)
    if (vEmail) return vEmail
    const vPhone = verifyOne('phone_verified', 'phone_verified_at', phoneUsable, before.phone_verified_at, phoneVerifyCleared)
    if (vPhone) return vPhone
    const vAddr = verifyOne('address_verified', 'address_verified_at', addrUsable, before.address_verified_at, addrVerifyCleared)
    if (vAddr) return vAddr

    // ── Do Not Text ──
    if (has('do_not_text')) {
      const want = body.do_not_text
      if (typeof want !== 'boolean') {
        return Response.json({ error: 'do_not_text must be a boolean.' }, { status: 400 })
      }
      if ((before.sms_opt_out ?? false) !== want) { patch.sms_opt_out = want; changed = true }
    }

    // ── Customer alert ──
    if (has('alert')) {
      const raw = body.alert
      if (raw != null && !str(raw)) {
        return Response.json({ error: 'alert must be a string or null.' }, { status: 400 })
      }
      const trimmed = str(raw) ? raw.trim() : ''
      const next: string | null = trimmed.length > 0 ? trimmed : null
      if ((before.contact_alert ?? null) !== next) { patch.contact_alert = next; changed = true }
    }

    // Resolve Text Undeliverable intent against the number that WILL be on file.
    // A delivery failure is recorded (never cleared here — replacing the number
    // clears it on its own), only when staged AND the resulting number is not
    // already undeliverable, matching the per-field semantics.
    const markUndeliverable = has('mark_undeliverable') && body.mark_undeliverable === true

    // The before/after text_undeliverable facts for the audit note. Before is the
    // current number's state; after accounts for a number change (which clears a
    // stale failure) and a newly staged failure.
    const beforeUndeliverable = await isTextUndeliverableForCurrentNumber(supabase, customerId, before.phone)
    const phoneChanged = (nextPhone ?? null) !== (before.phone ?? null)
    const undeliverableAfterPhone = phoneChanged ? false : beforeUndeliverable
    const willRecordUndeliverable = markUndeliverable && !undeliverableAfterPhone && !!nextPhone?.trim()
    const afterUndeliverable = undeliverableAfterPhone || willRecordUndeliverable

    // Nothing changed on the row, no new failure to record: a true no-op. Return
    // the current record unchanged and record NO history.
    if (!changed && !willRecordUndeliverable) {
      return respondWithContact(supabase, before)
    }

    let updated: CustomerContactRow = before
    if (changed) {
      const { data, error: updErr } = await supabase
        .from('customers')
        .update(patch)
        .eq('id', customerId)
        .eq('is_test', false)
        .select(SELECT)
        .maybeSingle<CustomerContactRow>()
      if (updErr) {
        console.error('customer contact unified update error:', updErr)
        return Response.json({ error: updErr.message }, { status: 500 })
      }
      if (!data) return Response.json({ error: 'Customer not found.' }, { status: 404 })
      updated = data
    }

    // Record a newly staged text-delivery failure for the number now on file.
    if (willRecordUndeliverable) {
      const touchedBy = await resolveEmployeeName(supabase)
      await recordTextUndeliverable(supabase, customerId, updated.phone, touchedBy)
    }

    // ── ONE history entry for the whole change, prior -> new preserved ──
    const snapshot = (row: CustomerContactRow, undeliverable: boolean): ContactSnapshot => ({
      first_name: row.first_name,
      last_name: row.last_name,
      middle_name: row.middle_name,
      suffix: row.suffix,
      goes_by: row.goes_by,
      suffix_in_familiar: row.suffix_in_familiar,
      email: row.email,
      phone: row.phone,
      street: storedStreet(row),
      city: row.city,
      state: row.state,
      zip: row.zip,
      email_verified_at: row.email_verified_at,
      phone_verified_at: row.phone_verified_at,
      address_verified_at: row.address_verified_at,
      email_availability: row.email_availability,
      sms_opt_out: row.sms_opt_out ?? false,
      date_of_birth: row.date_of_birth,
      date_of_birth_approx: row.date_of_birth_approx,
      text_undeliverable: undeliverable,
      contact_alert: row.contact_alert,
    })
    const note = buildContactUpdateHistoryNote(
      snapshot(before, beforeUndeliverable),
      snapshot(updated, afterUndeliverable),
    )
    if (note) {
      const touchedBy = await resolveEmployeeName(supabase)
      const { error: hErr } = await supabase.from('case_touches').insert({
        customer_id: customerId,
        case_id: null,
        touch_type: 'workflow',
        notes: note,
        touched_at: new Date().toISOString(),
        touched_by: touchedBy,
      })
      if (hErr) console.error('contact-update history record error:', hErr)
    }

    return respondWithContact(supabase, updated)
  }

  // ── CORRECT THE CUSTOMER NAME ─────────────────────────────────────────────
  // Body: { field: 'name', first_name, last_name, middle_name?, suffix?,
  //         goes_by?, suffix_in_familiar? }
  // Every recorded part is corrected IN PLACE on the customers row. The SAME
  // centralized normalization/validation the form applies runs here so invalid
  // input cannot bypass the UI: capitalization is preserved exactly as typed
  // (McAndrew, DeLuca), multiword names stay whole (La Bar, van der Berg), and
  // nothing is inferred. Save-only-changed: a field matching the stored value
  // is not rewritten. A request that would leave BOTH first and last empty is
  // rejected — a customer keeps at least one name component. The change
  // (prior -> new) is recorded once in Customer History, naming the full
  // recorded name (or the familiar name when only the goes-by/preference moved).
  if (field === 'name') {
    const b = body as Record<string, unknown>
    const str = (v: unknown): v is string => typeof v === 'string'
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k)
    const rawPart = (key: string, stored: string | null): string | null => {
      const v = b[key]
      return has(key) ? (str(v) ? v : null) : stored
    }
    for (const key of ['first_name', 'last_name', 'middle_name', 'suffix', 'goes_by']) {
      const v = b[key]
      if (has(key) && v != null && !str(v)) {
        return Response.json({ error: `${key} must be a string or null.` }, { status: 400 })
      }
    }
    const rawPref = b.suffix_in_familiar
    if (has('suffix_in_familiar') && rawPref != null && typeof rawPref !== 'boolean') {
      return Response.json({ error: 'suffix_in_familiar must be a boolean or null.' }, { status: 400 })
    }

    const result = validatePersonName({
      firstName: rawPart('first_name', before.first_name),
      middleName: rawPart('middle_name', before.middle_name),
      lastName: rawPart('last_name', before.last_name),
      suffix: rawPart('suffix', before.suffix),
      goesBy: rawPart('goes_by', before.goes_by),
      suffixInFamiliar: has('suffix_in_familiar')
        ? (rawPref as boolean | null)
        : (before.suffix_in_familiar ?? null),
    })
    if (result.status === 'invalid') {
      return Response.json({ error: result.reason }, { status: 400 })
    }
    const v = result.value
    // The familiar-suffix preference is only meaningful when a suffix is on file.
    const nextPref = v.suffix ? v.suffixInFamiliar : null

    const patch: Partial<CustomerContactRow> = {}
    if ((v.firstName ?? null) !== (before.first_name ?? null)) patch.first_name = v.firstName
    if ((v.lastName ?? null) !== (before.last_name ?? null)) patch.last_name = v.lastName
    if ((v.middleName ?? null) !== (before.middle_name ?? null)) patch.middle_name = v.middleName
    if ((v.suffix ?? null) !== (before.suffix ?? null)) patch.suffix = v.suffix
    if ((v.goesBy ?? null) !== (before.goes_by ?? null)) patch.goes_by = v.goesBy
    if ((nextPref ?? null) !== (before.suffix_in_familiar ?? null)) patch.suffix_in_familiar = nextPref

    // Nothing actually changed: return the current record unchanged.
    if (Object.keys(patch).length === 0) {
      return respondWithContact(supabase, before)
    }

    const { data: updated, error: nErr } = await supabase
      .from('customers')
      .update(patch)
      .eq('id', customerId)
      .eq('is_test', false)
      .select(SELECT)
      .maybeSingle<CustomerContactRow>()
    if (nErr) {
      console.error('customer name update error:', nErr)
      return Response.json({ error: nErr.message }, { status: 500 })
    }
    if (!updated) return Response.json({ error: 'Customer not found.' }, { status: 404 })

    // Record the correction (prior -> new) once in Customer History, reusing the
    // shared contact-update note builder so every name part is captured.
    const nameSnapshot = (row: CustomerContactRow): ContactSnapshot => ({
      first_name: row.first_name,
      last_name: row.last_name,
      middle_name: row.middle_name,
      suffix: row.suffix,
      goes_by: row.goes_by,
      suffix_in_familiar: row.suffix_in_familiar,
      email: row.email,
      phone: row.phone,
      street: storedStreet(row),
      city: row.city,
      state: row.state,
      zip: row.zip,
      email_verified_at: row.email_verified_at,
      phone_verified_at: row.phone_verified_at,
      address_verified_at: row.address_verified_at,
      email_availability: row.email_availability,
      sms_opt_out: row.sms_opt_out ?? false,
      date_of_birth: row.date_of_birth,
      date_of_birth_approx: row.date_of_birth_approx,
      text_undeliverable: false,
      contact_alert: row.contact_alert,
    })
    const note = buildContactUpdateHistoryNote(nameSnapshot(before), nameSnapshot(updated))
    if (note) {
      const touchedBy = await resolveEmployeeName(supabase)
      const { error: hErr } = await supabase.from('case_touches').insert({
        customer_id: customerId,
        case_id: null,
        touch_type: 'workflow',
        notes: note,
        touched_at: new Date().toISOString(),
        touched_by: touchedBy,
      })
      if (hErr) console.error('name-change history record error:', hErr)
    }
    return respondWithContact(supabase, updated)
  }

  // ── SET / CLEAR THE CUSTOMER ALERT ────────────────────────────────────────
  // Body: { field: 'alert', alert: string | null }
  // One short free-text alert per customer, shown at the top of the shared card
  // wherever it renders. Trimmed; an empty/whitespace value clears it (NULL).
  // No categories, priorities, expiration, or workflow side effects — it writes
  // exactly the one customers.contact_alert column.
  if (field === 'alert') {
    const raw = body.alert
    if (raw != null && typeof raw !== 'string') {
      return Response.json({ error: 'alert must be a string or null.' }, { status: 400 })
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    const next: string | null = trimmed.length > 0 ? trimmed : null

    // Save-only-changed: a no-op returns the current record unchanged.
    if ((before.contact_alert ?? null) === next) {
      return respondWithContact(supabase, before)
    }

    const { data: updated, error: aErr } = await supabase
      .from('customers')
      .update({ contact_alert: next })
      .eq('id', customerId)
      .eq('is_test', false)
      .select(SELECT)
      .maybeSingle<CustomerContactRow>()
    if (aErr) {
      console.error('customer alert update error:', aErr)
      return Response.json({ error: aErr.message }, { status: 500 })
    }
    if (!updated) return Response.json({ error: 'Customer not found.' }, { status: 404 })
    return respondWithContact(supabase, updated)
  }

  // ── SET EMAIL AVAILABILITY ────────────────────────────────────────────────
  // Record the email-availability fact as an informational durable customer
  // fact. Body:
  //   { field: 'email_availability', availability: 'missing' | 'no_address' | 'undeliverable' }
  // 'missing' resets the fact to unknown (the stored column back to NULL); the
  // two reasons store their value.
  // 'available' is never set here — it is set by the system when a usable
  // address is saved (the email SAVE path below). The change is save-only-
  // changed: when the stored status already matches, nothing is written and no
  // history entry is created, so there is never a duplicate entry. For
  // 'undeliverable' the current address is REMOVED from active use (email ->
  // null, verification cleared) but PRESERVED in Customer History by naming it
  // in the recorded note. This is informational only: it never suppresses
  // research, routes a queue, closes a case, stops servicing, or removes the
  // customer from a project. An employee can change it or enter an email at any
  // time.
  if (field === 'email_availability') {
    const status = body.availability
    if (!isSelectableEmailAvailability(status)) {
      return Response.json(
        { error: 'availability must be one of: missing, no_address, undeliverable.' },
        { status: 400 },
      )
    }

    // The value written to the durable column. 'missing' RESETS the fact to
    // unknown (NULL); the two reasons store their own value. Either way the
    // active email and its verification are cleared, so the card reads the
    // chosen state, not a lingering address.
    const storedValue: EmailAvailability | null = status === 'missing' ? null : status

    // Save-only-changed: a repeat of the same stored state with no address left
    // to clear is a no-op (no duplicate history); when an address still lingers
    // the clear happens even if the stored value is unchanged.
    const priorEmail = before.email?.trim() ? before.email : null
    const statusChanged = (before.email_availability ?? null) !== storedValue
    const retiringAddress = !!priorEmail
    if (!statusChanged && !retiringAddress) {
      return respondWithContact(supabase, before)
    }

    // The address leaves active use; its value is preserved in the history note
    // recorded below. Verification cannot outlive the address.
    const patch: Partial<CustomerContactRow> = {
      email_availability: storedValue,
      email: null,
      email_verified_at: null,
    }

    const { data: updated, error: updErr } = await supabase
      .from('customers')
      .update(patch)
      .eq('id', customerId)
      .eq('is_test', false)
      .select(SELECT)
      .maybeSingle<CustomerContactRow>()
    if (updErr) {
      console.error('customer email-availability update error:', updErr)
      return Response.json({ error: updErr.message }, { status: 500 })
    }
    if (!updated) return Response.json({ error: 'Customer not found.' }, { status: 404 })

    // One history entry for the meaningful change, with the acting employee and
    // timestamp. The prior address is named so Undeliverable preserves it.
    await recordEmailAvailabilityHistory(supabase, customerId, status, priorEmail)
    return respondWithContact(supabase, updated)
  }

  // ── SET / CLEAR DO NOT TEXT ───────────────────────────────────────────────
  // Body: { field: 'sms', do_not_text: boolean }
  // Sets or clears the durable customer-level texting opt-out
  // (customers.sms_opt_out). Do Not Text disables texting ONLY — telephone calls
  // are never affected — and follows the CUSTOMER regardless of the phone number
  // (it is not scoped to a number), so it persists across a number change until
  // an operator deliberately clears it. Save-only-changed: a no-op returns the
  // record unchanged. Reuses the existing sms_opt_out field; it is NOT a new
  // texting system.
  if (field === 'sms') {
    const raw = body.do_not_text
    if (typeof raw !== 'boolean') {
      return Response.json({ error: 'do_not_text must be a boolean.' }, { status: 400 })
    }
    if ((before.sms_opt_out ?? false) === raw) {
      return respondWithContact(supabase, before)
    }
    const { data: updated, error: sErr } = await supabase
      .from('customers')
      .update({ sms_opt_out: raw })
      .eq('id', customerId)
      .eq('is_test', false)
      .select(SELECT)
      .maybeSingle<CustomerContactRow>()
    if (sErr) {
      console.error('customer sms_opt_out update error:', sErr)
      return Response.json({ error: sErr.message }, { status: 500 })
    }
    if (!updated) return Response.json({ error: 'Customer not found.' }, { status: 404 })
    return respondWithContact(supabase, updated)
  }

  // ── RECORD TEXT UNDELIVERABLE ─────────────────────────────────────────────
  // Body: { field: 'sms_undeliverable' }
  // Records a text-DELIVERY FAILURE for the number CURRENTLY on file, reusing
  // the existing value-scoped unusable mechanism (a case_touches text row
  // carrying [channel-unusable:<digits>]). Because the failure is scoped to the
  // failed number's digits, replacing the number restores text availability on
  // its own; this never touches calling. An ordinary unsent text is NOT a
  // failure, so this is a deliberate action and requires a number on file. The
  // customer row is unchanged (the failure lives in history); the response
  // re-resolves text_undeliverable from the recorded fact.
  if (field === 'sms_undeliverable') {
    if (!before.phone?.trim()) {
      return Response.json({ error: 'There is no phone number on file to mark undeliverable.' }, { status: 400 })
    }
    const touchedBy = await resolveEmployeeName(supabase)
    const ok = await recordTextUndeliverable(supabase, customerId, before.phone, touchedBy)
    if (!ok) {
      return Response.json({ error: 'Could not record the text delivery failure.' }, { status: 500 })
    }
    return respondWithContact(supabase, before)
  }

  // ── VERIFY a field ──────────────────────────────────────────────────────
  if (typeof body.verified === 'boolean') {
    const verifiedCol = VERIFIED_COLUMN[field]

    if (body.verified) {
      // A missing or unusable value cannot be marked verified — there is nothing
      // to confirm. Guarded here as well as in the UI so it cannot be bypassed.
      const usable =
        field === 'email' ? !!before.email?.trim()
        : field === 'phone' ? !!before.phone?.trim()
        : addressUsable(storedStreet(before), before.city, before.state, before.zip)
      if (!usable) {
        return Response.json(
          { error: `There is no usable ${field} on file to mark as customer verified.` },
          { status: 400 },
        )
      }
    }

    const ts = body.verified ? new Date().toISOString() : null
    const { data: updated, error: vErr } = await supabase
      .from('customers')
      .update({ [verifiedCol]: ts })
      .eq('id', customerId)
      .eq('is_test', false)
      .select(SELECT)
      .maybeSingle<CustomerContactRow>()
    if (vErr) {
      console.error('customer contact verify error:', vErr)
      return Response.json({ error: vErr.message }, { status: 500 })
    }
    if (!updated) return Response.json({ error: 'Customer not found.' }, { status: 404 })
    return respondWithContact(supabase, updated)
  }

  // ── SAVE a field (or the address group) ───────────────────────────────────
  const patch: Partial<CustomerContactRow> = {}
  let changed = false

  // When a usable replacement email is saved, the availability transitions to
  // 'available' and any prior No Email Address / Undeliverable designation is
  // cleared on its own — a found address makes those moot. An Email Refused is
  // NOT cleared by entering an address: a refusal is reversed only by explicit
  // action, so it persists until then. Tracked so one history entry records the
  // transition to available.
  let availabilityBecameAvailable = false

  if (field === 'email') {
    const r = normalizeEmailInput(typeof body.email === 'string' ? body.email : null)
    if (r.status === 'invalid') {
      return Response.json({ error: r.reason ?? 'Invalid email address.' }, { status: 400 })
    }
    if ((r.value ?? null) !== (before.email ?? null)) {
      patch.email = r.value
      // Editing the value clears its prior customer verification.
      patch.email_verified_at = null
      changed = true
    }
    // Entering a usable email returns the card to the normal email-on-file
    // state: it sets the status to 'available' and clears a prior No Usable
    // Email / Undeliverable reason. Applied whenever a usable value is now on
    // file and the stored status is a reason state (or unset).
    const hasUsable = !!r.value
    const clearable = before.email_availability === 'no_address' || before.email_availability === 'undeliverable'
    if (hasUsable && (clearable || before.email_availability == null)) {
      if (before.email_availability !== 'available') {
        patch.email_availability = 'available'
        availabilityBecameAvailable = clearable // only a real transition from a terminal reason is history-worthy
        changed = true
      }
    }
  } else if (field === 'phone') {
    const r = normalizePhoneInput(typeof body.phone === 'string' ? body.phone : null)
    if (r.status === 'invalid') {
      return Response.json({ error: r.reason ?? 'Invalid phone number.' }, { status: 400 })
    }
    if ((r.value ?? null) !== (before.phone ?? null)) {
      patch.phone = r.value
      patch.phone_verified_at = null
      changed = true
    }
  } else {
    // Address is edited as one group: street, city, state, ZIP.
    const street = cleanLine(body.street)
    const city = cleanLine(body.city)
    const state = cleanState(body.state)
    const zip = cleanLine(body.zip)

    // Storage convention: the mailing street lives in `street`. We write street
    // there and leave address_line1 untouched (empty in practice), matching the
    // app-wide read that prefers street and falls back to address_line1.
    const beforeStreet = storedStreet(before)
    const addrChanged =
      (street ?? null) !== (beforeStreet ?? null) ||
      (city ?? null) !== (before.city ?? null) ||
      (state ?? null) !== (before.state ?? null) ||
      (zip ?? null) !== (before.zip ?? null)

    if (addrChanged) {
      patch.street = street
      patch.city = city
      patch.state = state
      patch.zip = zip
      patch.address_verified_at = null
      changed = true
    }
  }

  if (!changed) {
    // Nothing actually changed: return the current record unchanged so the UI
    // can refresh from the authoritative row without a special case.
    return respondWithContact(supabase, before)
  }

  const { data: updated, error: updErr } = await supabase
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .eq('is_test', false)
    .select(SELECT)
    .maybeSingle<CustomerContactRow>()
  if (updErr) {
    console.error('customer contact update error:', updErr)
    return Response.json({ error: updErr.message }, { status: 500 })
  }
  if (!updated) return Response.json({ error: 'Customer not found.' }, { status: 404 })

  // A saved replacement address that cleared a prior No Email Address /
  // Undeliverable designation is a meaningful availability change: record it
  // once in Customer History with the acting employee and timestamp, naming the
  // now-usable address. (Only a real transition from a terminal reason is logged
  // — a first-time address on a Missing customer is an ordinary email edit.)
  if (availabilityBecameAvailable) {
    await recordEmailAvailabilityHistory(supabase, customerId, 'available', updated.email)
  }

  return respondWithContact(supabase, updated)
}
