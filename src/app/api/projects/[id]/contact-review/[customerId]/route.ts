import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import { normalizeEmailInput, normalizePhoneInput } from '@/lib/contact-input'
import { buildResearchTouchRows, contactMethodsStillMissing } from '@/lib/stewardship/research-record'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Resolve the signed-in employee's display name for the research record,
 * mirroring the stewardship route: prefer staff_profiles.display_name, fall back
 * to the email local-part. Attribution is best-effort and never blocks the save.
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
 * PATCH /api/projects/[id]/contact-review/[customerId]
 *
 * Save the outcome of Contact Review for ONE project customer. Two outcomes:
 *
 * FOUND — Body: { email?: string | null, phone?: string | null }
 *   Email and phone are updated INDEPENDENTLY and only when explicitly provided:
 *   a field absent from the body is left exactly as it was, so existing
 *   information is preserved unless the worker actually changed it.
 *   - A present string sets/overwrites that field (trimmed; empty string clears
 *     it to NULL). A CHANGED value also clears that field's prior customer
 *     verification (*_verified_at -> null), the same contract the shared
 *     CustomerContactCard route applies.
 *   - An omitted or unchanged field is not written at all.
 *
 * NOT FOUND — Body: { research_nothing_found: true }
 *   Records, PER STILL-MISSING METHOD, that contact research was completed with
 *   nothing usable found (who + when), as an ordinary case_touches row with a
 *   stable marker — the SAME durable fact the Stewardship "Nothing usable yet"
 *   action records. This is what lets Contact Review stop re-presenting the
 *   customer on every pass instead of only hiding them for the session. It is
 *   NOT a close: the customer keeps project membership, history, and every
 *   contact method; a method that later gets a value re-opens the recommendation
 *   on its own. A method already on file is never recorded (presence makes it
 *   moot). If both methods are already present, this is a no-op.
 *
 * A body with none of these fields is a 400. The FOUND path writes only the
 * customers row; the NOT FOUND path writes only a case_touches history row.
 * Neither touches stewardship_outreach, customer_prereviews, or any workflow
 * status — Contact Review corrects the durable contact facts in place and
 * records its research outcome, nothing else.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params
  const supabase = createAdminClient()

  // Archived projects are read-only; the same guard every project write uses.
  const active = await assertProjectActive(supabase, projectId)
  if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

  let body: { email?: string | null; phone?: string | null; research_nothing_found?: boolean }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // NOT-FOUND outcome: record unsuccessful research for the still-missing
  // methods and return. Membership is enforced first so this can only record
  // against a customer in THIS project. Checked before the found-field patch so
  // the two outcomes never mix in one request.
  if (body.research_nothing_found === true) {
    const { data: member } = await supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', projectId)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (!member) {
      return Response.json({ error: 'Customer is not in this project.' }, { status: 404 })
    }

    const { data: cust, error: custReadErr } = await supabase
      .from('customers')
      .select('id, email, phone')
      .eq('id', customerId)
      .eq('is_test', false)
      .maybeSingle()
    if (custReadErr) {
      console.error('contact-review research read error:', custReadErr)
      return Response.json({ error: custReadErr.message }, { status: 500 })
    }
    if (!cust) {
      return Response.json({ error: 'Customer not found.' }, { status: 404 })
    }

    const missing = contactMethodsStillMissing({ email: cust.email, phone: cust.phone })
    // Both methods already present: nothing to research, nothing to record.
    if (missing.length === 0) {
      return Response.json({ data: { customer_id: customerId, recorded: [] } })
    }

    const touchedBy = await resolveEmployeeName(supabase)
    const rows = buildResearchTouchRows(customerId, missing, touchedBy)
    const { error: insErr } = await supabase.from('case_touches').insert(rows)
    if (insErr) {
      console.error('contact-review research record error:', insErr)
      return Response.json({ error: 'Could not record the research outcome; please try again.' }, { status: 500 })
    }
    return Response.json({ data: { customer_id: customerId, recorded: missing } })
  }

  // Build a field-level patch of ONLY the fields explicitly present. An omitted
  // field is never written, so the stored value is preserved untouched.
  //
  // Each present field is run through the shared contact-input normalization so
  // the rules the form applies are enforced here too and invalid formatting
  // cannot bypass the UI. An empty value clears the field to NULL; an invalid
  // value (e.g. a phone that is not an unambiguous 10 US digits) is rejected
  // with 400 and nothing is written.
  const patch: {
    email?: string | null; phone?: string | null
    email_verified_at?: null; phone_verified_at?: null
  } = {}
  const wantEmail = Object.prototype.hasOwnProperty.call(body, 'email')
  const wantPhone = Object.prototype.hasOwnProperty.call(body, 'phone')
  let emailValue: string | null = null
  let phoneValue: string | null = null
  if (wantEmail) {
    const r = normalizeEmailInput(typeof body.email === 'string' ? body.email : null)
    if (r.status === 'invalid') {
      return Response.json({ error: r.reason ?? 'Invalid email address.' }, { status: 400 })
    }
    emailValue = r.value // valid canonical value, or null when empty
  }
  if (wantPhone) {
    const r = normalizePhoneInput(typeof body.phone === 'string' ? body.phone : null)
    if (r.status === 'invalid') {
      return Response.json({ error: r.reason ?? 'Invalid phone number.' }, { status: 400 })
    }
    phoneValue = r.value // valid canonical value, or null when empty
  }

  if (!wantEmail && !wantPhone) {
    return Response.json({ error: 'Provide email and/or phone to save' }, { status: 400 })
  }

  // The customer must belong to THIS project (membership = project_customers),
  // so Contact Review can only correct a customer in the project it is scoped
  // to. This also guards against a stray customerId writing an unrelated record.
  const { data: member } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!member) {
    return Response.json({ error: 'Customer is not in this project.' }, { status: 404 })
  }

  // Read the current values so we only write a field that actually changed, and
  // so a change can clear that field's prior customer-verification — the same
  // contract the shared CustomerContactCard route applies. A value the customer
  // confirmed is no longer the confirmed value once it is edited, so its
  // *_verified_at is reset to null in the same write.
  const { data: before, error: beforeErr } = await supabase
    .from('customers')
    .select('id, email, phone')
    .eq('id', customerId)
    .eq('is_test', false)
    .maybeSingle<{ id: string; email: string | null; phone: string | null }>()
  if (beforeErr) {
    console.error('contact-review customer read error:', beforeErr)
    return Response.json({ error: beforeErr.message }, { status: 500 })
  }
  if (!before) {
    return Response.json({ error: 'Customer not found.' }, { status: 404 })
  }

  if (wantEmail && (emailValue ?? null) !== (before.email ?? null)) {
    patch.email = emailValue
    patch.email_verified_at = null
  }
  if (wantPhone && (phoneValue ?? null) !== (before.phone ?? null)) {
    patch.phone = phoneValue
    patch.phone_verified_at = null
  }

  // Nothing actually changed: return the current record (including the verified
  // columns) so the caller can refresh without a special case.
  if (Object.keys(patch).length === 0) {
    const { data: current } = await supabase
      .from('customers')
      .select('id, first_name, last_name, email, phone, email_verified_at, phone_verified_at, address_verified_at')
      .eq('id', customerId)
      .eq('is_test', false)
      .maybeSingle()
    return Response.json({ data: current })
  }

  const { data: updated, error: updErr } = await supabase
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .eq('is_test', false)
    .select('id, first_name, last_name, email, phone, email_verified_at, phone_verified_at, address_verified_at')
    .maybeSingle()
  if (updErr) {
    console.error('contact-review customer update error:', updErr)
    return Response.json({ error: updErr.message }, { status: 500 })
  }
  if (!updated) {
    return Response.json({ error: 'Customer not found.' }, { status: 404 })
  }

  return Response.json({ data: updated })
}
