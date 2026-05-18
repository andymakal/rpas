import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const ALLOWED_FIELDS = new Set([
  'name',
  'carrier_id',
  'product_type_id',
  'gdc_multiplier',
  'is_active',
  'notes',
])

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
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) updates[key] = val
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
