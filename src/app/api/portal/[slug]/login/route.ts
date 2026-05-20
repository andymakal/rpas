import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = createAdminClient()

  let body: { pin?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!body.pin?.trim()) {
    return NextResponse.json({ error: 'PIN is required' }, { status: 400 })
  }

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, agent_number, dashboard_token')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!agency) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }

  // The agent code (e.g. C4775) is the portal PIN.
  // Stored agent_number includes an "A0" prefix (e.g. A0C4775) — strip it so
  // agents can enter just their short code.
  if (!agency.agent_number) {
    return NextResponse.json({ error: 'This portal has not been configured yet. Please contact your Right Path representative.' }, { status: 403 })
  }

  // Agent codes are always the last 5 characters of the stored agent_number
  // (e.g. A0B3292 → B3292, A0C4775 → C4775). Accept either the short code
  // or the full agent_number so entry is flexible.
  const stored    = agency.agent_number.trim().toUpperCase()
  const shortCode = stored.slice(-5)
  const entered   = body.pin.trim().toUpperCase()
  if (entered !== shortCode && entered !== stored) {
    return NextResponse.json({ error: `Incorrect PIN. [debug: stored="${stored}" short="${shortCode}" entered="${entered}"]` }, { status: 401 })
  }

  // Ensure a dashboard_token exists — generate one if this agency predates the field
  let token = agency.dashboard_token
  if (!token) {
    token = crypto.randomUUID()
    await supabase.from('agencies').update({ dashboard_token: token }).eq('id', agency.id)
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(`rpas_portal_${slug}`, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 24 * 30, // 30 days
    path:     `/portal/${slug}`,
  })
  return response
}
