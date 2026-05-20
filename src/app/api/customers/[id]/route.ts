import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const ALLOWED = new Set([
  'first_name', 'last_name', 'phone', 'email',
  'street', 'city', 'state', 'zip',
  'date_of_birth', 'marital_status', 'gender',
  'tobacco_use', 'height_ft', 'height_in', 'weight_lbs', 'health_notes',
  'spanish_speaking',
])

const NAME_FIELDS = new Set(['first_name', 'last_name'])

function toTitleCase(str: string): string {
  return str.trim().replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

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

  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) continue
    updates[k] = NAME_FIELDS.has(k) && typeof v === 'string' ? toTitleCase(v) : v
  }

  if (!Object.keys(updates).length) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Customer update error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
