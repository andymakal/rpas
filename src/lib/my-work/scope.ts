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
import { onboardingCompleteForPolicies, activeProjectsWithWorkflow } from '@/lib/projects/workflows'
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
  // scope needs (customer id only; contact facts are not needed here). Paged so
  // a board larger than PostgREST's default row cap is never silently
  // truncated: a truncated board would drop legitimate My Work customers from
  // the scope and make them unsearchable.
  const boardRows = await fetchAllRows<BoardRow>((from, to) =>
    supabase
      .from('stewardship_outreach')
      .select('refused_at, customer_prereviews!inner ( decision, customer_id )')
      .range(from, to),
  )

  const openRows = boardRows.filter(
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
      // Paged within the chunk: 300 customers can hold more policy rows than the
      // default cap, so read every page before judging onboarding completion.
      const pols = await fetchAllRows<{
        customer_id: string
        product_type: string | null
        sa_status: string | null
      }>((from, to) =>
        supabase
          .from('service_policies')
          .select('customer_id, product_type, sa_status, is_test')
          .in('customer_id', chunk)
          .eq('is_test', false)
          .range(from, to),
      )
      for (const p of pols) {
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
    for (let i = 0; i < openCustomerIds.length; i += 300) {
      const chunk = openCustomerIds.slice(i, i + 300)
      const memberships = await fetchAllRows<{ customer_id: string; project_id: string }>((from, to) =>
        supabase
          .from('project_customers')
          .select('customer_id, project_id')
          .in('customer_id', chunk)
          .range(from, to),
      )
      for (const m of memberships) {
        const set = projectsByCustomer.get(m.customer_id) ?? new Set<string>()
        set.add(m.project_id)
        projectsByCustomer.set(m.customer_id, set)
      }
    }
  }

  // The project's declared membership (when scoped), used both to intersect the
  // board set and to seed the derived onboarding population. Paged so a project
  // larger than the default row cap never silently loses members — the core
  // "search reliably regardless of project size" guarantee.
  let projectMemberIds: Set<string> | null = null
  if (projectId) {
    projectMemberIds = await fetchProjectMemberIds(supabase, projectId)
  }

  const result = new Set<string>()

  // Recorded, actionable board customers.
  for (const cid of openCustomerIds) {
    if (projectMemberIds && !projectMemberIds.has(cid)) continue
    const itemProjects = projectsByCustomer.get(cid) ?? new Set<string>()
    if (!canActOnItem(profile, 'outreach', outreachRequiredQual, itemProjects)) continue
    result.add(cid)
  }

  // Derived, record-less onboarding members. A customer whose project runs
  // Servicing Agent Onboarding is actionable outreach the moment the project is
  // populated, before any stewardship record exists — exactly as My Work counts
  // them. They must therefore be searchable in the My Work scope too.
  //
  //   - scoped to one project: derive that project's onboarding members.
  //   - all projects: derive for EVERY active project that runs onboarding, so
  //     the all-projects My Work scope includes onboarding customers from every
  //     project the employee can act on (not only a selected one).
  const onboardingProjectIds: string[] = projectId
    ? projectMemberIds && projectMemberIds.size > 0 ? [projectId] : []
    : (await activeProjectsWithWorkflow(supabase, 'servicing_agent_onboarding') ?? []).map((p) => p.id)

  for (const pid of onboardingProjectIds) {
    const memberIds = projectId ? projectMemberIds! : await fetchProjectMemberIds(supabase, pid)
    if (memberIds.size === 0) continue
    const derived = await deriveOnboardingPopulation(supabase, pid, {
      memberCustomerIds: memberIds,
      excludeCustomerIds: boardCustomerIds,
    })
    const projectScope = new Set<string>([pid])
    for (const d of derived) {
      if (canActOnItem(profile, 'outreach', outreachRequiredQual, projectScope)) {
        result.add(d.customerId)
      }
    }
  }

  return result
}

/** All member customer ids of a project, paged past the default row cap. */
async function fetchProjectMemberIds(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<Set<string>> {
  const rows = await fetchAllRows<{ customer_id: string }>((from, to) =>
    supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', projectId)
      .range(from, to),
  )
  return new Set(rows.map((r) => r.customer_id))
}

/**
 * Read every row of a PostgREST query, paging with .range() until a short page
 * proves the end. PostgREST caps a single response (~1000 rows by default), so
 * any unpaged read of a potentially large set silently truncates — which for a
 * scope read would drop legitimate customers. This keeps every scope read
 * complete regardless of size.
 */
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(`My Work scope read failed: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}
