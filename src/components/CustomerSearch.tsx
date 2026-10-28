'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { formatPhoneDisplay } from '@/lib/contact-input'

/**
 * Shared customer-search picker.
 *
 * One self-contained component for every "type a query, pick a customer" flow
 * in Right Path. It owns ALL standard search behavior — debounced input,
 * minimum-character gating, the fetch to the shared /api/customers/search
 * endpoint, loading / empty / error states, and the results dropdown — so pages
 * supply only configuration (which search mode, who to exclude) and what to do
 * when a customer is picked.
 *
 * Matching is centralized server-side in the search route: it matches by
 * customer name and, when the query reduces to a phone number, by phone
 * digit-to-digit. That means a number pasted from Hearsay in any common format
 * (punctuation, spaces, a leading US country code, or surrounding text) finds
 * the customer WITHOUT any change to stored customer records. Duplicate phone
 * numbers are handled safely: the route returns every matching customer and
 * this component lists them all, so the worker chooses rather than the system
 * assuming a unique match.
 *
 * The component is generic over the row shape the chosen mode returns. The base
 * fields (id, first/last name, phone) are always present; a mode that returns
 * more (dedup's date_of_birth / city / state / case_count, the default mode's
 * customer_group_id or cases) is typed through the generic, so onSelect hands
 * the page back exactly the row it expects and a custom renderRow can show the
 * extra fields.
 */

/** The fields every search mode returns; the floor of the generic row type. */
export type CustomerSearchHit = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
}

type Theme = 'light' | 'dark'

type RenderRowArgs<T> = {
  /** Whether this row is currently busy (e.g. a selection action is running). */
  busy: boolean
  /** Invoke the standard selection path for this row. */
  select: () => void
}

/**
 * The population a search is scoped to. Scope enforcement lives entirely in the
 * shared search route; a page passes only this context, never its own filtering.
 *   - undefined / { kind: 'all' } — search the whole customer database (general
 *     customer-lookup screens).
 *   - { kind: 'project', projectId } — only customers in that project
 *     (individual project workflow screens).
 *   - { kind: 'myWork', projectId? } — only the signed-in employee's My Work
 *     population; with projectId, that population narrowed to one project
 *     (My Work with a project selected, and the project-scoped working screens).
 * Changing the scope (e.g. the worker picks a different project) re-runs the
 * search, so results track the active context.
 */
export type CustomerSearchScope =
  | { kind: 'all' }
  | { kind: 'project'; projectId: string }
  | { kind: 'myWork'; projectId?: string | null }

/**
 * Opt-in compact scope picker for WORK-ORIENTED search screens (Customer
 * Interaction, Servicing Access). When provided, the component renders a small
 * dropdown letting the worker choose where to search and manages the selected
 * scope itself; the `scope` prop is then ignored. Specialized pickers do NOT
 * pass this — they keep a single fixed scope and no control.
 *
 *   - Current Project — the project in context (shown only when projectId is
 *     set); scopes to that project's membership.
 *   - All Projects — the combined membership of the worker's My Work projects.
 *   - All Customers — the whole customer database (general lookup).
 *
 * `defaultChoice` selects the initial option: 'project' when working within a
 * project, 'myWork' when working across projects, 'all' for general lookup.
 */
export type CustomerSearchScopePicker = {
  projectId?: string | null
  defaultChoice: 'project' | 'myWork' | 'all'
}

type ScopeChoice = 'project' | 'myWork' | 'all'

type CustomerSearchProps<T extends CustomerSearchHit> = {
  /**
   * Which shared search mode to use. 'default' is the household-link / general
   * picker shape; 'dedup' returns the extended identity fields (DOB, city,
   * state, case count) used for identity confirmation. Both match name + phone.
   */
  mode?: 'default' | 'dedup'
  /** The population to restrict results to. Omit for a database-wide search.
   *  Ignored when `scopePicker` is provided (the dropdown owns the scope). */
  scope?: CustomerSearchScope
  /** Opt-in compact scope dropdown for work-oriented screens. Pickers omit it. */
  scopePicker?: CustomerSearchScopePicker
  /** Results per page (ranked mode). Default 25. Show More fetches the next page. */
  pageSize?: number
  /** Customer id to exclude from results (e.g. the current customer). */
  exclude?: string | null
  /** Optional agency scope passed through to the endpoint (default mode). */
  agencyId?: string | null
  /** Called when the worker picks a customer. Receives the full typed row. */
  onSelect: (hit: T) => void | Promise<void>
  /** Placeholder for the search input. */
  placeholder?: string
  /** Accessible label for the input (visually hidden unless `label` is shown). */
  ariaLabel?: string
  /** Light (workflow tokens) or dark (slate) presentation. Default 'light'. */
  theme?: Theme
  /**
   * Seed the input with an initial query (e.g. a policy's client name to find
   * the matching customer). Applied as the starting value; the component still
   * owns the query state afterward. To re-seed for a different context, remount
   * with a changed `key`.
   */
  initialQuery?: string
  /** Minimum characters before searching. Default 2 (matches the endpoint). */
  minChars?: number
  /** Debounce before firing the search, ms. Default 250. */
  debounceMs?: number
  /** Autofocus the input on mount. */
  autoFocus?: boolean
  /** The id of the row currently performing a selection action, if any. */
  busyId?: string | null
  /**
   * Custom row renderer. Receives the hit plus a { busy, select } helper. When
   * omitted, a standard row (name on the left, formatted phone on the right)
   * is rendered and clicking it calls onSelect.
   */
  renderRow?: (hit: T, args: RenderRowArgs<T>) => React.ReactNode
  /**
   * Custom empty-state renderer, shown when the search has run and returned no
   * matches. Receives the trimmed query so a screen can offer a query-aware
   * action (e.g. "create a new customer named …"). When omitted, a plain
   * "No matches." line is shown.
   */
  renderEmpty?: (term: string) => React.ReactNode
  /** Extra classes for the outer wrapper. */
  className?: string
}

export function fullName(hit: CustomerSearchHit): string {
  return [hit.first_name, hit.last_name].filter(Boolean).join(' ').trim() || 'Unnamed customer'
}

export function CustomerSearch<T extends CustomerSearchHit>({
  mode = 'default',
  scope,
  scopePicker,
  pageSize = 25,
  exclude,
  agencyId,
  onSelect,
  placeholder = 'Search by name or phone…',
  ariaLabel = 'Search customers by name or phone',
  theme = 'light',
  initialQuery = '',
  minChars = 2,
  debounceMs = 250,
  autoFocus = false,
  busyId = null,
  renderRow,
  renderEmpty,
  className,
}: CustomerSearchProps<T>) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<T[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selected scope choice when the dropdown is in use. Defaults per the caller:
  // Current Project in a project, All Projects across projects, All Customers
  // for general lookup. Falls back off 'project' when no projectId exists.
  const pickerProjectId = scopePicker?.projectId ?? null
  const initialChoice: ScopeChoice =
    scopePicker
      ? scopePicker.defaultChoice === 'project' && !pickerProjectId
        ? 'myWork'
        : scopePicker.defaultChoice
      : 'all'
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>(initialChoice)

  const term = query.trim()
  const active = term.length >= minChars

  // Ranked, paginated behavior is used whenever a scope picker is present (the
  // work-oriented screens). Specialized pickers use neither and keep their
  // historical fixed top-10, unranked response.
  const ranked = !!scopePicker

  // Resolve the effective scope: the dropdown choice when present, else the
  // fixed `scope` prop. Flattened to primitives so the effect re-runs when the
  // worker switches scope or project and results track the active context.
  const effectiveScope: CustomerSearchScope = scopePicker
    ? scopeChoice === 'project' && pickerProjectId
      ? { kind: 'project', projectId: pickerProjectId }
      : scopeChoice === 'myWork'
        // "All Projects" is the COMBINED membership of the worker's My Work
        // projects — never narrowed to the project they entered from. So it
        // carries NO projectId, regardless of pickerProjectId.
        ? { kind: 'myWork' }
        : { kind: 'all' }
    : scope ?? { kind: 'all' }

  const scopeKind = effectiveScope.kind
  const scopeProjectId =
    effectiveScope.kind === 'project'
      ? effectiveScope.projectId
      : effectiveScope.kind === 'myWork'
        ? effectiveScope.projectId ?? null
        : null

  // Build the request params for a given page offset. Centralizes scope +
  // ranking + pagination; pages never construct their own query.
  const buildParams = (offset: number): URLSearchParams => {
    const params = new URLSearchParams({ q: term })
    if (mode === 'dedup') params.set('dedup', 'true')
    if (exclude) params.set('exclude', exclude)
    if (agencyId) params.set('agency_id', agencyId)
    if (scopeKind === 'project') {
      params.set('scope', 'project')
      if (scopeProjectId) params.set('project_id', scopeProjectId)
    } else if (scopeKind === 'myWork') {
      params.set('scope', 'mywork')
      if (scopeProjectId) params.set('project_id', scopeProjectId)
    }
    if (ranked) {
      params.set('rank', 'lastname')
      params.set('limit', String(pageSize))
      params.set('offset', String(offset))
    }
    return params
  }

  useEffect(() => {
    if (!active) { setResults([]); setError(null); setSearching(false); setHasMore(false); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?${buildParams(0).toString()}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) {
          setError(json?.error ?? 'Search failed.')
          setResults([]); setHasMore(false)
          return
        }
        setError(null)
        setResults((json?.data ?? []) as T[])
        setHasMore(json?.has_more === true)
      } catch {
        if (!cancelled) { setError('Network error during search.'); setResults([]); setHasMore(false) }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, debounceMs)
    return () => { cancelled = true; clearTimeout(t) }
    // term drives the effect; scope kind/project re-run it so results track the
    // active context; exclude/agencyId/mode are stable per usage.
  }, [term, active, mode, exclude, agencyId, debounceMs, scopeKind, scopeProjectId, ranked, pageSize])

  // Show More: fetch the next page and append, so results are never silently
  // truncated. Uses the current result count as the offset.
  async function showMore() {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/customers/search?${buildParams(results.length).toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Search failed.'); return }
      setResults(prev => [...prev, ...((json?.data ?? []) as T[])])
      setHasMore(json?.has_more === true)
    } catch {
      setError('Network error loading more results.')
    } finally {
      setLoadingMore(false)
    }
  }

  const styles = useMemo(() => themeStyles(theme), [theme])

  function defaultRow(hit: T, { busy, select }: RenderRowArgs<T>) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={select}
        className={styles.row}
      >
        <span className={styles.rowName}>{fullName(hit)}</span>
        {hit.phone && <span className={styles.rowMeta}>{formatPhoneDisplay(hit.phone)}</span>}
      </button>
    )
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className={styles.searchIcon} aria-hidden />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            autoFocus={autoFocus}
            className={styles.input}
          />
        </div>
        {scopePicker && (
          <select
            value={scopeChoice}
            onChange={e => setScopeChoice(e.target.value as ScopeChoice)}
            aria-label="Search scope"
            className={styles.scopeSelect}
          >
            {pickerProjectId && <option value="project">Current Project</option>}
            <option value="myWork">All Projects</option>
            <option value="all">All Customers</option>
          </select>
        )}
      </div>

      {active && (
        searching && results.length === 0 ? (
          <div className={styles.panel}>
            <p className={styles.note}>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching…
            </p>
          </div>
        ) : error ? (
          <div className={styles.panel}>
            <p className={styles.error}>{error}</p>
          </div>
        ) : results.length === 0 ? (
          // A custom empty state (e.g. a "create new customer" CTA) owns its own
          // chrome; the default "No matches." uses the panel.
          renderEmpty ? (
            <div className="mt-2">{renderEmpty(term)}</div>
          ) : (
            <div className={styles.panel}>
              <p className={styles.note}>No matches.</p>
            </div>
          )
        ) : (
          <div className={styles.panel}>
            <ul className={styles.list}>
              {results.map(hit => {
                const args: RenderRowArgs<T> = {
                  busy: busyId === hit.id,
                  select: () => { void onSelect(hit) },
                }
                return (
                  <li key={hit.id} className={styles.listItem}>
                    {renderRow ? renderRow(hit, args) : defaultRow(hit, args)}
                  </li>
                )
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={showMore}
                disabled={loadingMore}
                className={styles.showMore}
              >
                {loadingMore
                  ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…</>
                  : 'Show more'}
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}

function themeStyles(theme: Theme) {
  if (theme === 'dark') {
    return {
      searchIcon: 'pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500',
      input:
        'w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none',
      panel: 'mt-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-800',
      note: 'flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400',
      error: 'px-3 py-2 text-sm text-rose-400',
      list: 'divide-y divide-slate-700',
      listItem: '',
      row: 'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-100 transition-colors hover:bg-slate-700/60 disabled:opacity-50',
      rowName: 'font-medium',
      rowMeta: 'text-xs text-slate-400',
      scopeSelect: 'shrink-0 rounded-lg border border-slate-600 bg-slate-800 py-2 pl-2 pr-7 text-sm text-slate-200 focus:border-blue-500 focus:outline-none',
      showMore: 'flex w-full items-center justify-center gap-1.5 border-t border-slate-700 px-3 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-slate-700/60 disabled:opacity-50',
    }
  }
  return {
    searchIcon: 'pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted',
    input:
      'w-full rounded-lg border border-surface-border-strong bg-surface-card py-2 pl-9 pr-3 text-base text-ink placeholder-ink-muted focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40',
    panel: 'mt-2 overflow-hidden rounded-lg border border-surface-border bg-surface-card',
    note: 'flex items-center gap-1.5 px-3 py-2 text-sm text-ink-supporting',
    error: 'px-3 py-2 text-sm text-rose-700',
    list: 'divide-y divide-surface-border',
    listItem: '',
    row: 'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-base text-ink transition-colors hover:bg-surface-muted disabled:opacity-50',
    rowName: 'font-medium',
    rowMeta: 'text-sm text-ink-supporting',
    scopeSelect: 'shrink-0 rounded-lg border border-surface-border-strong bg-surface-card py-2 pl-3 pr-8 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40',
    showMore: 'flex w-full items-center justify-center gap-1.5 border-t border-surface-border px-3 py-2 text-sm font-medium text-brand-hover transition-colors hover:bg-surface-muted disabled:opacity-50',
  }
}
