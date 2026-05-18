import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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
    .select('portal_pin, dashboard_token')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!agency) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }

  if (!agency.portal_pin || body.pin.trim() !== agency.portal_pin) {
    return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(`rpas_portal_${slug}`, agency.dashboard_token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 24 * 30, // 30 days
    path:     `/portal/${slug}`,
  })
  return response
}
