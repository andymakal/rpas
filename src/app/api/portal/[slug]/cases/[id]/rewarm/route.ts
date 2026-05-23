import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  try {
    const { slug, id } = await params
    const supabase = createAdminClient()

    // Verify portal cookie matches this agency's dashboard_token
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

    // Parse body
    let body: { note?: string; lsp_name?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (!body.note?.trim()) {
      return NextResponse.json({ error: 'A note is required' }, { status: 400 })
    }

    // Verify case belongs to this agency
    const { data: existing } = await supabase
      .from('cases')
      .select('id, notes, internal_status, customers ( first_name, last_name )')
      .eq('id', id)
      .eq('agency_id', agency.id)
      .eq('is_test', false)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    // Append re-warm note to existing notes, preserving full history
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
    const header = body.lsp_name?.trim()
      ? `--- Re-warmed ${dateStr} by ${body.lsp_name.trim()} ---`
      : `--- Re-warmed ${dateStr} ---`

    const newNotes = [existing.notes?.trim(), header, body.note.trim()]
      .filter(Boolean)
      .join('\n\n')

    // Log the status transition
    await supabase.from('case_status_history').insert({
      case_id:     id,
      from_status: existing.internal_status,
      to_status:   'active_referral',
    })

    // Reset the case — back to the front of the queue, always hot
    const { error: updateError } = await supabase
      .from('cases')
      .update({
        internal_status:   'active_referral',
        is_hot_lead:       true,
        notes:             newNotes,
        snooze_reason_id:  null,
        status_entered_at: new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Notify the RP team
    const cust = (existing as unknown as {
      customers: { first_name: string; last_name: string } | null
    }).customers
    const clientName = cust ? `${cust.first_name} ${cust.last_name}` : 'Unknown'
    const notifBody  = body.lsp_name?.trim()
      ? `${body.lsp_name.trim()} has re-engaged this client`
      : 'Client has been re-engaged'

    await supabase.from('notifications').insert({
      type:  'rewarm',
      title: `🔥 Re-warm: ${clientName}`,
      body:  notifBody,
      link:  `/referrals/${id}`,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 })
  }
}
