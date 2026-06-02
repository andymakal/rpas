'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, AlertTriangle, CheckCircle2, Phone, Search, Plus } from 'lucide-react'
import type { ReviewListRow } from './page'
import { fmtDate as fmt } from '@/lib/fmt'
import { setNavList } from '@/lib/nav-list'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  prep:       'text-blue-400 bg-blue-400/10 border border-blue-400/20',
  complete:   'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
  no_contact: 'text-slate-400 bg-slate-400/10 border border-slate-400/20',
}

const STATUS_LABELS: Record<string, string> = {
  prep:       'Prep',
  complete:   'Complete',
  no_contact: 'No Contact',
}

const OUTCOME_COLORS: Record<string, string> = {
  excellent:         'text-emerald-400',
  service_needed:    'text-yellow-400',
  opportunity_found: 'text-blue-400',
  no_contact:        'text-slate-500',
  not_interested:    'text-slate-500',
}

const OUTCOME_LABELS: Record<string, string> = {
  excellent:         'Excellent — no changes',
  service_needed:    'Service issue found',
  opportunity_found: 'Opportunity found',
  no_contact:        'No contact',
  not_interested:    'Not interested',
}

const TYPE_LABELS: Record<string, string> = {
  term:         'Term',
  permanent_ul: 'Universal Life',
  permanent_wl: 'Whole Life',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v)}`
}

function isTobaccoPolicy(rateClass: string | null | undefined): boolean {
  if (!rateClass) return false
  const r = rateClass.toLowerCase()
  const hasTobacco = r.includes('tobacco') && !r.includes('non-tobacco') && !r.includes('non tobacco')
  return hasTobacco || r.includes('smoker')
}

// ── New Review Modal ──────────────────────────────────────────────────────────

function NewReviewModal({ onClose }: { onClose: (id?: string) => void }) {
  const [policyId,   setPolicyId]   = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function handleCreate() {
    if (!policyId.trim()) { setError('Policy ID is required'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/policy-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_id: policyId.trim(), assigned_to: assignedTo || null }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create'); return }
      onClose(json.data.id)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
        <h2 className="text-white font-semibold text-lg">Queue Review</h2>
        <p className="text-slate-400 text-sm">
          Enter the service policy ID to add it to the review queue.
          The prep screen will load automatically.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Service Policy ID *</label>
            <input
              type="text"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-slate-500 placeholder-slate-500"
              placeholder="paste policy UUID…"
              value={policyId}
              onChange={e => setPolicyId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Assign To</label>
            <select
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value)}
            >
              <option value="">Unassigned</option>
              <option value="Tyler">Tyler</option>
              <option value="Lucas">Lucas</option>
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#1F3864' }}
          >
            {saving ? 'Creating…' : 'Queue Review'}
          </button>
          <button
            onClick={() => onClose()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReviewsClient({ reviews }: { reviews: ReviewListRow[] }) {
  const router = useRouter()

  const [search,      setSearch]      = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter,   setTypeFilter]   = useState<string>('all')
  const [assignFilter, setAssignFilter] = useState<string>('all')
  const [tobaccoOnly,  setTobaccoOnly]  = useState(false)
  const [showModal,    setShowModal]    = useState(false)

  const filtered = useMemo(() => {
    let rows = reviews
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.service_policies?.client_name?.toLowerCase().includes(q) ||
        r.service_policies?.policy_number?.toLowerCase().includes(q) ||
        r.service_policies?.carrier?.toLowerCase().includes(q) ||
        r.review_number?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') {
      rows = rows.filter(r => r.status === statusFilter)
    }
    if (typeFilter !== 'all') {
      rows = rows.filter(r => r.review_type === typeFilter)
    }
    if (assignFilter !== 'all') {
      rows = rows.filter(r => r.assigned_to === assignFilter || (!r.assigned_to && assignFilter === 'unassigned'))
    }
    if (tobaccoOnly) {
      rows = rows.filter(r => isTobaccoPolicy(r.service_policies?.rate_class))
    }
    return rows
  }, [reviews, search, statusFilter, typeFilter, assignFilter, tobaccoOnly])

  const counts = useMemo(() => ({
    prep:       reviews.filter(r => r.status === 'prep').length,
    complete:   reviews.filter(r => r.status === 'complete').length,
    no_contact: reviews.filter(r => r.status === 'no_contact').length,
    tobacco:    reviews.filter(r => isTobaccoPolicy(r.service_policies?.rate_class)).length,
  }), [reviews])

  function handleModalClose(newId?: string) {
    setShowModal(false)
    if (newId) router.push(`/reviews/${newId}`)
  }

  return (
    <>
      {showModal && <NewReviewModal onClose={handleModalClose} />}

      {/* ── Summary chips ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-5">
        <Chip label="In Prep" count={counts.prep} color="blue" />
        <Chip label="Complete" count={counts.complete} color="emerald" />
        <Chip label="No Contact" count={counts.no_contact} color="slate" />
        {counts.tobacco > 0 && (
          <Chip label="Tobacco" count={counts.tobacco} color="amber" />
        )}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search client, policy #, carrier…"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-slate-500 placeholder-slate-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={[
            { value: 'all',       label: 'All statuses' },
            { value: 'prep',      label: 'Prep' },
            { value: 'complete',  label: 'Complete' },
            { value: 'no_contact', label: 'No Contact' },
          ]} />

          <FilterSelect value={typeFilter} onChange={setTypeFilter} options={[
            { value: 'all',          label: 'All types' },
            { value: 'term',         label: 'Term' },
            { value: 'permanent_ul', label: 'Universal Life' },
            { value: 'permanent_wl', label: 'Whole Life' },
          ]} />

          <FilterSelect value={assignFilter} onChange={setAssignFilter} options={[
            { value: 'all',        label: 'All producers' },
            { value: 'Tyler',      label: 'Tyler' },
            { value: 'Lucas',      label: 'Lucas' },
            { value: 'unassigned', label: 'Unassigned' },
          ]} />

          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-0"
              checked={tobaccoOnly}
              onChange={e => setTobaccoOnly(e.target.checked)}
            />
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Tobacco only
          </label>

          <button
            onClick={() => setShowModal(true)}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" />
            Queue Review
          </button>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <ClipboardList className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">
            {reviews.length === 0
              ? 'No reviews queued yet — use "Queue Review" to add a policy.'
              : 'No reviews match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <Th>Review #</Th>
                <Th>Client</Th>
                <Th>Carrier / Policy</Th>
                <Th>Type</Th>
                <Th>Face</Th>
                <Th>Assigned</Th>
                <Th>Status</Th>
                <Th>Outcome</Th>
                <Th>Queued</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(r => {
                const p = r.service_policies
                const isTob = isTobaccoPolicy(p?.rate_class)
                return (
                  <tr
                    key={r.id}
                    onClick={() => { setNavList(filtered.map(x => x.id)); router.push(`/reviews/${r.id}`) }}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">
                      {r.review_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-100 font-medium">{p?.client_name ?? '—'}</span>
                        {isTob && (
                          <span title="Tobacco rate class">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200">{p?.carrier ?? '—'}</div>
                      <div className="text-slate-500 font-mono text-xs">{p?.policy_number ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {r.review_type ? TYPE_LABELS[r.review_type] ?? r.review_type : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{fmtAmt(p?.face_amount)}</td>
                    <td className="px-4 py-3 text-slate-400">{r.assigned_to ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] ?? ''}`}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.outcome ? (
                        <span className={`text-xs ${OUTCOME_COLORS[r.outcome] ?? 'text-slate-400'}`}>
                          {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                        </span>
                      ) : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {fmt(r.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Chip({ label, count, color }: { label: string; count: number; color: string }) {
  const colors: Record<string, string> = {
    blue:    'bg-blue-400/10 border-blue-400/20 text-blue-400',
    emerald: 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400',
    slate:   'bg-slate-400/10 border-slate-400/20 text-slate-400',
    amber:   'bg-amber-400/10 border-amber-400/20 text-amber-400',
  }
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${colors[color]}`}>
      <span className="font-bold text-base leading-none">{count}</span>
      {label}
    </div>
  )
}

function FilterSelect({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
