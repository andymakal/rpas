/**
 * Project Population Builder — server-side engine wrapper.
 *
 * Thin TypeScript layer over the SQL population functions
 * (20261010000001_project_population_engine.sql). All heavy lifting — the active
 * predicate, facet filtering, narrowing counts — lives in SQL; this module just
 * calls the functions through the service-role client and shapes the result for
 * the API, including resolving the agency facet's ids to human labels.
 *
 * Server-only (uses the service-role admin client). Never import into a client
 * component.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { PopulationCriteria, DiscreteFacetId } from './population-criteria'

export type FacetValue = { value: string; label: string; count: number }
export type RangeBound = { min: number | null; max: number | null }

export type PopulationFacets = {
  discrete: Record<string, FacetValue[]>
  range: Record<string, RangeBound>
}

export type PopulationSummary = {
  policyCount: number
  customerCount: number
}

export type AmbiguousStatus = { coverage_status: string; policy_count: number }

export type PopulationPreview = PopulationSummary & {
  facets: PopulationFacets
  /**
   * Coverage statuses an active-only population excludes because they cannot be
   * classified as in force or terminated (e.g. NFO elections). Reported so the
   * exclusion is explicit, never silent. Only meaningful when activeOnly.
   */
  ambiguousStatuses: AmbiguousStatus[]
}

export type CommitResult = {
  run_id: string
  run_number: number
  matched_policies: number
  matched_customers: number
  added_customers: number
  already_in_project: number
}

/** Sentinel used in SQL for a NULL discrete value, surfaced as "Not set". */
const NULL_SENTINEL = '\u2205' // ∅
const NULL_LABEL = 'Not set'

type Rpc = ReturnType<typeof createAdminClient>

async function summary(sb: Rpc, criteria: PopulationCriteria): Promise<PopulationSummary> {
  const { data, error } = await sb.rpc('project_population_summary', { c: criteria })
  if (error) throw new Error(`population_summary: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return {
    policyCount: Number(row?.policy_count ?? 0),
    customerCount: Number(row?.customer_count ?? 0),
  }
}

/**
 * Resolve agency ids (the raw values of the `agency` discrete facet) to display
 * labels. Other discrete facets are already human-readable text.
 */
async function agencyLabels(sb: Rpc, ids: string[]): Promise<Map<string, string>> {
  const real = ids.filter(id => id && id !== NULL_SENTINEL)
  if (real.length === 0) return new Map()
  const { data } = await sb
    .from('agencies')
    .select('id, name, display_name')
    .in('id', real)
  const map = new Map<string, string>()
  for (const a of data ?? []) {
    map.set(a.id as string, ((a.display_name as string | null) || (a.name as string)) ?? (a.id as string))
  }
  return map
}

/** Age facets whose bounds the caller actually needs (because the user opened them). */
export type AgeFacetId = 'customer_age' | 'insured_age'

async function facets(
  sb: Rpc,
  criteria: PopulationCriteria,
  ageFacets: AgeFacetId[],
): Promise<PopulationFacets> {
  // age_facets drives lazy age: the SQL computes customer/insured age bounds
  // only for the facets named here (opened by the user) or when that age
  // criterion is applied. Empty => no age/DOB work unless a criterion is set.
  const { data, error } = await sb.rpc('project_population_facets', {
    c: criteria,
    age_facets: ageFacets,
  })
  if (error) throw new Error(`population_facets: ${error.message}`)

  const raw = (data ?? {}) as {
    discrete?: Record<string, { value: string | null; count: number }[]>
    range?: Record<string, RangeBound>
  }

  const discreteRaw = raw.discrete ?? {}

  // Resolve agency labels up front.
  const agencyIds = (discreteRaw['agency'] ?? []).map(v => v.value ?? NULL_SENTINEL)
  const aLabels = await agencyLabels(sb, agencyIds)

  const discrete: Record<string, FacetValue[]> = {}
  for (const [facetId, values] of Object.entries(discreteRaw)) {
    discrete[facetId] = (values ?? []).map(v => {
      const value = v.value ?? NULL_SENTINEL
      let label: string
      if (value === NULL_SENTINEL) label = NULL_LABEL
      else if (facetId === 'agency') label = aLabels.get(value) ?? value
      else label = value
      return { value, label, count: Number(v.count ?? 0) }
    })
  }

  const range: Record<string, RangeBound> = {}
  for (const [facetId, bound] of Object.entries(raw.range ?? {})) {
    range[facetId] = {
      min: bound?.min != null ? Number(bound.min) : null,
      max: bound?.max != null ? Number(bound.max) : null,
    }
  }

  return { discrete, range }
}

async function ambiguousStatuses(sb: Rpc): Promise<AmbiguousStatus[]> {
  const { data, error } = await sb.rpc('project_population_ambiguous_statuses')
  if (error) throw new Error(`ambiguous_statuses: ${error.message}`)
  return (data ?? []).map((r: { coverage_status: string; policy_count: number }) => ({
    coverage_status: r.coverage_status,
    policy_count: Number(r.policy_count ?? 0),
  }))
}

/**
 * Full preview: headline counts + narrowed facet values/bounds + ambiguous-status
 * report. `ageFacets` names the age facets the user has opened; their bounds are
 * computed on demand. When empty (no age facet open), age bounds are produced
 * only for an age facet whose criterion is applied — otherwise no DOB/age work.
 */
export async function previewPopulation(
  criteria: PopulationCriteria,
  ageFacets: AgeFacetId[] = [],
): Promise<PopulationPreview> {
  const sb = createAdminClient()
  const [s, f, amb] = await Promise.all([
    summary(sb, criteria),
    facets(sb, criteria, ageFacets),
    ambiguousStatuses(sb),
  ])
  return { ...s, facets: f, ambiguousStatuses: amb }
}

/**
 * Atomically commit a population into a project (run + new customers + matches)
 * via the project_population_commit SQL function. All-or-nothing: any failure
 * rolls back the entire commit. Throws on error (route maps to a 4xx/5xx).
 */
export async function commitPopulation(
  projectId: string,
  criteria: PopulationCriteria,
  userId: string,
): Promise<CommitResult> {
  const sb = createAdminClient()
  const { data, error } = await sb.rpc('project_population_commit', {
    p_project_id: projectId,
    p_criteria: criteria,
    p_user: userId,
  })
  if (error) {
    // Surface the engine's explicit errors as typed messages.
    throw new Error(error.message)
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Commit returned no result')
  return {
    run_id: row.run_id as string,
    run_number: Number(row.run_number),
    matched_policies: Number(row.matched_policies),
    matched_customers: Number(row.matched_customers),
    added_customers: Number(row.added_customers),
    already_in_project: Number(row.already_in_project),
  }
}

/** Just the headline counts (lighter call used while the user drags sliders). */
export async function summarizePopulation(criteria: PopulationCriteria): Promise<PopulationSummary> {
  const sb = createAdminClient()
  return summary(sb, criteria)
}

export { NULL_SENTINEL }
export type { DiscreteFacetId }
