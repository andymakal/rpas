import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const ALLOWED = new Set([
  'first_name', 'last_name', 'email', 'phone',
  'title', 'allstate_id', 'npn', 'sub_producer_code',
  'birthday', 'is_active',
])

// PATCH — update producer profile fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) updates[k] = v
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('producers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ producer: data })
}
