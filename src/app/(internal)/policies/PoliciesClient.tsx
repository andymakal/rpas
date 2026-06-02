'use client'

import { useState, useTransition, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Search, AlertTriangle, CheckCircle, Clock, FileQuestion,
  Send, Shield, ShieldOff, ChevronRight, Cigarette,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import type { PolicyListRow } from './page'
import { fmtDate } from '@/lib/fmt'

// ── Flag helpers (mirrors prep engine logic, client-side) ─────────────────────

function isTobacco(rateClass: string | null) {
  if (!rateClass) return false
  const r = rateClass.toLowerCase()
  // Exclude any variant meaning "non-tobacco" / "no-tobacco"
  const isNonTobacco = r.includes('non-tobacco') || r.includes('non tobacco')
                    || r.includes('no-tobacco')  || r.includes('no tobacco')
  return (r.includes('tobacco') && !isNonTobacco) || r.includes('smoker')
}

function yearsRemaining(issueIso: string | null, termStr: string | null): number | null {
  if (!issueIso || !termStr) return null
  const match = termStr.match(/\d+/)
  if (!match) return null
  const issueYear = new Date(issueIso + 'T12:00:00').getFullYear()
  const expiry    = issueYear + parseInt(match[0], 10)
  return expiry - new Date().getFullYear()
}

function isUlLapseRisk(row: PolicyListRow): boolean {
  if (row.product_type !== 'UL' && row.product_type !== 'VUL') return false
  if (!row.cash_value_amount || !row.annual_premium) return false
  return (row.cash_value_amount / row.annual_premium) < 5
}

type FlagInfo = { label: string; color: 'red' | 'amber' | 'blue' }

function getFlags(row: PolicyListRow): FlagInfo[] {
  const flags: FlagInfo[] = []
  if (isTobacco(row.rate_class)) flags.push({ label: 'Tobacco', color: 'red' })

  if (row.product_type === 'Term') {
    const yr = yearsRemaining(row.issue_date, row.term_length)
    if (yr != null && yr <= 0)  flags.push({ label: 'Expired', color: 'red' })
    else if (yr != null && yr <= 2) flags.push({ label: `Exp. ${yr}yr`, color: 'red' })
    else if (yr != null && yr <= 5) flags.push({ label: `Exp. ${yr}yr`, color: 'amber' })
  }

  if (isUlLapseRisk(row)) flags.push({ label: 'Lapse Risk', color: 'amber' })
  return flags
}

// ── SA status badge ───────────────────────────────────────────────────────────

function SaBadge({ row }: { row: PolicyListRow }) {
  if (row.sa_status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-900/50 text-green-300 px-2 py-0.5 rounded-full">
        <CheckCircle className="w-3 h-3" /> Confirmed
      </span>
    )
  }
  if (row.sa_status === 'not_on_file') {
    if (row.sa_form_sent_at) {
      return (
        <span className="inline-flex items-center gap-1 text-xs bg-sky-900/50 text-sky-300 px-2 py-0.5 rounded-full">
          <Send className="w-3 h-3" /> Form Sent
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full">
        <ShieldOff className="w-3 h-3" /> Not SA
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
      <FileQuestion className="w-3 h-3" /> Unknown
    </span>
  )
}

// ── Product type badge ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-slate-600 text-xs">—</span>
  const colors: Record<string, string> = {
    Term: 'bg-blue-900/40 text-blue-300',
    UL:   'bg-purple-900/40 text-purple-300',
    VUL:  'bg-purple-900/40 text-purple-300',
    WL:   'bg-teal-900/40 text-teal-300',
    PERM: 'bg-teal-900/40 text-teal-300',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[type] ?? 'bg-slate-700 text-slate-400'}`}>
      {type}
    </span>
  )
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

// ── SA filter options ─────────────────────────────────────────────────────────

const SA_FILTERS = [
  { value: '',             label: 'All' },
  { value: 'unknown',      label: 'Not Checked' },
  { value: 'confirmed',    label: 'Confirmed SA' },
  { value: 'not_on_file',  label: 'Not SA' },
]

const TYPE_FILTERS = [
  { value: '',     label: 'All Types' },
  { value: 'Term', label: 'Term' },
  { value: 'UL',   label: 'UL' },
  { value: 'VUL',  label: 'VUL' },
  { value: 'WL',   label: 'WL' },
  { value: 'PERM', label: 'PERM' },
]

// ── Main component ────────────────────────────────────────────────────────────

export function PoliciesClient({
  rows,
  totalCount,
  page,
  pageSize,
  activeQ,
  activeSa,
  activeType,
  activeYear,
  activeTobacco,
  activeSort,
  activeDir,
  showInactive,
}: {
  rows:         PolicyListRow[]
  totalCount:   number
  page:         number
  pageSize:     number
  activeQ:      string
  activeSa:     string
  activeType:   string
  activeYear:   string
  activeTobacco: boolean
  activeSort:   string
  activeDir:    string
  showInactive: boolean
}) {
  const router   = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState(activeQ)

  // Year options: 1985 → current year
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: current - 1984 }, (_, i) => String(current - i))
  }, [])

  // All filters are server-side URL params; navigate resets to page 1 on filter change
  const navigate = useCallback((overrides: Record<string, string>) => {
    const params = new URLSearchParams()
    const merged = {
      q:        activeQ,
      sa:       activeSa,
      type:     activeType,
      year:     activeYear,
      sort:     activeSort,
      dir:      activeDir,
      tobacco:  activeTobacco ? '1' : '',
      inactive: showInactive   ? '1' : '',
      page:     '1',   // reset to page 1 on any filter change
      ...overrides,
    }
    Object.entries(merged).forEach(([k, v]) => { if (v && v !== '1' || k === 'page' && v !== '1') params.set(k, v) })
    // Cleaner: just set all non-empty values
    params.delete('page')
    Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
    if (merged.page === '1') params.delete('page')
    startTransition(() => {
      router.push(`${pathname}${params.size ? '?' + params.toString() : ''}`)
    })
  }, [router, pathname, activeQ, activeSa, activeType, activeYear, activeSort, activeDir, activeTobacco, showInactive])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate({ q: search })
  }

  function goToPage(p: number) {
    const params = new URLSearchParams()
    if (activeQ)       params.set('q',       activeQ)
    if (activeSa)      params.set('sa',      activeSa)
    if (activeType)    params.set('type',    activeType)
    if (activeYear)    params.set('year',    activeYear)
    if (activeSort && activeSort !== 'face_amount') params.set('sort', activeSort)
    if (activeDir  && activeDir  !== 'desc')        params.set('dir',  activeDir)
    if (activeTobacco) params.set('tobacco', '1')
    if (showInactive)  params.set('inactive', '1')
    if (p > 1)         params.set('page', String(p))
    startTransition(() => {
      router.push(`${pathname}${params.size ? '?' + params.toString() : ''}`)
    })
  }

  // Server already sorted; client only removes tobacco false-positives (non-tobacco rate classes)
  const displayRows = useMemo(
    () => activeTobacco ? rows.filter(r => isTobacco(r.rate_class)) : rows,
    [rows, activeTobacco]
  )

  const totalPages = Math.ceil(totalCount / pageSize)

  // Summary counts from current page
  const confirmed  = rows.filter(r => r.sa_status === 'confirmed').length
  const notChecked = rows.filter(r => r.sa_status === 'unknown').length
  const formSent   = rows.filter(r => r.sa_status === 'not_on_file' && r.sa_form_sent_at).length
  const notSa      = rows.filter(r => r.sa_status === 'not_on_file' && !r.sa_form_sent_at).length
  const tobaccoCount = displayRows.filter(r => isTobacco(r.rate_class)).length

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-white text-2xl font-semibold">Policies</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            LBL / Everlake in-force book · {totalCount.toLocaleString()} policies
            {activeTobacco ? ' (tobacco-rated)' : ''}{showInactive ? ' incl. inactive' : ''}
          </p>
        </div>

        {/* SA summary chips */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Confirmed SA',  count: confirmed,  icon: CheckCircle, color: 'text-green-400' },
            { label: 'Not Checked',   count: notChecked, icon: FileQuestion, color: 'text-slate-400' },
            { label: 'Not SA',        count: notSa,      icon: ShieldOff,   color: 'text-amber-400' },
            { label: 'Form Sent',     count: formSent,   icon: Send,        color: 'text-sky-400'   },
          { label: 'Tobacco Rated', count: tobaccoCount, icon: Cigarette,  color: 'text-red-400'   },
          ].map(({ label, count, icon: Icon, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
              <Icon className={`w-5 h-5 shrink-0 ${color}`} />
              <div>
                <p className="text-white font-semibold text-lg leading-none">{count}</p>
                <p className="text-slate-500 text-xs mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-60">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or policy number…"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ backgroundColor: '#1F3864' }}
            >
              Search
            </button>
          </form>

          {/* SA filter */}
          <div className="flex gap-1">
            {SA_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => navigate({ sa: f.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeSa === f.value
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex gap-1">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => navigate({ type: f.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeType === f.value
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Year issued filter */}
          <select
            value={activeYear}
            onChange={e => navigate({ year: e.target.value })}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-600 cursor-pointer"
          >
            <option value="">All years</option>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Tobacco toggle */}
          <button
            onClick={() => navigate({ tobacco: activeTobacco ? '' : '1' })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              activeTobacco
                ? 'bg-red-900/40 border-red-700 text-red-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Cigarette className="w-3.5 h-3.5" />
            Tobacco only
          </button>

          {/* Show inactive toggle */}
          <button
            onClick={() => navigate({ inactive: showInactive ? '' : '1' })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showInactive
                ? 'bg-amber-900/40 border-amber-700 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {showInactive ? 'Hiding inactive' : 'Show inactive'}
          </button>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 text-xs">
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Policy #</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">
                  <button
                    onClick={() => navigate({
                      sort: 'issue_date',
                      dir: activeSort === 'issue_date' && activeDir === 'asc' ? 'desc' : 'asc',
                    })}
                    className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors"
                  >
                    Issue Date
                    {activeSort === 'issue_date'
                      ? activeDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button
                    onClick={() => navigate({
                      sort: 'face_amount',
                      dir: activeSort === 'face_amount' && activeDir === 'desc' ? 'asc' : 'desc',
                    })}
                    className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors ml-auto"
                  >
                    {activeSort === 'face_amount'
                      ? activeDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                      : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                    Face Amt
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium">SA Status</th>
                <th className="text-left px-4 py-3 font-medium">Agency</th>
                <th className="text-left px-4 py-3 font-medium">Flags</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500 text-sm">
                    No policies found
                  </td>
                </tr>
              )}
              {displayRows.map(row => {
                const flags = getFlags(row)
                const agencyName = row.agencies?.display_name ?? row.agencies?.name
                const customerName = row.customers
                  ? `${row.customers.first_name} ${row.customers.last_name}`
                  : null
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/policies/${row.id}`)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <p className="text-white font-medium truncate max-w-40">
                        {row.client_name}
                      </p>
                      {customerName && (
                        <Link
                          href={`/customers/${row.customer_id}`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-sky-400 hover:underline"
                        >
                          {customerName}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300 text-xs">
                      {row.policy_number}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={row.product_type} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {row.issue_date ? fmtDate(row.issue_date) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 font-medium">
                      {row.face_amount ? fmt(row.face_amount) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <SaBadge row={row} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-36">
                      {agencyName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {flags.map(f => (
                          <span
                            key={f.label}
                            className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                              f.color === 'red'
                                ? 'bg-red-900/40 text-red-300'
                                : f.color === 'amber'
                                ? 'bg-amber-900/40 text-amber-300'
                                : 'bg-sky-900/40 text-sky-300'
                            }`}
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/policies/${row.id}`}
                        className="flex items-center justify-end text-slate-600 group-hover:text-slate-300 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500">
                Page {page} of {totalPages} · {totalCount.toLocaleString()} policies
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-default transition-colors"
                >
                  ← Prev
                </button>

                {/* Page number pills — show up to 7 around current page */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | '…')[]>((acc, p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…')
                    acc.push(p)
                    return acc
                  }, [])
                  .map((item, i) =>
                    item === '…'
                      ? <span key={`ellipsis-${i}`} className="text-xs text-slate-600 px-1">…</span>
                      : <button
                          key={item}
                          onClick={() => goToPage(item as number)}
                          className={`w-8 h-7 rounded-lg text-xs font-medium transition-colors ${
                            item === page
                              ? 'text-white'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                          style={item === page ? { backgroundColor: '#1F3864' } : undefined}
                        >
                          {item}
                        </button>
                  )
                }

                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-default transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
