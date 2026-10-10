import { NextRequest } from 'next/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { normalizeCriteria } from '@/lib/projects/population-criteria'
import { previewPopulation, summarizePopulation } from '@/lib/projects/population-engine'

/**
 * POST /api/projects/population/preview
 *
 * Administrative-only. Given a population criteria snapshot, returns the live
 * matching policy count, distinct customer count, and (unless summaryOnly) the
 * faceted available values + counts and range bounds — all computed against the
 * real service_policies book. Nothing is written.
 *
 * Body: { criteria: PopulationCriteria, summaryOnly?: boolean }
 */
export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: { criteria?: unknown; summaryOnly?: boolean; ageFacets?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const criteria = normalizeCriteria(body.criteria)

  // Which age facets the user has opened (so their bounds are computed on
  // demand). Only the two age facets are honored; anything else is ignored.
  const ageFacets = (Array.isArray(body.ageFacets) ? body.ageFacets : []).filter(
    (f): f is 'customer_age' | 'insured_age' => f === 'customer_age' || f === 'insured_age',
  )

  try {
    if (body.summaryOnly) {
      const summary = await summarizePopulation(criteria)
      return Response.json({ data: { ...summary, criteria } })
    }
    const preview = await previewPopulation(criteria, ageFacets)
    return Response.json({ data: { ...preview, criteria } })
  } catch (err) {
    console.error('population preview error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Preview failed' },
      { status: 500 },
    )
  }
}
