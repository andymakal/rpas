import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    let body: { pin?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (!body.pin?.trim()) {
      return NextResponse.json({ error: 'PIN is required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: agency } = await supabase
      .from('agencies')
      .select('id, owner_pin, dashboard_token')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    const entered = body.pin.trim()
    const stored  = agency.owner_pin ?? '0000'
    if (entered !== stored) {
      return NextResponse.json({ error: 'Incorrect owner PIN. Please try again.' }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set(`rpas_portal_${slug}_owner`, agency.dashboard_token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24, // 24-hour owner session
      path:     `/portal/${slug}`,
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 })
  }
}
