import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
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
  form_received_at: string | null
  submitted_at: string | null
  carrier_correction: string | null
}

const OUTREACH_COLUMNS =
  'id, prereview_id, queue, call_reason, research_reason, last_call_outcome, ' +
  'callback_date, email_sent_at, follow_up_due, form_received_at, submitted_at, carrier_correction'

/**
 * Resolve the signed-in employee's display name for a touch log, mirroring the
 * cases touch route: prefer staff_profiles.display_name, fall back to the email
 * local-part. Attribution is best-effort and never blocks the workflow.
 */
async function resolveEmployeeName(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  try {
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return null
    const { data: profile } = await admin
      .from('staff_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
    return profile?.display_name ?? user.email?.split('@')[0] ?? null
  } catch {
    return null
  }
}

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
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

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
  const cust = pre.customers as {
    id: string; first_name: string; last_name: string
    email: string | null; phone: string | null; date_of_birth: string | null
    address_line1: string | null; city: string | null; state: string | null; zip: string | null
  }

  // Required-signer identity is NOT durable today: there is no owner/signer
  // record, and the customer is not necessarily the policy owner or a required
  // signer. We therefore do not assert any signer. The customer and the request
  // policies' insured names are returned as context the worker uses to verify
  // the actual signature(s) from the returned form before submitting; the UI
  // requires that confirmation.
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
      form_received_at: o.form_received_at,
      submitted_at: o.submitted_at,
      carrier_correction: o.carrier_correction,
      customer: cust,
      source_agency_id: pre.source_agency_id,
      holdings,
      // Signer identity cannot be determined from durable data.
      signer_identity_known: false,
    },
  })
}

/**
 * PATCH /api/stewardship/[id]
 *
 * Apply a workflow transition. Body: { action: OutreachAction }. The transition
 * rules live in src/lib/stewardship/queues.ts; this route validates the action
 * against the current state, persists the resulting patch, and performs the
 * durable side effects:
 *   - research-found email/phone persists the actual contact value on the
 *     customer (field-level, never overwriting the other fact);
 *   - form-sent stamps sa_form_sent_at on the request policies;
 *   - carrier-confirmed sets sa_status = 'confirmed' on the ONE named request
 *     policy (never the others), then ends outreach by deleting the
 *     stewardship_outreach row ONLY when every request policy is confirmed. While
 *     any request policy still needs access, the item stays in waiting-for-carrier
 *     and remains actionable. The open customer_prereview is left for the later
 *     documentation layer.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  let body: { action?: OutreachAction & { email?: string; phone?: string } }
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
    .select(`${OUTREACH_COLUMNS}, customer_prereviews!inner ( customer_id, customers!inner ( phone ) )`)
    .eq('id', id)
    .single()
  if (readErr || !current) {
    return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  }

  const row = current as unknown as OutreachRow & {
    customer_prereviews: { customer_id: string; customers: { phone: string | null } }
  }
  const customerId = row.customer_prereviews.customer_id

  // ── research-found: persist the actual contact value BEFORE routing ─────────
  // Field-level: write only the found fact, never overwrite the other. Refuse
  // to advance on a blank value.
  if (action.type === 'research-found' && (action.found === 'email' || action.found === 'phone')) {
    const value = (action.found === 'email' ? body.action?.email : body.action?.phone)?.trim()
    if (!value) {
      return Response.json(
        { error: `A ${action.found} value is required to route this customer forward` },
        { status: 400 },
      )
    }
    const field = action.found === 'email' ? { email: value } : { phone: value }
    const { error: custErr } = await supabase
      .from('customers')
      .update(field)
      .eq('id', customerId)
    if (custErr) {
      console.error('stewardship research contact persist error:', custErr)
      return Response.json({ error: custErr.message }, { status: 500 })
    }
  }

  const state: OutreachState = {
    queue: row.queue,
    call_reason: row.call_reason,
    research_reason: row.research_reason,
    last_call_outcome: row.last_call_outcome,
    callback_date: row.callback_date,
    email_sent_at: row.email_sent_at,
    follow_up_due: row.follow_up_due,
    form_received_at: row.form_received_at,
    submitted_at: row.submitted_at,
    carrier_correction: row.carrier_correction,
    has_usable_phone: !!row.customer_prereviews.customers?.phone?.trim(),
  }

  const result = applyAction(state, action)
  if (result.error) {
    return Response.json({ error: result.error }, { status: 409 })
  }

  // form-sent stamps sa_form_sent_at on the request policies (servicing-agent
  // status lives on service_policies). Do this before the outreach patch.
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

  // carrier-confirmed: confirm servicing access on the ONE named request policy,
  // then end outreach only once EVERY request policy is confirmed. The open
  // customer_prereview remains (decision still null) for the documentation
  // layer. "Out of outreach" stays derivable: no stewardship_outreach row.
  if (result.confirmPolicyId) {
    // The policy must belong to THIS outreach's request set (a confirmation can
    // only apply to a policy actually in the servicing request). This also
    // guards against confirming a policy from a different customer/outreach.
    const { data: links } = await supabase
      .from('stewardship_outreach_policies')
      .select('policy_id')
      .eq('outreach_id', id)
    const requestPolicyIds = (links ?? []).map((l: { policy_id: string }) => l.policy_id)
    if (!requestPolicyIds.includes(result.confirmPolicyId)) {
      return Response.json(
        { error: 'That policy is not part of this servicing request.' },
        { status: 409 },
      )
    }

    // Confirm exactly this one policy. Scoped by id AND customer_id so a stray
    // id can never confirm another customer's policy. The other request
    // policies are left untouched — their statuses are independent.
    const { error: saErr } = await supabase
      .from('service_policies')
      .update({ sa_status: 'confirmed' })
      .eq('id', result.confirmPolicyId)
      .eq('customer_id', customerId)
    if (saErr) {
      console.error('stewardship carrier-confirm sa_status update error:', saErr)
      return Response.json(
        { error: 'Could not update servicing status; the item was left in Waiting for Carrier.' },
        { status: 500 },
      )
    }

    // Persist the outreach patch (clears any standing correction note). Keep the
    // item in waiting-for-carrier; it stays actionable for the remaining
    // policies. Done before deciding completion so a correction note never
    // lingers on a still-open item.
    if (Object.keys(result.patch).length > 0) {
      const { error: updErr } = await supabase
        .from('stewardship_outreach')
        .update(result.patch)
        .eq('id', id)
      if (updErr) {
        console.error('stewardship carrier-confirm patch error:', updErr)
        return Response.json({ error: updErr.message }, { status: 500 })
      }
    }

    // Re-read the request policies' live statuses to decide completion. Outreach
    // is finished only when every request policy — term and permanent alike — is
    // confirmed. (The 1035 review advances to operations prep independently once
    // the permanent policies are confirmed; it does not wait on term policies.)
    const { data: statusRows, error: statusErr } = await supabase
      .from('service_policies')
      .select('id, sa_status')
      .in('id', requestPolicyIds)
    if (statusErr) {
      console.error('stewardship carrier-confirm status re-read error:', statusErr)
      return Response.json({ error: statusErr.message }, { status: 500 })
    }
    const allConfirmed =
      requestPolicyIds.length > 0 &&
      (statusRows ?? []).length === requestPolicyIds.length &&
      (statusRows ?? []).every((p: { sa_status: string | null }) => p.sa_status === 'confirmed')

    if (allConfirmed) {
      // Every request policy is confirmed — the servicing outreach work is done.
      // Deleting cascades stewardship_outreach_policies; the open
      // customer_prereview is untouched for the documentation layer.
      const { error: delErr } = await supabase
        .from('stewardship_outreach')
        .delete()
        .eq('id', id)
      if (delErr) {
        console.error('stewardship carrier-confirm delete error:', delErr)
        return Response.json({ error: delErr.message }, { status: 500 })
      }
      return Response.json({ data: null, completed_outreach: true })
    }

    // Still have policies awaiting confirmation — return the (still-open) row so
    // the task screen refreshes with the updated per-policy statuses.
    const { data: stillOpen } = await supabase
      .from('stewardship_outreach')
      .select(OUTREACH_COLUMNS)
      .eq('id', id)
      .single()
    return Response.json({ data: stillOpen, completed_outreach: false })
  }

  // ── "Form attached and email sent": advance AND record the touch atomically ─
  // This confirmation is the one place the sent servicing-agent authorization
  // email becomes durable history (opening Outlook is a separate mailto that
  // records nothing). Two requirements shape this path:
  //
  //   1. A successful confirmation must never silently leave the customer
  //      without a history entry. The touch is recorded as part of the
  //      operation; if it fails we surface an error instead of swallowing it.
  //   2. Repeated or concurrent submits of the SAME confirmation must not create
  //      duplicate touches, while a legitimate later email still does.
  //
  // Both are met by gating on the queue transition itself. The advance
  // ready-to-email -> waiting-for-response is persisted with a conditional
  // update scoped to the current queue, so it is atomic at the database: only
  // the FIRST request to flip the row matches. A duplicate or concurrent submit
  // (the row already in waiting-for-response) matches zero rows and records
  // nothing. A later legitimate email must re-enter ready-to-email first, so it
  // flips the row again and correctly logs a new touch.
  if (action.type === 'email-sent' && state.queue === 'ready-to-email') {
    const { data: advancedRows, error: advErr } = await supabase
      .from('stewardship_outreach')
      .update(result.patch)
      .eq('id', id)
      .eq('queue', 'ready-to-email')
      .select(OUTREACH_COLUMNS)
    if (advErr) {
      console.error('stewardship email-sent advance error:', advErr)
      return Response.json({ error: advErr.message }, { status: 500 })
    }

    // Zero rows: another request already advanced this item (duplicate or
    // concurrent submit). Nothing further to record. Return the current row.
    if (!advancedRows || advancedRows.length === 0) {
      const { data: currentRow } = await supabase
        .from('stewardship_outreach')
        .select(OUTREACH_COLUMNS)
        .eq('id', id)
        .single()
      return Response.json({ data: currentRow, completed_outreach: false })
    }

    const advanced = advancedRows[0] as unknown as OutreachRow
    const touchedBy = await resolveEmployeeName(supabase)
    const { error: touchErr } = await supabase
      .from('case_touches')
      .insert({
        customer_id: customerId,
        case_id:     null,
        touch_type:  'email',
        notes:       '1035 servicing-agent authorization email sent to the customer.',
        touched_at:  advanced.email_sent_at ?? new Date().toISOString(),
        touched_by:  touchedBy,
      })
    if (touchErr) {
      // The confirmation must not silently lose its history entry. Surface the
      // failure so the worker knows to retry rather than believing it logged.
      console.error('stewardship email touch log error:', touchErr)
      return Response.json(
        { error: 'The email was recorded but its history entry could not be saved. Please try again.' },
        { status: 500 },
      )
    }

    return Response.json({ data: advanced, completed_outreach: false })
  }

  // Normal case: persist the outreach patch.
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

  const { data: updated } = await supabase
    .from('stewardship_outreach')
    .select(OUTREACH_COLUMNS)
    .eq('id', id)
    .single()

  return Response.json({ data: updated, completed_outreach: false })
}
