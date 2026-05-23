'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox, Phone, Building2, User, CalendarDays, Flame, ChevronDown } from 'lucide-react'
import type { TriageCase, ProducerOption } from './page'

type Props = {
  cases:     TriageCase[]
  producers: ProducerOption[]
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function daysInQueue(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function AgeBadge({ iso }: { iso: string }) {
  const d = daysInQueue(iso)
  let cls = 'bg-emerald-900/40 text-emerald-300'
  if (d >= 2) cls = 'bg-amber-900/40 text-amber-300'
  if (d >= 4) cls = 'bg-red-900/40 text-red-300'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      <CalendarDays className="w-3 h-3" />
      {d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`}
    </span>
  )
}

function TriageCard({
  c,
  producers,
  onAssign,
}: {
  c: TriageCase
  producers: ProducerOption[]
  onAssign: (caseId: string, producerId: string) => Promise<void>
}) {
  const [producerId, setProducerId]   = useState('')
  const [assigning, setAssigning] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [isPending]               = useTransition()

  const agencyName = c.agencies?.display_name ?? c.agencies?.name ?? '—'
  const clientName = c.customers
    ? `${c.customers.first_name} ${c.customers.last_name}`
    : 'Unknown'
  const agentName  = c.agents
    ? `${c.agents.first_name} ${c.agents.last_name}`
    : null

  async function handleAssign() {
    if (!producerId) {
      setError('Select a producer first')
      return
    }
    setAssigning(true)
    setError(null)
    try {
      await onAssign(c.id, producerId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed')
      setAssigning(false)
    }
  }

  return (
    <div className={`rounded-xl border bg-slate-900 transition-colors ${
      c.is_hot_lead ? 'border-orange-600/60' : 'border-slate-700/60'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {c.is_hot_lead && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-400">
                <Flame className="w-3.5 h-3.5" /> Hot Lead
              </span>
            )}
            {c.is_owner_referral && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-900/40 text-indigo-300 text-xs font-medium px-2 py-0.5">
                Owner Referral
              </span>
            )}
          </div>
          <p className="text-white font-semibold text-base mt-0.5">{clientName}</p>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-slate-400 text-sm">
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              {agencyName}
            </span>
            {agentName && (
              <span className="inline-flex items-center gap-1.5 text-slate-400 text-sm">
                <User className="w-3.5 h-3.5 shrink-0" />
                {agentName}
              </span>
            )}
            {c.customers?.phone && (
              <span className="inline-flex items-center gap-1.5 text-slate-400 text-sm">
                <Phone className="w-3.5 h-3.5 shrink-0" />
                {c.customers.phone}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <AgeBadge iso={c.created_at} />
          <p className="text-xs text-slate-500">{fmt(c.created_at)}</p>
        </div>
      </div>

      {/* Notes preview */}
      {c.notes && (
        <div className="px-5 pb-3">
          <p className="text-xs text-slate-500 line-clamp-2">{c.notes}</p>
        </div>
      )}

      {/* Assignment footer */}
      <div className="border-t border-slate-700/60 px-5 py-3 flex items-center gap-3">
        <div className="relative flex-1">
          <select
            value={producerId}
            onChange={e => { setProducerId(e.target.value); setError(null) }}
            className="w-full appearance-none bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          >
            <option value="">Assign to producer…</option>
            {producers.map(p => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        </div>

        <button
          onClick={handleAssign}
          disabled={assigning || isPending || !producerId}
          className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: '#1F3864' }}
        >
          {assigning ? 'Assigning…' : 'Assign →'}
        </button>
      </div>

      {error && (
        <p className="px-5 pb-3 text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

export function TriageClient({ cases: initial, producers }: Props) {
  const router = useRouter()
  const [cases, setCases] = useState(initial)
  const [, startTransition] = useTransition()

  async function handleAssign(caseId: string, producerId: string) {
    const res = await fetch(`/api/cases/${caseId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        producer_id:     producerId,
        internal_status: 'active_referral',
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? 'Failed to assign')
    }
    // Remove from local queue immediately — no need to wait for router.refresh()
    setCases(prev => prev.filter(c => c.id !== caseId))
    startTransition(() => router.refresh())
  }

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <Inbox className="w-7 h-7 text-slate-500" />
        </div>
        <p className="text-slate-300 font-medium">Queue is clear</p>
        <p className="text-slate-500 text-sm mt-1">No referrals waiting for assignment</p>
      </div>
    )
  }

  const hot   = cases.filter(c => c.is_hot_lead)
  const other = cases.filter(c => !c.is_hot_lead)

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-1">
        <p className="text-slate-400 text-sm">
          <span className="text-white font-semibold">{cases.length}</span>{' '}
          referral{cases.length !== 1 ? 's' : ''} in queue
        </p>
        {hot.length > 0 && (
          <p className="text-orange-400 text-sm">
            <Flame className="inline w-3.5 h-3.5 mr-0.5" />
            {hot.length} hot
          </p>
        )}
      </div>

      {/* Hot leads first (if any) */}
      {hot.length > 0 && (
        <div className="space-y-3">
          {hot.map(c => (
            <TriageCard key={c.id} c={c} producers={producers} onAssign={handleAssign} />
          ))}
        </div>
      )}

      {/* Regular queue */}
      {other.length > 0 && (
        <div className="space-y-3">
          {hot.length > 0 && (
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-1">Standard Queue</p>
          )}
          {other.map(c => (
            <TriageCard key={c.id} c={c} producers={producers} onAssign={handleAssign} />
          ))}
        </div>
      )}
    </div>
  )
}
