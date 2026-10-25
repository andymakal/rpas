import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { normalizeEmailInput, normalizePhoneInput } from '@/lib/contact-input'
import {
  type EmailAvailability,
  type SelectableEmailAvailability,
  EMAIL_AVAILABILITY_LABEL,
  isSelectableEmailAvailability,
} from '@/lib/email-availability'

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
}

const SELECT =
  'id, first_name, last_name, email, phone, street, address_line1, city, state, zip, ' +
  'email_verified_at, phone_verified_at, address_verified_at, email_availability'

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
  if (field !== 'email' && field !== 'phone' && field !== 'address' && field !== 'email_availability') {
    return Response.json(
      { error: 'A field of email, phone, address, or email_availability is required.' },
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
      return Response.json({ data: before })
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
    return Response.json({ data: updated })
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
    return Response.json({ data: updated })
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
    return Response.json({ data: before })
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

  return Response.json({ data: updated })
}
