import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/service-requests/[id]
 * Update workflow_status, notes, date_resolved, or request_type on a service request.
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

  const allowed = ['workflow_status', 'request_type', 'notes', 'date_received', 'date_resolved']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('service_requests')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('service_request patch error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
