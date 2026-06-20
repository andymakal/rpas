'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Copy, Check, CheckCircle2, Phone, AlertTriangle,
  Info, TrendingUp, AlertCircle, Save, ClipboardCheck, User, Pencil,
} from 'lucide-react'
import {
  generateCallScript,
  generateFlags,
  getReviewType,
  reviewTypeLabel,
} from '@/lib/reviews/prep'
import type { PolicyForPrep, ReviewFlag } from '@/lib/reviews/prep'
import type { ReviewDetail } from './page'
import { fmtDate as fmt, fmtEagentNote } from '@/lib/fmt'
import { useNavList } from '@/lib/nav-list'
import { addRecentItem } from '@/lib/recent-items'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  prep:       'text-blue-400 bg-blue-400/10 border border-blue-400/20',
  complete:   'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
  no_contact: 'text-slate-400 bg-slate-400/10 border border-slate-400/20',
}

const STATUS_LABELS: Record<string, string> = {
  prep:       'In Prep',
  complete:   'Complete',
  no_contact: 'No Contact',
}

const OUTCOME_CONFIG: { value: string; label: string; color: string; bg: string }[] = [
  { value: 'excellent',         label: 'All Good',       color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500 hover:bg-emerald-500/25' },
  { value: 'service_needed',    label: 'Service Needed', color: 'text-yellow-300',  bg: 'bg-yellow-500/15 border-yellow-500 hover:bg-yellow-500/25'  },
  { value: 'opportunity_found', label: 'Opportunity',    color: 'text-blue-300',    bg: 'bg-blue-500/15 border-blue-500 hover:bg-blue-500/25'        },
  { value: 'not_interested',    label: 'Not Interested', color: 'text-slate-400',   bg: 'bg-slate-700/50 border-slate-600 hover:bg-slate-700'        },
  { value: 'no_contact',        label: 'No Contact',     color: 'text-slate-400',   bg: 'bg-slate-700/50 border-slate-600 hover:bg-slate-700'        },
]

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; ring: string; badge: string; label: string }> = {
  critical:    { icon: AlertCircle,   ring: 'border-red-500/40 bg-red-500/5',    badge: 'bg-red-500/20 text-red-300 border border-red-500/30',          label: 'Critical'     },
  warning:     { icon: AlertTriangle, ring: 'border-yellow-500/40 bg-yellow-500/5', badge: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30', label: 'Warning'   },
  opportunity: { icon: TrendingUp,    ring: 'border-blue-500/40 bg-blue-500/5',  badge: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',        label: 'Opportunity'  },
  info:        { icon: Info,          ring: 'border-slate-600 bg-slate-800/40',  badge: 'bg-slate-700 text-slate-400 border border-slate-600',           label: 'Info'         },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(val)
}

const inputCls  = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500 placeholder-slate-500'
const selectCls = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500'

// ── Flag card ─────────────────────────────────────────────────────────────────

function FlagCard({ flag }: { flag: ReviewFlag }) {
  const cfg = SEVERITY_CONFIG[flag.severity] ?? SEVERITY_CONFIG.info
  const Icon = cfg.icon
  return (
    <div className={`rounded-lg border p-3.5 ${cfg.ring}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${
          flag.severity === 'critical'    ? 'text-red-400' :
          flag.severity === 'warning'     ? 'text-yellow-400' :
          flag.severity === 'opportunity' ? 'text-blue-400' :
          'text-slate-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-slate-100">{flag.label}</span>
            <span className={`text-xs rounded-full px-1.5 py-0.5 font-medium ${cfg.badge}`}>
              {cfg.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{flag.description}</p>
        </div>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

type ProducerOption = { id: string; first_name: string; last_name: string }

export function ReviewPrepClient({
  review: initialReview,
  producers = [],
}: {
  review:    ReviewDetail
  producers?: ProducerOption[]
}) {
  const router = useRouter()
  const [review, setReview] = useState(initialReview)
  const policy = review.service_policies

  const { prevId, nextId, position, total } = useNavList(review.id)
  const [notesCopied, setNotesCopied] = useState(false)

  // ── Create linked SR from this review ──────────────────────────
  const [srRequestType, setSrRequestType] = useState('')
  const [srCreating,    setSrCreating]    = useState(false)
  const [srError,       setSrError]       = useState<string | null>(null)

  async function handleCreateSr() {
    if (!policy?.id) return
    if (!srRequestType) { setSrError('Select a request type first'); return }
    setSrCreating(true); setSrError(null)
    try {
      const res = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_id: policy.id, request_type: srRequestType }),
      })
      const json = await res.json()
      if (!res.ok) { setSrError(json.error ?? 'Failed to create'); return }
      router.push(`/service/${json.data.id}`)
    } catch { setSrError('Network error') }
    finally { setSrCreating(false) }
  }

  useEffect(() => {
    const client = review.service_policies?.client_name ?? 'Policy Review'
    addRecentItem({
      id:       review.id,
      type:     'review',
      label:    client,
      sublabel: review.review_number ?? 'Policy Review',
      href:     `/reviews/${review.id}`,
    })
  }, [review.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Right-panel state ───────────────────────────────────────────────────
  const [assignedTo,     setAssignedTo]     = useState(review.assigned_to ?? '')
  const [status,         setStatus]         = useState(review.status)
  const [outcome,        setOutcome]        = useState(review.outcome ?? '')
  const [tobaccoAsked,   setTobaccoAsked]   = useState(review.tobacco_asked)
  const [stillUsing,     setStillUsing]     = useState<boolean | null>(review.still_using_tobacco ?? null)
  const [tobaccoProduct, setTobaccoProduct] = useState(review.tobacco_product ?? '')
  const [beneConfirmed,  setBeneConfirmed]  = useState(review.primary_beneficiary_confirmed ?? '')
  const [prepNotes,         setPrepNotes]         = useState(review.prep_notes ?? '')
  const [callCompletedAt,   setCallCompletedAt]   = useState(review.call_completed_at ? review.call_completed_at.slice(0, 10) : '')
  const [editingRecordDate, setEditingRecordDate] = useState(false)
  const [saving,            setSaving]            = useState(false)
  const [saved,             setSaved]             = useState(false)
  const [error,             setError]             = useState<string | null>(null)

  // ── Script copy state ───────────────────────────────────────────────────
  const [copied, setCopied]   = useState(false)

  // ── Policy snapshot inline edit ──────────────────────────────────────────
  const [policyEditing, setPolicyEditing] = useState(false)
  const [policyEdit,    setPolicyEdit]    = useState({
    face_amount:           policy?.face_amount          != null ? String(policy.face_amount)          : '',
    death_benefit_amount:  policy?.death_benefit_amount != null ? String(policy.death_benefit_amount) : '',
    cash_value_amount:     policy?.cash_value_amount    != null ? String(policy.cash_value_amount)    : '',
    cash_value_as_of_date: policy?.cash_value_as_of_date ?? '',
    cost_basis:            policy?.cost_basis            != null ? String(policy.cost_basis)           : '',
    annual_premium:        policy?.annual_premium        != null ? String(policy.annual_premium)       : '',
    premium_mode:          policy?.premium_mode          ?? '',
    rate_class:            policy?.rate_class            ?? '',
    riders:                policy?.riders               ?? '',
    primary_beneficiary:   policy?.primary_beneficiary  ?? '',
  })
  const [policySaving, setPolicySaving] = useState(false)
  const [policySaved,  setPolicySaved]  = useState(false)
  const [policyError,  setPolicyError]  = useState<string | null>(null)

  function pef(k: keyof typeof policyEdit) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setPolicyEdit(prev => ({ ...prev, [k]: e.target.value }))
  }

  async function handleSavePolicyEdit() {
    if (!policy?.id) return
    const num = (v: string) => v.trim() === '' ? null : parseFloat(v.replace(/[^0-9.]/g, ''))
    setPolicySaving(true); setPolicyError(null)
    try {
      const res = await fetch(`/api/service-policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          face_amount:           num(policyEdit.face_amount),
          death_benefit_amount:  num(policyEdit.death_benefit_amount),
          cash_value_amount:     num(policyEdit.cash_value_amount),
          cash_value_as_of_date: policyEdit.cash_value_as_of_date || null,
          cost_basis:            num(policyEdit.cost_basis),
          annual_premium:        num(policyEdit.annual_premium),
          premium_mode:          policyEdit.premium_mode          || null,
          rate_class:            policyEdit.rate_class.trim()     || null,
          riders:                policyEdit.riders.trim()         || null,
          primary_beneficiary:   policyEdit.primary_beneficiary.trim() || null,
        }),
      })
      if (!res.ok) { const j = await res.json(); setPolicyError(j.error ?? 'Save failed'); return }
      // Patch local review state so snapshot reflects saved values immediately
      setReview(prev => prev.service_policies ? {
        ...prev,
        service_policies: {
          ...prev.service_policies,
          face_amount:           num(policyEdit.face_amount),
          death_benefit_amount:  num(policyEdit.death_benefit_amount),
          cash_value_amount:     num(policyEdit.cash_value_amount),
          cash_value_as_of_date: policyEdit.cash_value_as_of_date || null,
          cost_basis:            num(policyEdit.cost_basis),
          annual_premium:        num(policyEdit.annual_premium),
          premium_mode:          policyEdit.premium_mode          || null,
          rate_class:            policyEdit.rate_class.trim()     || null,
          riders:                policyEdit.riders.trim()         || null,
          primary_beneficiary:   policyEdit.primary_beneficiary.trim() || null,
        },
      } : prev)
      setPolicySaved(true)
      setPolicyEditing(false)
      setTimeout(() => setPolicySaved(false), 2500)
      router.refresh()
    } catch { setPolicyError('Network error') }
    finally { setPolicySaving(false) }
  }

  // ── Build prep data ─────────────────────────────────────────────────────
  const policyForPrep: PolicyForPrep | null = policy ? {
    client_name:           policy.client_name,
    policy_number:         policy.policy_number,
    carrier:               policy.carrier,
    product_type:          policy.product_type,
    issue_date:            policy.issue_date,
    term_length:           policy.term_length,
    face_amount:           policy.face_amount,
    death_benefit_amount:  policy.death_benefit_amount,
    cash_value_amount:     policy.cash_value_amount,
    cost_basis:            policy.cost_basis,
    annual_premium:        policy.annual_premium,
    premium_mode:          policy.premium_mode,
    rate_class:            policy.rate_class,
    riders:                policy.riders,
    insured_first_name:    policy.insured_first_name,
    insured_last_name:     policy.insured_last_name,
    primary_beneficiary:   policy.primary_beneficiary,
  } : null

  const script    = policyForPrep ? generateCallScript(policyForPrep) : null
  const flags     = policyForPrep ? generateFlags(policyForPrep) : []
  const revType   = getReviewType(policy?.product_type ?? null)
  const typeLabel = reviewTypeLabel(revType)

  const isTobaccoFlag = flags.some(f => f.label.includes('Tobacco'))

  // ── Copy script ─────────────────────────────────────────────────────────
  async function copyScript() {
    if (!script) return
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // ── Save right panel ────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch(`/api/policy-reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to:                  assignedTo  || null,
          status,
          outcome:                      outcome     || null,
          tobacco_asked:                tobaccoAsked,
          still_using_tobacco:          stillUsing,
          tobacco_product:              tobaccoProduct.trim() || null,
          primary_beneficiary_confirmed: beneConfirmed.trim() || null,
          prep_notes:                   prepNotes.trim() || null,
          call_completed_at:            callCompletedAt || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to save'); return }
      setReview(prev => ({ ...prev, ...json.data }))
      setStatus(json.data.status)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  // ── Log outcome shortcut ────────────────────────────────────────────────
  async function logOutcome(outcomeValue: string) {
    const newStatus = outcomeValue === 'no_contact' ? 'no_contact' : 'complete'
    setOutcome(outcomeValue)
    setStatus(newStatus)
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/policy-reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: outcomeValue,
          status:  newStatus,
          assigned_to: assignedTo || null,
          tobacco_asked: tobaccoAsked,
          still_using_tobacco: stillUsing,
          tobacco_product: tobaccoProduct.trim() || null,
          primary_beneficiary_confirmed: beneConfirmed.trim() || null,
          prep_notes: prepNotes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to log outcome'); return }
      setReview(prev => ({ ...prev, ...json.data }))
      router.refresh()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => router.push('/reviews')}
              className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Reviews
            </button>
            {total > 0 && (
              <div className="flex items-center gap-1">
                <button onClick={() => router.push(`/reviews/${prevId}`)} disabled={!prevId}
                  className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-500 tabular-nums w-16 text-center">{position} / {total}</span>
                <button onClick={() => router.push(`/reviews/${nextId}`)} disabled={!nextId}
                  className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-2.5">
            <h1 className="text-white text-2xl font-semibold">
              {review.review_number ?? 'Policy Review'}
            </h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS.prep}`}>
              {STATUS_LABELS[status] ?? status}
            </span>
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
              {typeLabel}
            </span>
            {isTobaccoFlag && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <AlertTriangle className="w-3 h-3" />
                Tobacco
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {policy?.client_name ?? '—'}
            {policy?.policy_number && <span className="text-slate-600"> · {policy.policy_number}</span>}
            {policy?.carrier && <span className="text-slate-600"> · {policy.carrier}</span>}
          </p>
        </div>
      </div>

      {/* ── Body: two-column ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* ── Left: Flags + Script + Snapshot (2/3 wide) ────────────────── */}
        <div className="xl:col-span-2 space-y-5">

          {/* Flags */}
          {flags.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-slate-500" />
                Talking Points
                <span className="text-xs font-normal text-slate-500">({flags.length})</span>
              </h2>
              <div className="space-y-2.5">
                {flags.map((f, i) => <FlagCard key={i} flag={f} />)}
              </div>
            </div>
          )}

          {/* Call Script */}
          {script && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-500" />
                  Call Script
                </h2>
                <button
                  onClick={copyScript}
                  className={`inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border transition-colors ${
                    copied
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="bg-slate-950/60 rounded-lg border border-slate-800 p-4 overflow-auto max-h-[520px]">
                <pre className="text-sm text-slate-200 font-sans whitespace-pre-wrap leading-relaxed">
                  {script.split('\n').map((line, i) => {
                    // Style pause markers
                    if (line.includes('— PAUSE —') || line.includes('— LISTEN —') || line.includes('— CONFIRM —')) {
                      return (
                        <span key={i} className="block text-blue-400 font-medium my-1">{line}</span>
                      )
                    }
                    // Style bracketed cues
                    if (line.startsWith('[') && line.endsWith(']')) {
                      return (
                        <span key={i} className="block text-slate-500 italic text-xs my-1">{line}</span>
                      )
                    }
                    return <span key={i} className="block">{line}</span>
                  })}
                </pre>
              </div>
            </div>
          )}

          {/* Policy Snapshot */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                Policy Snapshot
              </h2>
              {policy != null && (
                policyEditing ? (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setPolicyEditing(false); setPolicyError(null) }}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSavePolicyEdit}
                      disabled={policySaving}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                    >
                      <Save className="w-3 h-3" />
                      {policySaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setPolicyEditing(true)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                )
              )}
            </div>

            {policyEditing ? (
              <div className="space-y-3">
                {/* Structural fields — read-only in edit mode */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 pb-3 border-b border-slate-800">
                  <Row label="Client"       value={policy?.client_name ?? '—'} />
                  <Row label="Policy #"     value={policy?.policy_number ?? '—'} mono />
                  <Row label="Carrier"      value={policy?.carrier ?? '—'} />
                  <Row label="Product Type" value={policy?.product_type ?? '—'} />
                  <Row label="Issue Date"   value={fmt(policy?.issue_date ?? null)} />
                  {policy?.term_length && <Row label="Term" value={policy.term_length} />}
                </div>

                {/* Editable financial / detail fields */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Face Amount ($)',        key: 'face_amount'          },
                    { label: 'Death Benefit ($)',      key: 'death_benefit_amount' },
                    { label: 'Cash / Surrender Value ($)', key: 'cash_value_amount' },
                    { label: 'Cost Basis ($)',         key: 'cost_basis'           },
                    { label: 'Annual Premium ($)',     key: 'annual_premium'       },
                  ].map(({ label, key }) => (
                    <div key={key}>
                      <label className="block text-xs text-slate-500 mb-1">{label}</label>
                      <input
                        type="text" inputMode="decimal"
                        value={policyEdit[key as keyof typeof policyEdit]}
                        onChange={pef(key as keyof typeof policyEdit)}
                        placeholder="—"
                        className={inputCls}
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">CSV As of Date</label>
                    <input type="date" value={policyEdit.cash_value_as_of_date}
                      onChange={pef('cash_value_as_of_date')} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Premium Mode</label>
                    <select value={policyEdit.premium_mode} onChange={pef('premium_mode')} className={inputCls}>
                      <option value="">—</option>
                      {['Annual','Semi-Annual','Quarterly','Monthly','EFT Monthly'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Rate Class</label>
                    <input type="text" value={policyEdit.rate_class}
                      onChange={pef('rate_class')} placeholder="e.g. Preferred Plus" className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Riders</label>
                  <input type="text" value={policyEdit.riders}
                    onChange={pef('riders')} placeholder="e.g. WAIVER, CLTR" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Primary Beneficiary (on file)</label>
                  <input type="text" value={policyEdit.primary_beneficiary}
                    onChange={pef('primary_beneficiary')} placeholder="e.g. Jane Doe (spouse)" className={inputCls} />
                </div>
                {policyError  && <p className="text-xs text-red-400">{policyError}</p>}
                {policySaved  && <p className="text-xs text-emerald-400">Saved ✓</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                <Row label="Client"       value={policy?.client_name ?? '—'} />
                <Row label="Policy #"     value={policy?.policy_number ?? '—'} mono />
                <Row label="Carrier"      value={policy?.carrier ?? '—'} />
                <Row label="Product Type" value={policy?.product_type ?? '—'} />
                <Row label="Issue Date"   value={fmt(policy?.issue_date ?? null)} />
                {policy?.term_length && <Row label="Term"        value={policy.term_length} />}
                <Row label="Rate Class"   value={policy?.rate_class ?? '—'} />
                <Row label="Face Amount"  value={fmtCurrency(policy?.face_amount)} />
                {policy?.death_benefit_amount != null && policy.death_benefit_amount !== policy.face_amount && (
                  <Row label="Death Benefit" value={fmtCurrency(policy.death_benefit_amount)} />
                )}
                {policy?.cash_value_amount != null && (
                  <Row
                    label={policy.cash_value_as_of_date ? `Cash Value (as of ${fmt(policy.cash_value_as_of_date)})` : 'Cash Value'}
                    value={fmtCurrency(policy.cash_value_amount)}
                  />
                )}
                {policy?.cost_basis != null && (
                  <Row label="Cost Basis" value={fmtCurrency(policy.cost_basis)} />
                )}
                <Row label="Annual Premium" value={fmtCurrency(policy?.annual_premium)} />
                {policy?.premium_mode && <Row label="Mode" value={policy.premium_mode} />}
                {policy?.riders && <Row label="Riders" value={policy.riders} span />}
                {policy?.primary_beneficiary && (
                  <Row label="Primary Bene (file)" value={policy.primary_beneficiary} span />
                )}
                {policy?.agencies && (
                  <Row label="Agency" value={policy.agencies.display_name ?? policy.agencies.name} />
                )}
                {policy?.agents && (
                  <Row label="LSP" value={`${policy.agents.first_name} ${policy.agents.last_name}`} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Assignment + Outcome + Tobacco (1/3 wide) ──────────── */}
        <div className="space-y-5">

          {/* Assignment & Status */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Assignment</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Assigned To</label>
                <select
                  className={selectCls}
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {producers.map(p => (
                    <option key={p.id} value={`${p.first_name} ${p.last_name}`}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
                <select
                  className={selectCls}
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                >
                  <option value="prep">Prep</option>
                  <option value="complete">Complete</option>
                  <option value="no_contact">No Contact</option>
                </select>
              </div>
            </div>
          </div>

          {/* Outcome — the 30-second post-call log */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1">Outcome</h2>
            <p className="text-xs text-slate-500 mb-3">Log in ~30 seconds after the call ends.</p>
            <div className="grid grid-cols-1 gap-2">
              {OUTCOME_CONFIG.map(cfg => (
                <button
                  key={cfg.value}
                  onClick={() => logOutcome(cfg.value)}
                  className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium border text-left transition-colors ${
                    outcome === cfg.value
                      ? cfg.bg + ' ' + cfg.color
                      : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {outcome === cfg.value && (
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                  )}
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tobacco Section */}
          <div className={`bg-slate-900 border rounded-xl p-5 ${
            isTobaccoFlag ? 'border-amber-500/30' : 'border-slate-800'
          }`}>
            <h2 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
              isTobaccoFlag ? 'text-amber-400' : 'text-white'
            }`}>
              {isTobaccoFlag && <AlertTriangle className="w-4 h-4" />}
              Tobacco Reclassification
            </h2>

            <div className="space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-600 bg-slate-800 focus:ring-0"
                  checked={tobaccoAsked}
                  onChange={e => setTobaccoAsked(e.target.checked)}
                />
                <span className="text-sm text-slate-300">Asked about tobacco use</span>
              </label>

              {tobaccoAsked && (
                <>
                  <div>
                    <p className="text-xs font-medium text-slate-400 mb-2">Still using?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setStillUsing(true)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          stillUsing === true
                            ? 'bg-red-500/15 border-red-500 text-red-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setStillUsing(false)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          stillUsing === false
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Product (if applicable)
                    </label>
                    <input
                      type="text"
                      className={inputCls}
                      placeholder="e.g. Cigars only, Patches, None"
                      value={tobaccoProduct}
                      onChange={e => setTobaccoProduct(e.target.value)}
                    />
                  </div>
                  {stillUsing === false && (
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <p className="text-xs text-emerald-400 font-medium">
                        🎯 Reclassification opportunity — Lincoln counts only cigarettes/vape as tobacco.
                        Pull a non-tobacco quote from Lincoln.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Beneficiary Confirmation */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Beneficiary Confirmed</h2>
            <p className="text-xs text-slate-500 mb-2">
              {policy?.primary_beneficiary
                ? `On file: ${policy.primary_beneficiary}`
                : 'Not on file — confirm verbally on the call.'}
            </p>
            <input
              type="text"
              className={inputCls}
              placeholder="Confirmed name(s) on call…"
              value={beneConfirmed}
              onChange={e => setBeneConfirmed(e.target.value)}
            />
          </div>

          {/* Prep Notes */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Prep Notes</h2>
              <button
                onClick={() => { navigator.clipboard.writeText(fmtEagentNote(prepNotes)); setNotesCopied(true); setTimeout(() => setNotesCopied(false), 2000) }}
                disabled={!prepNotes.trim()}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-default transition-colors"
              >
                {notesCopied ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied!</span></> : <><Copy className="w-3 h-3" />Copy for eAgent</>}
              </button>
            </div>
            <textarea
              rows={4}
              className={inputCls}
              placeholder="Anything to note before or after the call — context, follow-up items, client tone…"
              value={prepNotes}
              onChange={e => setPrepNotes(e.target.value)}
            />
          </div>

          {/* Save */}
          {error  && <p className="text-xs text-red-400 px-1">{error}</p>}
          {saved  && <p className="text-xs text-emerald-400 px-1">Saved ✓</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save Review'}
          </button>

          {/* Print client summary */}
          <a
            href={`/api/reviews/${review.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-slate-300 border border-slate-700 hover:bg-slate-800 transition-colors"
          >
            🖨 Print Client Summary
          </a>

          {/* Create linked Service Request */}
          {policy?.id && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Create Service Request
              </h2>
              <p className="text-xs text-slate-500">
                Found something that needs action? Log an SR directly from this review.
              </p>
              <div>
                <select
                  value={srRequestType}
                  onChange={e => setSrRequestType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
                >
                  <option value="">Select request type…</option>
                  {['Beneficiary Change','Banking / EFT Change','Face Amount Change',
                    'Policy Loan / Withdrawal','Policy Surrender','Policy Document Request',
                    'Payment / Reinstatement','Coverage / Status Question','Other',
                  ].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {srError && <p className="text-xs text-red-400">{srError}</p>}
              <button
                onClick={handleCreateSr}
                disabled={srCreating || !srRequestType}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium text-white bg-amber-700 hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {srCreating ? 'Creating…' : 'Create Service Request →'}
              </button>
            </div>
          )}

          {/* Record info */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide">Record Info</h2>
              {!editingRecordDate ? (
                <button
                  onClick={() => setEditingRecordDate(true)}
                  className="inline-flex items-center gap-1 text-xs rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              ) : (
                <button
                  onClick={() => setEditingRecordDate(false)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Done
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <Row label="Review #" value={review.review_number ?? '—'} mono />
              <Row label="Queued"   value={fmt(review.created_at)} />
              {editingRecordDate ? (
                <div className="flex items-center justify-between gap-3 text-sm py-0.5">
                  <span className="text-slate-500 shrink-0">Completed</span>
                  <input
                    type="date"
                    value={callCompletedAt}
                    onChange={e => setCallCompletedAt(e.target.value)}
                    className="bg-slate-800 border border-slate-600 text-slate-100 text-xs rounded-md px-2 py-1 focus:outline-none focus:border-slate-500"
                  />
                </div>
              ) : (
                callCompletedAt
                  ? <Row label="Completed" value={fmt(callCompletedAt)} />
                  : <p className="text-xs text-slate-600 italic">No completion date set</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Row helper ────────────────────────────────────────────────────────────────
function Row({
  label, value, mono, span,
}: {
  label: string
  value: string
  mono?: boolean
  span?: boolean
}) {
  return (
    <div className={`flex items-start justify-between gap-3 text-sm py-0.5 ${span ? 'col-span-2' : ''}`}>
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs text-slate-300' : 'text-slate-200'}`}>
        {value}
      </span>
    </div>
  )
}
