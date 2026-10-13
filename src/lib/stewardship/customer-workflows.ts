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
  // Outreach finished (servicing access being/already established) and the
  // prereview is open awaiting the Initial Analysis / review decision.
  | 'awaiting_analysis'

export type ActiveOnboarding = {
  prereview_id: string
  outreach_id: string | null
  phase: OnboardingPhase
  /** Human-readable current status, e.g. a queue label or "Awaiting analysis". */
  status_label: string
  /** The current queue when outreach is live; null once outreach has finished. */
  queue: OutreachQueue | null
  started_at: string
  /** Servicing-access roll-up across the request / known policies. */
  policies_total: number
  policies_confirmed: number
}

export type CompletedOnboardingSummary = {
  /** Whether the customer has any policy with servicing access confirmed. */
  has_confirmed_access: boolean
  policies_total: number
  policies_confirmed: number
  /** True when every known policy has confirmed servicing access. */
  fully_confirmed: boolean
  /** Where completed onboarding hands off next. */
  handoff: 'initial_analysis' | null
}

export type CustomerOnboarding = {
  active: ActiveOnboarding | null
  completed: CompletedOnboardingSummary | null
}

type PrereviewRow = {
  id: string
  decision: string | null
  created_at: string
}

type OutreachRow = {
  id: string
  prereview_id: string
  queue: OutreachQueue
  created_at: string
}

/**
 * Build the onboarding summary for one customer. One small set of reads:
 * open prereview -> its outreach (if any) -> the customer's policies' sa_status.
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

  // 2. The open onboarding work item (decision still null), if any.
  const { data: preRows } = await supabase
    .from('customer_prereviews')
    .select('id, decision, created_at')
    .eq('customer_id', customerId)
    .is('decision', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const prereview = ((preRows ?? []) as PrereviewRow[])[0] ?? null

  let active: ActiveOnboarding | null = null

  if (prereview) {
    // Is outreach still running for this open item?
    const { data: outRows } = await supabase
      .from('stewardship_outreach')
      .select('id, prereview_id, queue, created_at')
      .eq('prereview_id', prereview.id)
      .limit(1)
    const outreach = ((outRows ?? []) as OutreachRow[])[0] ?? null

    if (outreach) {
      active = {
        prereview_id: prereview.id,
        outreach_id: outreach.id,
        phase: 'outreach',
        status_label: QUEUE_META[outreach.queue]?.label ?? 'In outreach',
        queue: outreach.queue,
        started_at: prereview.created_at,
        policies_total: policiesTotal,
        policies_confirmed: policiesConfirmed,
      }
    } else {
      // Outreach finished (row deleted on full confirmation) but the prereview
      // is still open: the customer is awaiting the Initial Analysis / review
      // decision. This is the handoff into the analysis preparation process.
      active = {
        prereview_id: prereview.id,
        outreach_id: null,
        phase: 'awaiting_analysis',
        status_label: 'Awaiting Initial Analysis',
        queue: null,
        started_at: prereview.created_at,
        policies_total: policiesTotal,
        policies_confirmed: policiesConfirmed,
      }
    }
  }

  // 3. Completed summary: present whenever any servicing access is confirmed,
  //    so a finished onboarding is legible on the record even after the active
  //    item is resolved. The detailed history stays in touches/notes.
  const completed: CompletedOnboardingSummary | null =
    policiesConfirmed > 0
      ? {
          has_confirmed_access: true,
          policies_total: policiesTotal,
          policies_confirmed: policiesConfirmed,
          fully_confirmed: policiesTotal > 0 && policiesConfirmed === policiesTotal,
          handoff: 'initial_analysis',
        }
      : null

  return { active, completed }
}
