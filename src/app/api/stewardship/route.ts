import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { QUEUE_META, type OutreachQueue } from '@/lib/stewardship/queues'

/**
 * GET /api/stewardship
 *
 * Returns the outreach board: every open capture work item with its current
 * queue and the customer identity needed to render the queue list. Backed by
 * stewardship_outreach joined to customer_prereviews -> customers.
 *
 * Optional ?queue=<OutreachQueue> filters to one queue.
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const url = new URL(request.url)
  const queueFilter = url.searchParams.get('queue')

  let query = supabase
    .from('stewardship_outreach')
    .select(`
      id, prereview_id, queue, call_reason, research_reason, last_call_outcome,
      callback_date, email_sent_at, follow_up_due, submitted_at, carrier_correction,
      updated_at,
      customer_prereviews!inner (
        id, customer_id, source_agency_id, decision,
        customers!inner ( id, first_name, last_name, email, phone )
      )
    `)
    .order('updated_at', { ascending: true })

  if (queueFilter && queueFilter in QUEUE_META) {
    query = query.eq('queue', queueFilter)
  }

  const { data, error } = await query
  if (error) {
    console.error('stewardship board query error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  type Row = {
    id: string
    queue: OutreachQueue
    call_reason: string | null
    research_reason: string | null
    last_call_outcome: string | null
    callback_date: string | null
    email_sent_at: string | null
    follow_up_due: string | null
    submitted_at: string | null
    carrier_correction: string | null
    customer_prereviews: {
      id: string
      decision: string | null
      customers: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }
    }
  }

  // Only open items (decision still null) belong on the outreach board. A
  // decided pre-review is no longer stewardship/outreach work.
  const rows = ((data ?? []) as unknown as Row[]).filter(r => r.customer_prereviews?.decision == null)

  const items = rows.map(r => ({
    id: r.id,
    queue: r.queue,
    call_reason: r.call_reason,
    research_reason: r.research_reason,
    last_call_outcome: r.last_call_outcome,
    callback_date: r.callback_date,
    email_sent_at: r.email_sent_at,
    follow_up_due: r.follow_up_due,
    submitted_at: r.submitted_at,
    carrier_correction: r.carrier_correction,
    prereview_id: r.customer_prereviews.id,
    customer: r.customer_prereviews.customers,
  }))

  const counts = Object.fromEntries(
    (Object.keys(QUEUE_META) as OutreachQueue[]).map(q => [q, 0]),
  ) as Record<OutreachQueue, number>
  for (const it of items) counts[it.queue] += 1

  return Response.json({ data: { items, counts } })
}
