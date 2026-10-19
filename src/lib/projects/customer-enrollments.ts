import type { createAdminClient } from '@/lib/supabase/admin'
import type { HistoryEnrollmentRow } from '@/lib/stewardship/customer-history'

/**
 * Read a customer's project-enrollment events for the shared Customer History.
 *
 * Source: the deduped membership records (project_customers), one row per
 * customer per project — the row recording the run that FIRST added them. A
 * later draw that re-includes an already-enrolled customer does not create a
 * second membership row (enforced by project_customers_unique and the
 * not-exists guard in project_population_commit), so this naturally yields one
 * "Added to Project" event per customer per project and never duplicates on
 * subsequent draws.
 *
 * Attribution: the operator who ran the draw lives on the run
 * (project_runs.started_by, an auth.users id). We resolve it to a display name
 * via staff_profiles, matching how case_touches attribution reads. When the run
 * is absent (manual add / deleted run) or the user has no staff_profiles row,
 * the attribution is simply omitted — the event still shows, honestly, without
 * a fabricated name.
 *
 * This is display-only and reuses existing records; it writes nothing and does
 * not create a separate history store.
 */
export async function getCustomerEnrollmentEvents(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
): Promise<HistoryEnrollmentRow[]> {
  const { data, error } = await admin
    .from('project_customers')
    .select(
      'id, added_at, projects!project_id ( name ), project_runs!added_by_run_id ( started_by )',
    )
    .eq('customer_id', customerId)
    .order('added_at', { ascending: false })

  if (error || !data) return []

  type Row = {
    id: string
    added_at: string
    projects: { name: string | null } | null
    project_runs: { started_by: string | null } | null
  }
  const rows = data as unknown as Row[]

  // Resolve the operators (run started_by user ids) to display names in one
  // batched lookup, the same name source case_touches attribution uses.
  const userIds = Array.from(
    new Set(
      rows
        .map((r) => r.project_runs?.started_by)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  )
  const nameById = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('staff_profiles')
      .select('id, display_name')
      .in('id', userIds)
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) nameById.set(p.id, p.display_name)
    }
  }

  return rows
    .filter((r) => !!r.projects?.name)
    .map((r) => ({
      id: r.id,
      project_name: r.projects!.name as string,
      added_at: r.added_at,
      added_by: r.project_runs?.started_by
        ? nameById.get(r.project_runs.started_by) ?? null
        : null,
    }))
}
