/**
 * MY WORK scope resolution (server-only) — Right Path.
 *
 * Returns the set of CUSTOMER IDS that make up the signed-in employee's My Work
 * population: the customers who have open, actionable work this employee could
 * act on. This is the authoritative population the shared customer search
 * intersects with when it is scoped to the My Work context, so a search on My
 * Work can never surface a customer outside the work the screen represents.
 *
 * It deliberately reuses the SAME authoritative reads and the SAME eligibility
 * test the My Work composition (getMyWork) and the stewardship board route use,
 * rather than re-deriving a parallel notion of "my work":
 *   - open shared board: stewardship_outreach joined to customer_prereviews ->
 *     customers, open items only (decision null, not refused);
 *   - onboarding-complete suppression via onboardingCompleteForPolicies over
 *     service_policies (a customer who has advanced past onboarding is not
 *     counted);
 *   - project association via project_customers;
 *   - the shared pick-up test canActOnItem (capability + claim rules);
 *   - derived, record-less onboarding members via deriveOnboardingPopulation,
 *     so a freshly populated project's members are searchable before any record
 *     exists — exactly as My Work counts them.
 *
 * Scope variants:
 *   - no projectId  → the agency-wide actionable set (My Work, all projects).
 *   - with projectId → that set intersected with the project's membership, plus
 *     the project's derived onboarding members (My Work, specific project, and
 *     the project-scoped working screens).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCapabilityProfile, loadWorkFunctions } from '@/lib/capabilities/resolve'
import { canActOnItem } from '@/lib/capabilities/work-functions'
import { onboardingCompleteForPolicies } from '@/lib/projects/workflows'
import { deriveOnboardingPopulation } from '@/lib/stewardship/derived-onboarding'

type BoardRow = {
  refused_at: string | null
  customer_prereviews: {
    decision: string | null
    customer_id: string
  } | null
}

export interface MyWorkScopeOptions {
  /** The signed-in auth user id (maps to a producer). */
  authUserId: string
  /** When set, restrict to this project's population (My Work, one project). */
  projectId?: string | null
}

/**
 * The customer ids in the signed-in employee's My Work population. Empty set
 * when the user has no producer profile (no personal work) — a scoped search
 * then correctly returns nothing rather than the whole database.
 */
export async function getMyWorkCustomerIds(
  options: MyWorkScopeOptions,
): Promise<Set<string>> {
  const supabase = createAdminClient()
  const projectId = options.projectId?.trim() || null

  const [profile, workFunctions] = await Promise.all([
    resolveCapabilityProfile(options.authUserId),
    loadWorkFunctions(),
  ])
  if (!profile) return new Set<string>()

  const outreachRequiredQual =
    workFunctions.find((w) => w.canonicalKey === 'outreach')?.requiredQualification ?? null

  // Open shared board — the same read getMyWork uses, trimmed to the fields the
  // scope needs (customer id only; contact facts are not needed here).
  const { data: boardData, error: boardErr } = await supabase
    .from('stewardship_outreach')
    .select('refused_at, customer_prereviews!inner ( decision, customer_id )')
  if (boardErr) throw new Error(`My Work scope board read failed: ${boardErr.message}`)

  const openRows = ((boardData ?? []) as unknown as BoardRow[]).filter(
    (r) => r.customer_prereviews?.decision == null && r.refused_at == null,
  )
  const boardCustomerIds = Array.from(
    new Set(openRows.map((r) => r.customer_prereviews!.customer_id)),
  )

  // Onboarding-complete suppression (same authoritative fact as getMyWork):
  // a customer whose permanent servicing access is confirmed has advanced past
  // onboarding and is not counted.
  const onboardingComplete = new Set<string>()
  if (boardCustomerIds.length > 0) {
    const policiesByCustomer = new Map<
      string,
      { product_type: string | null; sa_status: string | null }[]
    >()
    for (let i = 0; i < boardCustomerIds.length; i += 300) {
      const chunk = boardCustomerIds.slice(i, i + 300)
      const { data: pols } = await supabase
        .from('service_policies')
        .select('customer_id, product_type, sa_status, is_test')
        .in('customer_id', chunk)
        .eq('is_test', false)
      for (const p of (pols ?? []) as {
        customer_id: string
        product_type: string | null
        sa_status: string | null
      }[]) {
        const list = policiesByCustomer.get(p.customer_id) ?? []
        list.push({ product_type: p.product_type, sa_status: p.sa_status })
        policiesByCustomer.set(p.customer_id, list)
      }
    }
    for (const [cid, policies] of policiesByCustomer) {
      if (policies.length > 0 && onboardingCompleteForPolicies(policies)) {
        onboardingComplete.add(cid)
      }
    }
  }
  const openCustomerIds = boardCustomerIds.filter((id) => !onboardingComplete.has(id))

  // Project association for the open customers, so the pick-up test sees each
  // item's project set (a project-scoped eligibility applies only to its own
  // project's items).
  const projectsByCustomer = new Map<string, Set<string>>()
  if (openCustomerIds.length > 0) {
    const { data: memberships } = await supabase
      .from('project_customers')
      .select('customer_id, project_id')
      .in('customer_id', openCustomerIds)
    for (const m of (memberships ?? []) as { customer_id: string; project_id: string }[]) {
      const set = projectsByCustomer.get(m.customer_id) ?? new Set<string>()
      set.add(m.project_id)
      projectsByCustomer.set(m.customer_id, set)
    }
  }

  // The project's declared membership (when scoped), used both to intersect the
  // board set and to seed the derived onboarding population.
  let projectMemberIds: Set<string> | null = null
  if (projectId) {
    const { data: members } = await supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', projectId)
    projectMemberIds = new Set((members ?? []).map((m: { customer_id: string }) => m.customer_id))
  }

  const result = new Set<string>()

  // Recorded, actionable board customers.
  for (const cid of openCustomerIds) {
    if (projectMemberIds && !projectMemberIds.has(cid)) continue
    const itemProjects = projectsByCustomer.get(cid) ?? new Set<string>()
    if (!canActOnItem(profile, 'outreach', outreachRequiredQual, itemProjects)) continue
    result.add(cid)
  }

  // Derived, record-less onboarding members. Only a project runs onboarding, so
  // this applies when a project is in scope. These members are actionable
  // outreach in that project; gate them with the project's own scope.
  if (projectId && projectMemberIds && projectMemberIds.size > 0) {
    const derived = await deriveOnboardingPopulation(supabase, projectId, {
      memberCustomerIds: projectMemberIds,
      excludeCustomerIds: boardCustomerIds,
    })
    const projectScope = new Set<string>([projectId])
    for (const d of derived) {
      if (canActOnItem(profile, 'outreach', outreachRequiredQual, projectScope)) {
        result.add(d.customerId)
      }
    }
  }

  return result
}
