import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { buildCustomerHistory, type HistoryTouchRow } from '@/lib/stewardship/customer-history'
import type { PolicySummary } from '@/components/workflow'

/**
 * GET /api/customers/[id]/contact-history
 *
 * The display customer history and policy summary for ONE customer, for the
 * working-screen right-hand history column and center policy summary. It reads
 * the one durable history (case_touches) and the customer's policies
 * (service_policies) and returns them shaped for the shared CustomerHistoryCard
 * and PolicySummaryList. Display only: it reads nothing about workflow state and
 * writes nothing.
 *
 * Contact Research (and any other working screen built on the project side)
 * loads this when a customer opens, keeping the Contact Research LIST read thin
 * while still giving the opened customer the same three-column history + policy
 * context the stewardship working screens have. Mirrors the history read in
 * GET /api/stewardship/[id] so the two surfaces group and format identically.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: customerId } = await params
  const supabase = createAdminClient()
  const actorTimeZone = await getActorTimeZone()

  // The whole customer contact history (not run-scoped), grouped newest-first.
  const { data: historyRows } = await supabase
    .from('case_touches')
    .select('id, touch_type, notes, touched_at, touched_by')
    .eq('customer_id', customerId)
    .order('touched_at', { ascending: false })
  const customerHistory = buildCustomerHistory(
    (historyRows ?? []) as HistoryTouchRow[],
    actorTimeZone,
  )

  // The customer's policies, mapped onto the read-only Policy Summary shape.
  // Non-test only; existing policy data only, nothing invented.
  const { data: policyRows } = await supabase
    .from('service_policies')
    .select('id, policy_number, carrier, product_type, face_amount, cash_value_amount, issue_date')
    .eq('customer_id', customerId)
    .eq('is_test', false)
    .order('issue_date', { ascending: false })
  const policies: PolicySummary[] = ((policyRows ?? []) as PolicyRow[]).map((p) => ({
    id: p.id,
    policy_number: p.policy_number,
    product_type: p.product_type,
    face_amount: p.face_amount,
    issue_date: p.issue_date,
    cash_value_amount: p.cash_value_amount,
    carrier: p.carrier,
  }))

  return Response.json({
    data: { customer_history: customerHistory, policies, actor_time_zone: actorTimeZone },
  })
}

type PolicyRow = {
  id: string
  policy_number: string | null
  carrier: string | null
  product_type: string | null
  face_amount: number | null
  cash_value_amount: number | null
  issue_date: string | null
}
