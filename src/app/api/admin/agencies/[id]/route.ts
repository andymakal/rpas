import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

const ALLOWED_FIELDS = new Set([
  'display_name', 'sml_team_id', 'is_active',
  'agent_number', 'contact_phone', 'contact_email',
  'contact_street', 'contact_city', 'contact_state', 'contact_zip',
  'portal_pin',
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

  // If a portal_pin is being set, ensure the agency has a dashboard_token.
  // The token is the secret stored in the cookie after login — without it the
  // PIN auth loop never resolves.
  if ('portal_pin' in updates && updates.portal_pin) {
    const { data: existing } = await supabase
      .from('agencies')
      .select('dashboard_token')
      .eq('id', id)
      .single()
    if (!existing?.dashboard_token) {
      updates.dashboard_token = crypto.randomUUID()
    }
  }

  const { data, error } = await supabase
    .from('agencies')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
