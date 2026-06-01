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

// POST — create a new team member + producer profile
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  let body: { email: string; full_name: string; title?: string; phone?: string; allstate_id?: string; npn?: string; sub_producer_code?: string; birthday?: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email     = body.email?.trim().toLowerCase()
  const full_name = body.full_name?.trim()
  if (!email || !full_name) {
    return Response.json({ error: 'Email and name are required' }, { status: 400 })
  }

  // Split name into first/last for the producer record
  const nameParts  = full_name.split(' ')
  const first_name = nameParts[0] ?? full_name
  const last_name  = nameParts.slice(1).join(' ') || ''

  // Generate a readable temporary password
  const chars    = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const tempPass = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    + '!'

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password:      tempPass,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Create the producer profile linked to the new auth user
  const producerInsert: Record<string, unknown> = {
    auth_user_id: data.user.id,
    first_name,
    last_name,
    email,
  }
  if (body.title)             producerInsert.title             = body.title.trim()
  if (body.phone)             producerInsert.phone             = body.phone.trim()
  if (body.allstate_id)       producerInsert.allstate_id       = body.allstate_id.trim()
  if (body.npn)               producerInsert.npn               = body.npn.trim()
  if (body.sub_producer_code) producerInsert.sub_producer_code = body.sub_producer_code.trim()
  if (body.birthday)          producerInsert.birthday          = body.birthday

  await supabase.from('producers').insert(producerInsert)
  // Producer insert failure is non-fatal — auth user is created, profile can be added later

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

// PUT — reset a team member's password (generates a new temp password)
export async function PUT(request: NextRequest) {
  const supabase = createAdminClient()
  let body: { userId: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const chars    = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const tempPass = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    + '!'

  // email_confirm: true ensures accounts that show "Pending" become active on reset
  const { error } = await supabase.auth.admin.updateUserById(body.userId, {
    password:      tempPass,
    email_confirm: true,
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ tempPass })
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
