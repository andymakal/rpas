import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const ALLOWED = new Set([
  'first_name', 'last_name', 'date_of_birth',
  'gender', 'tobacco_use', 'height_ft', 'height_in', 'weight_lbs', 'health_notes',
  'quoted_carrier', 'quoted_product_type', 'face_amount',
  'linked_case_id',
])

/**
 * PATCH  /api/cases/[id]/household-members/[memberId]  — update member fields
 * DELETE /api/cases/[id]/household-members/[memberId]  — remove member
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id, memberId } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) updates[k] = v
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Verify the member belongs to the specified case
  const { data, error } = await supabase
    .from('case_household_members')
    .update(updates)
    .eq('id', memberId)
    .eq('case_id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ error: 'Member not found' }, { status: 404 })
  return Response.json({ data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id, memberId } = await params
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('case_household_members')
    .delete()
    .eq('id', memberId)
    .eq('case_id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
