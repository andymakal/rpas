import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { getReviewType } from '@/lib/reviews/prep'

/**
 * POST /api/policy-reviews
 *
 * Creates a policy review record for an existing service_policy.
 * Derives review_type from the policy's product_type.
 * Auto-assigns a review number: RV-YYYY-NNN.
 *
 * Body: { policy_id, assigned_to?, prep_notes? }
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: {
    policy_id:    string
    assigned_to?: string | null
    prep_notes?:  string | null
  }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.policy_id?.trim()) {
    return Response.json({ error: 'policy_id is required' }, { status: 400 })
  }

  // Load the policy so we can derive review_type
  const { data: policy, error: pErr } = await supabase
    .from('service_policies')
    .select('id, product_type')
    .eq('id', body.policy_id)
    .single()

  if (pErr || !policy) {
    return Response.json({ error: 'Policy not found' }, { status: 404 })
  }

  const reviewType = getReviewType(policy.product_type as string | null)

  // ── Auto-generate review number: RV-YYYY-NNN ────────────────────────────
  const year   = new Date().getFullYear()
  const prefix = `RV-${year}-`

  const { data: maxRow } = await supabase
    .from('policy_reviews')
    .select('review_number')
    .like('review_number', `${prefix}%`)
    .order('review_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let seq = 1
  if (maxRow?.review_number) {
    const parts = maxRow.review_number.split('-')
    const last  = parseInt(parts[2] ?? '0', 10)
    if (!isNaN(last)) seq = last + 1
  }
  const reviewNumber = `${prefix}${String(seq).padStart(3, '0')}`

  // ── Insert the review ────────────────────────────────────────────────────
  const { data: review, error: rErr } = await supabase
    .from('policy_reviews')
    .insert({
      review_number: reviewNumber,
      policy_id:     body.policy_id,
      review_type:   reviewType,
      assigned_to:   body.assigned_to?.trim() || null,
      prep_notes:    body.prep_notes?.trim()  || null,
      status:        'prep',
    })
    .select('id, review_number, policy_id, review_type, status')
    .single()

  if (rErr || !review) {
    console.error('policy_review insert error:', rErr)
    return Response.json({ error: rErr?.message ?? 'Failed to create review' }, { status: 500 })
  }

  return Response.json({ data: review }, { status: 201 })
}
