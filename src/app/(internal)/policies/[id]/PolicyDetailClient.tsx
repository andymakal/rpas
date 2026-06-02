'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle, ShieldOff, FileQuestion, Send,
  AlertTriangle, ChevronRight, Search, X, Building2, User,
  Link2, Link2Off, ClipboardList, Zap, Pencil, Save,
} from 'lucide-react'
import type { PolicyDetail, PolicyReviewRow } from './page'
import type { ReviewFlag } from '@/lib/reviews/prep'
import { fmtDate } from '@/lib/fmt'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-slate-500 text-xs">—</span>
  const colors: Record<string, string> = {
    Term: 'bg-blue-900/40 text-blue-300',
    UL:   'bg-purple-900/40 text-purple-300',
    VUL:  'bg-purple-900/40 text-purple-300',
    WL:   'bg-teal-900/40 text-teal-300',
    PERM: 'bg-teal-900/40 text-teal-300',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[type] ?? 'bg-slate-700 text-slate-300'}`}>
      {type}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  const color =
    s === 'active'     ? 'bg-emerald-900/40 text-emerald-300' :
    s === 'pending'    ? 'bg-blue-900/40    text-blue-300'    :
    s === 'paid up'    ? 'bg-indigo-900/40  text-indigo-300'  :
    s === 'lapsed'     ? 'bg-amber-900/40   text-amber-300'   :
    s === 'surrendered'? 'bg-red-900/40     text-red-300'     :
    s === 'terminated' ? 'bg-slate-700      text-slate-400'   :
    'bg-slate-700 text-slate-400'
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>
      {status}
    </span>
  )
}

function SeverityDot({ severity }: { severity: ReviewFlag['severity'] }) {
  const cls =
    severity === 'critical'    ? 'bg-red-500' :
    severity === 'warning'     ? 'bg-amber-400' :
    severity === 'opportunity' ? 'bg-sky-400' :
    'bg-slate-500'
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${cls}`} />
}

function ReviewStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    prep:        'bg-slate-700 text-slate-300',
    scheduled:   'bg-blue-900/40 text-blue-300',
    in_progress: 'bg-amber-900/40 text-amber-300',
    completed:   'bg-green-900/40 text-green-300',
    cancelled:   'bg-red-900/40 text-red-300',
  }
  const label: Record<string, string> = {
    prep:        'Prep',
    scheduled:   'Scheduled',
    in_progress: 'In Progress',
    completed:   'Completed',
    cancelled:   'Cancelled',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>
      {label[status] ?? status}
    </span>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ title, icon: Icon, children, className = '' }: {
  title: string
  icon?: React.ElementType
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-xl ${className}`}>
      <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-slate-500" />}
        <span className="text-sm font-medium text-slate-300">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b border-slate-800/60 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-sm text-slate-200 text-right">{value ?? '—'}</span>
    </div>
  )
}

// ── Customer search types ─────────────────────────────────────────────────────

type CustomerResult = {
  id:         string
  first_name: string
  last_name:  string
  phone:      string | null
}

// ── Main component ────────────────────────────────────────────────────────────

export function PolicyDetailClient({
  policy: initial,
  agencies,
  reviews: initialReviews,
  flags,
}: {
  policy:   PolicyDetail
  agencies: { id: string; name: string; display_name: string | null }[]
  reviews:  PolicyReviewRow[]
  flags:    ReviewFlag[]
}) {
  const router = useRouter()

  // ── Local state (optimistic UI) ──────────────────────────────────────────────
  const [saStatus,    setSaStatus]    = useState(initial.sa_status)
  const [formSentAt,  setFormSentAt]  = useState<string | null>(initial.sa_form_sent_at)
  const [agencyId,    setAgencyId]    = useState<string | null>(initial.agency_id)
  const [customerId,  setCustomerId]  = useState<string | null>(initial.customer_id)
  const [customerName, setCustomerName] = useState<string | null>(
    initial.customers
      ? `${initial.customers.first_name} ${initial.customers.last_name}`
      : null
  )
  const [reviews,      setReviews]    = useState<PolicyReviewRow[]>(initialReviews)
  const [autoNotice,   setAutoNotice] = useState<string | null>(null)

  // ── Edit mode state ───────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [editFields, setEditFields] = useState({
    face_amount:          initial.face_amount          != null ? String(initial.face_amount)          : '',
    death_benefit_amount: initial.death_benefit_amount != null ? String(initial.death_benefit_amount) : '',
    cash_value_amount:    initial.cash_value_amount    != null ? String(initial.cash_value_amount)    : '',
    cost_basis:           initial.cost_basis            != null ? String(initial.cost_basis)           : '',
    annual_premium:       initial.annual_premium        != null ? String(initial.annual_premium)       : '',
    premium_mode:         initial.premium_mode          ?? '',
    rate_class:           initial.rate_class            ?? '',
    primary_beneficiary:  initial.primary_beneficiary   ?? '',
    riders:               initial.riders                ?? '',
    coverage_status:      initial.coverage_status       ?? 'Active',
    notes:                initial.notes                 ?? '',
  })

  function ef(k: keyof typeof editFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setEditFields(prev => ({ ...prev, [k]: e.target.value }))
  }

  async function handleSaveEdit() {
    setSaving(true)
    setErr(null)
    try {
      const num = (v: string) => v.trim() === '' ? null : parseFloat(v)
      await patchPolicy({
        face_amount:          num(editFields.face_amount),
        death_benefit_amount: num(editFields.death_benefit_amount),
        cash_value_amount:    num(editFields.cash_value_amount),
        cost_basis:           num(editFields.cost_basis),
        annual_premium:       num(editFields.annual_premium),
        premium_mode:         editFields.premium_mode  || null,
        rate_class:           editFields.rate_class    || null,
        primary_beneficiary:  editFields.primary_beneficiary || null,
        riders:               editFields.riders        || null,
        coverage_status:      editFields.coverage_status || 'Active',
        notes:                editFields.notes         || null,
      })
      setEditing(false)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [saving,        setSaving]        = useState(false)
  const [agencySaving,  setAgencySaving]  = useState(false)
  const [err,           setErr]           = useState<string | null>(null)
  const [queuingReview, setQueuingReview] = useState(false)

  // Customer search
  const [custSearch,   setCustSearch]   = useState('')
  const [custResults,  setCustResults]  = useState<CustomerResult[]>([])
  const [custSearching, setCustSearching] = useState(false)
  const [showCustDrop,  setShowCustDrop]  = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropRef   = useRef<HTMLDivElement>(null)

  // ── Close dropdown on outside click ──────────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowCustDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── PATCH helper ─────────────────────────────────────────────────────────────
  async function patchPolicy(fields: Record<string, unknown>) {
    const res  = await fetch(`/api/service-policies/${initial.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Save failed')
    return json
  }

  // ── SA status change ──────────────────────────────────────────────────────────
  async function handleSaChange(newStatus: string) {
    if (newStatus === saStatus) return
    setSaving(true)
    setErr(null)
    setAutoNotice(null)
    try {
      const patch: Record<string, unknown> = { sa_status: newStatus }
      // Clear form_sent when changing away from not_on_file
      if (newStatus !== 'not_on_file') patch.sa_form_sent_at = null
      const json = await patchPolicy(patch)
      setSaStatus(newStatus)
      if (newStatus !== 'not_on_file') setFormSentAt(null)

      // Auto-queue notice
      if (json.auto_queued_review) {
        const rv = json.auto_queued_review as { id: string; review_number: string }
        setAutoNotice(`Review ${rv.review_number} auto-queued based on policy flags.`)
        // Prepend to local reviews list
        setReviews(prev => [{
          id:            rv.id,
          review_number: rv.review_number,
          review_type:   'auto',
          status:        'prep',
          assigned_to:   null,
          created_at:    new Date().toISOString(),
        }, ...prev])
      }
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── SA form sent toggle ───────────────────────────────────────────────────────
  async function handleFormSentToggle() {
    setSaving(true)
    setErr(null)
    const newVal = formSentAt ? null : new Date().toISOString()
    try {
      await patchPolicy({ sa_form_sent_at: newVal })
      setFormSentAt(newVal)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Agency change ─────────────────────────────────────────────────────────────
  async function handleAgencyChange(newAgencyId: string) {
    setAgencySaving(true)
    setErr(null)
    try {
      await patchPolicy({ agency_id: newAgencyId || null })
      setAgencyId(newAgencyId || null)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setAgencySaving(false)
    }
  }

  // ── Customer search ───────────────────────────────────────────────────────────
  const searchCustomers = useCallback(async (q: string) => {
    if (q.length < 2) { setCustResults([]); return }
    setCustSearching(true)
    try {
      const res  = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setCustResults(json.data ?? [])
      setShowCustDrop(true)
    } catch {
      // silent
    } finally {
      setCustSearching(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(custSearch), 300)
    return () => clearTimeout(t)
  }, [custSearch, searchCustomers])

  // ── Customer link ─────────────────────────────────────────────────────────────
  async function handleCustomerLink(cid: string, name: string) {
    setSaving(true)
    setErr(null)
    setShowCustDrop(false)
    try {
      await patchPolicy({ customer_id: cid })
      setCustomerId(cid)
      setCustomerName(name)
      setCustSearch('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleCustomerUnlink() {
    if (!confirm('Remove customer link from this policy?')) return
    setSaving(true)
    setErr(null)
    try {
      await patchPolicy({ customer_id: null })
      setCustomerId(null)
      setCustomerName(null)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Manual queue review ───────────────────────────────────────────────────────
  async function handleQueueReview() {
    setQueuingReview(true)
    setErr(null)
    try {
      const res  = await fetch('/api/policy-reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ policy_id: initial.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to queue review')
      const rv = json.data as PolicyReviewRow
      setReviews(prev => [rv, ...prev])
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to queue review')
    } finally {
      setQueuingReview(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const currentAgency = agencies.find(a => a.id === agencyId)
  const hasOpenReview = reviews.some(r =>
    ['prep', 'scheduled', 'in_progress'].includes(r.status)
  )

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Back link */}
        <Link
          href="/policies"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Policies
        </Link>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-white text-2xl font-semibold">{initial.client_name}</h1>
              <TypeBadge type={initial.product_type} />
              <StatusBadge status={editFields.coverage_status} />
            </div>
            <p className="text-slate-400 text-sm mt-0.5 font-mono">{initial.policy_number} · {initial.carrier}</p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => { setEditing(false); setErr(null) }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#1F3864' }}
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Policy
              </button>
            )}
          </div>
        </div>

        {/* Error banner */}
        {err && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {err}
            <button onClick={() => setErr(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Auto-queue notice */}
        {autoNotice && (
          <div className="bg-green-900/30 border border-green-800 rounded-lg px-4 py-3 text-green-300 text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 shrink-0" />
            {autoNotice}
            <button onClick={() => setAutoNotice(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left col — details */}
          <div className="lg:col-span-2 space-y-5">

            {/* Coverage details */}
            <Card title="Coverage Details">
              {editing ? (
                <div className="space-y-3">
                  {[
                    { label: 'Face Amount ($)',         key: 'face_amount'          },
                    { label: 'Death Benefit ($)',       key: 'death_benefit_amount' },
                    { label: 'Cash Value ($)',          key: 'cash_value_amount'    },
                    { label: 'Cost Basis ($)',          key: 'cost_basis'           },
                    { label: 'Annual Premium ($)',      key: 'annual_premium'       },
                  ].map(({ label, key }) => (
                    <div key={key}>
                      <label className="block text-xs text-slate-500 mb-1">{label}</label>
                      <input
                        type="number"
                        value={editFields[key as keyof typeof editFields]}
                        onChange={ef(key as keyof typeof editFields)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
                        placeholder="—"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Premium Mode</label>
                    <select value={editFields.premium_mode} onChange={ef('premium_mode')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-slate-500">
                      <option value="">—</option>
                      {['Annual','Semi-Annual','Quarterly','Monthly','EFT Monthly'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Rate Class</label>
                    <input value={editFields.rate_class} onChange={ef('rate_class')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
                      placeholder="e.g. Preferred Plus, Standard…" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Coverage Status</label>
                    <select value={editFields.coverage_status} onChange={ef('coverage_status')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-slate-500">
                      {['Active','Pending','Paid Up','Lapsed','Surrendered','Terminated'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <>
                  <Row label="Face Amount"    value={fmt(initial.face_amount)} />
                  <Row label="Death Benefit"  value={fmt(initial.death_benefit_amount)} />
                  <Row label="Cash Value"     value={fmt(initial.cash_value_amount)} />
                  <Row label="Cost Basis"     value={fmt(initial.cost_basis)} />
                  <Row label="Annual Premium" value={
                    initial.annual_premium
                      ? `${fmt(initial.annual_premium)}${initial.premium_mode ? ` / ${initial.premium_mode.toLowerCase()}` : ''}`
                      : '—'
                  } />
                  <Row label="Issue Date"  value={fmtDate(initial.issue_date)} />
                  {initial.product_type === 'Term' && (
                    <Row label="Term Length" value={initial.term_length ?? '—'} />
                  )}
                  <Row label="Rate Class" value={editFields.rate_class || '—'} />
                </>
              )}
            </Card>

            {/* Insured / Riders */}
            <Card title="Policy Details">
              <Row
                label="Insured"
                value={
                  initial.insured_first_name || initial.insured_last_name
                    ? `${initial.insured_first_name ?? ''} ${initial.insured_last_name ?? ''}`.trim()
                    : '—'
                }
              />
              {editing ? (
                <div className="space-y-3 mt-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Primary Beneficiary</label>
                    <input value={editFields.primary_beneficiary} onChange={ef('primary_beneficiary')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
                      placeholder="e.g. Jane Doe (spouse)" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Riders</label>
                    <input value={editFields.riders} onChange={ef('riders')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
                      placeholder="e.g. WAIVER, CLTR" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Notes</label>
                    <textarea value={editFields.notes} onChange={ef('notes')} rows={4}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 resize-none"
                      placeholder="Internal notes about this policy…" />
                  </div>
                </div>
              ) : (
                <>
                  <Row label="Primary Beneficiary" value={editFields.primary_beneficiary || '—'} />
                  <Row label="Riders"              value={editFields.riders || '—'} />
                  {editFields.notes && (
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <p className="text-xs text-slate-500 mb-1">Notes</p>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap">{editFields.notes}</p>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* Flags */}
            {flags.length > 0 && (
              <Card title="Review Flags" icon={AlertTriangle}>
                <div className="space-y-3">
                  {flags.map((f, i) => (
                    <div key={i} className="flex gap-3">
                      <SeverityDot severity={f.severity} />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{f.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{f.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

          </div>

          {/* Right col — actions */}
          <div className="space-y-5">

            {/* SA Status */}
            <Card title="SA Status" icon={
              saStatus === 'confirmed' ? CheckCircle :
              saStatus === 'not_on_file' ? ShieldOff :
              FileQuestion
            }>
              <div className="space-y-3">

                {/* 3-state toggle */}
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { value: 'confirmed',   label: 'Confirmed',   icon: CheckCircle,  active: 'bg-green-900/50 border-green-700 text-green-300' },
                    { value: 'not_on_file', label: 'Not SA',      icon: ShieldOff,    active: 'bg-amber-900/50 border-amber-700 text-amber-300' },
                    { value: 'unknown',     label: 'Unknown',     icon: FileQuestion, active: 'bg-slate-700 border-slate-600 text-slate-200'    },
                  ].map(({ value, label, icon: Icon, active }) => (
                    <button
                      key={value}
                      onClick={() => handleSaChange(value)}
                      disabled={saving}
                      className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border text-xs font-medium transition-colors ${
                        saStatus === value
                          ? active
                          : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                      } disabled:opacity-50`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Form sent sub-toggle (visible when not_on_file) */}
                {saStatus === 'not_on_file' && (
                  <div className="border-t border-slate-800 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Send className="w-3.5 h-3.5" />
                        SA Change Form
                      </div>
                      <button
                        onClick={handleFormSentToggle}
                        disabled={saving}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
                          formSentAt
                            ? 'bg-sky-900/50 border-sky-700 text-sky-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                        } disabled:opacity-50`}
                      >
                        {formSentAt ? 'Sent ✓' : 'Not Sent'}
                      </button>
                    </div>
                    {formSentAt && (
                      <p className="text-xs text-slate-500 mt-1.5">
                        Sent {fmtDate(formSentAt)}
                      </p>
                    )}
                  </div>
                )}

                {saving && (
                  <p className="text-xs text-slate-500 animate-pulse">Saving…</p>
                )}
              </div>
            </Card>

            {/* Agency */}
            <Card title="Agency" icon={Building2}>
              <div className="space-y-2">
                {currentAgency && (
                  <p className="text-sm text-slate-200">
                    {currentAgency.display_name ?? currentAgency.name}
                  </p>
                )}
                <select
                  value={agencyId ?? ''}
                  onChange={e => handleAgencyChange(e.target.value)}
                  disabled={agencySaving}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-500 disabled:opacity-50"
                >
                  <option value="">— Unassigned —</option>
                  {agencies.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.display_name ?? a.name}
                    </option>
                  ))}
                </select>
                {agencySaving && <p className="text-xs text-slate-500 animate-pulse">Saving…</p>}
              </div>
            </Card>

            {/* Customer link */}
            <Card title="Customer" icon={User}>
              <div className="space-y-3">
                {customerId && customerName ? (
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/customers/${customerId}`}
                      className="text-sm text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {customerName}
                    </Link>
                    <button
                      onClick={handleCustomerUnlink}
                      disabled={saving}
                      title="Unlink customer"
                      className="text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <Link2Off className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No customer linked</p>
                )}

                {/* Search box */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <input
                    ref={searchRef}
                    value={custSearch}
                    onChange={e => { setCustSearch(e.target.value); setShowCustDrop(true) }}
                    onFocus={() => custResults.length && setShowCustDrop(true)}
                    placeholder="Search by last name…"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  />
                  {custSearching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs animate-pulse">…</span>
                  )}
                  {/* Dropdown */}
                  {showCustDrop && custResults.length > 0 && (
                    <div
                      ref={dropRef}
                      className="absolute z-20 top-full mt-1 left-0 right-0 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden"
                    >
                      {custResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => handleCustomerLink(c.id, `${c.first_name} ${c.last_name}`)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-slate-200 transition-colors"
                        >
                          <span className="font-medium">{c.last_name}</span>, {c.first_name}
                          {c.phone && <span className="text-slate-500 text-xs ml-2">{c.phone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>

          </div>
        </div>

        {/* Reviews section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-300">Policy Reviews</span>
              {reviews.length > 0 && (
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                  {reviews.length}
                </span>
              )}
            </div>
            {!hasOpenReview && (
              <button
                onClick={handleQueueReview}
                disabled={queuingReview}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                {queuingReview ? 'Queuing…' : 'Queue Review'}
              </button>
            )}
          </div>

          {reviews.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-500 text-sm">
              No reviews yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 text-xs">
                  <th className="text-left px-5 py-2.5 font-medium">Review #</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {reviews.map(r => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 font-mono text-slate-300 text-xs">{r.review_number}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs capitalize">
                      {r.review_type === 'permanent_ul' ? 'UL'
                       : r.review_type === 'permanent_wl' ? 'WL'
                       : r.review_type}
                    </td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/reviews/${r.id}`}
                        className="flex items-center justify-end text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  )
}
