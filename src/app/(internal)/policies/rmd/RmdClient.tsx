'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Phone, Search, ArrowLeft, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { RmdRow } from './page'

function fmt(n: number | null) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtPhone(raw: string | null): string {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '').slice(-10)
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

type SortKey = 'name' | 'carrier' | 'value' | 'rmd'

export function RmdClient({ rows }: { rows: RmdRow[] }) {
  const router  = useRouter()
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState<SortKey>('name')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc')

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'value' || k === 'rmd' ? 'desc' : 'asc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronsUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  const totalRmd = rows.reduce((s, r) => s + (r.rmd_amount ?? 0), 0)
  const totalValue = rows.reduce((s, r) => s + (r.cash_value_amount ?? 0), 0)

  const displayed = useMemo(() => {
    let list = rows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r =>
        r.client_name.toLowerCase().includes(q) ||
        (r.customers?.first_name ?? '').toLowerCase().includes(q) ||
        (r.customers?.last_name ?? '').toLowerCase().includes(q) ||
        (r.customers?.phone ?? '').includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let diff = 0
      if (sortKey === 'name') {
        diff = a.client_name.localeCompare(b.client_name)
      } else if (sortKey === 'carrier') {
        diff = a.carrier.localeCompare(b.carrier)
      } else if (sortKey === 'value') {
        diff = (a.cash_value_amount ?? 0) - (b.cash_value_amount ?? 0)
      } else if (sortKey === 'rmd') {
        diff = (a.rmd_amount ?? 0) - (b.rmd_amount ?? 0)
      }
      return sortDir === 'asc' ? diff : -diff
    })
  }, [rows, search, sortKey, sortDir])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/policies" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Policies
            </Link>
          </div>
          <h1 className="text-white text-2xl font-semibold">RMD Call List</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Active annuity policies — {rows.length} client{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total Annual RMDs</p>
          <p className="text-2xl font-bold text-amber-400">{fmt(totalRmd)}</p>
          <p className="text-xs text-slate-600 mt-0.5">across {rows.filter(r => r.rmd_amount).length} with known amounts</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total Account Value</p>
          <p className="text-2xl font-bold text-slate-300">{fmt(totalValue)}</p>
          <p className="text-xs text-slate-600 mt-0.5">across {rows.filter(r => r.cash_value_amount).length} with known values</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Clients to Call</p>
          <p className="text-2xl font-bold text-white">{rows.length}</p>
          <p className="text-xs text-slate-600 mt-0.5">active annuities in system</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search client or phone…"
          className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500 text-xs">
              <th className="text-left px-4 py-3 font-medium">
                <button onClick={() => handleSort('name')} className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors">
                  Client <SortIcon k="name" />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium">Phone</th>
              <th className="text-left px-4 py-3 font-medium">
                <button onClick={() => handleSort('carrier')} className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors">
                  Carrier <SortIcon k="carrier" />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium">Policy #</th>
              <th className="text-right px-4 py-3 font-medium">
                <button onClick={() => handleSort('value')} className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors ml-auto">
                  <SortIcon k="value" /> Account Value
                </button>
              </th>
              <th className="text-right px-4 py-3 font-medium">
                <button onClick={() => handleSort('rmd')} className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors ml-auto">
                  <SortIcon k="rmd" /> Annual RMD
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium">Agency</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-500 text-sm">
                  {search ? 'No clients match your search.' : 'No RMD policies found.'}
                </td>
              </tr>
            ) : displayed.map(row => {
              const phone       = row.customers?.phone ?? null
              const phoneFormatted = fmtPhone(phone)
              const agencyName  = row.agencies?.display_name ?? row.agencies?.name ?? '—'
              const customerUrl = row.customer_id ? `/customers/${row.customer_id}` : null

              return (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/policies/${row.id}`)}
                  className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{row.client_name}</p>
                    {customerUrl && (
                      <Link
                        href={customerUrl}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-sky-400 hover:underline"
                      >
                        {row.customers?.first_name} {row.customers?.last_name} →
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {phoneFormatted ? (
                      <a
                        href={`tel:${phone}`}
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {phoneFormatted}
                      </a>
                    ) : (
                      <span className="text-slate-600 text-xs">No phone</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{row.carrier}</td>
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs">{row.policy_number}</td>
                  <td className="px-4 py-3 text-right text-slate-200 font-medium tabular-nums">
                    {fmt(row.cash_value_amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.rmd_amount
                      ? <span className="text-amber-400 font-semibold">{fmt(row.rmd_amount)}</span>
                      : <span className="text-slate-600 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{agencyName}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/policies/${row.id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-slate-600 group-hover:text-slate-300 transition-colors"
                    >
                      →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {displayed.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-800 text-xs text-slate-600">
            {displayed.length} of {rows.length} clients shown
          </div>
        )}
      </div>
    </div>
  )
}
