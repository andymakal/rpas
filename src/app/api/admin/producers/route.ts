import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// POST — create a producer record for an existing auth user (pre-migration users)
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.auth_user_id || !body.first_name) {
    return Response.json({ error: 'auth_user_id and first_name are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('producers')
    .upsert(body, { onConflict: 'auth_user_id' })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ producer: data })
}
