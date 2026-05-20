'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronUp, ChevronDown, Search, Target } from 'lucide-react'
import type { PlacedCase } from './page'

type SortKey = 'client' | 'carrier' | 'face' | 'premium' | 'date'

// ── Helpers ───────────────────────────────────────────────────
function formatCurrency(val: number): string {
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(3)}B`
  if (val >= 1_000_000)     return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000)         return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toFixed(0)}`
}

function formatCurrencyFull(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(val)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Period = 'month' | 'quarter' | 'ytd' | 'all'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month',   label: 'This Month'    },
  { key: 'quarter', label: 'This Quarter'  },
  { key: 'ytd',     label: 'YTD'           },
  { key: 'all',     label: 'All Time'      },
]

function periodStart(p: Period): string | null {
  const now = new Date()
  if (p === 'all') return null
  if (p === 'ytd') return new Date(now.getFullYear(), 0, 1).toISOString()
  if (p === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return new Date(now.getFullYear(), q * 3, 1).toISOString()
  }
  // month
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

const ANNUAL_GOAL = 1_000_000_000 // $1B

// ── Component ─────────────────────────────────────────────────
export default function ProductionClient({ cases }: { cases: PlacedCase[] }) {
  const router = useRouter()
  const [period, setPeriod]         = useState<Period>('ytd')
  const [agencyFilter, setAgency]   = useState('')
  const [search, setSearch]         = useState('')
  const [sortKey, setSortKey]       = useState<SortKey>('date')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'face' || key === 'premium' ? 'desc' : 'asc') }
  }

  const SortTh = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sortKey === k
    return (
      <th className="px-4 py-3 text-left">
        <button onClick={() => handleSort(k)}
          className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${active ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          {label}
          {active
            ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3 opacity-30" />}
        </button>
      </th>
    )
  }

  const cutoff = useMemo(() => periodStart(period), [period])

  // YTD face amount for the goal progress bar (always YTD regardless of period filter)
  const ytdFace = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 1).toISOString()
    return cases
      .filter(c => c.placed_at && c.placed_at >= start)
      .reduce((s, c) => s + (c.face_amount ?? 0), 0)
  }, [cases])

  const goalPct = Math.min((ytdFace / ANNUAL_GOAL) * 100, 100)

  // Agency options from all cases (not filtered)
  const agencyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const c of cases) {
      const name = c.agencies?.display_name ?? c.agencies?.name ?? ''
      if (name) seen.add(name)
    }
    return Array.from(seen).sort()
  }, [cases])

  // Filtered rows
  const filtered = useMemo(() => {
    let rows = cases

    if (cutoff) rows = rows.filter(c => c.placed_at && c.placed_at >= cutoff)
    if (agencyFilter) rows = rows.filter(c =>
      (c.agencies?.display_name ?? c.agencies?.name ?? '') === agencyFilter
    )
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(c => {
        const name = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.toLowerCase()
        const agency = (c.agencies?.display_name ?? c.agencies?.name ?? '').toLowerCase()
        const policy = (c.policy_number ?? '').toLowerCase()
        return name.includes(q) || agency.includes(q) || policy.includes(q)
      })
    }

    rows = [...rows].sort((a, b) => {
      let diff = 0
      if (sortKey === 'client') {
        const aL = `${a.customers?.last_name ?? ''} ${a.customers?.first_name ?? ''}`.toLowerCase().trim()
        const bL = `${b.customers?.last_name ?? ''} ${b.customers?.first_name ?? ''}`.toLowerCase().trim()
        diff = aL < bL ? -1 : aL > bL ? 1 : 0
      } else if (sortKey === 'carrier') {
        const aC = (a.products?.carriers?.short_name ?? a.products?.name ?? '').toLowerCase()
        const bC = (b.products?.carriers?.short_name ?? b.products?.name ?? '').toLowerCase()
        diff = aC < bC ? -1 : aC > bC ? 1 : 0
      } else if (sortKey === 'face') {
        diff = (a.face_amount ?? 0) - (b.face_amount ?? 0)
      } else if (sortKey === 'premium') {
        diff = (a.annual_premium ?? 0) - (b.annual_premium ?? 0)
      } else {
        diff = new Date(a.placed_at ?? '').getTime() - new Date(b.placed_at ?? '').getTime()
      }
      return sortDir === 'asc' ? diff : -diff
    })

    return rows
  }, [cases, cutoff, agencyFilter, search, sortKey, sortDir])

  // Summary stats from filtered rows
  const stats = useMemo(() => ({
    faceTotal:    filtered.reduce((s, c) => s + (c.face_amount ?? 0), 0),
    premiumTotal: filtered.reduce((s, c) => s + (c.annual_premium ?? 0), 0),
    count:        filtered.length,
    allTimeForce: cases.reduce((s, c) => s + (c.face_amount ?? 0), 0),
  }), [filtered, cases])

  return (
    <div className="space-y-5">

      {/* $1B Goal Progress */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-slate-300">Annual Goal — $1B In Force</span>
          </div>
          <span className="text-sm font-semibold text-emerald-400">{goalPct.toFixed(2)}%</span>
        </div>
        <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
            style={{ width: `${goalPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-500">{formatCurrency(ytdFace)} placed YTD</span>
          <span className="text-xs text-slate-600">{formatCurrency(ANNUAL_GOAL - ytdFace)} remaining</span>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Face Amount</p>
          <p className="text-2xl font-bold text-white">{formatCurrencyFull(stats.faceTotal)}</p>
          <p className="text-xs text-slate-600 mt-0.5">{stats.count} polic{stats.count !== 1 ? 'ies' : 'y'}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Annual Premium</p>
          <p className="text-2xl font-bold text-blue-400">{formatCurrencyFull(stats.premiumTotal)}</p>
          <p className="text-xs text-slate-600 mt-0.5">GDC basis</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Policy Count</p>
          <p className="text-2xl font-bold text-slate-300">{stats.count}</p>
          <p className="text-xs text-slate-600 mt-0.5">in selected period</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total In Force</p>
          <p className="text-2xl font-bold text-emerald-400">{formatCurrencyFull(stats.allTimeForce)}</p>
          <p className="text-xs text-slate-600 mt-0.5">all time</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        {/* Period tabs */}
        <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 gap-0.5">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${period === p.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {p.label}
            </button>
          ))}
        </div>

        <select value={agencyFilter} onChange={e => setAgency(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500">
          <option value="">All agencies</option>
          {agencyOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input type="text" placeholder="Search client, agency, or policy…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base font-medium text-slate-400">No placed policies found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <SortTh k="client"  label="Client"         />
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                <SortTh k="carrier" label="Carrier · Product" />
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Policy #</th>
                <SortTh k="face"    label="Face Amount"    />
                <SortTh k="premium" label="Annual Premium" />
                <SortTh k="date"    label="Date Placed"    />
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const isLastRow = i === filtered.length - 1
                const carrierProduct = (() => {
                  const p = c.products
                  if (!p) return '—'
                  return p.carriers?.short_name ? `${p.carriers.short_name} · ${p.name}` : p.name
                })()

                return (
                  <tr key={c.id} onClick={() => router.push(`/cases/${c.id}`)}
                    className={`group cursor-pointer transition-colors hover:bg-slate-800/30 ${!isLastRow ? 'border-b border-slate-800/50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white group-hover:text-blue-300 transition-colors">
                        {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
                      </p>
                      {c.agents && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {c.agents.first_name} {c.agents.last_name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.agencies
                        ? <span className="text-slate-300">{c.agencies.display_name ?? c.agencies.name}</span>
                        : <span className="text-amber-400 text-xs font-medium">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[180px] truncate">
                      {carrierProduct}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">
                      {c.policy_number ?? <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-200 tabular-nums font-semibold">
                      {formatCurrencyFull(c.face_amount)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 tabular-nums">
                      {formatCurrencyFull(c.annual_premium)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(c.placed_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <ChevronRight className="w-4 h-4 group-hover:text-slate-400 transition-colors" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-600">{filtered.length} of {cases.length} placed policies</p>
    </div>
  )
}
