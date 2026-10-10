import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import { normalizeCriteria } from '@/lib/projects/population-criteria'
import { commitPopulation } from '@/lib/projects/population-engine'

/**
 * POST /api/projects/[id]/population
 *
 * Administrative-only. Commit a population into a project as a new run. The
 * three writes — create the project_run, add only not-already-present
 * project_customers, and record every triggering project_match with evidence —
 * run inside a single transaction via project_population_commit(). Any failure
 * rolls the whole thing back; a partial run/population can never be left behind.
 *
 * Each run is preserved separately (run_number increments; prior runs untouched;
 * existing customers are never removed).
 *
 * Body: { criteria: PopulationCriteria }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId } = await context.params

  // Archived projects are read-only: no new population may be added until the
  // project is restored. Existing runs remain fully viewable.
  const active = await assertProjectActive(createAdminClient(), projectId)
  if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

  let body: { criteria?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const criteria = normalizeCriteria(body.criteria)

  try {
    const result = await commitPopulation(projectId, criteria, auth.userId)
    return Response.json({ data: result }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not add population'
    // Map the engine's explicit, transaction-rolling-back errors to clear codes.
    if (/not found/i.test(message)) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
    if (/population is empty/i.test(message)) {
      return Response.json(
        { error: 'This population is empty. Adjust the filters and preview again before adding.' },
        { status: 400 },
      )
    }
    console.error('population commit error:', err)
    return Response.json({ error: message }, { status: 500 })
  }
}
