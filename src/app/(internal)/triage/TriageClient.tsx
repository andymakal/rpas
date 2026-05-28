'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Phone, Mail, Flame, Clock, ChevronDown, ChevronUp, CalendarX, Wrench } from 'lucide-react'
import type { TriageCase } from './page'
import { fmtDate } from '@/lib/fmt'

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysInQueue(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function age(dob: string | null): number | null {
  if (!dob) return null
  const today = new Date()
  const birth = new Date(dob)
  let a = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a--
  return a
}

// Pull key:value lines out of the intake notes block
function parseNotes(raw: string | null): Record<string, string> {
  if (!raw) return {}
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      if (key && val) result[key] = val
    }
  }
  return result
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function QueueAgeBadge({ iso }: { iso: string }) {
  const d = daysInQueue(iso)
  let cls = 'bg-emerald-900/40 text-emerald-300 border-emerald-700'
  if (d >= 3) cls = 'bg-amber-900/40 text-amber-300 border-amber-700'
  if (d >= 7) cls = 'bg-red-900/40 text-red-300 border-red-700'
  const label = d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 ${cls}`}>
      <Clock className="w-3 h-3" />{label}
    </span>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function TriageRow({ c }: { c: TriageCase }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)

  const agency    = c.agencies?.display_name ?? c.agencies?.name ?? '—'
  const client    = c.customers
    ? `${c.customers.first_name} ${c.customers.last_name}`
    : 'Unknown'
  const lsp       = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const clientAge = age(c.customers?.date_of_birth ?? null)
  const parsed    = parseNotes(c.notes)

  function handleRowClick(e: React.MouseEvent) {
    // Chevron toggles preview; anywhere else opens the full referral
    const target = e.target as HTMLElement
    if (target.closest('[data-expand]')) {
      setExpanded(o => !o)
    } else {
      router.push(`/referrals/${c.id}`)
    }
  }

  return (
    <>
      <tr
        onClick={handleRowClick}
        className={`cursor-pointer transition-colors border-b border-slate-800/50 ${
          expanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
        }`}
      >
        {/* Contact */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {c.is_hot_lead && <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
            <span className="font-medium text-white">{client}</span>
            {c.is_owner_referral && (
              <span className="text-xs font-medium text-violet-300 bg-violet-900/40 border border-violet-800 rounded px-1.5 py-0.5">
                Owner
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {c.customers?.phone && (
              <a href={`tel:${c.customers.phone}`} onClick={e => e.stopPropagation()}
                className="text-xs text-slate-400 hover:text-blue-400 flex items-center gap-1 transition-colors">
                <Phone className="w-3 h-3" />{c.customers.phone}
              </a>
            )}
            {clientAge && (
              <span className="text-xs text-slate-500">Age {clientAge}</span>
            )}
          </div>
          {c.customers?.email && (
            <div className="mt-0.5">
              <a href={`mailto:${c.customers.email}`} onClick={e => e.stopPropagation()}
                className="text-xs text-slate-500 hover:text-blue-400 flex items-center gap-1 transition-colors">
                <Mail className="w-3 h-3" />{c.customers.email}
              </a>
            </div>
          )}
          {/* Activity badges */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {c.missed_count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-amber-900/40 text-amber-300 border-amber-700">
                <CalendarX className="w-3 h-3" />
                {c.missed_count} missed
              </span>
            )}
            {(c.touches ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs rounded border px-2 py-0.5 bg-slate-800/60 text-slate-400 border-slate-700">
                <Phone className="w-3 h-3" />
                {c.touches} touch{c.touches !== 1 ? 'es' : ''} · {fmtRelative(c.last_contact_at)}
              </span>
            )}
          </div>
        </td>

        {/* Agency */}
        <td className="px-4 py-3 text-sm text-slate-300">{agency}</td>

        {/* Referred by */}
        <td className="px-4 py-3 text-sm text-slate-400">{lsp ?? '—'}</td>

        {/* Referral type */}
        <td className="px-4 py-3 text-sm text-slate-400">{parsed['Type'] ?? '—'}</td>

        {/* Contact preference */}
        <td className="px-4 py-3">
          <p className="text-xs text-slate-400">{parsed['Contact'] ?? '—'}</p>
          {parsed['Best time'] && (
            <p className="text-xs text-slate-500">{parsed['Best time']}</p>
          )}
        </td>

        {/* Date in / queue age */}
        <td className="px-4 py-3 text-right">
          <p className="text-xs text-slate-500 mb-1">{fmtDate(c.created_at)}</p>
          <QueueAgeBadge iso={c.created_at} />
        </td>

        {/* Expand preview toggle */}
        <td className="px-3 py-3" data-expand="1">
          <div data-expand="1" className="flex justify-end">
            {expanded
              ? <ChevronUp   className="w-4 h-4 text-slate-500 pointer-events-none" />
              : <ChevronDown className="w-4 h-4 text-slate-500 pointer-events-none" />}
          </div>
        </td>
      </tr>

      {/* Inline preview — flags, notes, email */}
      {expanded && (
        <tr className="bg-slate-800/30 border-b border-slate-700/50">
          <td colSpan={7} className="px-5 py-3">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-400">
              {c.customers?.email && (
                <span><span className="text-slate-500">Email </span>{c.customers.email}</span>
              )}
              {c.agents?.email && (
                <span><span className="text-slate-500">LSP email </span>{c.agents.email}</span>
              )}
              {parsed['Allstate Policy'] && (
                <span>
                  <span className="text-slate-500">Allstate Policy </span>
                  <span className="font-mono">{parsed['Allstate Policy']}</span>
                </span>
              )}
              {parsed['Flags'] && (
                <span><span className="text-slate-500">Flags </span>{parsed['Flags']}</span>
              )}
              {parsed['Notes'] && (
                <span className="max-w-lg"><span className="text-slate-500">Notes </span>{parsed['Notes']}</span>
              )}
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-slate-600">
                Click anywhere on the row to open the full referral record →
              </p>
              {(() => {
                const p = new URLSearchParams()
                p.set('from_case_id', c.id)
                const name = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.trim()
                if (name)            p.set('client_name', name)
                if (c.agencies?.id)  p.set('agency_id',   c.agencies.id)
                if (c.agents?.id)    p.set('agent_id',    c.agents.id)
                return (
                  <a
                    href={`/service/new?${p.toString()}`}
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-blue-300 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    Route to Service Request
                  </a>
                )
              })()}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function TriageClient({ cases }: { cases: TriageCase[] }) {
  const [search, setSearch]             = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')

  const agencyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const c of cases) {
      const name = c.agencies?.display_name ?? c.agencies?.name ?? ''
      if (name) seen.add(name)
    }
    return Array.from(seen).sort()
  }, [cases])

  const filtered = useMemo(() => {
    let list = cases
    if (agencyFilter) {
      list = list.filter(c =>
        (c.agencies?.display_name ?? c.agencies?.name ?? '') === agencyFilter
      )
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c => {
        const name  = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.toLowerCase()
        const agc   = (c.agencies?.display_name ?? c.agencies?.name ?? '').toLowerCase()
        const lsp   = c.agents ? `${c.agents.first_name} ${c.agents.last_name}`.toLowerCase() : ''
        const phone = c.customers?.phone ?? ''
        return name.includes(q) || agc.includes(q) || lsp.includes(q) || phone.includes(q)
      })
    }
    return list
  }, [cases, agencyFilter, search])

  const hotCount = cases.filter(c => c.is_hot_lead).length

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-slate-300 font-medium">Queue is clear</p>
        <p className="text-slate-500 text-sm mt-1">No referrals waiting in triage</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary + filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <p className="text-slate-400 text-sm">
            <span className="text-white font-semibold">{cases.length}</span> in queue
          </p>
          {hotCount > 0 && (
            <span className="inline-flex items-center gap-1 text-orange-400 text-sm">
              <Flame className="w-3.5 h-3.5" />{hotCount} hot
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={agencyFilter}
            onChange={e => setAgencyFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
          >
            <option value="">All agencies</option>
            {agencyOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, agency, LSP, phone…"
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 w-64 focus:outline-none focus:border-slate-500 placeholder-slate-600"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-400 text-sm">No referrals match your filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Referred by</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Contact pref.</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Date in</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => <TriageRow key={c.id} c={c} />)}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-600">{filtered.length} of {cases.length} referrals</p>
    </div>
  )
}
