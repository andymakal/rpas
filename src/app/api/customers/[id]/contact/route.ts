import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { normalizeEmailInput, normalizePhoneInput } from '@/lib/contact-input'

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
 * Verification and editing are independent operations; the same card drives
 * both, but a single request does one or the other.
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
}

const SELECT =
  'id, first_name, last_name, email, phone, street, address_line1, city, state, zip, ' +
  'email_verified_at, phone_verified_at, address_verified_at'

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
  if (field !== 'email' && field !== 'phone' && field !== 'address') {
    return Response.json({ error: 'A field of email, phone, or address is required.' }, { status: 400 })
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
  return Response.json({ data: updated })
}
