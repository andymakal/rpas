'use client'

import { useState, useTransition, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Search, AlertTriangle, CheckCircle, Clock, FileQuestion,
  Send, Shield, ShieldOff, ChevronRight, Cigarette,
} from 'lucide-react'
import type { PolicyListRow } from './page'

// ── Flag helpers (mirrors prep engine logic, client-side) ─────────────────────

function isTobacco(rateClass: string | null) {
  if (!rateClass) return false
  const r = rateClass.toLowerCase()
  // "Non-Tobacco" must not match — check for tobacco but exclude non-tobacco
  const hasTobacco = r.includes('tobacco') && !r.includes('non-tobacco') && !r.includes('non tobacco')
  return hasTobacco || r.includes('smoker')
}

function yearsRemaining(issueIso: string | null, termStr: string | null): number | null {
  if (!issueIso || !termStr) return null
  const match = termStr.match(/\d+/)
  if (!match) return null
  const issueYear = new Date(issueIso + 'T12:00:00').getFullYear()
  const expiry    = issueYear + parseInt(match[0], 10)
  return expiry - new Date().getFullYear()
}

function isUlLapseRisk(row: PolicyListRow): boolean {
  if (row.product_type !== 'UL' && row.product_type !== 'VUL') return false
  if (!row.cash_value_amount || !row.annual_premium) return false
  return (row.cash_value_amount / row.annual_premium) < 5
}

type FlagInfo = { label: string; color: 'red' | 'amber' | 'blue' }

function getFlags(row: PolicyListRow): FlagInfo[] {
  const flags: FlagInfo[] = []
  if (isTobacco(row.rate_class)) flags.push({ label: 'Tobacco', color: 'red' })

  if (row.product_type === 'Term') {
    const yr = yearsRemaining(row.issue_date, row.term_length)
    if (yr != null && yr <= 0)  flags.push({ label: 'Expired', color: 'red' })
    else if (yr != null && yr <= 2) flags.push({ label: `Exp. ${yr}yr`, color: 'red' })
    else if (yr != null && yr <= 5) flags.push({ label: `Exp. ${yr}yr`, color: 'amber' })
  }

  if (isUlLapseRisk(row)) flags.push({ label: 'Lapse Risk', color: 'amber' })
  return flags
}

// ── SA status badge ───────────────────────────────────────────────────────────

function SaBadge({ row }: { row: PolicyListRow }) {
  if (row.sa_status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-900/50 text-green-300 px-2 py-0.5 rounded-full">
        <CheckCircle className="w-3 h-3" /> Confirmed
      </span>
    )
  }
  if (row.sa_status === 'not_on_file') {
    if (row.sa_form_sent_at) {
      return (
        <span className="inline-flex items-center gap-1 text-xs bg-sky-900/50 text-sky-300 px-2 py-0.5 rounded-full">
          <Send className="w-3 h-3" /> Form Sent
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full">
        <ShieldOff className="w-3 h-3" /> Not SA
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
      <FileQuestion className="w-3 h-3" /> Unknown
    </span>
  )
}

// ── Product type badge ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-slate-600 text-xs">—</span>
  const colors: Record<string, string> = {
    Term: 'bg-blue-900/40 text-blue-300',
    UL:   'bg-purple-900/40 text-purple-300',
    VUL:  'bg-purple-900/40 text-purple-300',
    WL:   'bg-teal-900/40 text-teal-300',
    PERM: 'bg-teal-900/40 text-teal-300',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[type] ?? 'bg-slate-700 text-slate-400'}`}>
      {type}
    </span>
  )
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

// ── SA filter options ─────────────────────────────────────────────────────────

const SA_FILTERS = [
  { value: '',             label: 'All' },
  { value: 'unknown',      label: 'Not Checked' },
  { value: 'confirmed',    label: 'Confirmed SA' },
  { value: 'not_on_file',  label: 'Not SA' },
]

const TYPE_FILTERS = [
  { value: '',     label: 'All Types' },
  { value: 'Term', label: 'Term' },
  { value: 'UL',   label: 'UL' },
  { value: 'VUL',  label: 'VUL' },
  { value: 'WL',   label: 'WL' },
  { value: 'PERM', label: 'PERM' },
]

// ── Main component ────────────────────────────────────────────────────────────

export function PoliciesClient({
  rows,
  activeQ,
  activeSa,
  activeType,
}: {
  rows: PolicyListRow[]
  activeQ: string
  activeSa: string
  activeType: string
}) {
  const router   = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const [search,      setSearch]      = useState(activeQ)
  const [tobaccoOnly, setTobaccoOnly] = useState(false)

  const navigate = useCallback((q: string, sa: string, type: string) => {
    const params = new URLSearchParams()
    if (q)    params.set('q', q)
    if (sa)   params.set('sa', sa)
    if (type) params.set('type', type)
    startTransition(() => {
      router.push(`${pathname}${params.size ? '?' + params.toString() : ''}`)
    })
  }, [router, pathname])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    navigate(search, activeSa, activeType)
  }

  // Summary counts
  const confirmed    = rows.filter(r => r.sa_status === 'confirmed').length
  const notChecked   = rows.filter(r => r.sa_status === 'unknown').length
  const formSent     = rows.filter(r => r.sa_status === 'not_on_file' && r.sa_form_sent_at).length
  const notSa        = rows.filter(r => r.sa_status === 'not_on_file' && !r.sa_form_sent_at).length
  const tobaccoCount = useMemo(() => rows.filter(r => isTobacco(r.rate_class)).length, [rows])

  // Client-side filtered rows (tobacco toggle; SA/type/search are server-side)
  const displayRows = useMemo(
    () => tobaccoOnly ? rows.filter(r => isTobacco(r.rate_class)) : rows,
    [rows, tobaccoOnly]
  )

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-white text-2xl font-semibold">Policies</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            LBL / Everlake in-force book · {displayRows.length}{tobaccoOnly ? ' tobacco-rated' : ''} showing
          </p>
        </div>

        {/* SA summary chips */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Confirmed SA',  count: confirmed,  icon: CheckCircle, color: 'text-green-400' },
            { label: 'Not Checked',   count: notChecked, icon: FileQuestion, color: 'text-slate-400' },
            { label: 'Not SA',        count: notSa,      icon: ShieldOff,   color: 'text-amber-400' },
            { label: 'Form Sent',     count: formSent,   icon: Send,        color: 'text-sky-400'   },
          { label: 'Tobacco Rated', count: tobaccoCount, icon: Cigarette,  color: 'text-red-400'   },
          ].map(({ label, count, icon: Icon, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
              <Icon className={`w-5 h-5 shrink-0 ${color}`} />
              <div>
                <p className="text-white font-semibold text-lg leading-none">{count}</p>
                <p className="text-slate-500 text-xs mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-60">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or policy number…"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ backgroundColor: '#1F3864' }}
            >
              Search
            </button>
          </form>

          {/* SA filter */}
          <div className="flex gap-1">
            {SA_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => navigate(search, f.value, activeType)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeSa === f.value
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex gap-1">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => navigate(search, activeSa, f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeType === f.value
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Tobacco toggle */}
          <button
            onClick={() => setTobaccoOnly(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              tobaccoOnly
                ? 'bg-red-900/40 border-red-700 text-red-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Cigarette className="w-3.5 h-3.5" />
            Tobacco only
          </button>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 text-xs">
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Policy #</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Face Amt</th>
                <th className="text-left px-4 py-3 font-medium">SA Status</th>
                <th className="text-left px-4 py-3 font-medium">Agency</th>
                <th className="text-left px-4 py-3 font-medium">Flags</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500 text-sm">
                    No policies found
                  </td>
                </tr>
              )}
              {displayRows.map(row => {
                const flags = getFlags(row)
                const agencyName = row.agencies?.display_name ?? row.agencies?.name
                const customerName = row.customers
                  ? `${row.customers.first_name} ${row.customers.last_name}`
                  : null
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/policies/${row.id}`)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <p className="text-white font-medium truncate max-w-40">
                        {row.client_name}
                      </p>
                      {customerName && (
                        <Link
                          href={`/customers/${row.customer_id}`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-sky-400 hover:underline"
                        >
                          {customerName}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300 text-xs">
                      {row.policy_number}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={row.product_type} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 font-medium">
                      {row.face_amount ? fmt(row.face_amount) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <SaBadge row={row} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-36">
                      {agencyName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {flags.map(f => (
                          <span
                            key={f.label}
                            className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                              f.color === 'red'
                                ? 'bg-red-900/40 text-red-300'
                                : f.color === 'amber'
                                ? 'bg-amber-900/40 text-amber-300'
                                : 'bg-sky-900/40 text-sky-300'
                            }`}
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/policies/${row.id}`}
                        className="flex items-center justify-end text-slate-600 group-hover:text-slate-300 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {displayRows.length === 300 && (
            <div className="px-4 py-3 border-t border-slate-800 text-center text-slate-500 text-xs">
              Showing top 300 by face amount — use search or filters to narrow results
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
