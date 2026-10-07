'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, ChevronRight, Plus, X } from 'lucide-react'
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

export default function CustomersClient() {
  const router = useRouter()
  const [customers, setCustomers]         = useState<CustomerRow[]>([])
  const [loading, setLoading]             = useState(true)
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [query, setQuery]                 = useState('')
  const [segFilter, setSegFilter]         = useState<SegmentFilter>('all')
  const [showDeceased, setShowDeceased]           = useState(false)
  const [showFormerClients, setShowFormerClients] = useState(false)
  const [showProspects, setShowProspects]         = useState(false)
  const [noPoliciesOnly, setNoPoliciesOnly]       = useState(false)

  // New customer modal
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [ncFirstName, setNcFirstName]         = useState('')
  const [ncLastName,  setNcLastName]          = useState('')
  const [ncPhone,     setNcPhone]             = useState('')
  const [ncEmail,     setNcEmail]             = useState('')
  const [ncSaving,    setNcSaving]            = useState(false)
  const [ncError,     setNcError]             = useState<string | null>(null)

  async function handleNewCustomer() {
    if (!ncLastName.trim()) { setNcError('Last name is required.'); return }
    setNcSaving(true); setNcError(null)
    try {
      const res  = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: ncFirstName, last_name: ncLastName, phone: ncPhone, email: ncEmail }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create customer')
      router.push(`/customers/${json.data.id}`)
    } catch (err) {
      setNcError(err instanceof Error ? err.message : 'Error')
      setNcSaving(false)
    }
  }

  function openNewCustomer() {
    setNcFirstName(''); setNcLastName(''); setNcPhone(''); setNcEmail(''); setNcError(null)
    setShowNewCustomer(true)
  }

  // Server search state — null means not in search mode (showing browse view)
  const [searchResults, setSearchResults] = useState<CustomerRow[] | null>(null)
  const [searching, setSearching]         = useState(false)

  useEffect(() => {
    fetch('/api/customers')
      .then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`)))
        return r.json()
      })
      .then((data: CustomerRow[]) => { setCustomers(data); setLoading(false) })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  // Debounced server search — fires when query is 2+ chars
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/customers/search?mode=list&q=${encodeURIComponent(q)}`)
        const json = await res.json()
        setSearchResults(Array.isArray(json.data) ? json.data : [])
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  // Browse-mode filter (segment counts + unfiltered view)
  const browsed = useMemo(() => {
    return customers.filter(c => {
      if (!showDeceased && c.is_deceased) return false
      if (!showFormerClients && c.is_former_client) return false
      if (!showProspects && c.is_prospect) return false
      if (noPoliciesOnly && c.policy_count > 0) return false
      if (segFilter === 'unassigned' && c.segment) return false
      if (segFilter !== 'all' && segFilter !== 'unassigned' && c.segment !== segFilter) return false
      return true
    })
  }, [customers, segFilter, showDeceased, showFormerClients, showProspects, noPoliciesOnly])

  // What actually goes to the table
  const isSearchMode = searchResults !== null
  const displayed    = isSearchMode ? searchResults : browsed.slice(0, 200)
  const isCapped     = !isSearchMode && browsed.length > 200

  const segCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, unassigned: 0 }
    for (const c of customers) {
      if (c.is_deceased || c.is_former_client || c.is_prospect) continue
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

  if (loadError) return <div className="p-6 text-red-400">Failed to load customers: {loadError}</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* New Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-base">New Customer</h2>
              <button onClick={() => setShowNewCustomer(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">First name</label>
                  <input value={ncFirstName} onChange={e => setNcFirstName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                    placeholder="First" autoFocus />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Last name <span className="text-red-400">*</span></label>
                  <input value={ncLastName} onChange={e => setNcLastName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                    placeholder="Last" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Phone</label>
                <input value={ncPhone} onChange={e => setNcPhone(e.target.value)} type="tel"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="(555) 555-5555" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Email</label>
                <input value={ncEmail} onChange={e => setNcEmail(e.target.value)} type="email"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="name@example.com" />
              </div>
              {ncError && <p className="text-xs text-red-400">{ncError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleNewCustomer} disabled={ncSaving || !ncLastName.trim()}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {ncSaving ? 'Creating…' : 'Create Customer'}
                </button>
                <button onClick={() => setShowNewCustomer(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Customers</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {searching
                ? 'Searching…'
                : isSearchMode
                  ? `${displayed.length.toLocaleString()} result${displayed.length === 1 ? '' : 's'}`
                  : loading
                    ? 'Loading…'
                    : browsed.length !== customers.length
                      ? `${browsed.length.toLocaleString()} of ${customers.length.toLocaleString()}`
                      : `${customers.length.toLocaleString()} total`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={openNewCustomer}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New Customer
            </button>
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
                checked={showProspects}
                onChange={e => setShowProspects(e.target.checked)}
                className="rounded"
              />
              Show prospects
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showFormerClients}
                onChange={e => setShowFormerClients(e.target.checked)}
                className="rounded"
              />
              Show former clients
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDeceased}
                onChange={e => setShowDeceased(e.target.checked)}
                className="rounded"
              />
              Show quiet filed
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
            className="w-full pl-9 pr-10 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs animate-pulse">…</span>
          )}
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
        {searching && !isSearchMode ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Searching…</div>
        ) : loading && !isSearchMode ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading customers…</div>
        ) : displayed.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
            {isSearchMode ? 'No customers found.' : 'No customers match your filters.'}
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
              {displayed.map(c => (
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
                      {c.is_former_client && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-medium">
                          Former
                        </span>
                      )}
                      {c.is_deceased && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                          Quiet Filed
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

      {/* Footer */}
      {isCapped ? (
        <div className="shrink-0 px-6 py-2 border-t border-slate-800 text-xs text-slate-500">
          Showing 200 of {browsed.length.toLocaleString()} — search to narrow results
        </div>
      ) : isSearchMode && displayed.length === 100 ? (
        <div className="shrink-0 px-6 py-2 border-t border-slate-800 text-xs text-slate-500">
          Showing first 100 results — refine your search to narrow further
        </div>
      ) : null}
    </div>
  )
}
