import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest }        from 'next/server'

/**
 * POST /api/policy-reviews/:id/open-case
 *
 * Creates a new case from an annual review where an opportunity was identified.
 * The customer is already in the system — no intake or triage needed.
 *
 * Body: { referral_type, notes?, assigned_to? }
 *
 * The new case:
 *   - starts at 'appointment_set' (warm conversation, past cold-lead stages)
 *   - lead_source = 'review_generated' (shows as EFS Generated on portal)
 *   - is linked back via policy_reviews.resulting_case_id
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params
  const supabase = createAdminClient()

  let body: { referral_type?: string; notes?: string; assigned_to?: string }
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.referral_type?.trim()) {
    return Response.json({ error: 'referral_type is required' }, { status: 400 })
  }

  // Load review + policy snapshot to get customer, agency, agent
  const { data: review, error: revErr } = await supabase
    .from('policy_reviews')
    .select(`
      id, resulting_case_id,
      service_policies (
        customer_id, agency_id, agent_id,
        client_name, carrier, product_type
      )
    `)
    .eq('id', reviewId)
    .single()

  if (revErr || !review) {
    return Response.json({ error: revErr?.message ?? 'Review not found' }, { status: 404 })
  }

  if (review.resulting_case_id) {
    return Response.json({ error: 'A case has already been opened from this review', case_id: review.resulting_case_id }, { status: 409 })
  }

  type PolicyRow = {
    customer_id: string | null
    agency_id:   string | null
    agent_id:    string | null
    client_name: string | null
    carrier:     string | null
    product_type: string | null
  }
  const policy = review.service_policies as unknown as PolicyRow | null

  if (!policy?.customer_id) {
    return Response.json({ error: 'Policy has no linked customer — cannot open case' }, { status: 422 })
  }

  // Create the case
  const { data: newCase, error: caseErr } = await supabase
    .from('cases')
    .insert({
      customer_id:      policy.customer_id,
      agency_id:        policy.agency_id,
      agent_id:         policy.agent_id,
      internal_status:  'appointment_set',
      lead_source:      'review_generated',
      is_owner_referral: false,
      is_hot_lead:      false,
      is_test:          false,
      notes:            body.notes?.trim() || null,
      producer_id:      body.assigned_to?.trim() || null,
      quoted_product_type: policy.product_type,
      quoted_carrier:   policy.carrier,
    })
    .select('id')
    .single()

  if (caseErr || !newCase) {
    console.error('open-case: insert failed', caseErr)
    return Response.json({ error: caseErr?.message ?? 'Failed to create case' }, { status: 500 })
  }

  // Record status history
  await supabase.from('case_status_history').insert({
    case_id:     newCase.id,
    from_status: null,
    to_status:   'appointment_set',
  })

  // Link review → case
  await supabase
    .from('policy_reviews')
    .update({ resulting_case_id: newCase.id, outcome: 'opportunity_found', status: 'complete' })
    .eq('id', reviewId)

  // Add note to case if provided
  if (body.notes?.trim()) {
    await supabase.from('customer_notes').insert({
      case_id:     newCase.id,
      section:     'producer',
      author_name: body.assigned_to?.trim() || 'System',
      body:        `Opened from annual review (${reviewId.slice(0, 8)}…): ${body.notes.trim()}`,
    })
  }

  // Notification
  await supabase.from('notifications').insert({
    type:  'review_case_opened',
    title: `Case opened from review: ${policy.client_name ?? 'Unknown'}`,
    body:  `${body.referral_type} — ${policy.carrier ?? ''} ${policy.product_type ?? ''}`.trim(),
    link:  `/referrals/${newCase.id}`,
  })

  return Response.json({ data: { case_id: newCase.id } }, { status: 201 })
}
