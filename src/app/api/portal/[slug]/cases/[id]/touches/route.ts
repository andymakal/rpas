import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  try {
    const { slug, id } = await params
    const supabase = createAdminClient()

    const token = request.cookies.get(`rpas_portal_${slug}`)?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: agency } = await supabase
      .from('agencies')
      .select('id, dashboard_token')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!agency || agency.dashboard_token !== token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Verify case belongs to this agency
    const { data: caseRow } = await supabase
      .from('cases')
      .select('id')
      .eq('id', id)
      .eq('agency_id', agency.id)
      .eq('is_test', false)
      .single()

    if (!caseRow) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    const { data: touches, error } = await supabase
      .from('case_touches')
      .select('touch_type, touched_at, touched_by')
      .eq('case_id', id)
      .order('touched_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: touches ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 })
  }
}
