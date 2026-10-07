import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  applyAction,
  type OutreachAction,
  type OutreachState,
  type OutreachQueue,
  type CallReason,
  type ResearchReason,
  type CallOutcome,
} from '@/lib/stewardship/queues'

type OutreachRow = {
  id: string
  prereview_id: string
  queue: OutreachQueue
  call_reason: CallReason | null
  research_reason: ResearchReason | null
  last_call_outcome: CallOutcome | null
  callback_date: string | null
  email_sent_at: string | null
  follow_up_due: string | null
  submitted_at: string | null
  carrier_correction: string | null
}

const OUTREACH_COLUMNS =
  'id, prereview_id, queue, call_reason, research_reason, last_call_outcome, ' +
  'callback_date, email_sent_at, follow_up_due, submitted_at, carrier_correction'

/**
 * GET /api/stewardship/[id]
 *
 * One outreach work item with everything the task screen needs: the outreach
 * state, the customer, the request policies, and all other known holdings shown
 * as context. Policy facts come from service_policies (not duplicated).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: outreach, error } = await supabase
    .from('stewardship_outreach')
    .select(`
      ${OUTREACH_COLUMNS},
      customer_prereviews!inner (
        id, customer_id, source_agency_id, decision,
        customers!inner ( id, first_name, last_name, email, phone, date_of_birth, address_line1, city, state, zip )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !outreach) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }

  const pre = (outreach as unknown as {
    customer_prereviews: {
      id: string
      customer_id: string
      source_agency_id: string | null
      customers: Record<string, unknown>
    }
  }).customer_prereviews
  const customerId = pre.customer_id

  // All known holdings for this customer (context), and which are in the request.
  const [{ data: allPolicies }, { data: requestLinks }] = await Promise.all([
    supabase
      .from('service_policies')
      .select('id, policy_number, carrier, product_type, face_amount, cash_value_amount, coverage_status, insured_first_name, insured_last_name, sa_status, sa_form_sent_at')
      .eq('customer_id', customerId)
      .eq('is_test', false),
    supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id),
  ])

  const requestIds = new Set((requestLinks ?? []).map((r: { policy_id: string }) => r.policy_id))

  const holdings = ((allPolicies ?? []) as Record<string, unknown>[]).map(p => ({
    id: p.id as string,
    policy_number: p.policy_number as string,
    carrier: p.carrier as string,
    product_type: p.product_type as string | null,
    face_amount: p.face_amount as number | null,
    cash_value_amount: p.cash_value_amount as number | null,
    coverage_status: p.coverage_status as string,
    insured_name: [p.insured_first_name, p.insured_last_name].filter(Boolean).join(' ') || null,
    sa_status: p.sa_status as string,
    sa_form_sent_at: p.sa_form_sent_at as string | null,
    in_request: requestIds.has(p.id as string),
  }))

  const o = outreach as unknown as OutreachRow
  return Response.json({
    data: {
      id: o.id,
      prereview_id: o.prereview_id,
      queue: o.queue,
      call_reason: o.call_reason,
      research_reason: o.research_reason,
      last_call_outcome: o.last_call_outcome,
      callback_date: o.callback_date,
      email_sent_at: o.email_sent_at,
      follow_up_due: o.follow_up_due,
      submitted_at: o.submitted_at,
      carrier_correction: o.carrier_correction,
      customer: pre.customers,
      source_agency_id: pre.source_agency_id,
      holdings,
    },
  })
}

/**
 * PATCH /api/stewardship/[id]
 *
 * Apply a workflow transition. Body: { action: OutreachAction }. The transition
 * rules live in src/lib/stewardship/queues.ts; this route validates the action
 * against the current state, persists the resulting patch, and performs the one
 * durable side effect (carrier confirmation -> service_policies.sa_status).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Auth: internal staff only.
  const sessionClient = await createClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: OutreachAction }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = body.action
  if (!action?.type) {
    return Response.json({ error: 'action is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: current, error: readErr } = await supabase
    .from('stewardship_outreach')
    .select(OUTREACH_COLUMNS)
    .eq('id', id)
    .single()
  if (readErr || !current) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }

  const row = current as unknown as OutreachRow
  const state: OutreachState = {
    queue: row.queue,
    call_reason: row.call_reason,
    research_reason: row.research_reason,
    last_call_outcome: row.last_call_outcome,
    callback_date: row.callback_date,
    email_sent_at: row.email_sent_at,
    follow_up_due: row.follow_up_due,
    submitted_at: row.submitted_at,
    carrier_correction: row.carrier_correction,
  }

  const result = applyAction(state, action)
  if (result.error) {
    return Response.json({ error: result.error }, { status: 409 })
  }

  // Persist the outreach patch (only when there is something to change).
  if (Object.keys(result.patch).length > 0) {
    const { error: updErr } = await supabase
      .from('stewardship_outreach')
      .update(result.patch)
      .eq('id', id)
    if (updErr) {
      console.error('stewardship patch error:', updErr)
      return Response.json({ error: updErr.message }, { status: 500 })
    }
  }

  // Side effect: carrier confirmation confirms servicing access on the request
  // policies and marks outreach complete. It does NOT create a review.
  if (result.saStatus === 'confirmed') {
    const { data: links } = await supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id)
    const policyIds = (links ?? []).map((l: { policy_id: string }) => l.policy_id)
    if (policyIds.length > 0) {
      await supabase
        .from('service_policies')
        .update({ sa_status: 'confirmed' })
        .in('id', policyIds)
    }
  }

  // Side effect: when the form is sent, stamp sa_form_sent_at on the request
  // policies (servicing-agent status lives on service_policies).
  if (action.type === 'form-sent') {
    const { data: links } = await supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id)
    const policyIds = (links ?? []).map((l: { policy_id: string }) => l.policy_id)
    if (policyIds.length > 0) {
      await supabase
        .from('service_policies')
        .update({ sa_form_sent_at: new Date().toISOString() })
        .in('id', policyIds)
    }
  }

  const { data: updated } = await supabase
    .from('stewardship_outreach')
    .select(OUTREACH_COLUMNS)
    .eq('id', id)
    .single()

  return Response.json({
    data: updated,
    completed_outreach: result.completesOutreach ?? false,
  })
}
