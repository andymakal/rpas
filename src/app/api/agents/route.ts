import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { normalizeEmail } from '@/lib/fmt'

// POST — create a new agent for an agency
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: { first_name?: string; last_name?: string; email?: string | null; agency_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.first_name?.trim() || !body.last_name?.trim()) {
    return Response.json({ error: 'First and last name are required' }, { status: 400 })
  }

  if (!body.agency_id) {
    return Response.json({ error: 'Agency ID is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('agents')
    .insert({
      agency_id:  body.agency_id,
      first_name: body.first_name.trim(),
      last_name:  body.last_name.trim(),
      email:      normalizeEmail(body.email) ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('Agent create error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data }, { status: 201 })
}
