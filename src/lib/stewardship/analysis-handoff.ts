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
  /** Overall outcome, persisted to customer_prereviews.handoff_status. */
  status: 'done' | 'failed'
  /** How the handoff resolved, for the audit note / UI. */
  mode: 'created_review' | 'reused_review' | 'project_prep' | 'none'
  /** Error detail when status = 'failed' (also persisted to handoff_error). */
  error: string | null
  /** 1 when a review was created, 0 otherwise. */
  reviewsCreated: number
  /** Policies attached to the review (0 for the project-prep path). */
  policiesCovered: number
}

/**
 * Hand a just-completed onboarding into the existing Initial Analysis
 * preparation process, then mark the pre-review decided ('review_now').
 *
 * Two cases, so a project's own review-preparation workflow is preserved and
 * NOT duplicated:
 *
 *   - Customer IS in an ACTIVE project that CONTAINS the Review Preparation
 *     workflow: that project's own review preparation (the derived
 *     operations_prep stage over service_policies.sa_status +
 *     project_customer_reviews) IS the Initial Analysis prep. Creating a general
 *     policy_review on top would be duplicate work, so we do NOT create one —
 *     the project workflow already surfaces the prep. We still mark the decision
 *     review_now.
 *
 *   - Otherwise (non-project onboarding): create ONE policy_review in 'prep'
 *     (prereview_id is UNIQUE — one review per pre-review) covering every
 *     confirmed policy via the policy_review_policies bridge, so it appears on
 *     /reviews as actionable Initial Analysis prep.
 *
 * The outcome is RETURNED (not swallowed): on any failure, status='failed' with
 * an error, so the caller can persist it to customer_prereviews.handoff_status /
 * handoff_error and a failed handoff is never silently lost. Idempotent: a
 * review already linked to the pre-review is reused.
 */
export async function handoffToInitialAnalysis(
  supabase: SupabaseClient,
  args: { prereviewId: string; customerId: string; policyIds: string[] },
): Promise<HandoffResult> {
  const result: HandoffResult = {
    status: 'done', mode: 'none', error: null, reviewsCreated: 0, policiesCovered: 0,
  }
  const policyIds = Array.from(new Set(args.policyIds.filter(Boolean)))

  try {
    // Is the customer in an ACTIVE project that contains the Review Preparation
    // workflow? If so, that project's own review-preparation owns the downstream
    // prep; do not create a competing general review.
    const inActiveReviewProject = await customerInActiveReviewProject(supabase, args.customerId)

    if (inActiveReviewProject) {
      result.mode = 'project_prep'
    } else if (policyIds.length === 0) {
      result.mode = 'none'
    } else {
      // Reuse an existing review for this pre-review if one is already linked
      // (prereview_id is unique) — makes the handoff idempotent.
      const { data: existing } = await supabase
        .from('policy_reviews')
        .select('id')
        .eq('prereview_id', args.prereviewId)
        .maybeSingle()

      let reviewId = existing?.id ?? null
      if (reviewId) {
        result.mode = 'reused_review'
      } else {
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
          throw new Error(`policy_review insert failed: ${insErr?.message ?? 'unknown'}`)
        }
        reviewId = inserted.id
        result.mode = 'created_review'
        result.reviewsCreated = 1
      }

      // Bridge every confirmed policy to the one review (idempotent upsert).
      const bridgeRows = policyIds.map(pid => ({ policy_review_id: reviewId as string, policy_id: pid }))
      const { error: bridgeErr } = await supabase
        .from('policy_review_policies')
        .upsert(bridgeRows, { onConflict: 'policy_review_id,policy_id', ignoreDuplicates: true })
      if (bridgeErr) {
        throw new Error(`policy_review_policies upsert failed: ${bridgeErr.message}`)
      }
      result.policiesCovered = policyIds.length
    }

    // Record the producer-facing decision so the item leaves the outreach board.
    await markPrereviewReviewNow(supabase, args.prereviewId)
    result.status = 'done'
    return result
  } catch (e) {
    result.status = 'failed'
    result.error = e instanceof Error ? e.message : String(e)
    console.error('analysis handoff failed:', result.error)
    return result
  }
}

/**
 * Whether the customer belongs to an ACTIVE project that CONTAINS the Review
 * Preparation workflow — i.e. a project whose own review-preparation workflow
 * owns the downstream prep, so the general handoff must NOT create a competing
 * review. This is resolved from the project_workflows WIRING (data), never the
 * project type name.
 *
 * Fallback (pre-migration, when the workflow tables are absent): preserve the
 * prior behavior by testing the seeded "1035 Exchange" project type, so the
 * handoff branch is unchanged until the migration lands and then becomes
 * workflow-driven automatically.
 */
async function customerInActiveReviewProject(
  supabase: SupabaseClient,
  customerId: string,
): Promise<boolean> {
  // Projects (active) the customer belongs to.
  const { data: memberships } = await supabase
    .from('project_customers')
    .select('project_id, projects!inner ( status )')
    .eq('customer_id', customerId)
    .eq('projects.status', 'active')
  const projectIds = Array.from(
    new Set(((memberships ?? []) as { project_id: string }[]).map((m) => m.project_id)),
  )
  if (projectIds.length === 0) return false

  // Does any of those projects contain the review_preparation workflow?
  const { data: wired, error } = await supabase
    .from('project_workflows')
    .select('project_id, workflows!inner ( key )')
    .in('project_id', projectIds)
    .eq('workflows.key', 'review_preparation')
    .limit(1)
  if (!error) return (wired ?? []).length > 0

  // Fallback: workflow tables not present yet — preserve the prior 1035-type test.
  const { data: legacy } = await supabase
    .from('project_customers')
    .select('project_id, projects!inner ( status, project_types!inner ( name ) )')
    .eq('customer_id', customerId)
    .eq('projects.status', 'active')
    .eq('projects.project_types.name', '1035 Exchange')
    .limit(1)
  return (legacy ?? []).length > 0
}

/**
 * Record the producer-facing decision 'review_now' on the pre-review. Scoped to
 * a still-open (decision null) row so a concurrent decision is never clobbered,
 * and so this is safe to call more than once. Throws on a DB error so the caller
 * marks the handoff failed rather than losing it.
 */
async function markPrereviewReviewNow(supabase: SupabaseClient, prereviewId: string): Promise<void> {
  const { error } = await supabase
    .from('customer_prereviews')
    .update({ decision: 'review_now' })
    .eq('id', prereviewId)
    .is('decision', null)
  if (error) {
    throw new Error(`prereview decision update failed: ${error.message}`)
  }
}
