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

// PATCH — toggle resolved/outstanding on an existing requirement
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { pending_requirement_id?: string; resolved?: boolean }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { pending_requirement_id, resolved } = body
  if (!pending_requirement_id || typeof resolved !== 'boolean') {
    return Response.json(
      { error: 'pending_requirement_id and resolved (boolean) are required' },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('case_pending_requirements')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
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
