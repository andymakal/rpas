'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { CaseRow, StageTranslation } from './page'

const TIER_BADGE: Record<number, string> = {
  1: 'bg-blue-900/50 text-blue-300 border border-blue-800',
  2: 'bg-indigo-900/50 text-indigo-300 border border-indigo-800',
  3: 'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
}

function StatusBadge({ translation, internal_status }: { translation: StageTranslation | null; internal_status: string }) {
  if (translation?.is_active_case === false) {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-slate-800/50 text-slate-500 border border-slate-700">
        {translation?.agency_label ?? internal_status}
      </span>
    )
  }
  const tierCls = TIER_BADGE[translation?.tier ?? 1] ?? TIER_BADGE[1]
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tierCls}`}>
      {translation?.agency_label ?? internal_status}
    </span>
  )
}

export function ReferralsClient({ rows }: { rows: CaseRow[] }) {
  const [search, setSearch]             = useState('')
  const [tab, setTab]                   = useState<'active' | 'all' | 'closed'>('active')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortDir, setSortDir]           = useState<'desc' | 'asc'>('desc')

  // Unique statuses present in the full data set, sorted by label
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      if (r.internal_status && r.stage_translations?.agency_label) {
        seen.set(r.internal_status, r.stage_translations.agency_label)
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows

    if (tab === 'active') {
      list = list.filter(r => r.stage_translations?.is_active_case === true)
    } else if (tab === 'closed') {
      list = list.filter(r =>
        r.stage_translations?.is_active_case === false &&
        r.internal_status !== 'snoozed'
      )
    }

    if (statusFilter) {
      list = list.filter(r => r.internal_status === statusFilter)
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => {
        const client = `${r.customers?.first_name ?? ''} ${r.customers?.last_name ?? ''}`.toLowerCase()
        const agency = (r.agencies?.display_name ?? r.agencies?.name ?? '').toLowerCase()
        return client.includes(q) || agency.includes(q)
      })
    }

    list = [...list].sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortDir === 'asc' ? diff : -diff
    })

    return list
  }, [rows, tab, statusFilter, search, sortDir])

  const activeCount = rows.filter(r => r.stage_translations?.is_active_case === true).length

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'active', label: `Active (${activeCount})` },
    { key: 'all',    label: `All (${rows.length})` },
    { key: 'closed', label: 'Closed / Lost' },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs + filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setStatusFilter('') }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
          >
            <option value="">All statuses</option>
            {statusOptions.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search client or agency…"
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 w-56 focus:outline-none focus:border-slate-500 placeholder-slate-600"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base font-medium text-slate-400">No referrals found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Contact', 'Agency', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400">{h}</th>
                ))}
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Date In
                    {sortDir === 'desc'
                      ? <ChevronDown className="w-3.5 h-3.5" />
                      : <ChevronUp className="w-3.5 h-3.5" />
                    }
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <Link key={r.id} href={`/referrals/${r.id}`} legacyBehavior>
                  <tr
                    className={`cursor-pointer transition-colors hover:bg-slate-800/40 ${
                      i < filtered.length - 1 ? 'border-b border-slate-800/50' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">
                        {r.customers?.first_name ?? '—'} {r.customers?.last_name ?? ''}
                      </p>
                      <p className="text-xs text-slate-500">{r.customers?.phone ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {r.agencies?.display_name ?? r.agencies?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge translation={r.stage_translations} internal_status={r.internal_status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                </Link>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-600">{filtered.length} of {rows.length} referrals</p>
    </div>
  )
}
