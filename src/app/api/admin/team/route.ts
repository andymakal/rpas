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

// POST — invite a new team member
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

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: `${siteUrl}/auth/callback`,
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
