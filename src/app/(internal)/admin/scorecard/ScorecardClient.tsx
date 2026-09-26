'use client'

import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, Search, Trophy, TrendingUp, AlertCircle } from 'lucide-react'
import type { ScorecardRow } from './page'

const ANNUAL_GOAL = 12

function fmt$(v: number): string {
  if (v === 0) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function pct(n: number, d: number): string {
  if (!d) return '—'
  return `${Math.round((n / d) * 100)}%`
}

type SortKey = 'name' | 'policies' | 'gdc' | 'referrals' | 'pending' | 'placed_premium' | 'conversion'
type View    = 'quarter' | 'ytd'

function GoalBar({ count, goal = ANNUAL_GOAL }: { count: number; goal?: number }) {
  const capped  = Math.min(count, goal)
  const pctFull = (capped / goal) * 100
  const qualified = count >= goal

  const barColor = qualified
    ? 'bg-emerald-500'
    : count >= goal * 0.75
    ? 'bg-amber-400'
    : count >= goal * 0.5
    ? 'bg-blue-400'
    : 'bg-slate-600'

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden min-w-[60px]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pctFull}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums whitespace-nowrap ${
        qualified ? 'text-emerald-400' : 'text-slate-300'
      }`}>
        {count}/{goal}
        {qualified && <span className="ml-1">✓</span>}
      </span>
    </div>
  )
}

function StatusBadge({ count }: { count: number }) {
  if (count >= ANNUAL_GOAL) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
      <Trophy className="w-3 h-3" /> Qualified
    </span>
  )
  if (count >= ANNUAL_GOAL * 0.75) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
      <TrendingUp className="w-3 h-3" /> On Track
    </span>
  )
  if (count >= ANNUAL_GOAL * 0.5) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
      Progressing
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
      <AlertCircle className="w-3 h-3" /> Needs Attention
    </span>
  )
}

type Props = {
  rows:           ScorecardRow[]
  currentQuarter: number
  year:           number
}

export default function ScorecardClient({ rows, currentQuarter, year }: Props) {
  const [view,    setView]    = useState<View>('ytd')
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('policies')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r =>
      !q
      || (r.display_name ?? r.name).toLowerCase().includes(q)
      || (r.sml_team ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = 0, bv = 0
      switch (sortKey) {
        case 'name':
          return sortDir === 'asc'
            ? (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)
            : (b.display_name ?? b.name).localeCompare(a.display_name ?? a.name)
        case 'policies':
          av = a.allstate_policy_count; bv = b.allstate_policy_count; break
        case 'gdc':
          av = a.gdc_ytd; bv = b.gdc_ytd; break
        case 'referrals':
          av = view === 'quarter' ? a.placed_count_q  : a.referrals_total
          bv = view === 'quarter' ? b.placed_count_q  : b.referrals_total
          break
        case 'pending':
          av = a.pending_count; bv = b.pending_count; break
        case 'placed_premium':
          av = view === 'quarter' ? a.placed_premium_q : a.placed_premium
          bv = view === 'quarter' ? b.placed_premium_q : b.placed_premium
          break
        case 'conversion':
          av = a.referrals_total ? a.placed_count / a.referrals_total : 0
          bv = b.referrals_total ? b.placed_count / b.referrals_total : 0
          break
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [filtered, sortKey, sortDir, view])

  // Summary counts
  const qualified  = rows.filter(r => r.allstate_policy_count >= ANNUAL_GOAL).length
  const onTrack    = rows.filter(r => r.allstate_policy_count >= ANNUAL_GOAL * 0.75 && r.allstate_policy_count < ANNUAL_GOAL).length
  const totalGdc   = rows.reduce((s, r) => s + r.gdc_ytd, 0)
  const totalPolicies = rows.reduce((s, r) => s + r.allstate_policy_count, 0)

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp className="w-3 h-3 opacity-20" />
    return sortDir === 'asc'
      ? <ChevronUp   className="w-3 h-3 text-blue-400" />
      : <ChevronDown className="w-3 h-3 text-blue-400" />
  }

  function Th({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) {
    return (
      <th
        onClick={() => handleSort(k)}
        className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-200 whitespace-nowrap ${className}`}
      >
        <span className="flex items-center gap-1">{label} <SortIcon k={k} /></span>
      </th>
    )
  }

  return (
    <div className="space-y-5">

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: `${year} Policies (Total)`,  value: String(totalPolicies),               sub: `across ${rows.length} agencies` },
          { label: 'Qualified (≥ 12)',           value: String(qualified),                   sub: `${Math.round((qualified/rows.length)*100)}% of agencies` },
          { label: 'On Track (≥ 9)',             value: String(onTrack),                     sub: 'not yet qualified'   },
          { label: 'GDC YTD',                   value: fmt$(totalGdc),                      sub: `${year} all agencies`  },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-slate-900 rounded-xl border border-slate-800 px-4 py-3">
            <p className="text-slate-500 text-xs mb-1">{label}</p>
            <p className="text-white text-xl font-bold">{value}</p>
            <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
          {(['ytd', 'quarter'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                view === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'ytd' ? `${year} YTD` : `Q${currentQuarter}`}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agency or team…"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
          />
        </div>

        <p className="text-slate-500 text-xs ml-auto">{sorted.length} agencies</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 border-b border-slate-800">
            <tr>
              <Th k="name"           label="Agency"                    className="pl-4" />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">SML Team</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">Status</th>
              <Th k="policies"       label="Policies (Allstate)"       />
              <Th k="referrals"      label={view === 'quarter' ? `Placed Q${currentQuarter}` : 'Referrals'} />
              <Th k="pending"        label="Pending"                   />
              <Th k="placed_premium" label={view === 'quarter' ? 'Premium Q' : 'Premium YTD'} />
              <Th k="gdc"            label="GDC YTD"                   />
              <Th k="conversion"     label="Conv %"                    />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {sorted.map(r => {
              const label          = r.display_name ?? r.name
              const placedDisplay  = view === 'quarter' ? r.placed_count_q   : r.placed_count
              const premiumDisplay = view === 'quarter' ? r.placed_premium_q : r.placed_premium
              const convRate       = r.referrals_total ? (r.placed_count / r.referrals_total) * 100 : null

              return (
                <tr key={r.agency_id} className="hover:bg-slate-800/30 transition-colors">
                  {/* Agency */}
                  <td className="px-4 py-3">
                    <a
                      href={`/portal/${r.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-slate-200 hover:text-white hover:underline"
                    >
                      {label}
                    </a>
                  </td>

                  {/* SML Team */}
                  <td className="px-3 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {r.sml_team ?? '—'}
                  </td>

                  {/* Status badge */}
                  <td className="px-3 py-3">
                    <StatusBadge count={r.allstate_policy_count} />
                  </td>

                  {/* Policies + goal bar */}
                  <td className="px-3 py-3 min-w-[160px]">
                    <GoalBar count={r.allstate_policy_count} />
                    {r.referrals_gifted > 0 && (
                      <p className="text-slate-500 text-xs mt-0.5">
                        {r.referrals_portal}p + {r.referrals_gifted}g
                      </p>
                    )}
                  </td>

                  {/* Placed (quarter or referrals YTD) */}
                  <td className="px-3 py-3 tabular-nums text-slate-300 text-right">
                    {placedDisplay > 0 ? placedDisplay : <span className="text-slate-600">0</span>}
                  </td>

                  {/* Pending */}
                  <td className="px-3 py-3 tabular-nums text-slate-400 text-right">
                    {r.pending_count > 0 ? (
                      <span title={`${fmt$(r.pending_premium)} premium`}>{r.pending_count}</span>
                    ) : <span className="text-slate-600">0</span>}
                  </td>

                  {/* Placed premium */}
                  <td className="px-3 py-3 tabular-nums text-slate-300 text-right">
                    {premiumDisplay > 0 ? fmt$(premiumDisplay) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* GDC */}
                  <td className="px-3 py-3 tabular-nums text-right">
                    <span className={r.gdc_ytd > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                      {fmt$(r.gdc_ytd)}
                    </span>
                  </td>

                  {/* Conversion */}
                  <td className="px-3 py-3 tabular-nums text-slate-400 text-right pr-4">
                    {convRate !== null ? `${Math.round(convRate)}%` : '—'}
                  </td>
                </tr>
              )
            })}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500 text-sm">
                  No agencies match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-slate-600 text-xs">
        Policies count sourced from Allstate compensation report (GDC import).
        Referrals, pending, and placed figures are from RPAS cases.
        GDC reflects credits processed YTD; chargebacks reduce the total.
      </p>
    </div>
  )
}
