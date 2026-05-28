import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/portal/[slug]/cases/[id]/lsp-reengaged
 *
 * Called from the portal when an LSP confirms a client in the
 * "LSP Re-Warm Needed" (lsp_contact_needed) stage is still interested.
 *
 * Unlike /rewarm (which handles Parked Prospects → active_referral),
 * this moves the case back to 'triage' so Dulce / Gabe can pick it up
 * fresh. is_hot_lead is set to true because the LSP has confirmed interest.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  try {
    const { slug, id } = await params
    const supabase = createAdminClient()

    // ── Auth: verify portal cookie ──────────────────────────────────────────
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

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: { note?: string; lsp_name?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (!body.note?.trim()) {
      return NextResponse.json({ error: 'A note is required' }, { status: 400 })
    }

    // ── Verify case belongs to this agency ──────────────────────────────────
    const { data: existing } = await supabase
      .from('cases')
      .select('id, notes, internal_status, customers!customer_id ( first_name, last_name )')
      .eq('id', id)
      .eq('agency_id', agency.id)
      .eq('is_test', false)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    // Safety: only allow this action from lsp_contact_needed
    if (existing.internal_status !== 'lsp_contact_needed') {
      return NextResponse.json(
        { error: 'Case is not in LSP Re-Warm Needed status' },
        { status: 409 }
      )
    }

    // ── Append note ─────────────────────────────────────────────────────────
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
    const header = body.lsp_name?.trim()
      ? `--- LSP re-engaged ${dateStr} (${body.lsp_name.trim()}) ---`
      : `--- LSP re-engaged ${dateStr} ---`

    const newNotes = [existing.notes?.trim(), header, body.note.trim()]
      .filter(Boolean)
      .join('\n\n')

    // ── Log status transition ───────────────────────────────────────────────
    await supabase.from('case_status_history').insert({
      case_id:     id,
      from_status: 'lsp_contact_needed',
      to_status:   'triage',
    })

    // ── Move case back to triage — hot, so it surfaces at the top ──────────
    const { error: updateError } = await supabase
      .from('cases')
      .update({
        internal_status:   'triage',
        is_hot_lead:       true,
        notes:             newNotes,
        status_entered_at: new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // ── Notify the RP team ──────────────────────────────────────────────────
    const cust = (existing as unknown as {
      customers: { first_name: string; last_name: string } | null
    }).customers
    const clientName = cust ? `${cust.first_name} ${cust.last_name}` : 'Unknown'
    const notifBody  = body.lsp_name?.trim()
      ? `${body.lsp_name.trim()} confirmed ${clientName} is still interested — back in queue`
      : `LSP confirmed ${clientName} is still interested — back in queue`

    await supabase.from('notifications').insert({
      type:  'rewarm',
      title: `🔥 Back in queue: ${clientName}`,
      body:  notifBody,
      link:  `/referrals/${id}`,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 })
  }
}
