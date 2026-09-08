'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Phone, Search, ArrowLeft, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { RmdRow } from './page'

function fmtCurrency(n: number) {
  if (n === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtPhone(raw: string | null): string {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '').slice(-10)
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

type SortKey = 'name' | 'age' | 'carrier' | 'value' | 'rmd'

export function RmdClient({ rows }: { rows: RmdRow[] }) {
  const router = useRouter()
  const [search, setSearch]   = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'value' || k === 'rmd' || k === 'age' ? 'desc' : 'asc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronsUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  const totalRmd   = rows.reduce((s, r) => s + r.total_rmd_amount,    0)
  const totalValue = rows.reduce((s, r) => s + r.total_account_value, 0)

  const displayed = useMemo(() => {
    let list = rows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r =>
        r.first_name.toLowerCase().includes(q) ||
        r.last_name.toLowerCase().includes(q) ||
        (r.phone ?? '').includes(q) ||
        r.carriers.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let diff = 0
      if      (sortKey === 'name')    diff = a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
      else if (sortKey === 'age')     diff = a.age - b.age
      else if (sortKey === 'carrier') diff = a.carriers.localeCompare(b.carriers)
      else if (sortKey === 'value')   diff = a.total_account_value - b.total_account_value
      else if (sortKey === 'rmd')     diff = a.total_rmd_amount    - b.total_rmd_amount
      return sortDir === 'asc' ? diff : -diff
    })
  }, [rows, search, sortKey, sortDir])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/policies" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Policies
          </Link>
        </div>
        <h1 className="text-white text-2xl font-semibold">RMD Call List</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Annuity clients age 73+ — {rows.length} client{rows.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total Annual RMDs</p>
          <p className="text-2xl font-bold text-amber-400">
            {totalRmd > 0
              ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalRmd)
              : '—'}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">across {rows.filter(r => r.total_rmd_amount > 0).length} with known amounts</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total Account Value</p>
          <p className="text-2xl font-bold text-slate-300">
            {totalValue > 0
              ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalValue)
              : '—'}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">across {rows.filter(r => r.total_account_value > 0).length} with known values</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Clients to Call</p>
          <p className="text-2xl font-bold text-white">{rows.length}</p>
          <p className="text-xs text-slate-600 mt-0.5">active annuities, age 73+</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search client, carrier, or phone…"
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
                <button onClick={() => handleSort('age')} className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors">
                  Age <SortIcon k="age" />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium">
                <button onClick={() => handleSort('carrier')} className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors">
                  Carrier <SortIcon k="carrier" />
                </button>
              </th>
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
                  {search ? 'No clients match your search.' : 'No annuity clients age 73+ found.'}
                </td>
              </tr>
            ) : displayed.map(row => {
              const phoneFormatted = fmtPhone(row.phone)
              return (
                <tr
                  key={row.customer_id}
                  onClick={() => router.push(`/customers/${row.customer_id}`)}
                  className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{row.first_name} {row.last_name}</p>
                    {row.policy_count > 1 && (
                      <p className="text-xs text-slate-500">{row.policy_count} policies</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {phoneFormatted ? (
                      <a
                        href={`tel:${row.phone}`}
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
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{row.age}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{row.carriers || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-200 font-medium tabular-nums">
                    {fmtCurrency(row.total_account_value)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.total_rmd_amount > 0
                      ? <span className="text-amber-400 font-semibold">{fmtCurrency(row.total_rmd_amount)}</span>
                      : <span className="text-slate-600 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{row.agency_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${row.customer_id}`}
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
