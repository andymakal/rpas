/**
 * Initial Analysis handoff for completed servicing-agent onboarding.
 *
 * When an onboarding run completes (every request policy's servicing agent is
 * confirmed), the customer must flow into the existing Initial Analysis
 * preparation process — and this must work for EVERY completed onboarding, not
 * only customers inside a 1035 project.
 *
 * The existing Initial Analysis vehicle in Right Path is policy_reviews
 * (status 'prep'): the same records the annual-review cron and the manual
 * "new review" button create, surfaced on the /reviews board. So the handoff
 * reuses that vehicle rather than inventing a new one:
 *
 *   - Create ONE policy_review in 'prep' status, linked to the originating
 *     pre-review via prereview_id (which is UNIQUE — one review per pre-review),
 *     covering every confirmed request policy through the policy_review_policies
 *     bridge. It appears on /reviews immediately — an actionable Initial Analysis
 *     prep item, project or not.
 *   - The pre-review's decision is set to 'review_now', which both records the
 *     producer-facing outcome and removes the item from the outreach board
 *     (the board shows only undecided pre-reviews).
 *
 * 1035-project customers ALSO continue to advance through the derived 1035
 * workflow (operations_prep) off service_policies.sa_status; that is unchanged.
 * This handoff is the general path that additionally covers non-project
 * customers, and it is idempotent (it never double-creates a review for a policy
 * that already has an open one).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getReviewType } from '@/lib/reviews/prep'

async function nextReviewNumber(supabase: SupabaseClient): Promise<string> {
  const year = new Date().getFullYear()
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
    const last = parseInt(String(maxRow.review_number).split('-')[2] ?? '0', 10)
    if (!isNaN(last)) seq = last + 1
  }
  return `${prefix}${String(seq).padStart(3, '0')}`
}

export type HandoffResult = {
  /** 1 when a review was created for this prereview, 0 when one already existed. */
  reviewsCreated: number
  /** True when a review already existed for this prereview (idempotent no-op). */
  reviewExisted: boolean
  /** Policies attached to the review (via the policy_review_policies bridge). */
  policiesCovered: number
}

/**
 * Create the Initial Analysis prep review for a just-completed onboarding and
 * mark the pre-review decided ('review_now').
 *
 * Model (from the prereview foundation migration): ONE policy_review per
 * pre-review (policy_reviews.prereview_id is UNIQUE), covering one or more
 * policies via the policy_review_policies bridge. policy_reviews.policy_id is
 * the backward-compatibility anchor (the first confirmed policy). So this
 * creates a single review anchored to the first policy, type-derived from it,
 * and bridges every confirmed request policy.
 *
 * Idempotent and best-effort: if a review already links this pre-review, it is
 * reused (bridge rows are upserted); never throws — a handoff hiccup must not
 * undo the completed confirmation.
 */
export async function handoffToInitialAnalysis(
  supabase: SupabaseClient,
  args: { prereviewId: string; customerId: string; policyIds: string[] },
): Promise<HandoffResult> {
  const result: HandoffResult = { reviewsCreated: 0, reviewExisted: false, policiesCovered: 0 }
  const policyIds = Array.from(new Set(args.policyIds.filter(Boolean)))

  if (policyIds.length === 0) {
    await markPrereviewReviewNow(supabase, args.prereviewId)
    return result
  }

  // Reuse an existing review for this pre-review if one is already linked
  // (prereview_id is unique). This makes the handoff idempotent.
  const { data: existing } = await supabase
    .from('policy_reviews')
    .select('id')
    .eq('prereview_id', args.prereviewId)
    .maybeSingle()

  let reviewId: string | null = existing?.id ?? null

  if (reviewId) {
    result.reviewExisted = true
  } else {
    // Anchor the single review to the first confirmed policy; derive its type
    // from that policy's product_type.
    const { data: anchor } = await supabase
      .from('service_policies')
      .select('id, product_type, customer_id')
      .eq('id', policyIds[0])
      .maybeSingle()
    const reviewNumber = await nextReviewNumber(supabase)
    const { data: inserted, error: insErr } = await supabase
      .from('policy_reviews')
      .insert({
        review_number: reviewNumber,
        policy_id:     policyIds[0],
        customer_id:   anchor?.customer_id ?? args.customerId,
        review_type:   getReviewType(anchor?.product_type ?? null),
        status:        'prep',
        prep_notes:    'Created from completed servicing-agent onboarding (Initial Analysis prep).',
        prereview_id:  args.prereviewId,
      })
      .select('id')
      .single()
    if (insErr || !inserted) {
      console.error('analysis handoff: policy_review insert error', insErr)
      // Still record the decision so the item leaves the outreach board.
      await markPrereviewReviewNow(supabase, args.prereviewId)
      return result
    }
    reviewId = inserted.id
    result.reviewsCreated = 1
  }

  // Bridge every confirmed request policy to the one review. Idempotent via
  // upsert on the composite PK, so re-running adds nothing and never errors on
  // a policy already linked.
  const bridgeRows = policyIds.map(pid => ({ policy_review_id: reviewId as string, policy_id: pid }))
  const { error: bridgeErr } = await supabase
    .from('policy_review_policies')
    .upsert(bridgeRows, { onConflict: 'policy_review_id,policy_id', ignoreDuplicates: true })
  if (bridgeErr) {
    console.error('analysis handoff: policy_review_policies upsert error', bridgeErr)
  } else {
    result.policiesCovered = policyIds.length
  }

  await markPrereviewReviewNow(supabase, args.prereviewId)
  return result
}

/**
 * Record the producer-facing decision 'review_now' on the pre-review. Scoped to
 * a still-open (decision null) row so a concurrent decision is never clobbered,
 * and so this is safe to call more than once.
 */
async function markPrereviewReviewNow(supabase: SupabaseClient, prereviewId: string): Promise<void> {
  const { error } = await supabase
    .from('customer_prereviews')
    .update({ decision: 'review_now', servicing_completed_at: new Date().toISOString() })
    .eq('id', prereviewId)
    .is('decision', null)
  if (error) {
    console.error('analysis handoff: prereview decision update error', error)
  }
}
