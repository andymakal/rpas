import { createAdminClient } from '@/lib/supabase/admin'
import { generateFlags } from '@/lib/reviews/prep'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/service-policies/[id]
 *
 * Update policy fields. When sa_status is set to 'confirmed' and the policy has
 * actionable flags, auto-queues a policy review if none is already open.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [
    'client_name', 'policy_number', 'carrier', 'product_type',
    'issue_date', 'term_length', 'face_amount', 'death_benefit_amount',
    'cash_value_amount', 'cash_value_as_of_date', 'cost_basis',
    'annual_premium', 'premium_mode', 'rate_class', 'riders',
    'insured_first_name', 'insured_last_name', 'primary_beneficiary',
    'coverage_status', 'sa_status', 'sa_form_sent_at', 'notes',
    'agency_id', 'agent_id', 'customer_id',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('service_policies')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('service_policy patch error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // ── Auto-queue: fire when SA confirmed and policy has flags ──────────────────
  let autoQueuedReview: { id: string; review_number: string } | null = null

  if (patch.sa_status === 'confirmed') {
    try {
      // Re-fetch full policy fields needed by the prep engine
      const { data: full } = await supabase
        .from('service_policies')
        .select(`
          client_name, policy_number, carrier, product_type,
          issue_date, term_length, face_amount, death_benefit_amount,
          cash_value_amount, cost_basis, annual_premium, premium_mode,
          rate_class, riders, insured_first_name, insured_last_name,
          primary_beneficiary
        `)
        .eq('id', id)
        .single()

      if (full) {
        const flags = generateFlags(full)

        if (flags.length > 0) {
          // Check for an already-open review
          const { data: open } = await supabase
            .from('policy_reviews')
            .select('id')
            .eq('policy_id', id)
            .in('status', ['prep', 'scheduled', 'in_progress'])
            .limit(1)

          if (!open?.length) {
            // Generate review number: RV-YYYY-NNN
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

            // Derive review type
            const p = (full.product_type ?? '').toUpperCase()
            const reviewType =
              p === 'UL' || p === 'VUL' ? 'permanent_ul'
              : p === 'WL' || p === 'PERM' ? 'permanent_wl'
              : 'term'

            const { data: newReview } = await supabase
              .from('policy_reviews')
              .insert({
                review_number: reviewNumber,
                policy_id:     id,
                review_type:   reviewType,
                status:        'prep',
                prep_notes:    `Auto-queued: ${flags.map(f => f.label).join(', ')}`,
              })
              .select('id, review_number')
              .single()

            if (newReview) autoQueuedReview = newReview
          }
        }
      }
    } catch (autoErr) {
      // Non-fatal — log but don't fail the PATCH
      console.error('Auto-queue error:', autoErr)
    }
  }

  return Response.json({ data, auto_queued_review: autoQueuedReview })
}
