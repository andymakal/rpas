import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'

/**
 * PATCH /api/projects/[id]/contact-review/[customerId]
 *
 * Save corrected contact information for ONE project customer during Contact
 * Review. Email and phone are updated INDEPENDENTLY and only when explicitly
 * provided: a field absent from the body is left exactly as it was, so existing
 * information is preserved unless the worker actually changed it.
 *
 * Body: { email?: string | null, phone?: string | null }
 *   - A present string sets/overwrites that field (trimmed; empty string clears
 *     it to NULL).
 *   - An omitted field is not written at all.
 *   - A body with neither field present is a no-op (the "Nothing Usable & Next"
 *     action does not call this route; it simply advances the client).
 *
 * This writes ONLY to the customers row. It never creates a customer, never
 * creates a separate contact record, and never touches stewardship_outreach,
 * customer_prereviews, or any workflow status — Contact Review corrects the
 * durable contact facts in place and nothing else.
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

  let body: { email?: string | null; phone?: string | null }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Build a field-level patch of ONLY the fields explicitly present. An omitted
  // field is never written, so the stored value is preserved untouched.
  const patch: { email?: string | null; phone?: string | null } = {}
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const v = typeof body.email === 'string' ? body.email.trim() : body.email
    patch.email = v ? v : null
  }
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const v = typeof body.phone === 'string' ? body.phone.trim() : body.phone
    patch.phone = v ? v : null
  }

  if (Object.keys(patch).length === 0) {
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

  const { data: updated, error: updErr } = await supabase
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .eq('is_test', false)
    .select('id, first_name, last_name, email, phone')
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
