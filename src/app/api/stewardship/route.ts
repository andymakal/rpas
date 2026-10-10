import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { QUEUE_META, deriveFollowUpRouting, type OutreachQueue } from '@/lib/stewardship/queues'

/**
 * GET /api/stewardship
 *
 * Returns the outreach board: every open capture work item with its current
 * queue and the customer identity needed to render the queue list. Backed by
 * stewardship_outreach joined to customer_prereviews -> customers.
 *
 * Before building the board, overdue waiting-for-response items are moved to
 * Ready to Call (reason: no-response) by deterministic derived routing, so
 * overdue work surfaces in the right queue without manual housekeeping.
 *
 * Optional ?queue=<OutreachQueue> filters to one queue.
 *
 * Optional ?project_id=<uuid> scopes the board to a single project: only
 * outreach for customers in that project's project_customers is returned, and
 * the counts reflect only that scoped set. Without the param the board is the
 * normal unscoped view across all open outreach.
 */
export async function GET(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const supabase = createAdminClient()
  const url = new URL(request.url)
  const queueFilter = url.searchParams.get('queue')
  const projectId = url.searchParams.get('project_id')?.trim() || null

  // Project scope: resolve the project's customer set up front. The board is
  // then filtered to these customers so counts and lists show only this
  // project's work. An empty project yields an empty board.
  let projectCustomerIds: Set<string> | null = null
  if (projectId) {
    const { data: members, error: memberErr } = await supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', projectId)
    if (memberErr) {
      console.error('stewardship board: project membership query error', memberErr)
      return Response.json({ error: memberErr.message }, { status: 500 })
    }
    projectCustomerIds = new Set((members ?? []).map((m: { customer_id: string }) => m.customer_id))
    if (projectCustomerIds.size === 0) {
      const emptyCounts = Object.fromEntries(
        (Object.keys(QUEUE_META) as OutreachQueue[]).map(q => [q, 0]),
      ) as Record<OutreachQueue, number>
      return Response.json({ data: { items: [], counts: emptyCounts } })
    }
  }

  // Deterministic follow-up routing: promote overdue waiting-for-response items
  // to Ready to Call (no-response) up front, and persist the move so it is
  // durable rather than a per-render illusion.
  const now = new Date()
  const { data: waiting } = await supabase
    .from('stewardship_outreach')
    .select('id, follow_up_due')
    .eq('queue', 'waiting-for-response')
    .not('follow_up_due', 'is', null)
    .lte('follow_up_due', now.toISOString())
  for (const w of (waiting ?? []) as { id: string; follow_up_due: string | null }[]) {
    const patch = deriveFollowUpRouting({ queue: 'waiting-for-response', follow_up_due: w.follow_up_due }, now)
    if (patch) {
      await supabase.from('stewardship_outreach').update(patch).eq('id', w.id)
    }
  }

  let query = supabase
    .from('stewardship_outreach')
    .select(`
      id, prereview_id, queue, call_reason, research_reason, last_call_outcome,
      callback_date, email_sent_at, follow_up_due, form_received_at, submitted_at, carrier_correction,
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
    form_received_at: string | null
    submitted_at: string | null
    carrier_correction: string | null
    customer_prereviews: {
      id: string
      decision: string | null
      customers: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }
    }
  }

  // Only open items (decision still null) belong on the outreach board. A
  // decided pre-review is no longer stewardship/outreach work. When a project
  // scope is set, also drop any item whose customer is not in the project, so
  // both the list and the counts below reflect only this project's work.
  const rows = ((data ?? []) as unknown as Row[]).filter(r => {
    if (r.customer_prereviews?.decision != null) return false
    if (projectCustomerIds && !projectCustomerIds.has(r.customer_prereviews.customers.id)) return false
    return true
  })

  const items = rows.map(r => ({
    id: r.id,
    queue: r.queue,
    call_reason: r.call_reason,
    research_reason: r.research_reason,
    last_call_outcome: r.last_call_outcome,
    callback_date: r.callback_date,
    email_sent_at: r.email_sent_at,
    follow_up_due: r.follow_up_due,
    form_received_at: r.form_received_at,
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
