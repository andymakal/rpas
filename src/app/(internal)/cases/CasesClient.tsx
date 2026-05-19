'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronUp, ChevronDown, Search, AlertTriangle, CalendarClock } from 'lucide-react'
import type { CaseRow } from './page'

// ── Helpers ───────────────────────────────────────────────────
function tierBadgeClass(st: CaseRow['stage_translations']): string {
  if (!st) return 'bg-slate-800 text-slate-400 border border-slate-700'
  if (st.is_won)    return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (st.is_lost)   return 'bg-slate-800/70 text-slate-400 border border-slate-700'
  if (st.is_snoozed)return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
  switch (st.tier) {
    case 1:  return 'bg-blue-900/50 text-blue-300 border border-blue-800'
    case 2:  return 'bg-indigo-900/50 text-indigo-300 border border-indigo-800'
    case 3:  return 'bg-emerald-900/50 text-emerald-300 border border-emerald-800'
    default: return 'bg-slate-800 text-slate-400 border border-slate-700'
  }
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000)     return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toFixed(0)}`
}

function formatCurrencyFull(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysAgo(iso: string | null): number {
  if (!iso) return 999
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function daysInStatus(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function StaleBadge({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-xs text-red-400 font-medium">Never</span>
  const d = daysAgo(iso)
  const cls = d < 7  ? 'bg-emerald-900/50 text-emerald-300 border-emerald-800' :
              d < 21 ? 'bg-amber-900/50 text-amber-300 border-amber-800' :
                       'bg-red-900/50 text-red-300 border-red-800'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${cls}`}>
      {d}d ago
    </span>
  )
}

function FollowUpBadge({ date }: { date: string }) {
  const today    = new Date(); today.setHours(0, 0, 0, 0)
  const due      = new Date(date + 'T00:00:00')
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0)  return <span className="inline-flex items-center gap-1 text-xs text-red-300 font-medium"><AlertTriangle className="w-3 h-3" />Overdue</span>
  if (diffDays === 0) return <span className="inline-flex items-center gap-1 text-xs text-amber-300 font-medium"><CalendarClock className="w-3 h-3" />Today</span>
  if (diffDays <= 3)  return <span className="inline-flex items-center gap-1 text-xs text-blue-300"><CalendarClock className="w-3 h-3" />{diffDays}d</span>
  return null
}

type FilterTab = 'all' | 'active' | 'pending' | 'placed' | 'closed'
type SortKey   = 'date' | 'face' | 'days' | 'stale' | 'followup' | 'client' | 'status' | 'carrier'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'active',  label: 'Active'           },
  { key: 'pending', label: 'Pending'          },
  { key: 'placed',  label: 'Placed'           },
  { key: 'closed',  label: 'Closed / Snoozed' },
  { key: 'all',     label: 'All'              },
]

// ── Component ─────────────────────────────────────────────────
export default function CasesClient({ cases }: { cases: CaseRow[] }) {
  const router = useRouter()
  const [tab, setTab]               = useState<FilterTab>('active')
  const [search, setSearch]         = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')
  const [sortKey, setSortKey]       = useState<SortKey>('days')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'face' ? 'desc' : 'asc') }
    // string sorts default asc; numeric/time sorts default as above
  }

  // Tier 2+ only
  const tier2Plus = useMemo(
    () => cases.filter(r => (r.stage_translations?.tier ?? 0) >= 2),
    [cases]
  )

  // Pipeline summary stats
  const stats = useMemo(() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
    const activePipeline = tier2Plus
      .filter(r => r.stage_translations?.is_active_case && !r.stage_translations?.is_won)
      .reduce((s, r) => s + (r.face_amount ?? 0), 0)
    const placedYTD = tier2Plus
      .filter(r => r.stage_translations?.is_won && r.placed_at && r.placed_at >= yearStart)
      .reduce((s, r) => s + (r.face_amount ?? 0), 0)
    const activeCount = tier2Plus.filter(r => r.stage_translations?.is_active_case).length
    return { activePipeline, placedYTD, activeCount }
  }, [tier2Plus])

  // Agency options
  const agencyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of tier2Plus) {
      const name = r.agencies?.display_name ?? r.agencies?.name ?? ''
      if (name) seen.add(name)
    }
    return Array.from(seen).sort()
  }, [tier2Plus])

  // Filtered + sorted rows
  const filtered = useMemo(() => {
    let rows = tier2Plus

    if (tab === 'active')  rows = rows.filter(r => r.stage_translations?.is_active_case === true)
    else if (tab === 'pending') rows = rows.filter(r => r.stage_translations?.tier === 2)
    else if (tab === 'placed')  rows = rows.filter(r => r.stage_translations?.is_won === true)
    else if (tab === 'closed')  rows = rows.filter(r => r.stage_translations?.is_lost === true || r.stage_translations?.is_snoozed === true)

    if (agencyFilter) rows = rows.filter(r => (r.agencies?.display_name ?? r.agencies?.name ?? '') === agencyFilter)

    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r => {
        const client = `${r.customers?.first_name ?? ''} ${r.customers?.last_name ?? ''}`.toLowerCase()
        const agency = (r.agencies?.display_name ?? r.agencies?.name ?? '').toLowerCase()
        return client.includes(q) || agency.includes(q)
      })
    }

    rows = [...rows].sort((a, b) => {
      let diff = 0
      if (sortKey === 'client') {
        const aL = `${a.customers?.last_name ?? ''} ${a.customers?.first_name ?? ''}`.toLowerCase().trim()
        const bL = `${b.customers?.last_name ?? ''} ${b.customers?.first_name ?? ''}`.toLowerCase().trim()
        diff = aL < bL ? -1 : aL > bL ? 1 : 0
      } else if (sortKey === 'status') {
        const aS = (a.stage_translations?.agency_label ?? a.internal_status).toLowerCase()
        const bS = (b.stage_translations?.agency_label ?? b.internal_status).toLowerCase()
        diff = aS < bS ? -1 : aS > bS ? 1 : 0
      } else if (sortKey === 'carrier') {
        const aC = (a.products?.carriers?.short_name ?? a.products?.name ?? '').toLowerCase()
        const bC = (b.products?.carriers?.short_name ?? b.products?.name ?? '').toLowerCase()
        diff = aC < bC ? -1 : aC > bC ? 1 : 0
      } else if (sortKey === 'face') {
        diff = (a.face_amount ?? 0) - (b.face_amount ?? 0)
      } else if (sortKey === 'days') {
        diff = daysInStatus(a.status_entered_at) - daysInStatus(b.status_entered_at)
      } else if (sortKey === 'stale') {
        diff = daysAgo(a.last_contact_at) - daysAgo(b.last_contact_at)
      } else if (sortKey === 'followup') {
        const aV = a.follow_up_date ? new Date(a.follow_up_date).getTime() : Infinity
        const bV = b.follow_up_date ? new Date(b.follow_up_date).getTime() : Infinity
        diff = aV - bV
      } else {
        diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      return sortDir === 'asc' ? diff : -diff
    })

    return rows
  }, [tier2Plus, tab, agencyFilter, search, sortKey, sortDir])

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

  return (
    <div className="space-y-5">

      {/* Pipeline summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Active Pipeline</p>
          <p className="text-2xl font-bold text-white">{formatCurrency(stats.activePipeline)}</p>
          <p className="text-xs text-slate-600 mt-0.5">{stats.activeCount} active case{stats.activeCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Placed YTD</p>
          <p className="text-2xl font-bold text-emerald-400">{formatCurrency(stats.placedYTD)}</p>
          <p className="text-xs text-slate-600 mt-0.5">
            {tier2Plus.filter(r => r.stage_translations?.is_won && r.placed_at && r.placed_at >= new Date(new Date().getFullYear(), 0, 1).toISOString()).length} polic{tier2Plus.filter(r => r.stage_translations?.is_won).length !== 1 ? 'ies' : 'y'} placed
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total In Force</p>
          <p className="text-2xl font-bold text-slate-300">
            {formatCurrency(tier2Plus.filter(r => r.stage_translations?.is_won).reduce((s, r) => s + (r.face_amount ?? 0), 0))}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">all placed policies</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 gap-0.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setAgencyFilter('') }}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${tab === t.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <select value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500">
          <option value="">All agencies</option>
          {agencyOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input type="text" placeholder="Search client or agency…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base font-medium text-slate-400">No cases found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <SortTh k="client"  label="Client"         />
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                <SortTh k="status"  label="Status"         />
                <SortTh k="carrier" label="Carrier · Product" />
                <SortTh k="face"    label="Face Amount"    />
                <SortTh k="days"    label="Days"           />
                <SortTh k="stale"   label="Last Contact"   />
                <SortTh k="followup"label="Follow-up"      />
                <SortTh k="date"    label="Date In"        />
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const days      = daysInStatus(r.status_entered_at)
                const isStall   = days > 14 && (r.stage_translations?.is_active_case ?? false)
                const isLastRow = i === filtered.length - 1
                const carrierProduct = (() => {
                  const p = r.products
                  if (!p) return '—'
                  return p.carriers?.short_name ? `${p.carriers.short_name} · ${p.name}` : p.name
                })()

                return (
                  <tr key={r.id} onClick={() => router.push(`/cases/${r.id}`)}
                    className={`group cursor-pointer transition-colors hover:bg-slate-800/30 ${!isLastRow ? 'border-b border-slate-800/50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white group-hover:text-blue-300 transition-colors">
                        {r.customers?.first_name ?? '—'} {r.customers?.last_name ?? ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {r.agencies
                        ? <span className="text-slate-300">{r.agencies.display_name ?? r.agencies.name}</span>
                        : <span className="text-amber-400 text-xs font-medium">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tierBadgeClass(r.stage_translations)}`}>
                        {r.stage_translations?.agency_label ?? r.internal_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[180px] truncate">{carrierProduct}</td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums font-medium">
                      {formatCurrencyFull(r.face_amount)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className={
                        isStall
                          ? days > 30 ? 'text-red-400 font-semibold' : 'text-amber-400 font-semibold'
                          : 'text-slate-400'
                      }>
                        {days}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StaleBadge iso={r.last_contact_at} />
                    </td>
                    <td className="px-4 py-3">
                      {r.follow_up_date ? (
                        <div className="space-y-0.5">
                          <p className="text-xs text-slate-400">
                            {new Date(r.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                          <FollowUpBadge date={r.follow_up_date} />
                        </div>
                      ) : (
                        <span className="text-xs text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(r.created_at)}</td>
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
      <p className="text-xs text-slate-600">{filtered.length} of {tier2Plus.length} cases</p>
    </div>
  )
}
