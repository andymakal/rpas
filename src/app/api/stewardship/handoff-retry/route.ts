import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { handoffToInitialAnalysis } from '@/lib/stewardship/analysis-handoff'

/**
 * GET  /api/stewardship/handoff-retry
 *   List pre-reviews whose Initial Analysis handoff FAILED
 *   (customer_prereviews.handoff_status = 'failed'), so a failed handoff is
 *   never silently lost — it is visible and retryable.
 *
 * POST /api/stewardship/handoff-retry  { prereview_id: string }
 *   Re-run the handoff for one failed pre-review. The confirmed policies are
 *   recovered from the customer's current service_policies (sa_status =
 *   'confirmed'), since the outreach request-policy links are gone after
 *   completion. Idempotent (reuses an existing review).
 *
 * Internal-admin only.
 */

export async function GET() {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('customer_prereviews')
    .select('id, customer_id, handoff_error, servicing_completed_at, customers!inner ( first_name, last_name )')
    .eq('handoff_status', 'failed')
    .order('servicing_completed_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const items = (data ?? []).map((r: Record<string, unknown>) => {
    const c = r.customers as { first_name: string; last_name: string } | null
    return {
      prereview_id: r.id as string,
      customer_id: r.customer_id as string,
      customer_name: c ? `${c.first_name} ${c.last_name}`.trim() : null,
      handoff_error: r.handoff_error as string | null,
      completed_at: r.servicing_completed_at as string | null,
    }
  })
  return Response.json({ data: items })
}

export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: { prereview_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const prereviewId = body.prereview_id?.trim()
  if (!prereviewId) {
    return Response.json({ error: 'prereview_id is required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: pre, error: preErr } = await supabase
    .from('customer_prereviews')
    .select('id, customer_id, handoff_status')
    .eq('id', prereviewId)
    .maybeSingle()
  if (preErr || !pre) {
    return Response.json({ error: 'Pre-review not found' }, { status: 404 })
  }

  // Recover the confirmed policies for this customer (the onboarded set).
  const { data: confirmed } = await supabase
    .from('service_policies')
    .select('id')
    .eq('customer_id', pre.customer_id)
    .eq('is_test', false)
    .eq('sa_status', 'confirmed')
  const policyIds = (confirmed ?? []).map((p: { id: string }) => p.id)

  const handoff = await handoffToInitialAnalysis(supabase, {
    prereviewId: pre.id,
    customerId: pre.customer_id,
    policyIds,
  })

  const { error: upErr } = await supabase
    .from('customer_prereviews')
    .update({
      handoff_status: handoff.status,
      handoff_error:  handoff.status === 'failed' ? (handoff.error ?? 'Unknown handoff error') : null,
    })
    .eq('id', pre.id)
  if (upErr) {
    return Response.json({ error: upErr.message }, { status: 500 })
  }

  if (handoff.status === 'failed') {
    return Response.json({ error: handoff.error ?? 'Handoff retry failed', data: handoff }, { status: 500 })
  }
  return Response.json({ data: handoff })
}
