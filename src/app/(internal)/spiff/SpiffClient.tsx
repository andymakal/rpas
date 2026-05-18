'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Check, Search } from 'lucide-react'
import type { SpiffRow } from './page'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function SpiffClient({ rows: initial }: { rows: SpiffRow[] }) {
  const [rows, setRows]       = useState(initial)
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<'all' | 'outstanding' | 'paid'>('outstanding')
  const [paying, setPaying]   = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = rows
    if (filter === 'outstanding') list = list.filter(r => !r.paid_at)
    if (filter === 'paid')        list = list.filter(r => !!r.paid_at)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => {
        const client = `${r.cases?.customers?.first_name ?? ''} ${r.cases?.customers?.last_name ?? ''}`.toLowerCase()
        const agent  = `${r.agents?.first_name ?? ''} ${r.agents?.last_name ?? ''}`.toLowerCase()
        const agency = (r.agencies?.display_name ?? r.agencies?.name ?? '').toLowerCase()
        return client.includes(q) || agent.includes(q) || agency.includes(q)
      })
    }
    return list
  }, [rows, filter, search])

  async function togglePaid(row: SpiffRow) {
    setPaying(row.id)
    const newPaid = !row.paid_at
    try {
      const res = await fetch(`/api/spiff/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: newPaid }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, paid_at: data.paid_at } : r))
      }
    } finally {
      setPaying(null)
    }
  }

  const outstanding = rows.filter(r => !r.paid_at)

  const tabs: { key: typeof filter; label: string }[] = [
    { key: 'outstanding', label: `Outstanding (${outstanding.length})` },
    { key: 'paid',        label: 'Paid'                               },
    { key: 'all',         label: `All (${rows.length})`              },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === t.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client, LSP, or agency…"
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 w-64 focus:outline-none focus:border-slate-500 placeholder-slate-600"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-base font-medium">No SPIFF records found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Client', 'LSP', 'Agency', 'Earned', 'Amount', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const clientName = r.cases?.customers
                  ? `${r.cases.customers.first_name} ${r.cases.customers.last_name}`
                  : '—'
                const agentName = r.agents
                  ? `${r.agents.first_name} ${r.agents.last_name}`
                  : '—'
                const agencyName = r.agencies?.display_name ?? r.agencies?.name ?? '—'

                return (
                  <tr key={r.id} className={i < filtered.length - 1 ? 'border-b border-slate-800/50' : ''}>
                    <td className="px-4 py-3">
                      {r.cases?.id ? (
                        <Link href={`/referrals/${r.cases.id}`} className="font-medium text-white hover:text-blue-300 transition-colors">
                          {clientName}
                        </Link>
                      ) : (
                        <span className="font-medium text-white">{clientName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{agentName}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{agencyName}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{fmt(r.earned_at)}</td>
                    <td className="px-4 py-3 text-slate-200 font-medium">${Number(r.amount).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => togglePaid(r)}
                        disabled={paying === r.id}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all disabled:opacity-50 ${
                          r.paid_at
                            ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        {r.paid_at
                          ? <><Check className="w-3 h-3" /> Paid {fmt(r.paid_at)}</>
                          : 'Mark paid'
                        }
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-600">{filtered.length} of {rows.length} records</p>
    </div>
  )
}
