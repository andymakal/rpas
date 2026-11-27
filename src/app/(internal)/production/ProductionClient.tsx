'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  ChevronRight, ChevronUp, ChevronDown, Search, Target, UserCircle,
  CheckCircle2, AlertCircle, Link2, Link2Off, Loader2,
} from 'lucide-react'
import type { PlacedCase, GdcRecord } from './page'
import { fmtDate as formatDate } from '@/lib/fmt'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(3)}B`
  if (val >= 1_000_000)     return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000)         return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toFixed(0)}`
}

function formatCurrencyFull(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(val)
}

function formatCredit(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(val)
}

type SortKey = 'client' | 'carrier' | 'face' | 'premium' | 'date' | 'credit'
type Period = 'month' | 'quarter' | 'ytd' | 'all'
type Tab = 'life' | 'annuity' | 'securities'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month',   label: 'This Month'   },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'ytd',     label: 'YTD'          },
  { key: 'all',     label: 'All Time'     },
]

function periodStart(p: Period): string | null {
  const now = new Date()
  if (p === 'all') return null
  if (p === 'ytd') return new Date(now.getFullYear(), 0, 1).toISOString()
  if (p === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return new Date(now.getFullYear(), q * 3, 1).toISOString()
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

const ANNUAL_GOAL = 1_000_000_000

// ── Case Linker (for manually linking unmatched life GDC rows) ───────────────

type CaseHit = {
  id: string
  policy_number: string | null
  customers: { first_name: string | null; last_name: string | null } | null
  products: { name: string; carriers: { short_name: string } | null } | null
}

function CaseLinker({
  gdcId,
  currentCaseId,
  onLinked,
}: {
  gdcId: string
  currentCaseId: string | null
  onLinked: (caseId: string | null, label: string | null) => void
}) {
  const [open, setOpen]      = useState(false)
  const [q, setQ]            = useState('')
  const [hits, setHits]      = useState<CaseHit[]>([])
  const [searching, setSrch] = useState(false)
  const [saving, setSaving]  = useState(false)
  const [err, setErr]        = useState<string | null>(null)
  const [linkedLabel, setLinkedLabel] = useState<string | null>(null)

  const search = useCallback(async (term: string) => {
    if (term.length < 2) { setHits([]); return }
    setSrch(true)
    try {
      const res = await fetch(`/api/cases/search?q=${encodeURIComponent(term)}`)
      const json = await res.json() as { data?: CaseHit[] }
      setHits(json.data ?? [])
    } catch { /* ignore */ }
    setSrch(false)
  }, [])

  const link = useCallback(async (caseId: string | null, label: string | null) => {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/gdc-records/${gdcId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_case_id: caseId }),
      })
      if (!res.ok) {
        const j = await res.json() as { error?: string }
        setErr(j.error ?? 'Save failed')
      } else {
        setLinkedLabel(label)
        onLinked(caseId, label)
        setOpen(false); setQ(''); setHits([])
      }
    } catch { setErr('Network error') }
    setSaving(false)
  }, [gdcId, onLinked])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors"
        title={currentCaseId ? 'Change case link' : 'Link to placed case'}
      >
        {currentCaseId ? (
          <><Link2 className="w-3.5 h-3.5" />{linkedLabel ?? 'Linked'}</>
        ) : (
          <><Link2Off className="w-3.5 h-3.5 text-slate-600" />Link case…</>
        )}
      </button>
    )
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2 w-64">
      <input
        autoFocus
        type="text"
        placeholder="Search insured name or policy #…"
        value={q}
        onChange={e => { setQ(e.target.value); void search(e.target.value) }}
        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
      />
      {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
      {hits.length > 0 && (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {hits.map(h => {
            const name = `${h.customers?.first_name ?? ''} ${h.customers?.last_name ?? ''}`.trim()
            const carrier = h.products?.carriers?.short_name ?? h.products?.name ?? ''
            return (
              <button
                key={h.id}
                onClick={() => void link(h.id, name || h.policy_number)}
                disabled={saving}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
              >
                <span className="font-medium">{name || '—'}</span>
                {h.policy_number && <span className="text-slate-500 ml-1.5 font-mono">{h.policy_number}</span>}
                {carrier && <span className="block text-slate-500 mt-0.5">{carrier}</span>}
              </button>
            )
          })}
        </div>
      )}
      {currentCaseId && (
        <button
          onClick={() => void link(null, null)}
          disabled={saving}
          className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
        >
          Remove link
        </button>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button
        onClick={() => { setOpen(false); setQ(''); setHits([]) }}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}

// ── Customer Picker (for linking annuity/securities) ─────────────────────────

type CustomerHit = { id: string; first_name: string | null; last_name: string | null }

function CustomerLinker({
  gdcId,
  currentCustomer,
  onLinked,
}: {
  gdcId: string
  currentCustomer: GdcRecord['linked_customer']
  onLinked: (customerId: string | null, name: string | null) => void
}) {
  const [open, setOpen]       = useState(false)
  const [q, setQ]             = useState('')
  const [hits, setHits]       = useState<CustomerHit[]>([])
  const [searching, setSrch]  = useState(false)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const search = useCallback(async (term: string) => {
    if (term.length < 2) { setHits([]); return }
    setSrch(true)
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(term)}`)
      const json = await res.json() as { data?: CustomerHit[] }
      setHits(json.data ?? [])
    } catch { /* ignore */ }
    setSrch(false)
  }, [])

  const link = useCallback(async (customerId: string | null, name: string | null) => {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/gdc-records/${gdcId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_customer_id: customerId }),
      })
      if (!res.ok) {
        const j = await res.json() as { error?: string }
        setErr(j.error ?? 'Save failed')
      } else {
        onLinked(customerId, name)
        setOpen(false)
        setQ('')
        setHits([])
      }
    } catch { setErr('Network error') }
    setSaving(false)
  }, [gdcId, onLinked])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors"
        title={currentCustomer ? 'Change customer link' : 'Link to customer'}
      >
        {currentCustomer ? (
          <><Link2 className="w-3.5 h-3.5" />{currentCustomer.first_name} {currentCustomer.last_name}</>
        ) : (
          <><Link2Off className="w-3.5 h-3.5 text-slate-600" />Link customer…</>
        )}
      </button>
    )
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2 w-56">
      <input
        autoFocus
        type="text"
        placeholder="Search customer…"
        value={q}
        onChange={e => { setQ(e.target.value); void search(e.target.value) }}
        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
      />
      {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
      {hits.length > 0 && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {hits.map(h => (
            <button
              key={h.id}
              onClick={() => void link(h.id, `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim())}
              disabled={saving}
              className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
            >
              {h.first_name} {h.last_name}
            </button>
          ))}
        </div>
      )}
      {currentCustomer && (
        <button
          onClick={() => void link(null, null)}
          disabled={saving}
          className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
        >
          Remove link
        </button>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button
        onClick={() => { setOpen(false); setQ(''); setHits([]) }}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProductionClient({
  cases,
  gdcRecords: initialGdc,
  selectedYear,
  currentYear,
}: {
  cases: PlacedCase[]
  gdcRecords: GdcRecord[]
  selectedYear: number
  currentYear: number
}) {
  const router   = useRouter()
  const sp       = useSearchParams()
  const pathname = usePathname()

  const [tab, setTab]           = useState<Tab>((sp.get('tab') as Tab) ?? 'life')
  const [period, setPeriod]     = useState<Period>((sp.get('period') as Period) ?? 'ytd')
  const [agencyFilter, setAgency] = useState(sp.get('agency') ?? '')
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState<SortKey>((sp.get('sort') as SortKey) ?? 'date')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>((sp.get('dir') as 'asc' | 'desc') ?? 'desc')

  // Local state so customer link updates reflect immediately without a reload
  const [gdcRecords, setGdcRecords] = useState<GdcRecord[]>(initialGdc)

  function updateGdcLink(id: string, customerId: string | null, name: string | null) {
    setGdcRecords(prev => prev.map(r =>
      r.id === id
        ? {
            ...r,
            linked_customer_id: customerId,
            linked_customer: customerId && name
              ? { first_name: name.split(' ')[0] ?? '', last_name: name.split(' ').slice(1).join(' ') }
              : null,
          }
        : r
    ))
  }

  function updateCaseLink(id: string, caseId: string | null) {
    setGdcRecords(prev => prev.map(r =>
      r.id === id ? { ...r, linked_case_id: caseId } : r
    ))
  }

  function pushParams(updates: Record<string, string>) {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v); else p.delete(k)
    }
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function handleSort(key: SortKey) {
    const newDir = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : (key === 'face' || key === 'premium' || key === 'credit' ? 'desc' : 'asc')
    if (sortKey === key) setSortDir(newDir)
    else { setSortKey(key); setSortDir(newDir) }
    pushParams({ sort: key, dir: newDir })
  }

  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => {
    const active = sortKey === k
    return (
      <th className={`px-4 py-3 ${right ? 'text-right' : 'text-left'}`}>
        <button onClick={() => handleSort(k)}
          className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${active ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          {label}
          {active
            ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3 opacity-30" />}
        </button>
      </th>
    )
  }

  const cutoff = useMemo(() => periodStart(period), [period])

  // Build a map from case id → GDC record for life matches
  const casGdcMap = useMemo(() => {
    const m = new Map<string, GdcRecord>()
    for (const r of gdcRecords) {
      if (r.product_category === 'life' && r.linked_case_id) {
        m.set(r.linked_case_id, r)
      }
    }
    return m
  }, [gdcRecords])

  // YTD face amount for goal bar (always YTD regardless of period filter)
  const ytdFace = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 1).toISOString()
    return cases
      .filter(c => c.placed_at && c.placed_at >= start)
      .reduce((s, c) => s + (c.face_amount ?? 0), 0)
  }, [cases])

  const goalPct = Math.min((ytdFace / ANNUAL_GOAL) * 100, 100)

  const agencyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const c of cases) {
      const name = c.agencies?.display_name ?? c.agencies?.name ?? ''
      if (name) seen.add(name)
    }
    return Array.from(seen).sort()
  }, [cases])

  // ── Life tab: filtered + sorted placed cases ──────────────────────────────
  const filteredCases = useMemo(() => {
    let rows = cases
    if (cutoff) rows = rows.filter(c => c.placed_at && c.placed_at >= cutoff)
    if (agencyFilter) rows = rows.filter(c =>
      (c.agencies?.display_name ?? c.agencies?.name ?? '') === agencyFilter
    )
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(c => {
        const name = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.toLowerCase()
        const agency = (c.agencies?.display_name ?? c.agencies?.name ?? '').toLowerCase()
        const policy = (c.policy_number ?? '').toLowerCase()
        return name.includes(q) || agency.includes(q) || policy.includes(q)
      })
    }
    rows = [...rows].sort((a, b) => {
      let diff = 0
      if (sortKey === 'client') {
        const aL = `${a.customers?.last_name ?? ''} ${a.customers?.first_name ?? ''}`.toLowerCase().trim()
        const bL = `${b.customers?.last_name ?? ''} ${b.customers?.first_name ?? ''}`.toLowerCase().trim()
        diff = aL < bL ? -1 : aL > bL ? 1 : 0
      } else if (sortKey === 'carrier') {
        const aC = (a.products?.carriers?.short_name ?? a.products?.name ?? '').toLowerCase()
        const bC = (b.products?.carriers?.short_name ?? b.products?.name ?? '').toLowerCase()
        diff = aC < bC ? -1 : aC > bC ? 1 : 0
      } else if (sortKey === 'face') {
        diff = (a.face_amount ?? 0) - (b.face_amount ?? 0)
      } else if (sortKey === 'premium') {
        diff = (a.annual_premium ?? 0) - (b.annual_premium ?? 0)
      } else if (sortKey === 'credit') {
        const ag = casGdcMap.get(a.id)?.production_credit ?? 0
        const bg = casGdcMap.get(b.id)?.production_credit ?? 0
        diff = ag - bg
      } else {
        diff = new Date(a.placed_at ?? '').getTime() - new Date(b.placed_at ?? '').getTime()
      }
      return sortDir === 'asc' ? diff : -diff
    })
    return rows
  }, [cases, cutoff, agencyFilter, search, sortKey, sortDir, casGdcMap])

  const lifeStats = useMemo(() => ({
    faceTotal:    filteredCases.reduce((s, c) => s + (c.face_amount ?? 0), 0),
    premiumTotal: filteredCases.reduce((s, c) => s + (c.annual_premium ?? 0), 0),
    count:        filteredCases.length,
    gdcTotal:     filteredCases.reduce((s, c) => s + (casGdcMap.get(c.id)?.production_credit ?? 0), 0),
    gdcMatched:   filteredCases.filter(c => casGdcMap.has(c.id)).length,
  }), [filteredCases, casGdcMap])

  // ── Annuity / Securities tabs ─────────────────────────────────────────────
  const annuityRows = useMemo(() => {
    let rows = gdcRecords.filter(r => r.product_category === 'annuity')
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        (r.insured_name ?? '').toLowerCase().includes(q) ||
        (r.policy_number ?? '').toLowerCase().includes(q) ||
        (r.product ?? '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [gdcRecords, search])

  const securitiesRows = useMemo(() => {
    let rows = gdcRecords.filter(r => r.product_category === 'securities')
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        (r.insured_name ?? '').toLowerCase().includes(q) ||
        (r.policy_number ?? '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [gdcRecords, search])

  const annuityStats = useMemo(() => ({
    total:   annuityRows.reduce((s, r) => s + r.production_credit, 0),
    count:   annuityRows.length,
    linked:  annuityRows.filter(r => r.linked_customer_id).length,
  }), [annuityRows])

  const securitiesStats = useMemo(() => ({
    total:   securitiesRows.reduce((s, r) => s + r.production_credit, 0),
    count:   securitiesRows.length,
    linked:  securitiesRows.filter(r => r.linked_customer_id).length,
  }), [securitiesRows])

  // Unmatched life GDC rows (have no linked case — either unprocessed or no pipeline case)
  const unmatchedGdcLife = useMemo(() =>
    gdcRecords.filter(r => r.product_category === 'life' && !r.linked_case_id),
  [gdcRecords])

  // ── Tab counts for the tab strip ─────────────────────────────────────────
  const lifeGdcCount  = gdcRecords.filter(r => r.product_category === 'life').length
  const annuityCount  = gdcRecords.filter(r => r.product_category === 'annuity').length
  const securitiesCount = gdcRecords.filter(r => r.product_category === 'securities').length

  return (
    <div className="space-y-5">

      {/* $1B Goal Progress */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-slate-300">Annual Goal — $1B In Force</span>
          </div>
          <span className="text-sm font-semibold text-emerald-400">{goalPct.toFixed(2)}%</span>
        </div>
        <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
            style={{ width: `${goalPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-500">{formatCurrency(ytdFace)} placed YTD</span>
          <span className="text-xs text-slate-600">{formatCurrency(ANNUAL_GOAL - ytdFace)} remaining</span>
        </div>
      </div>

      {/* Year selector + Tab strip */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 gap-0.5">
          {(['life', 'annuity', 'securities'] as Tab[]).map(t => {
            const count = t === 'life' ? lifeGdcCount : t === 'annuity' ? annuityCount : securitiesCount
            const labels: Record<Tab, string> = { life: 'Life', annuity: 'Annuity', securities: 'Securities' }
            return (
              <button key={t} onClick={() => { setTab(t); pushParams({ tab: t }) }}
                className={`px-4 py-1.5 text-xs rounded-md font-medium transition-colors flex items-center gap-1.5 ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {labels[t]}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tab === t ? 'bg-slate-600 text-slate-300' : 'bg-slate-800 text-slate-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* GDC year selector */}
        <select
          value={selectedYear}
          onChange={e => { pushParams({ year: e.target.value }) }}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500"
        >
          {[currentYear, currentYear - 1, currentYear - 2].map(y => (
            <option key={y} value={y}>{y} GDC</option>
          ))}
        </select>
      </div>

      {/* ── LIFE TAB ─────────────────────────────────────────────────────── */}
      {tab === 'life' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Face Amount</p>
              <p className="text-2xl font-bold text-white">{formatCurrencyFull(lifeStats.faceTotal)}</p>
              <p className="text-xs text-slate-600 mt-0.5">{lifeStats.count} polic{lifeStats.count !== 1 ? 'ies' : 'y'}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Annual Premium</p>
              <p className="text-2xl font-bold text-blue-400">{formatCurrencyFull(lifeStats.premiumTotal)}</p>
              <p className="text-xs text-slate-600 mt-0.5">GDC basis</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">GDC Credit ({selectedYear})</p>
              <p className="text-2xl font-bold text-emerald-400">{formatCredit(lifeStats.gdcTotal)}</p>
              <p className="text-xs text-slate-600 mt-0.5">{lifeStats.gdcMatched} of {lifeStats.count} matched</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Unmatched GDC</p>
              <p className={`text-2xl font-bold ${unmatchedGdcLife.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {unmatchedGdcLife.length}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">life rows w/o case</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 gap-0.5">
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => { setPeriod(p.key); pushParams({ period: p.key }) }}
                  className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${period === p.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <select value={agencyFilter} onChange={e => { setAgency(e.target.value); pushParams({ agency: e.target.value }) }}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500">
              <option value="">All agencies</option>
              {agencyOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="relative flex-1 min-w-0 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              <input type="text" placeholder="Search client, agency, or policy…" value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600" />
            </div>
          </div>

          {/* Cases table */}
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {filteredCases.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-base font-medium text-slate-400">No placed policies found.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <SortTh k="client"  label="Client"            />
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                    <SortTh k="carrier" label="Carrier · Product" />
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Policy #</th>
                    <SortTh k="face"    label="Face"              right />
                    <SortTh k="premium" label="Premium"           right />
                    <SortTh k="credit"  label="GDC Credit"        right />
                    <SortTh k="date"    label="Placed"            />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map((c, i) => {
                    const isLast = i === filteredCases.length - 1
                    const gdcRec = casGdcMap.get(c.id)
                    const carrierProduct = (() => {
                      const p = c.products
                      if (!p) return '—'
                      return p.carriers?.short_name ? `${p.carriers.short_name} · ${p.name}` : p.name
                    })()
                    return (
                      <tr key={c.id} onClick={() => router.push(`/cases/${c.id}`)}
                        className={`group cursor-pointer transition-colors hover:bg-slate-800/30 ${!isLast ? 'border-b border-slate-800/50' : ''}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-white group-hover:text-blue-300 transition-colors">
                            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
                          </p>
                          {c.agents && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {c.agents.first_name} {c.agents.last_name}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {c.agencies
                            ? <span className="text-slate-300 text-sm">{c.agencies.display_name ?? c.agencies.name}</span>
                            : <span className="text-amber-400 text-xs font-medium">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs max-w-[180px] truncate">{carrierProduct}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs font-mono">{c.policy_number ?? <span className="text-slate-700">—</span>}</td>
                        <td className="px-4 py-3 text-right text-slate-200 tabular-nums font-semibold">{formatCurrencyFull(c.face_amount)}</td>
                        <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{formatCurrencyFull(c.annual_premium)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {gdcRec ? (
                            <span className="text-emerald-400 font-medium">{formatCredit(gdcRec.production_credit)}</span>
                          ) : (
                            <span className="text-slate-700 text-xs">No match</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(c.placed_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {c.customer_id && (
                              <button onClick={e => { e.stopPropagation(); router.push(`/customers/${c.customer_id}`) }}
                                title="Open Customer Card"
                                className="p-0.5 text-slate-600 hover:text-blue-400 transition-colors">
                                <UserCircle className="w-4 h-4" />
                              </button>
                            )}
                            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Unmatched GDC life rows */}
          {unmatchedGdcLife.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <p className="text-sm font-medium text-amber-300">
                  {unmatchedGdcLife.length} life GDC row{unmatchedGdcLife.length !== 1 ? 's' : ''} not matched to a placed case
                </p>
              </div>
              <p className="text-xs text-slate-500">
                These exist in the {selectedYear} compensation report but have no corresponding placed case in the pipeline.
                Re-import after placing the case or use &ldquo;Promote to Cases&rdquo; on the GDC Import page.
              </p>
              <div className="overflow-hidden rounded-xl border border-amber-900/40 bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Insured</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Product</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Policy #</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Credit</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Process Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Case</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedGdcLife.map((r, i) => (
                      <tr key={r.id} className={`${i < unmatchedGdcLife.length - 1 ? 'border-b border-slate-800/50' : ''}`}>
                        <td className="px-4 py-2.5 text-slate-300 text-xs">{r.insured_name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{r.product ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{r.policy_number ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-amber-400 tabular-nums text-xs font-medium">{formatCredit(r.production_credit)}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{formatDate(r.process_date)}</td>
                        <td className="px-4 py-2.5">
                          <CaseLinker
                            gdcId={r.id}
                            currentCaseId={r.linked_case_id}
                            onLinked={(caseId, _label) => updateCaseLink(r.id, caseId)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-600">{filteredCases.length} of {cases.length} placed policies shown</p>
        </div>
      )}

      {/* ── ANNUITY TAB ───────────────────────────────────────────────────── */}
      {tab === 'annuity' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">GDC Credit ({selectedYear})</p>
              <p className="text-2xl font-bold text-emerald-400">{formatCredit(annuityStats.total)}</p>
              <p className="text-xs text-slate-600 mt-0.5">{annuityStats.count} row{annuityStats.count !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Customer Linked</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-2xl font-bold text-white">{annuityStats.linked}</p>
                <span className="text-slate-600 text-sm">/ {annuityStats.count}</span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">auto-matched via service policy</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Unlinked</p>
              <p className={`text-2xl font-bold ${annuityStats.count - annuityStats.linked > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {annuityStats.count - annuityStats.linked}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">need manual link</p>
            </div>
          </div>

          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input type="text" placeholder="Search insured, policy, or product…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600" />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {annuityRows.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-slate-400">No annuity GDC records for {selectedYear}.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Insured</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Policy #</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Credit</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Process Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {annuityRows.map((r, i) => (
                    <tr key={r.id} className={`${i < annuityRows.length - 1 ? 'border-b border-slate-800/50' : ''}`}>
                      <td className="px-4 py-3 text-slate-200 font-medium text-sm">{r.insured_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{r.product ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs font-mono">{r.policy_number ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 tabular-nums font-medium">{formatCredit(r.production_credit)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{r.agencies?.display_name ?? r.agencies?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(r.process_date)}</td>
                      <td className="px-4 py-3">
                        {r.linked_customer_id ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                            <CustomerLinker
                              gdcId={r.id}
                              currentCustomer={r.linked_customer}
                              onLinked={(id, name) => updateGdcLink(r.id, id, name)}
                            />
                          </div>
                        ) : (
                          <CustomerLinker
                            gdcId={r.id}
                            currentCustomer={r.linked_customer}
                            onLinked={(id, name) => updateGdcLink(r.id, id, name)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-600">{annuityRows.length} annuity records · {selectedYear}</p>
        </div>
      )}

      {/* ── SECURITIES TAB ────────────────────────────────────────────────── */}
      {tab === 'securities' && (
        <div className="space-y-4">
          <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 text-sm text-blue-300 space-y-1">
            <p className="font-medium">Securities (Mutual Fund) records require manual customer linking.</p>
            <p className="text-blue-400/70 text-xs">
              All securities GDC rows appear as &ldquo;Mutual Fund&rdquo; in the compensation report —
              there is no policy-level match. Click &ldquo;Link customer…&rdquo; on each row to associate
              it with the right customer for 2027 KPI tracking.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">GDC Credit ({selectedYear})</p>
              <p className="text-2xl font-bold text-emerald-400">{formatCredit(securitiesStats.total)}</p>
              <p className="text-xs text-slate-600 mt-0.5">{securitiesStats.count} row{securitiesStats.count !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Customer Linked</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-2xl font-bold text-white">{securitiesStats.linked}</p>
                <span className="text-slate-600 text-sm">/ {securitiesStats.count}</span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">manually linked</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Unlinked</p>
              <p className={`text-2xl font-bold ${securitiesStats.count - securitiesStats.linked > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {securitiesStats.count - securitiesStats.linked}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">pending manual link</p>
            </div>
          </div>

          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input type="text" placeholder="Search insured or policy…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600" />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {securitiesRows.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-slate-400">No securities GDC records for {selectedYear}.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Insured</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Policy #</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Credit</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Process Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {securitiesRows.map((r, i) => (
                    <tr key={r.id} className={`${i < securitiesRows.length - 1 ? 'border-b border-slate-800/50' : ''}`}>
                      <td className="px-4 py-3 text-slate-200 font-medium text-sm">{r.insured_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs font-mono">{r.policy_number ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 tabular-nums font-medium">{formatCredit(r.production_credit)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{r.agencies?.display_name ?? r.agencies?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(r.process_date)}</td>
                      <td className="px-4 py-3">
                        {r.linked_customer_id ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                            <CustomerLinker
                              gdcId={r.id}
                              currentCustomer={r.linked_customer}
                              onLinked={(id, name) => updateGdcLink(r.id, id, name)}
                            />
                          </div>
                        ) : (
                          <CustomerLinker
                            gdcId={r.id}
                            currentCustomer={r.linked_customer}
                            onLinked={(id, name) => updateGdcLink(r.id, id, name)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-600">{securitiesRows.length} securities records · {selectedYear}</p>
        </div>
      )}
    </div>
  )
}
