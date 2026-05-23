import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// POST — flag a requirement as outstanding (creates the junction row)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { pending_requirement_id: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.pending_requirement_id) {
    return Response.json({ error: 'pending_requirement_id required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('case_pending_requirements')
    .upsert(
      { case_id: id, pending_requirement_id: body.pending_requirement_id, resolved_at: null },
      { onConflict: 'case_id,pending_requirement_id' }
    )

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}

// PATCH — resolve/unresolve OR update date fields on a requirement
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: {
    pending_requirement_id?: string
    resolved?: boolean
    ordered_at?: string | null
    scheduled_at?: string | null
    completed_at?: string | null
  }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { pending_requirement_id } = body
  if (!pending_requirement_id) {
    return Response.json({ error: 'pending_requirement_id is required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (typeof body.resolved === 'boolean') {
    updates.resolved_at = body.resolved ? new Date().toISOString() : null
  }
  if ('ordered_at'   in body) updates.ordered_at   = body.ordered_at   ?? null
  if ('scheduled_at' in body) updates.scheduled_at = body.scheduled_at ?? null
  if ('completed_at' in body) updates.completed_at = body.completed_at ?? null

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('case_pending_requirements')
    .update(updates)
    .eq('case_id', id)
    .eq('pending_requirement_id', pending_requirement_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}

// DELETE — clear a requirement from this case entirely
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { pending_requirement_id: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.pending_requirement_id) {
    return Response.json({ error: 'pending_requirement_id required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('case_pending_requirements')
    .delete()
    .eq('case_id', id)
    .eq('pending_requirement_id', body.pending_requirement_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
