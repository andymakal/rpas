'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ChevronRight, Search } from 'lucide-react'
import type { CaseRow } from './page'

type FilterTab = 'all' | 'active' | 'pending' | 'placed' | 'closed'

function tierBadgeClass(st: CaseRow['stage_translations']): string {
  if (!st) return 'bg-slate-800 text-slate-400 border border-slate-700'
  if (st.is_won) return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (st.is_lost) return 'bg-slate-800/70 text-slate-400 border border-slate-700'
  if (st.is_snoozed) return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
  switch (st.tier) {
    case 1: return 'bg-blue-900/50 text-blue-300 border border-blue-800'
    case 2: return 'bg-indigo-900/50 text-indigo-300 border border-indigo-800'
    case 3: return 'bg-emerald-900/50 text-emerald-300 border border-emerald-800'
    default: return 'bg-slate-800 text-slate-400 border border-slate-700'
  }
}

function formatCurrency(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function daysInStatus(statusEnteredAt: string | null): number {
  if (!statusEnteredAt) return 0
  const ms = Date.now() - new Date(statusEnteredAt).getTime()
  return Math.floor(ms / 86_400_000)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending (Tier 2)' },
  { key: 'placed', label: 'Placed' },
  { key: 'closed', label: 'Closed / Snoozed' },
]

export default function CasesClient({ cases }: { cases: CaseRow[] }) {
  const [tab, setTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let rows = cases

    // Tab filter
    if (tab === 'active') {
      rows = rows.filter(r => r.stage_translations?.is_active_case === true)
    } else if (tab === 'pending') {
      rows = rows.filter(r => r.stage_translations?.tier === 2)
    } else if (tab === 'placed') {
      rows = rows.filter(r => r.stage_translations?.is_won === true)
    } else if (tab === 'closed') {
      rows = rows.filter(
        r => r.stage_translations?.is_lost === true || r.stage_translations?.is_snoozed === true
      )
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r => {
        const clientName = `${r.customers?.first_name ?? ''} ${r.customers?.last_name ?? ''}`.toLowerCase()
        const agencyName = (r.agencies?.name ?? '').toLowerCase()
        return clientName.includes(q) || agencyName.includes(q)
      })
    }

    return rows
  }, [cases, tab, search])

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        {/* Tabs */}
        <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 gap-0.5">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                tab === t.key
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search client or agency…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600"
          />
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
                {['CLIENT', 'AGENCY', 'STATUS', 'CARRIER / PRODUCT', 'FACE AMOUNT', 'DAYS', 'DATE', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const days = daysInStatus(r.status_entered_at)
                const isStall =
                  days > 14 && (r.stage_translations?.is_active_case ?? false)
                const isLastRow = i === filtered.length - 1

                const carrierName = r.products?.carriers?.short_name ?? null
                const productName = r.products?.name ?? null
                const carrierProduct =
                  carrierName && productName
                    ? `${carrierName} · ${productName}`
                    : productName ?? carrierName ?? '—'

                return (
                  <tr
                    key={r.id}
                    className={`group transition-colors hover:bg-slate-800/30 ${!isLastRow ? 'border-b border-slate-800/50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/cases/${r.id}`} className="block">
                        <p className="font-medium text-white group-hover:text-blue-300 transition-colors">
                          {r.customers?.first_name ?? '—'} {r.customers?.last_name ?? ''}
                        </p>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.agencies ? (
                        <span className="text-slate-300">{r.agencies.name}</span>
                      ) : (
                        <span className="text-amber-400 text-xs font-medium">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tierBadgeClass(r.stage_translations)}`}
                      >
                        {r.stage_translations?.agency_label ?? r.internal_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">
                      {carrierProduct}
                    </td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">
                      {formatCurrency(r.face_amount)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span
                        className={
                          isStall
                            ? days > 30
                              ? 'text-red-400 font-semibold'
                              : 'text-amber-400 font-semibold'
                            : 'text-slate-400'
                        }
                      >
                        {days}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <Link href={`/cases/${r.id}`}>
                        <ChevronRight className="w-4 h-4 group-hover:text-slate-400 transition-colors" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
