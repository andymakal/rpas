'use client'

/**
 * Faceted filter controls for the Population Builder.
 *
 * Three control kinds, matching the facet metadata:
 *   DiscreteFacet — visible multi-select value list with per-value counts,
 *                   Select All / Clear. Selections within one field are OR.
 *   RangeFacet    — min/max numeric (money) or age range.
 *   DateFacet     — before / after / between date filtering.
 *
 * These are presentational: they render current selection + available values
 * (with live counts) and call back on change. The parent owns the criteria.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FacetValue } from '@/lib/projects/population-engine'
import type { RangeSelection, DateSelection } from '@/lib/projects/population-criteria'

// ─────────────────────────────────────────────────────────────────────────────
// Shared facet shell — collapsible group with a title and active summary.
// ─────────────────────────────────────────────────────────────────────────────

export function FacetShell({
  label,
  hint,
  activeSummary,
  defaultOpen = false,
  onClear,
  onOpenChange,
  children,
}: {
  label: string
  hint?: string
  activeSummary?: string | null
  defaultOpen?: boolean
  /**
   * When provided, a local Clear control appears (the facet is active). Clearing
   * removes just this facet's criterion; the parent's change handler then
   * refreshes the population immediately.
   */
  onClear?: () => void
  /**
   * Notified when the facet is expanded/collapsed. Used for lazy facets (e.g.
   * age) so the parent only requests expensive bounds once the user opens it.
   */
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  // Notify the parent of open/close changes AFTER render, never during it.
  // Calling onOpenChange inline (e.g. inside the setOpen updater) would update
  // the parent (setOpenAgeFacets) while this component is rendering, which React
  // flags as "Cannot update a component while rendering a different component".
  // An effect runs post-commit, so the parent's lazy age request is driven by a
  // committed open-state change rather than by render. We skip the initial mount
  // so merely rendering a (closed) facet never triggers an age request.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    onOpenChange?.(open)
    // onOpenChange is intentionally omitted: parents pass an inline callback, so
    // depending on it would re-fire on every render. We notify only when `open`
    // actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggle() {
    setOpen(o => !o)
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex w-full items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">{label}</span>
            {activeSummary && (
              <span className="mt-0.5 block truncate text-xs font-medium text-teal-700">{activeSummary}</span>
            )}
          </span>
          <ChevronDown
            className={cn('size-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Discrete multi-select with counts, Select All / Clear.
// ─────────────────────────────────────────────────────────────────────────────

export function DiscreteFacet({
  values,
  selected,
  onChange,
}: {
  values: FacetValue[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [filter, setFilter] = useState('')
  const selectedSet = new Set(selected)

  const shown = filter
    ? values.filter(v => v.label.toLowerCase().includes(filter.toLowerCase()))
    : values

  function toggle(value: string) {
    if (selectedSet.has(value)) onChange(selected.filter(v => v !== value))
    else onChange([...selected, value])
  }

  const allShownValues = shown.map(v => v.value)
  const allShownSelected = allShownValues.length > 0 && allShownValues.every(v => selectedSet.has(v))

  return (
    <div className="space-y-2">
      {values.length > 8 && (
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter values..."
          className="h-8 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
        />
      )}

      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => {
            // Select-all over the currently shown (filtered) values, merged with
            // any already-selected values outside the current filter.
            const merged = Array.from(new Set([...selected, ...allShownValues]))
            onChange(allShownSelected ? selected.filter(v => !allShownValues.includes(v)) : merged)
          }}
          className="font-medium text-teal-700 hover:text-teal-800"
        >
          {allShownSelected ? 'Unselect shown' : 'Select all'}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="font-medium text-slate-500 hover:text-slate-700"
          >
            Clear ({selected.length})
          </button>
        )}
      </div>

      <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
        {shown.length === 0 && (
          <li className="px-1 py-2 text-sm text-slate-400">No values.</li>
        )}
        {shown.map(v => {
          const isSel = selectedSet.has(v.value)
          return (
            <li key={v.value}>
              <button
                type="button"
                onClick={() => toggle(v.value)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  isSel ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    isSel ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white',
                  )}
                >
                  {isSel && <Check className="size-3" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1 truncate">{v.label}</span>
                <span className="shrink-0 tabular-nums text-xs text-slate-500">{v.count.toLocaleString()}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Range (money / age) — min & max inputs with the data bounds as placeholders.
// ─────────────────────────────────────────────────────────────────────────────

export function RangeFacet({
  unit,
  bounds,
  selection,
  onChange,
}: {
  unit: 'money' | 'years'
  bounds: { min: number | null; max: number | null }
  selection: RangeSelection | undefined
  onChange: (next: RangeSelection | undefined) => void
}) {
  const prefix = unit === 'money' ? '$' : ''
  const suffix = unit === 'years' ? ' yrs' : ''

  function set(part: 'min' | 'max', raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    const next: RangeSelection = { ...selection, [part]: Number.isNaN(num as number) ? null : num }
    if (next.min == null && next.max == null) onChange(undefined)
    else onChange(next)
  }

  const boundHint =
    bounds.min != null && bounds.max != null
      ? `Data range ${prefix}${Math.floor(bounds.min).toLocaleString()}${suffix} – ${prefix}${Math.ceil(bounds.max).toLocaleString()}${suffix}`
      : null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-slate-500">Min</span>
          <input
            type="number"
            inputMode="numeric"
            value={selection?.min ?? ''}
            onChange={e => set('min', e.target.value)}
            placeholder={bounds.min != null ? String(Math.floor(bounds.min)) : ''}
            className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
          />
        </label>
        <span className="mt-5 text-slate-400">–</span>
        <label className="flex-1">
          <span className="mb-1 block text-xs text-slate-500">Max</span>
          <input
            type="number"
            inputMode="numeric"
            value={selection?.max ?? ''}
            onChange={e => set('max', e.target.value)}
            placeholder={bounds.max != null ? String(Math.ceil(bounds.max)) : ''}
            className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
          />
        </label>
      </div>
      {boundHint && <p className="text-xs text-slate-400">{boundHint}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Date — before / after / between.
// ─────────────────────────────────────────────────────────────────────────────

export function DateFacet({
  selection,
  onChange,
}: {
  selection: DateSelection | undefined
  onChange: (next: DateSelection | undefined) => void
}) {
  const mode = selection?.mode ?? 'between'

  function setMode(m: DateSelection['mode']) {
    onChange({ mode: m, from: selection?.from ?? null, to: selection?.to ?? null })
  }
  function setDate(part: 'from' | 'to', val: string) {
    const next: DateSelection = { mode, from: selection?.from ?? null, to: selection?.to ?? null, [part]: val || null }
    if (!next.from && !next.to) onChange(undefined)
    else onChange(next)
  }

  const modes: DateSelection['mode'][] = ['before', 'after', 'between']

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {modes.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex-1 rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors',
              mode === m
                ? 'border-teal-600 bg-teal-600 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50',
            )}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {(mode === 'after' || mode === 'between') && (
          <label className="flex-1">
            <span className="mb-1 block text-xs text-slate-500">{mode === 'between' ? 'From' : 'On or after'}</span>
            <input
              type="date"
              value={selection?.from ?? ''}
              onChange={e => setDate('from', e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
            />
          </label>
        )}
        {(mode === 'before' || mode === 'between') && (
          <label className="flex-1">
            <span className="mb-1 block text-xs text-slate-500">{mode === 'between' ? 'To' : 'On or before'}</span>
            <input
              type="date"
              value={selection?.to ?? ''}
              onChange={e => setDate('to', e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
            />
          </label>
        )}
      </div>
    </div>
  )
}
