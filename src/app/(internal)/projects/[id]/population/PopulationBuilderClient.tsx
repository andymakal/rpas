'use client'

/**
 * Project Population Builder — faceted filter interface.
 *
 * Left: live counts (matching policies + distinct customers), applied filters,
 * and the Preview / Add to Project actions. Right: the facet groups.
 *
 * This is a faceted filter, not a spreadsheet and not an "add condition"
 * builder. Available discrete values and their counts update as filters narrow
 * the population; the headline counts update continuously (debounced).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Eye, FolderPlus, X, Filter } from 'lucide-react'
import {
  FACET_GROUPS,
  FACETS,
  facetMeta,
  type PopulationCriteria,
  type FacetGroup,
  type DiscreteFacetId,
  type RangeFacetId,
  type DateFacetId,
  type RangeSelection,
  type DateSelection,
} from '@/lib/projects/population-criteria'
import type { PopulationFacets, AmbiguousStatus } from '@/lib/projects/population-engine'
import { DiscreteFacet, RangeFacet, DateFacet, FacetShell } from './facet-controls'
import { cn } from '@/lib/utils'

type PreviewResponse = {
  policyCount: number
  customerCount: number
  facets?: PopulationFacets
  ambiguousStatuses?: AmbiguousStatus[]
}

const DEFAULT_CRITERIA: PopulationCriteria = { activeOnly: true, cashValue: 'any' }

export function PopulationBuilderClient({
  projectId,
  projectName,
  projectType,
  existingCustomerCount,
}: {
  projectId: string
  projectName: string
  projectType: string
  existingCustomerCount: number
}) {
  const router = useRouter()

  const [criteria, setCriteria] = useState<PopulationCriteria>(DEFAULT_CRITERIA)
  const [facets, setFacets] = useState<PopulationFacets | null>(null)
  const [counts, setCounts] = useState<{ policyCount: number; customerCount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ambiguous, setAmbiguous] = useState<AmbiguousStatus[]>([])

  // Which age facets the user has OPENED. Age bounds are requested on demand only
  // for these (the server also computes bounds for an age facet whose criterion
  // is applied). When empty and no age criterion is set, the server does no
  // DOB/age work at all.
  const [openAgeFacets, setOpenAgeFacets] = useState<Set<'customer_age' | 'insured_age'>>(new Set())

  const [committing, setCommitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const reqSeq = useRef(0)

  // Fetch preview (counts + facets) whenever criteria change. Debounced so slider
  // typing doesn't spam the server; always fetches facets so value lists narrow.
  const runPreview = useCallback(async (c: PopulationCriteria, ageFacets: string[]) => {
    const seq = ++reqSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects/population/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: c, ageFacets }),
      })
      const json = await res.json()
      if (seq !== reqSeq.current) return // a newer request superseded this one
      if (!res.ok) throw new Error(json.error ?? 'Preview failed')
      const data = json.data as PreviewResponse
      setCounts({ policyCount: data.policyCount, customerCount: data.customerCount })
      if (data.facets) setFacets(data.facets)
      if (data.ambiguousStatuses) setAmbiguous(data.ambiguousStatuses)
    } catch (err) {
      if (seq !== reqSeq.current) return
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ageFacets = Array.from(openAgeFacets)
    const t = setTimeout(() => runPreview(criteria, ageFacets), 300)
    return () => clearTimeout(t)
  }, [criteria, openAgeFacets, runPreview])

  // Open/close an age facet: opening requests its bounds on demand; closing stops
  // requesting them. The effect above re-runs the preview when this set changes.
  const setAgeFacetOpen = useCallback((id: 'customer_age' | 'insured_age', open: boolean) => {
    setOpenAgeFacets(prev => {
      const has = prev.has(id)
      if (open === has) return prev
      const next = new Set(prev)
      if (open) next.add(id); else next.delete(id)
      return next
    })
  }, [])

  // ── criteria mutators ──────────────────────────────────────────────────────
  const setDiscrete = (id: DiscreteFacetId, next: string[]) =>
    setCriteria(c => {
      const discrete = { ...(c.discrete ?? {}) }
      if (next.length === 0) delete discrete[id]
      else discrete[id] = next
      return { ...c, discrete }
    })

  const setRange = (id: RangeFacetId, next: RangeSelection | undefined) =>
    setCriteria(c => {
      const range = { ...(c.range ?? {}) }
      if (!next) delete range[id]
      else range[id] = next
      return { ...c, range }
    })

  const setDate = (id: DateFacetId, next: DateSelection | undefined) =>
    setCriteria(c => {
      const date = { ...(c.date ?? {}) }
      if (!next) delete date[id]
      else date[id] = next
      return { ...c, date }
    })

  const resetAll = () => setCriteria(DEFAULT_CRITERIA)

  // ── applied-filter chips ─────────────────────────────────────────────────────
  const appliedChips = useMemo(() => buildChips(criteria, facets), [criteria, facets])

  async function commit() {
    setCommitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/population`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not add population')
      // Flow: Add to Project -> Open Project.
      router.push(`/projects/${projectId}`)
    } catch (err) {
      setCommitting(false)
      setConfirmOpen(false)
      setError(err instanceof Error ? err.message : 'Could not add population')
    }
  }

  const customerCount = counts?.customerCount ?? 0
  const policyCount = counts?.policyCount ?? 0
  const canCommit = !loading && !committing && customerCount > 0

  return (
    <div className="mx-auto w-full max-w-[1360px] px-6 py-8 text-ink-secondary sm:px-10">
      <Link
        href={`/projects/${projectId}`}
        className="-ml-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-supporting transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to project
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Build Population
        </h1>
        <p className="mt-1 text-lg text-ink-supporting">
          {projectName}
          {projectType && <span className="text-ink-muted"> · {projectType}</span>}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        {/* ── Left column: counts, applied filters, actions ──────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-2xl border border-teal-100 bg-white p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
              Matching population
            </h2>
            <div className="mt-3 flex items-end gap-6">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-4xl font-bold tabular-nums text-teal-700">
                    {customerCount.toLocaleString()}
                  </span>
                  {loading && <Loader2 className="size-4 animate-spin text-teal-500" aria-hidden />}
                </div>
                <p className="text-sm font-medium text-slate-600">customers</p>
              </div>
              <div>
                <span className="text-2xl font-semibold tabular-nums text-slate-700">
                  {policyCount.toLocaleString()}
                </span>
                <p className="text-sm text-slate-500">policies</p>
              </div>
            </div>
            {existingCustomerCount > 0 && (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {existingCustomerCount.toLocaleString()} customer{existingCustomerCount === 1 ? '' : 's'} already in this
                project. Customers already added will not be duplicated.
              </p>
            )}

            {/* Ambiguous statuses: when active-only is on, report the statuses
                that are excluded because they can't be classified as in force or
                terminated — never silently drop them. */}
            {criteria.activeOnly !== false && ambiguous.length > 0 && (
              <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-amber-900">
                  {ambiguous.reduce((n, a) => n + a.policy_count, 0).toLocaleString()} policies with an
                  undetermined status are excluded
                </summary>
                <p className="mt-2 text-xs text-amber-800">
                  These coverage statuses can&apos;t be confirmed as in force or terminated, so they are not
                  included in an active-only population. Turn off &ldquo;Active policies only&rdquo; to include them.
                </p>
                <ul className="mt-2 space-y-1">
                  {ambiguous.map(a => (
                    <li key={a.coverage_status} className="flex justify-between gap-3 text-xs text-amber-900">
                      <span className="truncate">{a.coverage_status}</span>
                      <span className="shrink-0 tabular-nums">{a.policy_count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {/* Base controls: active-only + cash value */}
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-800">Active policies only</span>
              <input
                type="checkbox"
                checked={criteria.activeOnly !== false}
                onChange={e => setCriteria(c => ({ ...c, activeOnly: e.target.checked }))}
                className="size-4 accent-teal-600"
              />
            </label>
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-800">Cash value</span>
              <div className="flex gap-1">
                {(['any', 'has', 'none'] as const).map(choice => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setCriteria(c => ({ ...c, cashValue: choice }))}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                      (criteria.cashValue ?? 'any') === choice
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {choice === 'any' ? 'Any' : choice === 'has' ? 'Has cash value' : 'No cash value'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Applied filters */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
                <Filter className="size-3.5" aria-hidden /> Applied filters
              </h2>
              {appliedChips.length > 0 && (
                <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                  Reset all
                </button>
              )}
            </div>
            {appliedChips.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">
                No filters yet. The default population is active policies only.
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {appliedChips.map(chip => (
                  <li key={chip.key}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 py-1 pl-3 pr-1.5 text-xs font-medium text-teal-900">
                      {chip.text}
                      <button
                        type="button"
                        onClick={() => chip.clear(setCriteria)}
                        className="flex size-4 items-center justify-center rounded-full text-teal-600 hover:bg-teal-200"
                        aria-label={`Remove ${chip.text}`}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canCommit}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-base font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderPlus className="size-5" aria-hidden />
              Add to Project
            </button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <Eye className="size-3.5" aria-hidden />
              Previewing live — nothing is saved until you add to the project.
            </p>
          </div>
        </aside>

        {/* ── Right column: facet groups ─────────────────────────────────────── */}
        <div className="space-y-6">
          {FACET_GROUPS.map(group => (
            <FacetGroupBlock
              key={group}
              group={group}
              facets={facets}
              criteria={criteria}
              onDiscrete={setDiscrete}
              onRange={setRange}
              onDate={setDate}
              onAgeFacetOpen={setAgeFacetOpen}
            />
          ))}
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          customerCount={customerCount}
          policyCount={policyCount}
          existingCount={existingCustomerCount}
          committing={committing}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={commit}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Facet group block — renders the facets belonging to one group.
// ─────────────────────────────────────────────────────────────────────────────

function FacetGroupBlock({
  group,
  facets,
  criteria,
  onDiscrete,
  onRange,
  onDate,
  onAgeFacetOpen,
}: {
  group: FacetGroup
  facets: PopulationFacets | null
  criteria: PopulationCriteria
  onDiscrete: (id: DiscreteFacetId, next: string[]) => void
  onRange: (id: RangeFacetId, next: RangeSelection | undefined) => void
  onDate: (id: DateFacetId, next: DateSelection | undefined) => void
  onAgeFacetOpen: (id: 'customer_age' | 'insured_age', open: boolean) => void
}) {
  const groupFacets = FACETS.filter(f => f.group === group)

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{group}</h2>
      <div className="space-y-2">
        {groupFacets.map(f => {
          if (f.kind === 'discrete') {
            const id = f.id as DiscreteFacetId
            const values = facets?.discrete?.[id] ?? []
            const selected = criteria.discrete?.[id] ?? []
            const summary = selected.length > 0 ? `${selected.length} selected` : null
            return (
              <FacetShell key={f.id} label={f.label} hint={f.hint} activeSummary={summary}>
                <DiscreteFacet values={values} selected={selected} onChange={next => onDiscrete(id, next)} />
              </FacetShell>
            )
          }
          if (f.kind === 'money' || f.kind === 'age' || f.kind === 'range') {
            const id = f.id as RangeFacetId
            const bounds = facets?.range?.[id] ?? { min: null, max: null }
            const sel = criteria.range?.[id]
            const summary = sel ? rangeSummary(sel, f.unit === 'money' ? 'money' : 'years') : null
            // Age facets are lazy: opening one requests its bounds on demand.
            const isAge = f.kind === 'age'
            return (
              <FacetShell
                key={f.id}
                label={f.label}
                hint={f.hint}
                activeSummary={summary}
                onClear={sel ? () => onRange(id, undefined) : undefined}
                onOpenChange={isAge ? (open => onAgeFacetOpen(id as 'customer_age' | 'insured_age', open)) : undefined}
              >
                <RangeFacet
                  unit={f.unit === 'money' ? 'money' : 'years'}
                  bounds={bounds}
                  selection={sel}
                  onChange={next => onRange(id, next)}
                />
              </FacetShell>
            )
          }
          // date
          const id = f.id as DateFacetId
          const sel = criteria.date?.[id]
          const summary = sel ? dateSummary(sel) : null
          return (
            <FacetShell
              key={f.id}
              label={f.label}
              hint={f.hint}
              activeSummary={summary}
              onClear={sel ? () => onDate(id, undefined) : undefined}
            >
              <DateFacet selection={sel} onChange={next => onDate(id, next)} />
            </FacetShell>
          )
        })}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm dialog — final Preview before committing.
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmDialog({
  customerCount,
  policyCount,
  existingCount,
  committing,
  onCancel,
  onConfirm,
}: {
  customerCount: number
  policyCount: number
  existingCount: number
  committing: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-xl font-semibold text-slate-900">Add this population?</h3>
        <p className="mt-2 text-slate-600">
          This creates a new run and records its criteria. It adds the matching customers to the project and records
          every qualifying policy as evidence.
        </p>
        <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Matching customers</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{customerCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">Qualifying policies</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{policyCount.toLocaleString()}</dd>
          </div>
          {existingCount > 0 && (
            <div className="flex justify-between border-t border-slate-200 pt-2 text-xs">
              <dt className="text-slate-500">Already in project (won&apos;t duplicate)</dt>
              <dd className="tabular-nums text-slate-500">{existingCount.toLocaleString()}</dd>
            </div>
          )}
        </dl>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={committing}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={committing}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            {committing && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {committing ? 'Adding...' : 'Add to Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Applied-filter chip builders + summary formatters.
// ─────────────────────────────────────────────────────────────────────────────

type Chip = {
  key: string
  text: string
  clear: (set: React.Dispatch<React.SetStateAction<PopulationCriteria>>) => void
}

function buildChips(c: PopulationCriteria, facets: PopulationFacets | null): Chip[] {
  const chips: Chip[] = []

  if (c.activeOnly === false) {
    chips.push({
      key: 'activeOnly',
      text: 'Including inactive policies',
      clear: set => set(p => ({ ...p, activeOnly: true })),
    })
  }
  if (c.cashValue && c.cashValue !== 'any') {
    chips.push({
      key: 'cashValue',
      text: c.cashValue === 'has' ? 'Has cash value' : 'No cash value',
      clear: set => set(p => ({ ...p, cashValue: 'any' })),
    })
  }

  for (const [id, vals] of Object.entries(c.discrete ?? {})) {
    if (!vals || vals.length === 0) continue
    const meta = facetMeta(id as DiscreteFacetId)
    const labelFor = (v: string) =>
      facets?.discrete?.[id]?.find(fv => fv.value === v)?.label ?? v
    const text =
      vals.length <= 2
        ? `${meta?.label}: ${vals.map(labelFor).join(', ')}`
        : `${meta?.label}: ${vals.length} selected`
    chips.push({
      key: `d-${id}`,
      text,
      clear: set => set(p => {
        const discrete = { ...(p.discrete ?? {}) }
        delete discrete[id as DiscreteFacetId]
        return { ...p, discrete }
      }),
    })
  }

  for (const [id, sel] of Object.entries(c.range ?? {})) {
    if (!sel) continue
    const meta = facetMeta(id as RangeFacetId)
    chips.push({
      key: `r-${id}`,
      text: `${meta?.label}: ${rangeSummary(sel, meta?.unit === 'money' ? 'money' : 'years')}`,
      clear: set => set(p => {
        const range = { ...(p.range ?? {}) }
        delete range[id as RangeFacetId]
        return { ...p, range }
      }),
    })
  }

  for (const [id, sel] of Object.entries(c.date ?? {})) {
    if (!sel) continue
    const meta = facetMeta(id as DateFacetId)
    chips.push({
      key: `dt-${id}`,
      text: `${meta?.label}: ${dateSummary(sel)}`,
      clear: set => set(p => {
        const date = { ...(p.date ?? {}) }
        delete date[id as DateFacetId]
        return { ...p, date }
      }),
    })
  }

  return chips
}

function rangeSummary(sel: RangeSelection, unit: 'money' | 'years'): string {
  const fmt = (n: number) => (unit === 'money' ? `$${n.toLocaleString()}` : `${n} yrs`)
  if (sel.min != null && sel.max != null) return `${fmt(sel.min)} – ${fmt(sel.max)}`
  if (sel.min != null) return `≥ ${fmt(sel.min)}`
  if (sel.max != null) return `≤ ${fmt(sel.max)}`
  return 'any'
}

function dateSummary(sel: DateSelection): string {
  if (sel.mode === 'between') {
    if (sel.from && sel.to) return `${sel.from} – ${sel.to}`
    if (sel.from) return `from ${sel.from}`
    if (sel.to) return `to ${sel.to}`
  }
  if (sel.mode === 'before' && sel.to) return `on/before ${sel.to}`
  if (sel.mode === 'after' && sel.from) return `on/after ${sel.from}`
  return 'any'
}
