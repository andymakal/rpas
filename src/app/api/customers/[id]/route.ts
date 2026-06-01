import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { normalizeStreet, normalizeCity, normalizeState, normalizePhone } from '@/lib/fmt'

const ALLOWED = new Set([
  'first_name', 'last_name', 'phone', 'email',
  'street', 'city', 'state', 'zip',
  'date_of_birth', 'marital_status', 'gender',
  'tobacco_use', 'height_ft', 'height_in', 'weight_lbs', 'health_notes',
  'spanish_speaking', 'customer_group_id',
])

const NAME_FIELDS   = new Set(['first_name', 'last_name'])
const PHONE_FIELDS  = new Set(['phone'])
const STREET_FIELDS = new Set(['street'])
const CITY_FIELDS   = new Set(['city'])
const STATE_FIELDS  = new Set(['state'])

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
    if (typeof v === 'string') {
      if (NAME_FIELDS.has(k))   { updates[k] = toTitleCase(v);            continue }
      if (PHONE_FIELDS.has(k))  { updates[k] = normalizePhone(v)  ?? v;  continue }
      if (STREET_FIELDS.has(k)) { updates[k] = normalizeStreet(v) ?? v;  continue }
      if (CITY_FIELDS.has(k))   { updates[k] = normalizeCity(v)   ?? v;  continue }
      if (STATE_FIELDS.has(k))  { updates[k] = normalizeState(v)  ?? v;  continue }
    }
    updates[k] = v
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
