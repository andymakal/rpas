'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Phone, Mail, Building2, User, Flame, Calendar,
  ChevronDown, ChevronUp, AlertTriangle, Clock,
} from 'lucide-react'
import type { TriageCase, ProducerOption } from './page'

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysInQueue(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
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

// Pull structured lines out of the intake notes block
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

// ── Action panel ──────────────────────────────────────────────────────────────

type Action = 'appt' | 'transfer' | 'not_interested' | null

function ActionPanel({
  caseId,
  producers,
  onDone,
}: {
  caseId: string
  producers: ProducerOption[]
  onDone: (caseId: string) => void
}) {
  const [action, setAction]         = useState<Action>(null)
  const [producerId, setProducerId] = useState('')
  const [apptDate, setApptDate]     = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    if ((action === 'appt' || action === 'transfer') && !producerId) {
      setError('Select a producer first')
      return
    }
    if (action === 'appt' && !apptDate) {
      setError('Pick an appointment date')
      return
    }

    setSaving(true)
    const body: Record<string, unknown> =
      action === 'appt'
        ? { internal_status: 'appointment_set', producer_id: producerId, appointment_date: apptDate }
        : action === 'transfer'
        ? { internal_status: 'active_referral', producer_id: producerId }
        : { internal_status: 'not_interested' }

    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to save')
      }
      onDone(caseId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  const btnBase = 'rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors'

  if (!action) {
    return (
      <div className="flex items-center gap-2 pt-3 border-t border-slate-700/60 mt-3">
        <button
          onClick={() => setAction('appt')}
          className={`${btnBase} bg-blue-900/30 text-blue-300 border-blue-700 hover:bg-blue-900/50`}
        >
          <Calendar className="inline w-3.5 h-3.5 mr-1" />Set Appointment
        </button>
        <button
          onClick={() => setAction('transfer')}
          className={`${btnBase} bg-emerald-900/30 text-emerald-300 border-emerald-700 hover:bg-emerald-900/50`}
        >
          Live Transfer →
        </button>
        <button
          onClick={() => setAction('not_interested')}
          className={`${btnBase} bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700`}
        >
          Not Interested
        </button>
      </div>
    )
  }

  return (
    <div className="pt-3 border-t border-slate-700/60 mt-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Action label */}
        <span className="text-xs font-semibold text-slate-400">
          {action === 'appt' ? 'Set Appointment' : action === 'transfer' ? 'Live Transfer' : 'Mark Not Interested'}
        </span>

        {/* Producer dropdown — not needed for not_interested */}
        {(action === 'appt' || action === 'transfer') && (
          <div className="relative">
            <select
              value={producerId}
              onChange={e => setProducerId(e.target.value)}
              className="appearance-none bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded-lg px-3 py-1.5 pr-7 focus:outline-none focus:border-blue-500"
            >
              <option value="">Assign to…</option>
              {producers.map(p => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          </div>
        )}

        {/* Date picker — appointment only */}
        {action === 'appt' && (
          <input
            type="date"
            value={apptDate}
            onChange={e => setApptDate(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          />
        )}

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: '#1F3864' }}
        >
          {saving ? 'Saving…' : 'Confirm'}
        </button>
        <button
          onClick={() => { setAction(null); setError(null); setProducerId(''); setApptDate('') }}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />{error}
        </p>
      )}
    </div>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function TriageRow({
  c,
  producers,
  onDone,
}: {
  c: TriageCase
  producers: ProducerOption[]
  onDone: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const agency     = c.agencies?.display_name ?? c.agencies?.name ?? '—'
  const client     = c.customers
    ? `${c.customers.first_name} ${c.customers.last_name}`
    : 'Unknown'
  const lsp        = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const clientAge  = age(c.customers?.date_of_birth ?? null)
  const parsed     = parseNotes(c.notes)

  return (
    <>
      {/* Main row */}
      <tr
        onClick={() => setExpanded(o => !o)}
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
              <span className="text-xs font-medium text-violet-300 bg-violet-900/40 border border-violet-800 rounded px-1.5 py-0.5">Owner</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {c.customers?.phone && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Phone className="w-3 h-3" />{c.customers.phone}
              </span>
            )}
            {clientAge && (
              <span className="text-xs text-slate-500">Age {clientAge}</span>
            )}
          </div>
        </td>

        {/* Agency */}
        <td className="px-4 py-3 text-sm text-slate-300">{agency}</td>

        {/* Referred by */}
        <td className="px-4 py-3 text-sm text-slate-400">{lsp ?? '—'}</td>

        {/* Type */}
        <td className="px-4 py-3 text-sm text-slate-400">{parsed['Type'] ?? '—'}</td>

        {/* Contact preference */}
        <td className="px-4 py-3">
          <p className="text-xs text-slate-400">{parsed['Contact'] ?? '—'}</p>
          {parsed['Best time'] && (
            <p className="text-xs text-slate-500">{parsed['Best time']}</p>
          )}
        </td>

        {/* Date in + age */}
        <td className="px-4 py-3 text-right">
          <p className="text-xs text-slate-500 mb-1">{fmt(c.created_at)}</p>
          <QueueAgeBadge iso={c.created_at} />
        </td>

        {/* Expand toggle */}
        <td className="px-3 py-3 text-right">
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-500 ml-auto" />
            : <ChevronDown className="w-4 h-4 text-slate-500 ml-auto" />}
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="bg-slate-800/40 border-b border-slate-700/60">
          <td colSpan={7} className="px-5 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-w-3xl text-sm">

              {/* Left column */}
              <div className="space-y-2">
                {c.customers?.email && (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span>{c.customers.email}</span>
                  </div>
                )}
                {lsp && (
                  <div className="flex items-center gap-2 text-slate-400">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span>{lsp}</span>
                    {c.agents?.email && <span className="text-slate-500">· {c.agents.email}</span>}
                  </div>
                )}
                <div className="flex items-center gap-2 text-slate-400">
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{agency}</span>
                </div>
              </div>

              {/* Right column — intake flags / notes */}
              <div className="space-y-1.5">
                {parsed['Flags'] && (
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Flags</p>
                    <p className="text-slate-300 text-xs">{parsed['Flags']}</p>
                  </div>
                )}
                {parsed['Notes'] && (
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-slate-300 text-xs">{parsed['Notes']}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Action panel */}
            <ActionPanel caseId={c.id} producers={producers} onDone={onDone} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TriageClient({ cases: initial, producers }: { cases: TriageCase[]; producers: ProducerOption[] }) {
  const router = useRouter()
  const [cases, setCases]               = useState(initial)
  const [search, setSearch]             = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')

  function handleDone(id: string) {
    setCases(prev => prev.filter(c => c.id !== id))
    router.refresh()
  }

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
        const name   = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.toLowerCase()
        const agency = (c.agencies?.display_name ?? c.agencies?.name ?? '').toLowerCase()
        const lsp    = c.agents ? `${c.agents.first_name} ${c.agents.last_name}`.toLowerCase() : ''
        const phone  = c.customers?.phone ?? ''
        return name.includes(q) || agency.includes(q) || lsp.includes(q) || phone.includes(q)
      })
    }
    return list
  }, [cases, agencyFilter, search])

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <Flame className="w-6 h-6 text-slate-600" />
        </div>
        <p className="text-slate-300 font-medium">Queue is clear</p>
        <p className="text-slate-500 text-sm mt-1">No referrals waiting in triage</p>
      </div>
    )
  }

  const hotCount = cases.filter(c => c.is_hot_lead).length

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
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Contact Pref.</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Date In</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <TriageRow
                  key={c.id}
                  c={c}
                  producers={producers}
                  onDone={handleDone}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-600">{filtered.length} of {cases.length} referrals</p>
    </div>
  )
}
