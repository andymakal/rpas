import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    let body: { new_pin?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: agency } = await supabase
      .from('agencies')
      .select('id, dashboard_token')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    // Require active owner session cookie
    const ownerToken = request.cookies.get(`rpas_portal_${slug}_owner`)?.value
    if (!ownerToken || ownerToken !== agency.dashboard_token) {
      return NextResponse.json({ error: 'Owner authentication required' }, { status: 401 })
    }

    const newPin = body.new_pin?.trim() ?? ''
    if (!/^\d{4,8}$/.test(newPin)) {
      return NextResponse.json({ error: 'PIN must be 4–8 digits' }, { status: 400 })
    }

    const { error } = await supabase
      .from('agencies')
      .update({ owner_pin: newPin })
      .eq('id', agency.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update PIN' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 })
  }
}
