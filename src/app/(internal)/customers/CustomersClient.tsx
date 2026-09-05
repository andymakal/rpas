'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, ChevronRight } from 'lucide-react'
import type { CustomerRow } from './page'

const SEGMENTS = [
  { value: 'wanderer',    label: 'Wanderer',    badge: 'bg-slate-700/80 text-slate-300 border border-slate-600' },
  { value: 'explorer',   label: 'Explorer',    badge: 'bg-blue-900/50 text-blue-300 border border-blue-800' },
  { value: 'pathfinder', label: 'Pathfinder',  badge: 'bg-emerald-900/50 text-emerald-300 border border-emerald-800' },
  { value: 'voyageur',   label: 'Voyageur',    badge: 'bg-amber-900/50 text-amber-300 border border-amber-800' },
  { value: 'trailblazer',label: 'Trailblazer', badge: 'bg-orange-900/50 text-orange-300 border border-orange-800' },
] as const

function SegmentBadge({ segment }: { segment: string | null }) {
  const s = SEGMENTS.find(x => x.value === segment)
  if (!s) return <span className="text-xs text-slate-600">—</span>
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.badge}`}>
      {s.label}
    </span>
  )
}

function formatPhone(raw: string | null): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '').slice(-10)
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
  }
  return raw
}

type SegmentFilter = 'all' | 'wanderer' | 'explorer' | 'pathfinder' | 'voyageur' | 'trailblazer' | 'unassigned'

export default function CustomersClient({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter()
  const [query, setQuery]                 = useState('')
  const [segFilter, setSegFilter]         = useState<SegmentFilter>('all')
  const [showDeceased, setShowDeceased]   = useState(false)
  const [noPoliciesOnly, setNoPoliciesOnly] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter(c => {
      if (!showDeceased && c.is_deceased) return false
      if (noPoliciesOnly && c.policy_count > 0) return false

      if (segFilter === 'unassigned' && c.segment) return false
      if (segFilter !== 'all' && segFilter !== 'unassigned' && c.segment !== segFilter) return false

      if (!q) return true
      const name  = `${c.first_name ?? ''} ${c.last_name}`.toLowerCase()
      const phone = (c.phone ?? '').replace(/\D/g, '')
      const email = (c.email ?? '').toLowerCase()
      const id    = (c.source_client_id ?? '').toLowerCase()
      return (
        name.includes(q) ||
        phone.includes(q.replace(/\D/g, '')) ||
        email.includes(q) ||
        id.includes(q)
      )
    })
  }, [customers, query, segFilter, showDeceased, noPoliciesOnly])

  const segCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, unassigned: 0 }
    for (const c of customers) {
      if (c.is_deceased) continue
      counts.all++
      const seg = c.segment ?? 'unassigned'
      counts[seg] = (counts[seg] ?? 0) + 1
    }
    return counts
  }, [customers])

  const FILTER_BUTTONS: { value: SegmentFilter; label: string }[] = [
    { value: 'all',         label: `All (${segCounts.all ?? 0})` },
    { value: 'trailblazer', label: `Trailblazer (${segCounts.trailblazer ?? 0})` },
    { value: 'voyageur',    label: `Voyageur (${segCounts.voyageur ?? 0})` },
    { value: 'pathfinder',  label: `Pathfinder (${segCounts.pathfinder ?? 0})` },
    { value: 'explorer',    label: `Explorer (${segCounts.explorer ?? 0})` },
    { value: 'wanderer',    label: `Wanderer (${segCounts.wanderer ?? 0})` },
    { value: 'unassigned',  label: `Unassigned (${segCounts.unassigned ?? 0})` },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Customers</h1>
            <p className="text-sm text-slate-400 mt-0.5">{customers.length.toLocaleString()} total</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={noPoliciesOnly}
                onChange={e => setNoPoliciesOnly(e.target.checked)}
                className="rounded"
              />
              No policies only
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDeceased}
                onChange={e => setShowDeceased(e.target.checked)}
                className="rounded"
              />
              Show deceased
            </label>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, phone, email, or client ID…"
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        {/* Segment filter */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_BUTTONS.map(btn => (
            <button
              key={btn.value}
              onClick={() => setSegFilter(btn.value)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                segFilter === btn.value
                  ? 'bg-slate-600 border-slate-500 text-white font-medium'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
            No customers match your filters.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Segment</th>
                <th className="px-4 py-3 font-medium text-center">Policies</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Flags</th>
                <th className="px-4 py-3 font-medium w-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(c => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}`)}
                  className={`group hover:bg-slate-800/40 transition-colors cursor-pointer ${c.is_deceased ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-white hover:text-blue-400 transition-colors"
                    >
                      {c.last_name}, {c.first_name ?? '—'}
                    </Link>
                    {c.source_client_id && (
                      <div className="text-xs text-slate-600 mt-0.5">{c.source_client_id}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SegmentBadge segment={c.segment} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.policy_count > 0 ? (
                      <span className="text-sm font-medium text-slate-300 tabular-nums">{c.policy_count}</span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">
                    {formatPhone(c.phone)}
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">
                    {c.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {c.city && c.state ? `${c.city}, ${c.state}` : (c.state ?? '—')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.is_emoney_client && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-800 font-medium">
                          eMoney
                        </span>
                      )}
                      {c.is_deceased && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                          Deceased
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 group-hover:text-slate-400 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      {filtered.length > 0 && filtered.length !== customers.length && (
        <div className="shrink-0 px-6 py-2 border-t border-slate-800 text-xs text-slate-500">
          Showing {filtered.length.toLocaleString()} of {customers.length.toLocaleString()}
        </div>
      )}
    </div>
  )
}
