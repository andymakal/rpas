import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/policy-reviews/[id]
 *
 * Updates a policy review record.  Used for:
 *   - Assigning to a producer
 *   - Logging outcome after the call
 *   - Updating tobacco answers
 *   - Saving prep notes
 *   - Confirming beneficiary
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [
    'assigned_to',
    'status',
    'outcome',
    'tobacco_asked',
    'still_using_tobacco',
    'tobacco_product',
    'primary_beneficiary_confirmed',
    'call_completed_at',
    'prep_notes',
    'pdf_url',
    'resulting_case_id',
  ]

  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Auto-stamp call_completed_at when outcome is being set for the first time
  if (patch.outcome && patch.outcome !== 'no_contact' && !patch.call_completed_at) {
    patch.call_completed_at = new Date().toISOString()
  }

  // Auto-advance status to 'complete' if outcome is set
  if (patch.outcome && !patch.status) {
    patch.status = patch.outcome === 'no_contact' ? 'no_contact' : 'complete'
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('policy_reviews')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('policy_review patch error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}

/**
 * DELETE /api/policy-reviews/[id]
 *
 * Permanently removes a policy review record.
 * The associated service_policy is NOT deleted — only the review row.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('policy_reviews')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('policy_review delete error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
