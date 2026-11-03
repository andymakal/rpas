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

    const [
      { data: touches, error },
      { data: statusHistory },
      { data: stageLabels },
    ] = await Promise.all([
      supabase
        .from('case_touches')
        .select('touch_type, touched_at, touched_by, notes')
        .eq('case_id', id),
      supabase
        .from('case_status_history')
        .select('to_status, changed_at')
        .eq('case_id', id),
      supabase
        .from('stage_translations')
        .select('internal_status, agency_label'),
    ])

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const labelMap = new Map(
      (stageLabels ?? []).map(s => [s.internal_status, s.agency_label])
    )

    type FeedEntry = { touch_type: string; touched_at: string; touched_by: string | null; notes: string | null }

    const touchFeed: FeedEntry[] = (touches ?? []).map(t => ({
      touch_type: t.touch_type,
      touched_at: t.touched_at,
      touched_by: t.touched_by,
      notes:      t.notes,
    }))

    const statusFeed: FeedEntry[] = (statusHistory ?? []).map(s => ({
      touch_type: 'status_change',
      touched_at: s.changed_at,
      touched_by: null,
      notes:      labelMap.get(s.to_status) ?? s.to_status,
    }))

    const combined = [...touchFeed, ...statusFeed].sort(
      (a, b) => new Date(b.touched_at).getTime() - new Date(a.touched_at).getTime()
    )

    return NextResponse.json({ data: combined })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 })
  }
}
