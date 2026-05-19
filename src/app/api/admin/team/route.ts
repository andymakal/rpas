import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://right-path-agency-system.vercel.app'

// GET — list all auth users
export async function GET() {
  const supabase = createAdminClient()
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ users })
}

// POST — create a new team member (no email required)
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  let body: { email: string; full_name: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email     = body.email?.trim().toLowerCase()
  const full_name = body.full_name?.trim()
  if (!email || !full_name) {
    return Response.json({ error: 'Email and name are required' }, { status: 400 })
  }

  // Generate a readable temporary password
  const chars    = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const tempPass = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    + '!'

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password:      tempPass,
    email_confirm: true,          // skip confirmation email entirely
    user_metadata: { full_name },
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ user: data.user, tempPass })
}

// PATCH — update a team member's name
export async function PATCH(request: NextRequest) {
  const supabase = createAdminClient()
  let body: { userId: string; full_name: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.userId || !body.full_name?.trim()) {
    return Response.json({ error: 'userId and full_name are required' }, { status: 400 })
  }

  const { data, error } = await supabase.auth.admin.updateUserById(body.userId, {
    user_metadata: { full_name: body.full_name.trim() },
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ user: data.user })
}

// DELETE — remove a team member
export async function DELETE(request: NextRequest) {
  const supabase = createAdminClient()
  let body: { userId: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const { error } = await supabase.auth.admin.deleteUser(body.userId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
