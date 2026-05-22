'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GaugeChart, GDC_BANDS, APP_BANDS } from './GaugeChart'

// ── Types ─────────────────────────────────────────────────────────────────────

type StageTranslation = {
  agency_label: string
  tier: number
  is_active_case: boolean
  is_won: boolean
  is_lost: boolean
}

export type Case = {
  id: string
  internal_status: string
  created_at: string
  placed_at: string | null
  face_amount: number | null
  annual_premium: number | null
  is_hot_lead: boolean
  customers: { first_name: string; last_name: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: StageTranslation | null
  products: { name: string; carriers: { short_name: string } | null } | null
}

export type ServiceRequest = {
  id: string
  created_at: string
  resolved_at: string | null
  customers: { first_name: string; last_name: string } | null
  carriers: { short_name: string } | null
  service_request_types: { name: string } | null
  request_statuses: { name: string } | null
}

export type PolicyReview = {
  id: string
  created_at: string
  reviewed_at: string | null
  customers: { first_name: string; last_name: string } | null
  carriers: { short_name: string } | null
  review_statuses: { name: string } | null
  opportunity_types: { name: string } | null
}

export type SpiffRecord = {
  id: string
  earned_at: string
  paid_at: string | null
  amount: number
  agents: { first_name: string; last_name: string } | null
}

export type GdcRecord = {
  id: string
  policy_number: string | null
  insured_name: string | null
  product: string | null
  production_credit: number
  app_date: string | null
  process_date: string | null
  allstate_partner_number: string | null
}

export type PortalContent = {
  id: string
  content_type: 'training' | 'bulletin' | 'resource'
  title: string
  body: string | null
  link: string | null
  link_label: string | null
  sort_order: number
}

type AgencyProps = {
  name:   string
  slug:   string
  phone:  string | null
  email:  string | null
  street: string | null
  city:   string | null
  state:  string | null
  zip:    string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function AgeBadge({ dateStr }: { dateStr: string }) {
  const d = daysAgo(dateStr)
  const cls = d < 14
    ? 'bg-green-50 text-green-600 border border-green-100'
    : d < 31
      ? 'bg-amber-50 text-amber-600 border border-amber-100'
      : 'bg-red-50 text-red-600 border border-red-100'
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {d}d
    </span>
  )
}

function formatCurrency(v: number | null) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v)}`
}

function formatGdc(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${Math.round(v)}`
}

function stageBadgeClass(st: StageTranslation | null): string {
  if (!st) return 'bg-slate-100 text-slate-500'
  if (st.is_won)  return 'bg-emerald-100 text-emerald-700'
  if (st.is_lost) return 'bg-red-100 text-red-600'
  if (!st.is_active_case) return 'bg-orange-100 text-orange-600'
  if (st.tier >= 4) return 'bg-violet-100 text-violet-700'
  if (st.tier === 3) return 'bg-indigo-100 text-indigo-700'
  if (st.tier === 2) return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'
}

function srStatusClass(s: string | undefined) {
  if (!s) return 'bg-slate-100 text-slate-500'
  if (s === 'Resolved' || s === 'Converted to Review') return 'bg-green-100 text-green-700'
  if (s === 'Awaiting Carrier' || s === 'Pending Client Response') return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'
}

function prStatusClass(s: string | undefined) {
  if (!s) return 'bg-slate-100 text-slate-500'
  if (s?.startsWith('New Policy') || s?.startsWith('Completed')) return 'bg-green-100 text-green-700'
  if (s === 'Client Declined' || s === 'Complete — No Changes') return 'bg-slate-100 text-slate-500'
  if (s === 'Quoted — Follow Up' || s === 'Follow-Up Needed') return 'bg-amber-100 text-amber-700'
  if (s === 'In Progress') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-600'
}

function fmtDate(dateStr: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', ...opts
  })
}

function SectionHeader({ label, count, green }: { label: string; count: number; green?: boolean }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${green ? 'text-emerald-600' : 'text-slate-500'}`}>
      {label} <span className="ml-2 font-normal normal-case text-slate-400">({count})</span>
    </p>
  )
}

// ── Case cards ────────────────────────────────────────────────────────────────

function ReferralCard({ c }: { c: Case }) {
  const label = c.stage_translations?.agency_label ?? c.internal_status
  const date  = fmtDate(c.created_at)
  const lsp   = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  return (
    <div className={`rounded-xl border px-4 py-3 ${c.is_hot_lead ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {c.is_hot_lead && <span title="Hot Lead" className="text-base leading-none">🔥</span>}
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{date}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AgeBadge dateStr={c.created_at} />
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
              {label}
            </span>
          </div>
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
        </div>
      </div>
    </div>
  )
}

function PendingCard({ c }: { c: Case }) {
  const label   = c.stage_translations?.agency_label ?? c.internal_status
  const carrier = c.products?.carriers?.short_name
  const product = c.products?.name
  const face    = formatCurrency(c.face_amount)
  const lsp     = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const subtitle = [carrier, product, face].filter(Boolean).join(' · ')
  return (
    <div className={`rounded-xl border px-4 py-3 ${c.is_hot_lead ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {c.is_hot_lead && <span title="Hot Lead" className="text-base leading-none">🔥</span>}
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AgeBadge dateStr={c.created_at} />
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
              {label}
            </span>
          </div>
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
        </div>
      </div>
    </div>
  )
}

function PlacedCard({ c }: { c: Case }) {
  const carrier = c.products?.carriers?.short_name
  const product = c.products?.name
  const face    = formatCurrency(c.face_amount)
  const lsp     = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const date    = fmtDate(c.placed_at ?? c.created_at)
  const subtitle = [carrier, product, face].filter(Boolean).join(' · ')
  return (
    <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {c.is_hot_lead && <span title="Hot Lead" className="text-base leading-none">🔥</span>}
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          <p className="text-xs text-emerald-600 mt-0.5">Placed {date}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
            Policy Placed
          </span>
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
        </div>
      </div>
    </div>
  )
}

function ClosedCard({ c, agentFilter, onRewarm }: {
  c: Case
  agentFilter: string
  onRewarm: (caseId: string, note: string, lspName: string) => Promise<void>
}) {
  const [expanded, setExpanded]       = useState(false)
  const [note, setNote]               = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const lsp = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null

  async function handleSubmit() {
    if (!note.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onRewarm(c.id, note.trim(), agentFilter)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${expanded ? 'border-orange-300' : 'border-slate-100'}`}>
      <div className={`px-4 py-3 ${expanded ? 'bg-orange-50' : 'bg-white'}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">
              {c.is_hot_lead && <span className="mr-1">🔥</span>}
              {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
                {c.stage_translations?.agency_label ?? c.internal_status}
              </span>
              <button
                onClick={() => { setExpanded(o => !o); setSubmitError(null) }}
                className={`text-xs font-semibold rounded-lg px-2.5 py-1 border transition-all ${
                  expanded
                    ? 'border-orange-300 bg-orange-100 text-orange-700'
                    : 'border-orange-200 text-orange-600 hover:bg-orange-50'
                }`}
              >
                {expanded ? 'Cancel' : 'Re-Warm 🔥'}
              </button>
            </div>
            {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-orange-200 bg-orange-50/60 px-4 py-4 space-y-3">
          <p className="text-xs font-medium text-slate-600">
            What changed? Give us enough context to hit the ground running.
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Ran into her at the office — timing is better now, she's ready to talk..."
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-transparent resize-none"
          />
          {submitError && <p className="text-xs text-red-600">{submitError}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400 leading-snug">
              Will be flagged 🔥 and moved back to active referrals
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting || !note.trim()}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit 🔥'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Left column: Owner lock/unlock ────────────────────────────────────────────

function OwnerLock({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const [showForm, setShowForm] = useState(false)
  const [pin, setPin]           = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const router = useRouter()

  async function handleUnlock() {
    setLoading(true)
    setError(null)
    const res  = await fetch(`/api/portal/${slug}/owner-unlock`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError((json as { error?: string }).error ?? 'Incorrect PIN')
      setLoading(false)
    } else {
      router.refresh()
    }
  }

  if (isOwner) {
    return (
      <a
        href="#owner-section"
        className="flex items-center gap-2 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
      >
        <span>🔓</span>
        <span>Owner Mode Active</span>
        <span className="ml-auto text-emerald-400">↓</span>
      </a>
    )
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="flex items-center gap-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors"
      >
        <span>🔒</span>
        <span>Agency Owner Login</span>
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-600">Enter Owner PIN</p>
      <input
        type="password"
        value={pin}
        onChange={e => setPin(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !loading && pin && handleUnlock()}
        placeholder="••••"
        maxLength={8}
        autoFocus
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleUnlock}
          disabled={loading || !pin}
          className="flex-1 rounded-lg bg-slate-800 text-white text-xs font-semibold py-2 hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Verifying…' : 'Unlock'}
        </button>
        <button
          onClick={() => { setShowForm(false); setPin(''); setError(null) }}
          className="flex-1 rounded-lg border border-slate-200 text-slate-500 text-xs font-medium py-2 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Left column: Resources ────────────────────────────────────────────────────

function ResourceLinks({ items }: { items: PortalContent[] }) {
  const resources = items.filter(i => i.content_type === 'resource')
  if (resources.length === 0) return null
  return (
    <div className="bg-white rounded-2xl border border-slate-100 px-4 py-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Quick Links</p>
      <div className="divide-y divide-slate-50">
        {resources.map(item => (
          <a
            key={item.id}
            href={item.link ?? '#'}
            target={item.link?.startsWith('http') ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="flex items-center justify-between py-2 first:pt-0 last:pb-0 text-sm text-slate-700 hover:text-slate-900 group"
          >
            <span>{item.title}</span>
            <span className="text-slate-300 group-hover:text-slate-500 transition-colors">→</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Right column: SPIFF + Kept Appts ─────────────────────────────────────────

function SpiffKeptCard({
  spiffRecords,
  keptAppts,
  apptRate,
}: {
  spiffRecords: SpiffRecord[]
  keptAppts: number
  apptRate: number | null
}) {
  const byAgent = new Map<string, { name: string; earned: number; paid: number; count: number }>()
  for (const r of spiffRecords) {
    const key  = r.agents ? `${r.agents.first_name} ${r.agents.last_name}` : 'Unknown'
    const prev = byAgent.get(key) ?? { name: key, earned: 0, paid: 0, count: 0 }
    byAgent.set(key, {
      name:   key,
      earned: prev.earned + Number(r.amount),
      paid:   prev.paid   + (r.paid_at ? Number(r.amount) : 0),
      count:  prev.count  + 1,
    })
  }
  const rows             = Array.from(byAgent.values()).sort((a, b) => b.earned - a.earned)
  const totalEarned      = spiffRecords.reduce((s, r) => s + Number(r.amount), 0)
  const totalOutstanding = spiffRecords.filter(r => !r.paid_at).reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-100 px-4 py-4 space-y-4">
      {/* Kept Appointments */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Kept Appointments <span className="normal-case font-normal text-slate-300">YTD</span></p>
        <div className="flex items-end gap-3">
          <p className="text-3xl font-bold text-blue-600">{keptAppts}</p>
          {apptRate !== null && (
            <p className="text-sm text-slate-500 mb-1">{apptRate}% show rate</p>
          )}
        </div>
      </div>

      {/* SPIFF Earnings */}
      {spiffRecords.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">SPIFF Earnings <span className="normal-case font-normal text-slate-300">YTD</span></p>
            <div className="text-right">
              <p className="text-xs text-slate-500">${totalEarned.toFixed(2)} earned</p>
              {totalOutstanding > 0 && (
                <p className="text-xs text-amber-600">${totalOutstanding.toFixed(2)} pending</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.name} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-400">{r.count} qualified{r.count !== 1 ? '' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">${r.earned.toFixed(2)}</p>
                  {r.paid < r.earned && (
                    <p className="text-xs text-amber-600">${(r.earned - r.paid).toFixed(2)} pending</p>
                  )}
                  {r.paid >= r.earned && r.paid > 0 && (
                    <p className="text-xs text-emerald-600">All paid ✓</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Right column: Training + Bulletins ───────────────────────────────────────

function ContentCard({
  title,
  items,
  emptyText,
}: {
  title: string
  items: PortalContent[]
  emptyText: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 px-4 py-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="border-b border-slate-50 last:border-0 pb-3 last:pb-0">
              <p className="text-sm font-semibold text-slate-800">{item.title}</p>
              {item.body && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.body}</p>}
              {item.link && (
                <a
                  href={item.link}
                  target={item.link.startsWith('http') ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="inline-block mt-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {item.link_label ?? 'Learn more'} →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Owner section: GDC Transaction Table ──────────────────────────────────────

function GdcTransactionTable({ records }: { records: GdcRecord[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-slate-400 italic">No GDC transactions found for this year.</p>
  }

  const total      = records.reduce((s, r) => s + Number(r.production_credit), 0)
  const chargebacks = records.filter(r => Number(r.production_credit) < 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-6">
        <div>
          <p className="text-xs text-slate-400">YTD Total</p>
          <p className={`text-xl font-bold ${total >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
            {total >= 0 ? '' : '-'}${Math.abs(total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Transactions</p>
          <p className="text-xl font-bold text-slate-900">{records.length}</p>
        </div>
        {chargebacks.length > 0 && (
          <div>
            <p className="text-xs text-amber-600">Chargebacks</p>
            <p className="text-xl font-bold text-amber-600">{chargebacks.length}</p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-2 font-semibold text-slate-400 uppercase tracking-wide">Date</th>
              <th className="text-left py-2 px-2 font-semibold text-slate-400 uppercase tracking-wide">Insured</th>
              <th className="text-left py-2 px-2 font-semibold text-slate-400 uppercase tracking-wide">Product</th>
              <th className="text-left py-2 px-2 font-semibold text-slate-400 uppercase tracking-wide">Policy #</th>
              <th className="text-right py-2 px-2 font-semibold text-slate-400 uppercase tracking-wide">GDC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {records.map(r => {
              const credit   = Number(r.production_credit)
              const negative = credit < 0
              return (
                <tr key={r.id} className={`${negative ? 'bg-red-50' : ''}`}>
                  <td className="py-2 px-2 text-slate-500 whitespace-nowrap">
                    {r.process_date ? new Date(r.process_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                  <td className="py-2 px-2 text-slate-800 font-medium">{r.insured_name ?? '—'}</td>
                  <td className="py-2 px-2 text-slate-500">{r.product ?? '—'}</td>
                  <td className="py-2 px-2 text-slate-400 font-mono">{r.policy_number ?? '—'}</td>
                  <td className={`py-2 px-2 text-right font-semibold tabular-nums ${negative ? 'text-red-600' : 'text-slate-900'}`}>
                    {negative ? '-' : ''}${Math.abs(credit).toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200">
              <td colSpan={4} className="py-2 px-2 text-xs font-semibold text-slate-500">Total</td>
              <td className={`py-2 px-2 text-right text-sm font-bold tabular-nums ${total < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {total < 0 ? '-' : ''}${Math.abs(total).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Owner section: PIN change form ────────────────────────────────────────────

function PinChangeForm({ slug }: { slug: string }) {
  const [newPin, setNewPin]     = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPin !== confirm) {
      setError('PINs do not match')
      return
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      setError('PIN must be 4–8 digits (numbers only)')
      return
    }
    setLoading(true)
    const res  = await fetch(`/api/portal/${slug}/change-owner-pin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ new_pin: newPin }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError((json as { error?: string }).error ?? 'Failed to update PIN')
    } else {
      setSuccess(true)
      setNewPin('')
      setConfirm('')
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-w-xs">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">New Owner PIN</label>
        <input
          type="password"
          value={newPin}
          onChange={e => setNewPin(e.target.value)}
          placeholder="••••"
          maxLength={8}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Confirm PIN</label>
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="••••"
          maxLength={8}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      {error   && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-emerald-600">✓ Owner PIN updated successfully</p>}
      <button
        type="submit"
        disabled={loading || !newPin || !confirm}
        className="rounded-lg bg-slate-800 text-white text-sm font-semibold px-4 py-2 hover:bg-slate-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Saving…' : 'Update PIN'}
      </button>
    </form>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AgencyPortal({
  agency,
  cases,
  gdcYtd,
  appCount,
  serviceRequests,
  policyReviews,
  spiffRecords,
  isOwner,
  gdcRecords,
  portalContent,
}: {
  agency:          AgencyProps
  cases:           Case[]
  gdcYtd:          number
  appCount:        number
  serviceRequests: ServiceRequest[]
  policyReviews:   PolicyReview[]
  spiffRecords:    SpiffRecord[]
  isOwner:         boolean
  gdcRecords:      GdcRecord[]
  portalContent:   PortalContent[]
}) {
  const router = useRouter()
  const [agentFilter, setAgentFilter] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(`rpas_lsp_${agency.slug}`)
    if (saved) setAgentFilter(saved)
  }, [agency.slug])

  async function handleRewarm(caseId: string, note: string, lspName: string) {
    const res = await fetch(`/api/portal/${agency.slug}/cases/${caseId}/rewarm`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ note, lsp_name: lspName || undefined }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error ?? 'Failed to submit update')
    }
    router.refresh()
  }

  // Agent filter options
  const agentNames = Array.from(new Set(
    cases.map(c => c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null).filter(Boolean)
  )) as string[]

  const filtered = agentFilter
    ? cases.filter(c => {
        const name = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : ''
        return name.toLowerCase().includes(agentFilter.toLowerCase())
      })
    : cases

  // ── KPI counts (always agency-wide) ────────────────────────────────────────
  const now = new Date()
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30)
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60)

  const yearStart       = new Date(`${now.getFullYear()}-01-01`)
  const tier1           = cases.filter(c => c.stage_translations?.tier === 1)
  const tier1Ytd        = tier1.filter(c => new Date(c.created_at) >= yearStart)
  const totalReferrals  = tier1.length
  const activeReferrals = tier1.filter(c => c.stage_translations?.is_active_case).length
  const referrals30d    = tier1.filter(c => new Date(c.created_at) >= d30).length
  const referrals60d    = tier1.filter(c => new Date(c.created_at) >= d60).length
  const keptAppts       = tier1Ytd.filter(c => c.internal_status === 'appointment_kept').length
  const apptRate        = tier1Ytd.length > 0 ? Math.round(keptAppts / tier1Ytd.length * 100) : null
  const pendingCount    = cases.filter(c => (c.stage_translations?.tier ?? 0) >= 2 && c.stage_translations?.is_active_case).length
  const placedCount     = cases.filter(c => c.stage_translations?.is_won === true).length
  const placementRate   = totalReferrals > 0 ? Math.round(placedCount / totalReferrals * 100) : null

  // ── Filtered + sorted lists ─────────────────────────────────────────────────
  const hotFirst     = (a: Case, b: Case) => (b.is_hot_lead ? 1 : 0) - (a.is_hot_lead ? 1 : 0)
  const referrals    = filtered.filter(c => c.stage_translations?.tier === 1 && c.stage_translations?.is_active_case).sort(hotFirst)
  const pendingCases = filtered.filter(c => (c.stage_translations?.tier ?? 0) >= 2 && c.stage_translations?.is_active_case).sort(hotFirst)
  const placedCases  = filtered.filter(c => c.stage_translations?.is_won === true)
  const closedCases  = filtered.filter(c => c.stage_translations?.is_lost === true || c.internal_status === 'snoozed')

  // ── Portal content by type ──────────────────────────────────────────────────
  const trainingItems  = portalContent.filter(i => i.content_type === 'training')
  const bulletinItems  = portalContent.filter(i => i.content_type === 'bulletin')

  // ── Address string ──────────────────────────────────────────────────────────
  const addressLine = [
    agency.street,
    agency.city,
    agency.state,
    agency.zip,
  ].filter(Boolean).join(', ')

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <header className="bg-slate-900 px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase">
                Right Path Agency System
              </p>
              <p className="text-white font-bold text-xl leading-tight mt-0.5">{agency.name}</p>
            </div>
            <Link
              href={`/intake/${agency.slug}`}
              className="text-xs font-semibold text-slate-300 border border-slate-600 rounded-lg px-3 py-2 hover:bg-slate-800 transition-colors shrink-0"
            >
              + Submit Referral
            </Link>
          </div>
        </div>
      </header>

      {/* Three-column grid */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="xl:grid xl:grid-cols-[240px_minmax(0,1fr)_280px] xl:gap-6 space-y-6 xl:space-y-0">

          {/* ── Left column ──────────────────────────────────────────────────── */}
          <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">

            {/* Agency contact card */}
            <div className="bg-white rounded-2xl border border-slate-100 px-4 py-4 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Agency Info</p>
              {addressLine && (
                <p className="text-xs text-slate-600 leading-relaxed">{addressLine}</p>
              )}
              {agency.phone && (
                <a href={`tel:${agency.phone}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900">
                  <span>📞</span> {agency.phone}
                </a>
              )}
              {agency.email && (
                <a href={`mailto:${agency.email}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 break-all">
                  <span>✉️</span> {agency.email}
                </a>
              )}
            </div>

            {/* Owner lock/unlock */}
            <OwnerLock slug={agency.slug} isOwner={isOwner} />

            {/* Resources */}
            <ResourceLinks items={portalContent} />

          </div>

          {/* ── Center column ─────────────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Gauges */}
            <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4 text-center">
                {new Date().getFullYear()} Goal Progress
              </p>
              <div className="grid grid-cols-2 gap-6">
                <GaugeChart value={gdcYtd}   max={100000} bands={GDC_BANDS} label="GDC Year-to-Date"  formatValue={formatGdc} />
                <GaugeChart value={appCount} max={50}     bands={APP_BANDS} label="App Count"         formatValue={v => String(Math.round(v))} />
              </div>
            </div>

            {/* Pipeline stats */}
            <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
                Referral Pipeline — {new Date().getFullYear()}
              </p>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-900">{totalReferrals}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Total YTD</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">{activeReferrals}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Active</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-700">{referrals30d}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Last 30 Days</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-700">{referrals60d}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Last 60 Days</p>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4 grid grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-indigo-600">{pendingCount}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Pending</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{placedCount}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Placed{placementRate !== null && <span className="text-slate-400"> · {placementRate}%</span>}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-400">{serviceRequests.length}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Service Reqs</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-400">{policyReviews.length}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Reviews</p>
                </div>
              </div>
            </div>

            {/* Agent / LSP filter */}
            {agentNames.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filter by LSP</p>
                  {agentFilter && (
                    <button onClick={() => setAgentFilter('')} className="text-xs text-slate-400 hover:text-slate-600">
                      Show all
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {agentNames.map(name => (
                    <button key={name} onClick={() => setAgentFilter(agentFilter === name ? '' : name)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        agentFilter === name
                          ? 'bg-slate-800 text-white'
                          : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Referrals — Tier 1 active */}
            {referrals.length > 0 && (
              <div>
                <SectionHeader label="Referrals" count={referrals.length} />
                <div className="space-y-2">
                  {referrals.map(c => <ReferralCard key={c.id} c={c} />)}
                </div>
              </div>
            )}

            {/* Pending Business — Tier 2+ active */}
            {pendingCases.length > 0 && (
              <div>
                <SectionHeader label="Pending Business" count={pendingCases.length} />
                <div className="space-y-2">
                  {pendingCases.map(c => <PendingCard key={c.id} c={c} />)}
                </div>
              </div>
            )}

            {/* Placed Policies */}
            {placedCases.length > 0 && (
              <div>
                <SectionHeader label="Placed Policies" count={placedCases.length} green />
                <div className="space-y-2">
                  {placedCases.map(c => <PlacedCard key={c.id} c={c} />)}
                </div>
              </div>
            )}

            {/* Closed / Paused */}
            {closedCases.length > 0 && (
              <div>
                <SectionHeader label="Closed / Paused" count={closedCases.length} />
                <div className="space-y-2">
                  {closedCases.map(c => (
                    <ClosedCard key={c.id} c={c} agentFilter={agentFilter} onRewarm={handleRewarm} />
                  ))}
                </div>
              </div>
            )}

            {/* Service Requests */}
            {serviceRequests.length > 0 && (
              <div>
                <SectionHeader label="Service Requests" count={serviceRequests.filter(r => !r.resolved_at).length} />
                <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
                  {serviceRequests.map(sr => (
                    <div key={sr.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {sr.customers ? `${sr.customers.first_name} ${sr.customers.last_name}` : '—'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {sr.service_request_types?.name ?? '—'}{sr.carriers?.short_name ? ` · ${sr.carriers.short_name}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!sr.resolved_at && <AgeBadge dateStr={sr.created_at} />}
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${srStatusClass(sr.request_statuses?.name)}`}>
                          {sr.request_statuses?.name ?? '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Policy Reviews */}
            {policyReviews.length > 0 && (
              <div>
                <SectionHeader label="Policy Reviews" count={policyReviews.filter(r => !r.reviewed_at).length} />
                <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
                  {policyReviews.map(pr => (
                    <div key={pr.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {pr.customers ? `${pr.customers.first_name} ${pr.customers.last_name}` : '—'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {pr.carriers?.short_name ?? '—'}{pr.opportunity_types?.name ? ` · ${pr.opportunity_types.name}` : ''}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${prStatusClass(pr.review_statuses?.name)}`}>
                        {pr.review_statuses?.name ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
                <p className="text-slate-400 text-sm">No activity to show yet.</p>
              </div>
            )}

          </div>

          {/* ── Right column ──────────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* SPIFF + Kept Appts */}
            <SpiffKeptCard
              spiffRecords={spiffRecords}
              keptAppts={keptAppts}
              apptRate={apptRate}
            />

            {/* Training Schedule */}
            <ContentCard
              title="Training Schedule"
              items={trainingItems}
              emptyText="No upcoming training scheduled."
            />

            {/* Bulletins */}
            <ContentCard
              title="Bulletins"
              items={bulletinItems}
              emptyText="No active bulletins."
            />

          </div>

        </div>

        {/* ── Owner section (full-width below grid) ─────────────────────────── */}
        {isOwner && (
          <div id="owner-section" className="mt-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-lg">🔓</span>
              <h2 className="text-base font-bold text-slate-800">Agency Owner Section</h2>
              <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">Private</span>
            </div>

            {/* GDC Transactions */}
            <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
                GDC Transactions — {new Date().getFullYear()}
              </p>
              <GdcTransactionTable records={gdcRecords} />
            </div>

            {/* PIN Management */}
            <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Owner PIN</p>
              <p className="text-xs text-slate-400 mb-4">
                Change your owner PIN. Must be 4–8 digits. Your Right Path representative can reset it if needed.
              </p>
              <PinChangeForm slug={agency.slug} />
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 py-8">
          Right Path Agency System · Makal Financial Services, LLC
        </p>
      </div>
    </div>
  )
}
