/**
 * Project Population Builder — criteria schema and facet metadata.
 *
 * This is the single source of truth for the faceted filter model used by the
 * administrative Population Builder. It defines:
 *   - the JSON shape persisted verbatim in project_runs.criteria
 *   - the catalog of facets (which real Right Path column backs each, and how it
 *     filters: discrete multi-select, numeric/age range, or date)
 *
 * The facet catalog is schema-driven: every facet maps to an actual column on
 * service_policies / customers / agencies. No Cassidy-specific values are
 * hard-coded; discrete value lists and counts are always queried live.
 *
 * PHI: age facets expose AGE ONLY. Date of birth is never surfaced or
 * reconstructed. Age is computed server-side from the DOB column.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Criteria shape (persisted in project_runs.criteria)
// ─────────────────────────────────────────────────────────────────────────────

/** OR-set of discrete string values selected within one field. */
export type DiscreteSelection = string[]

/** Inclusive numeric range. Either bound may be omitted (open-ended). */
export type RangeSelection = {
  min?: number | null
  max?: number | null
}

/** Date filter: before, after, or between (inclusive). */
export type DateSelection = {
  mode: 'before' | 'after' | 'between'
  /** ISO yyyy-mm-dd. `from` used by after/between; `to` used by before/between. */
  from?: string | null
  to?: string | null
}

/** The "has cash value" tri-state used where a quick cash choice is useful. */
export type CashValueChoice = 'any' | 'has' | 'none'

/**
 * The full criteria snapshot. Every part is optional; an empty object means
 * "the default population" (active policies only, no narrowing).
 *
 * `activeOnly` defaults to true when absent — the default population is active
 * policies only.
 */
export type PopulationCriteria = {
  /** Default population is active policies only. Omitted => true. */
  activeOnly?: boolean

  /** Quick cash-value choice. Omitted => 'any'. */
  cashValue?: CashValueChoice

  /** Discrete multi-select facets, keyed by facet id. */
  discrete?: Partial<Record<DiscreteFacetId, DiscreteSelection>>

  /** Numeric / age range facets, keyed by facet id. */
  range?: Partial<Record<RangeFacetId, RangeSelection>>

  /** Date facets, keyed by facet id. */
  date?: Partial<Record<DateFacetId, DateSelection>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Facet catalog
// ─────────────────────────────────────────────────────────────────────────────

export type FacetGroup =
  | 'Book'
  | 'Policy'
  | 'Values'
  | 'Underwriting'
  | 'Customer'
  | 'Insured'
  | 'Policy Mechanics'

export type DiscreteFacetId =
  | 'agency'
  | 'carrier'
  | 'product_type'
  | 'term_length'
  | 'rate_class'
  | 'customer_segment'
  | 'insured_state'

export type RangeFacetId =
  | 'face_amount'
  | 'cash_value'
  | 'annual_premium'
  | 'customer_age'
  | 'insured_age'

export type DateFacetId =
  | 'issue_date'
  | 'termination_date'
  | 'surrender_end_date'

export type FacetId = DiscreteFacetId | RangeFacetId | DateFacetId

export type FacetKind = 'discrete' | 'range' | 'age' | 'date' | 'money'

export type FacetMeta = {
  id: FacetId
  label: string
  group: FacetGroup
  kind: FacetKind
  /** Short unit hint for range facets ($ / years). */
  unit?: 'money' | 'years'
  /** Help text shown under the facet. */
  hint?: string
}

/**
 * Ordered facet catalog. Order drives the UI grouping. Each entry names the
 * real backing column in the engine (see population-engine.ts), keeping this
 * file free of SQL.
 */
export const FACETS: FacetMeta[] = [
  // Book
  { id: 'agency',           label: 'Agency / Book',          group: 'Book',             kind: 'discrete' },

  // Policy
  { id: 'carrier',          label: 'Carrier',                group: 'Policy',           kind: 'discrete' },
  { id: 'product_type',     label: 'Product Type',           group: 'Policy',           kind: 'discrete' },
  { id: 'issue_date',       label: 'Issue Date',             group: 'Policy',           kind: 'date' },
  { id: 'term_length',      label: 'Term Length',            group: 'Policy',           kind: 'discrete' },
  { id: 'termination_date', label: 'Termination Date',       group: 'Policy',           kind: 'date' },

  // Values
  { id: 'face_amount',      label: 'Face Amount',            group: 'Values',           kind: 'money', unit: 'money' },
  { id: 'cash_value',       label: 'Cash Value',             group: 'Values',           kind: 'money', unit: 'money' },
  { id: 'annual_premium',   label: 'Annual Premium',         group: 'Values',           kind: 'money', unit: 'money' },

  // Underwriting
  { id: 'rate_class',       label: 'Underwriting / Rate Class', group: 'Underwriting',  kind: 'discrete' },

  // Customer
  { id: 'customer_age',     label: 'Customer Age',           group: 'Customer',         kind: 'age', unit: 'years',
    hint: 'Filters by age. Date of birth is never shown.' },
  { id: 'customer_segment', label: 'Customer Segment',       group: 'Customer',         kind: 'discrete' },

  // Insured
  { id: 'insured_age',      label: 'Insured Age',            group: 'Insured',          kind: 'age', unit: 'years',
    hint: 'Filters by age. Date of birth is never shown.' },
  { id: 'insured_state',    label: 'Insured State',          group: 'Insured',          kind: 'discrete' },

  // Policy Mechanics
  { id: 'surrender_end_date', label: 'Surrender Charge End Date', group: 'Policy Mechanics', kind: 'date' },
]

export const FACET_GROUPS: FacetGroup[] = [
  'Book', 'Policy', 'Values', 'Underwriting', 'Customer', 'Insured', 'Policy Mechanics',
]

export const DISCRETE_FACET_IDS: DiscreteFacetId[] =
  FACETS.filter(f => f.kind === 'discrete').map(f => f.id as DiscreteFacetId)

export const RANGE_FACET_IDS: RangeFacetId[] =
  FACETS.filter(f => f.kind === 'range' || f.kind === 'age' || f.kind === 'money').map(f => f.id as RangeFacetId)

export const DATE_FACET_IDS: DateFacetId[] =
  FACETS.filter(f => f.kind === 'date').map(f => f.id as DateFacetId)

export function facetMeta(id: FacetId): FacetMeta | undefined {
  return FACETS.find(f => f.id === id)
}

/**
 * Normalize an untrusted criteria object from the client into a safe
 * PopulationCriteria. Unknown facet ids are dropped, types are coerced, and
 * empty selections are omitted. This is the only shape persisted or sent to the
 * SQL engine.
 */
export function normalizeCriteria(input: unknown): PopulationCriteria {
  const out: PopulationCriteria = {}
  if (typeof input !== 'object' || input === null) return { activeOnly: true }
  const o = input as Record<string, unknown>

  out.activeOnly = o.activeOnly === undefined ? true : Boolean(o.activeOnly)

  if (o.cashValue === 'has' || o.cashValue === 'none' || o.cashValue === 'any') {
    out.cashValue = o.cashValue
  }

  const discreteIn = (o.discrete ?? {}) as Record<string, unknown>
  const discrete: Partial<Record<DiscreteFacetId, string[]>> = {}
  for (const id of DISCRETE_FACET_IDS) {
    const arr = discreteIn[id]
    if (Array.isArray(arr)) {
      const vals = arr.filter((v): v is string => typeof v === 'string')
      if (vals.length > 0) discrete[id] = vals
    }
  }
  if (Object.keys(discrete).length > 0) out.discrete = discrete

  const rangeIn = (o.range ?? {}) as Record<string, unknown>
  const range: Partial<Record<RangeFacetId, RangeSelection>> = {}
  for (const id of RANGE_FACET_IDS) {
    const r = rangeIn[id] as Record<string, unknown> | undefined
    if (r && typeof r === 'object') {
      const min = r.min === null || r.min === undefined ? null : Number(r.min)
      const max = r.max === null || r.max === undefined ? null : Number(r.max)
      const minOk = min != null && !Number.isNaN(min)
      const maxOk = max != null && !Number.isNaN(max)
      if (minOk || maxOk) {
        range[id] = { min: minOk ? min : null, max: maxOk ? max : null }
      }
    }
  }
  if (Object.keys(range).length > 0) out.range = range

  const dateIn = (o.date ?? {}) as Record<string, unknown>
  const date: Partial<Record<DateFacetId, DateSelection>> = {}
  for (const id of DATE_FACET_IDS) {
    const d = dateIn[id] as Record<string, unknown> | undefined
    if (d && (d.mode === 'before' || d.mode === 'after' || d.mode === 'between')) {
      const from = typeof d.from === 'string' && d.from ? d.from : null
      const to = typeof d.to === 'string' && d.to ? d.to : null
      if (from || to) date[id] = { mode: d.mode, from, to }
    }
  }
  if (Object.keys(date).length > 0) out.date = date

  return out
}

/** True when the criteria carry no narrowing beyond the active-only default. */
export function isEmptyCriteria(c: PopulationCriteria): boolean {
  const hasDiscrete = c.discrete && Object.values(c.discrete).some(v => (v?.length ?? 0) > 0)
  const hasRange = c.range && Object.values(c.range).some(r => r && (r.min != null || r.max != null))
  const hasDate = c.date && Object.values(c.date).some(d => d && (d.from != null || d.to != null))
  const hasCash = c.cashValue && c.cashValue !== 'any'
  return !hasDiscrete && !hasRange && !hasDate && !hasCash
}
