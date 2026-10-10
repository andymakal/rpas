import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Archived projects are read-only. This guard is the single server-side
 * enforcement point: it is called at the top of every write path that acts ON a
 * project (population, 1035 Step 3 prep/determination, Step 3 documents, and the
 * project-scoped Stewardship start) so that no new activity can be recorded
 * against an archived project, no matter where the request originates.
 *
 * An archived project remains fully readable — this never gates GET paths — and
 * its records are preserved; restoring it (projects.status back to active or
 * completed) makes it writable again. Active and completed projects pass through
 * unchanged: completion is a normal lifecycle state, not a read-only one, so
 * only 'archived' is blocked here.
 *
 * Returns the same discriminated shape as requireInternalAdmin so a caller adds
 * just two lines:
 *
 *   const active = await assertProjectActive(supabase, projectId)
 *   if (!active.ok) return Response.json({ error: active.error }, { status: active.status })
 */
export async function assertProjectActive(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data, error } = await supabase
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .maybeSingle()

  if (error) {
    return { ok: false, status: 500, error: error.message }
  }
  if (!data) {
    return { ok: false, status: 404, error: 'Project not found.' }
  }
  if (data.status === 'archived') {
    return {
      ok: false,
      status: 409,
      error: 'This project is archived and is read-only. Restore it before making changes.',
    }
  }
  return { ok: true }
}
