/**
 * Per-customer onboarding workflow summary for the customer record.
 *
 * The "Servicing-Agent Onboarding" workflow IS the existing Stewardship flow
 * (customer_prereviews + stewardship_outreach + per-policy sa_status on
 * service_policies). This module derives, for ONE customer, a small read model
 * the customer record uses to show:
 *
 *   - ACTIVE workflows: an open customer_prereview (decision IS NULL). Its
 *     human-readable status is derived from the live stewardship_outreach queue
 *     when the outreach is still running, or from the servicing-access picture
 *     once outreach has finished (the prereview stays open for the analysis /
 *     documentation layer).
 *
 *   - A COMPLETED summary: a one-line roll-up of servicing access across the
 *     customer's policies (how many confirmed) so a finished onboarding reads at
 *     a glance. The detailed step-by-step history is NOT duplicated here; it
 *     lives in the customer's touch history and notes, which the record already
 *     shows.
 *
 * This introduces NO new workflow system and NO stored stage. Everything is
 * derived live from existing tables, mirroring the derive-don't-store pattern of
 * the 1035 workflow read model. Nothing here writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { QUEUE_META, type OutreachQueue } from './queues'

export type OnboardingPhase =
  // Outreach is running: the stewardship queue label is the live status.
  | 'outreach'

export type ActiveOnboarding = {
  prereview_id: string
  outreach_id: string | null
  phase: OnboardingPhase
  /** Human-readable current status, e.g. a queue label or "Declined (stopped)". */
  status_label: string
  /** The current queue when outreach is live. */
  queue: OutreachQueue | null
  /** When set, the customer declined; outreach is stopped until reopened. */
  refused_at: string | null
  started_at: string
  /** Servicing-access roll-up across the request / known policies. */
  policies_total: number
  policies_confirmed: number
}

export type CompletedOnboardingSummary = {
  /** When the onboarding run completed (durable; not inferred from sa_status). */
  completed_at: string
  /** Policies with confirmed servicing access at the time of this read. */
  policies_total: number
  policies_confirmed: number
  /** True when every known policy has confirmed servicing access. */
  fully_confirmed: boolean
  /** Where completed onboarding hands off next. */
  handoff: 'initial_analysis'
}

export type CustomerOnboarding = {
  active: ActiveOnboarding | null
  completed: CompletedOnboardingSummary | null
}

type PrereviewRow = {
  id: string
  decision: string | null
  created_at: string
  servicing_completed_at: string | null
}

type OutreachRow = {
  id: string
  prereview_id: string
  queue: OutreachQueue
  created_at: string
  refused_at: string | null
}

/**
 * Build the onboarding summary for one customer.
 *
 * ACTIVE is an in-progress onboarding: an OPEN pre-review (decision null) with a
 * live stewardship_outreach row. Completion is NOT inferred from sa_status.
 *
 * COMPLETED is driven by the durable, non-derivable marker
 * customer_prereviews.servicing_completed_at — recorded exactly when an
 * onboarding run finished (every request policy confirmed). A policy reaching
 * sa_status = 'confirmed' by some unrelated route does NOT, on its own, make
 * this read report a completed onboarding.
 */
export async function getCustomerOnboarding(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CustomerOnboarding> {
  // 1. Servicing-access roll-up across the customer's known non-test policies.
  const { data: policyRows } = await supabase
    .from('service_policies')
    .select('sa_status')
    .eq('customer_id', customerId)
    .eq('is_test', false)
  const policies = (policyRows ?? []) as { sa_status: string | null }[]
  const policiesTotal = policies.length
  const policiesConfirmed = policies.filter(p => p.sa_status === 'confirmed').length

  // 2. The OPEN onboarding work item (decision null) and the most recent
  //    COMPLETED one (servicing_completed_at set), in one read.
  const { data: preRows } = await supabase
    .from('customer_prereviews')
    .select('id, decision, created_at, servicing_completed_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  const prereviews = (preRows ?? []) as PrereviewRow[]
  const openPrereview = prereviews.find(p => p.decision == null) ?? null
  const completedPrereview = prereviews.find(p => p.servicing_completed_at != null) ?? null

  let active: ActiveOnboarding | null = null

  if (openPrereview) {
    // Is outreach still running for this open item?
    const { data: outRows } = await supabase
      .from('stewardship_outreach')
      .select('id, prereview_id, queue, created_at, refused_at')
      .eq('prereview_id', openPrereview.id)
      .limit(1)
    const outreach = ((outRows ?? []) as OutreachRow[])[0] ?? null

    if (outreach) {
      active = {
        prereview_id: openPrereview.id,
        outreach_id: outreach.id,
        phase: 'outreach',
        status_label: outreach.refused_at
          ? 'Declined — outreach stopped'
          : (QUEUE_META[outreach.queue]?.label ?? 'In outreach'),
        queue: outreach.queue,
        refused_at: outreach.refused_at,
        started_at: openPrereview.created_at,
        policies_total: policiesTotal,
        policies_confirmed: policiesConfirmed,
      }
    }
    // An open pre-review with NO outreach row is an edge/legacy state (the
    // completion path sets decision=review_now, which clears "open"). We do not
    // fabricate an "awaiting analysis" active item from it — completion is
    // reported from the durable marker below, and the handoff creates the
    // actionable review that represents the next step.
  }

  // 3. Completed summary: driven by the durable completion marker, NOT by
  //    incidental sa_status. The confirmed-policy counts are reported from the
  //    live roll-up for context.
  const completed: CompletedOnboardingSummary | null = completedPrereview
    ? {
        completed_at: completedPrereview.servicing_completed_at as string,
        policies_total: policiesTotal,
        policies_confirmed: policiesConfirmed,
        fully_confirmed: policiesTotal > 0 && policiesConfirmed === policiesTotal,
        handoff: 'initial_analysis',
      }
    : null

  return { active, completed }
}
