import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest }        from 'next/server'

/**
 * GET /api/cron/lsp-no-response
 *
 * Runs daily (configured in vercel.json).
 * Finds every case that has been in lsp_contact_needed for 14+ days and
 * auto-closes it to no_lsp_response (is_lost = true).
 *
 * The status_entered_at column is automatically reset by a DB trigger on
 * every status change, so it reliably marks when a case entered its current
 * status — no additional column needed.
 *
 * Security: Vercel passes the CRON_SECRET as a Bearer token.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Resolve the lost_reason ID for no_lsp_response
  const { data: lostReason, error: lrErr } = await supabase
    .from('lost_reasons')
    .select('id')
    .eq('internal_code', 'no_lsp_response')
    .single()

  if (lrErr || !lostReason) {
    console.error('lsp-no-response: lost_reason lookup failed', lrErr)
    return Response.json(
      { error: 'lost_reason no_lsp_response not found — run migration 20260713000001 first' },
      { status: 500 },
    )
  }

  // 14 days ago (UTC)
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 14)
  const cutoffStr = cutoff.toISOString()

  const { data: cases, error: selectErr } = await supabase
    .from('cases')
    .select('id, customers!customer_id ( first_name, last_name )')
    .eq('internal_status', 'lsp_contact_needed')
    .eq('is_test', false)
    .lte('status_entered_at', cutoffStr)

  if (selectErr) {
    console.error('lsp-no-response cron select error:', selectErr)
    return Response.json({ error: selectErr.message }, { status: 500 })
  }

  const rows = (cases ?? []) as unknown as {
    id: string
    customers: { first_name: string; last_name: string } | null
  }[]

  if (rows.length === 0) {
    return Response.json({ ok: true, closed: 0 })
  }

  const caseIds = rows.map(c => c.id)

  const { error: updateErr } = await supabase
    .from('cases')
    .update({
      internal_status: 'no_lsp_response',
      lost_reason_id:  lostReason.id,
    })
    .in('id', caseIds)

  if (updateErr) {
    console.error('lsp-no-response cron update error:', updateErr)
    return Response.json({ error: updateErr.message }, { status: 500 })
  }

  // Notify the team — one card per case so they can follow up with the LSP
  const notifications = rows.map(c => {
    const name = c.customers
      ? `${c.customers.first_name} ${c.customers.last_name}`
      : 'Unknown'
    return {
      type:  'lsp_no_response_auto_close',
      title: `Auto-closed — no LSP response: ${name}`,
      body:  'Case moved to Closed after 14 days with no LSP response.',
      link:  `/referrals/${c.id}`,
    }
  })

  const { error: notifErr } = await supabase
    .from('notifications')
    .insert(notifications)

  if (notifErr) {
    // Non-fatal — cases are already updated; log and continue
    console.error('lsp-no-response notification insert error:', notifErr)
  }

  return Response.json({ ok: true, closed: rows.length })
}
