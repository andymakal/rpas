'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ChevronUp, ChevronDown, CalendarClock, AlertTriangle, Flame } from 'lucide-react'
import type { CaseRow, StageTranslation } from './page'
import { fmtDate, fmtDateShort } from '@/lib/fmt'
import { setNavList } from '@/lib/nav-list'

const TIER_BADGE: Record<number, string> = {
  1: 'bg-blue-900/50 text-blue-300 border border-blue-800',
  2: 'bg-indigo-900/50 text-indigo-300 border border-indigo-800',
  3: 'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function AgeBadge({ iso, label }: { iso: string | null; label?: string }) {
  const d = daysAgo(iso)
  const cls =
    d < 14 ? 'bg-emerald-900/50 text-emerald-300 border-emerald-800' :
    d < 30 ? 'bg-amber-900/50  text-amber-300  border-amber-800'  :
             'bg-red-900/50    text-red-300    border-red-800'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${cls}`}>
      {label ?? `${d}d`}
    </span>
  )
}

function FollowUpBadge({ date }: { date: string }) {
  const today     = new Date(); today.setHours(0, 0, 0, 0)
  const due       = new Date(date + 'T00:00:00')
  const diffDays  = Math.floor((due.getTime() - today.getTime()) / 86_400_000)

  if (diffDays < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium border bg-red-900/50 text-red-300 border-red-800">
        <AlertTriangle className="w-3 h-3" />
        Overdue
      </span>
    )
  }
  if (diffDays === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium border bg-amber-900/50 text-amber-300 border-amber-800">
        <CalendarClock className="w-3 h-3" />
        Today
      </span>
    )
  }
  if (diffDays <= 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium border bg-blue-900/50 text-blue-300 border-blue-800">
        <CalendarClock className="w-3 h-3" />
        {diffDays}d
      </span>
    )
  }
  return null // Far-future follow-ups don't need a list badge
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

type SortKey = 'client' | 'date' | 'touches' | 'stale' | 'followup'

export function ReferralsClient({ rows }: { rows: CaseRow[] }) {
  const router = useRouter()
  const [search, setSearch]             = useState('')
  const [tab, setTab]                   = useState<'active' | 'all' | 'closed'>('active')
  const [statusFilter, setStatusFilter] = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [sortKey, setSortKey]           = useState<SortKey>('date')
  const [sortDir, setSortDir]           = useState<'desc' | 'asc'>('desc')

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      // Default sort direction per key
      setSortDir(key === 'client' || key === 'touches' || key === 'stale' || key === 'followup' ? 'asc' : 'desc')
    }
  }

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

  const agencyOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      const name = r.agencies?.display_name ?? r.agencies?.name ?? ''
      if (name) seen.set(name, name)
    }
    return Array.from(seen.keys()).sort()
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

    if (statusFilter) list = list.filter(r => r.internal_status === statusFilter)

    if (agencyFilter) {
      list = list.filter(r =>
        (r.agencies?.display_name ?? r.agencies?.name ?? '') === agencyFilter
      )
    }

    if (sourceFilter) list = list.filter(r => r.lead_source === sourceFilter)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => {
        const client = `${r.customers?.first_name ?? ''} ${r.customers?.last_name ?? ''}`.toLowerCase()
        const agency = (r.agencies?.display_name ?? r.agencies?.name ?? '').toLowerCase()
        return client.includes(q) || agency.includes(q)
      })
    }

    list = [...list].sort((a, b) => {
      let diff = 0
      if (sortKey === 'client') {
        const aL = `${a.customers?.last_name ?? ''} ${a.customers?.first_name ?? ''}`.toLowerCase().trim()
        const bL = `${b.customers?.last_name ?? ''} ${b.customers?.first_name ?? ''}`.toLowerCase().trim()
        diff = aL < bL ? -1 : aL > bL ? 1 : 0
      } else if (sortKey === 'touches') {
        diff = (a.touches ?? 0) - (b.touches ?? 0)
      } else if (sortKey === 'stale') {
        // Sort by last contact — null (never contacted) comes first in asc
        const aVal = a.last_contact_at ? new Date(a.last_contact_at).getTime() : 0
        const bVal = b.last_contact_at ? new Date(b.last_contact_at).getTime() : 0
        diff = aVal - bVal
      } else if (sortKey === 'followup') {
        // Null follow-up dates go last
        const aVal = a.follow_up_date ? new Date(a.follow_up_date).getTime() : Infinity
        const bVal = b.follow_up_date ? new Date(b.follow_up_date).getTime() : Infinity
        diff = aVal - bVal
      } else {
        diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      return sortDir === 'asc' ? diff : -diff
    })

    return list
  }, [rows, tab, statusFilter, agencyFilter, search, sortKey, sortDir])

  const activeCount = rows.filter(r => r.stage_translations?.is_active_case === true).length

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'active', label: `Active (${activeCount})` },
    { key: 'all',    label: `All (${rows.length})` },
    { key: 'closed', label: 'Closed / Lost' },
  ]

  const sortCols: { key: SortKey; label: string }[] = [
    { key: 'client',  label: 'Contact'    },
    { key: 'date',    label: 'Date In'    },
    { key: 'touches', label: 'Touches'    },
    { key: 'stale',   label: 'Staleness'  },
    { key: 'followup',label: 'Follow-up'  },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setStatusFilter(''); setAgencyFilter(''); setSourceFilter('') }}
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

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
          >
            <option value="">All sources</option>
            <option value="agency_referral">Agency Referral</option>
            <option value="allstate_web">Allstate.com</option>
            <option value="self_generated">Self Generated</option>
          </select>

          <select
            value={agencyFilter}
            onChange={e => setAgencyFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
          >
            <option value="">All agencies</option>
            {agencyOptions.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

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
                {/* Contact — sortable */}
                {(() => {
                  const active = sortKey === 'client'
                  return (
                    <th className="px-4 py-3 text-left">
                      <button onClick={() => handleSort('client')}
                        className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${active ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                        Contact
                        {active
                          ? sortDir === 'desc' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5 opacity-30" />}
                      </button>
                    </th>
                  )
                })()}
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Status</th>
                {sortCols.filter(c => c.key !== 'client').map(({ key, label }) => {
                  const active = sortKey === key
                  return (
                    <th key={key} className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort(key)}
                        className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
                          active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {label}
                        {active
                          ? sortDir === 'desc' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5 opacity-30" />}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.id}
                  onClick={() => { setNavList(filtered.map(x => x.id)); router.push(`/referrals/${r.id}`) }}
                  className={`cursor-pointer transition-colors hover:bg-slate-800/40 ${
                    i < filtered.length - 1 ? 'border-b border-slate-800/50' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.is_hot_lead && <Flame className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />}
                      <p className="font-medium text-white">
                        {r.customers?.first_name ?? '—'} {r.customers?.last_name ?? ''}
                      </p>
                      {r.is_owner_referral && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-violet-900/50 text-violet-300 border border-violet-800 flex-shrink-0">
                          Owner
                        </span>
                      )}
                      {r.lead_source === 'allstate_web' && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-sky-900/50 text-sky-300 border border-sky-800 flex-shrink-0">
                          Allstate.com
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{r.customers?.phone ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {r.agencies?.display_name ?? r.agencies?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge translation={r.stage_translations} internal_status={r.internal_status} />
                  </td>
                  {/* Date In */}
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-400">
                      {fmtDate(r.created_at)}
                    </p>
                    <div className="mt-1">
                      <AgeBadge iso={r.created_at} />
                    </div>
                  </td>
                  {/* Touches */}
                  <td className="px-4 py-3">
                    {(() => {
                      const t = r.touches ?? 0
                      const cls = t === 0 ? 'text-red-400' : t < 4 ? 'text-amber-400' : t < 8 ? 'text-slate-300' : 'text-emerald-400'
                      return <span className={`text-sm font-semibold ${cls}`}>{t}</span>
                    })()}
                  </td>
                  {/* Staleness */}
                  <td className="px-4 py-3">
                    {r.last_contact_at ? (
                      <AgeBadge iso={r.last_contact_at} label={`${daysAgo(r.last_contact_at)}d ago`} />
                    ) : (
                      <span className="text-xs text-red-400 font-medium">Never</span>
                    )}
                  </td>
                  {/* Follow-up */}
                  <td className="px-4 py-3">
                    {r.follow_up_date ? (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400">
                          {fmtDateShort(r.follow_up_date)}
                        </p>
                        <FollowUpBadge date={r.follow_up_date} />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-600">{filtered.length} of {rows.length} referrals</p>
    </div>
  )
}
