'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Circle, AlertCircle, CheckCircle2 } from 'lucide-react'
import type {
  CaseDetail,
  StageLookup,
  AgencyLookup,
  ProductLookup,
  RateClassLookup,
  PremiumModeLookup,
  LostReasonLookup,
  SnoozeReasonLookup,
  PendingRequirementLookup,
} from './page'

function tierBadgeClass(st: CaseDetail['stage_translations']): string {
  if (!st) return 'bg-slate-800 text-slate-400 border border-slate-700'
  if (st.is_won) return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (st.is_lost) return 'bg-slate-800/70 text-slate-400 border border-slate-700'
  if (st.is_snoozed) return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
  switch (st.tier) {
    case 1: return 'bg-blue-900/50 text-blue-300 border border-blue-800'
    case 2: return 'bg-indigo-900/50 text-indigo-300 border border-indigo-800'
    case 3: return 'bg-emerald-900/50 text-emerald-300 border border-emerald-800'
    default: return 'bg-slate-800 text-slate-400 border border-slate-700'
  }
}

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysInStatus(statusEnteredAt: string | null): number {
  if (!statusEnteredAt) return 0
  return Math.floor((Date.now() - new Date(statusEnteredAt).getTime()) / 86_400_000)
}

const LEAD_SOURCE_LABELS: Record<string, string> = {
  agency_referral: 'Agency Referral',
  allstate_web:    'Allstate.com',
  self_generated:  'Self Generated',
}

type Props = {
  caseData: CaseDetail
  stages: StageLookup[]
  agencies: AgencyLookup[]
  products: ProductLookup[]
  rateClasses: RateClassLookup[]
  premiumModes: PremiumModeLookup[]
  lostReasons: LostReasonLookup[]
  snoozeReasons: SnoozeReasonLookup[]
  pendingRequirements: PendingRequirementLookup[]
}

export default function CaseEditClient({
  caseData,
  stages,
  agencies,
  products,
  rateClasses,
  premiumModes,
  lostReasons,
  snoozeReasons,
}: Props) {
  const days = daysInStatus(caseData.status_entered_at)

  const [status, setStatus]               = useState(caseData.internal_status)
  const [agencyId, setAgencyId]           = useState(caseData.agency_id ?? '')
  const [productId, setProductId]         = useState(caseData.products?.id ?? '')
  const [faceAmount, setFaceAmount]       = useState(caseData.face_amount?.toString() ?? '')
  const [annualPremium, setAnnualPremium] = useState(caseData.annual_premium?.toString() ?? '')
  const [rateClassId, setRateClassId]     = useState(caseData.rate_classes?.id ?? '')
  const [premiumModeId, setPremiumModeId] = useState(caseData.premium_modes?.id ?? '')
  const [policyNumber, setPolicyNumber]   = useState(caseData.policy_number ?? '')
  const [appointmentDate, setAppointmentDate] = useState(
    caseData.appointment_date ? caseData.appointment_date.split('T')[0] : ''
  )
  const [notes, setNotes]                 = useState(caseData.notes ?? '')
  const [lostReasonId, setLostReasonId]   = useState(caseData.lost_reasons?.id ?? '')
  const [snoozeReasonId, setSnoozeReasonId] = useState(caseData.snooze_reasons?.id ?? '')

  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Three-state requirements: 'inactive' | 'outstanding' | 'resolved'
  type ReqState = 'inactive' | 'outstanding' | 'resolved'
  const [reqState, setReqState] = useState<Record<string, ReqState>>(() => {
    const map: Record<string, ReqState> = {}
    for (const req of caseData.case_pending_requirements) {
      map[req.pending_requirement_id] = req.resolved_at !== null ? 'resolved' : 'outstanding'
    }
    return map
  })
  const [reqUpdating, setReqUpdating] = useState<Record<string, boolean>>({})

  const selectedStage = stages.find(s => s.internal_status === status)
  const selectedTier  = selectedStage?.tier ?? caseData.stage_translations?.tier ?? 1
  const isLostStatus   = status === 'carrier_declined' || status === 'client_withdrew'
  const isSnoozedStatus = status === 'snoozed'

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const body: Record<string, unknown> = {
      internal_status: status,
      agency_id:       agencyId || null,
      product_id:      productId || null,
      face_amount:     faceAmount ? parseFloat(faceAmount) : null,
      annual_premium:  annualPremium ? parseFloat(annualPremium) : null,
      rate_class_id:   rateClassId || null,
      premium_mode_id: premiumModeId || null,
      policy_number:   policyNumber || null,
      notes:           notes || null,
    }

    if (selectedTier === 1) body.appointment_date = appointmentDate || null
    if (isLostStatus && lostReasonId) body.lost_reason_id = lostReasonId
    if (isSnoozedStatus && snoozeReasonId) body.snooze_reason_id = snoozeReasonId

    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError((err as { error?: string }).error ?? 'Failed to save')
      } else {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
    } catch {
      setSaveError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  async function handleRequirementCycle(reqId: string) {
    const current = reqState[reqId] ?? 'inactive'
    const next: ReqState =
      current === 'inactive'     ? 'outstanding' :
      current === 'outstanding'  ? 'resolved'    : 'inactive'

    setReqUpdating(prev => ({ ...prev, [reqId]: true }))
    try {
      let res: Response
      if (next === 'outstanding') {
        res = await fetch(`/api/cases/${caseData.id}/requirements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_requirement_id: reqId }),
        })
      } else if (next === 'resolved') {
        res = await fetch(`/api/cases/${caseData.id}/requirements`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_requirement_id: reqId, resolved: true }),
        })
      } else {
        res = await fetch(`/api/cases/${caseData.id}/requirements`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_requirement_id: reqId }),
        })
      }
      if (res.ok) setReqState(prev => ({ ...prev, [reqId]: next }))
    } catch {
      // silent — user can retry
    } finally {
      setReqUpdating(prev => ({ ...prev, [reqId]: false }))
    }
  }

  const stagesByTier: Record<number, StageLookup[]> = {}
  for (const s of stages) {
    if (!stagesByTier[s.tier]) stagesByTier[s.tier] = []
    stagesByTier[s.tier].push(s)
  }

  const tierLabels: Record<number, string> = {
    1: 'Tier 1 — Potential',
    2: 'Tier 2 — Commitment',
    3: 'Tier 3 — Execution',
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <Link
          href="/cases"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Cases
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-8">
          <div className="flex-1 min-w-0">
            <h1 className="text-white text-2xl font-semibold">
              {caseData.customers
                ? `${caseData.customers.first_name} ${caseData.customers.last_name}`
                : 'Unknown Client'}
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {caseData.agencies?.name ?? <span className="text-amber-400">Unassigned</span>}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-medium ${tierBadgeClass(caseData.stage_translations)}`}>
              {caseData.stage_translations?.agency_label ?? caseData.internal_status}
            </span>
            <span className="text-slate-400 text-sm">
              {days} day{days !== 1 ? 's' : ''} in status
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left — edit form */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-white font-semibold mb-5">Case Details</h2>
            <div className="space-y-4">

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                >
                  {Object.entries(stagesByTier).map(([tier, group]) => (
                    <optgroup key={tier} label={tierLabels[parseInt(tier)] ?? `Tier ${tier}`}>
                      {group.map(s => (
                        <option key={s.internal_status} value={s.internal_status}>
                          {s.agency_label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {isLostStatus && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Lost Reason</label>
                  <select
                    value={lostReasonId}
                    onChange={e => setLostReasonId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                  >
                    <option value="">— select reason —</option>
                    {lostReasons.map(r => (
                      <option key={r.id} value={r.id}>{r.agency_label}</option>
                    ))}
                  </select>
                </div>
              )}

              {isSnoozedStatus && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Snooze Reason</label>
                  <select
                    value={snoozeReasonId}
                    onChange={e => setSnoozeReasonId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                  >
                    <option value="">— select reason —</option>
                    {snoozeReasons.map(r => (
                      <option key={r.id} value={r.id}>{r.agency_label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Agency</label>
                <select
                  value={agencyId}
                  onChange={e => setAgencyId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                >
                  <option value="">Unassigned</option>
                  {agencies.map(a => (
                    <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Product</label>
                <select
                  value={productId}
                  onChange={e => setProductId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                >
                  <option value="">— none —</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.carriers?.short_name ? `${p.carriers.short_name} · ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Face Amount</label>
                  <input
                    type="number" min="0" step="1000"
                    value={faceAmount}
                    onChange={e => setFaceAmount(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Annual Premium</label>
                  <input
                    type="number" min="0" step="1"
                    value={annualPremium}
                    onChange={e => setAnnualPremium(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Rate Class</label>
                  <select
                    value={rateClassId}
                    onChange={e => setRateClassId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                  >
                    <option value="">— none —</option>
                    {rateClasses.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Premium Mode</label>
                  <select
                    value={premiumModeId}
                    onChange={e => setPremiumModeId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                  >
                    <option value="">— none —</option>
                    {premiumModes.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Policy Number</label>
                <input
                  type="text"
                  value={policyNumber}
                  onChange={e => setPolicyNumber(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600"
                />
              </div>

              {selectedTier === 1 && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Appointment Date</label>
                  <input
                    type="date"
                    value={appointmentDate}
                    onChange={e => setAppointmentDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Internal notes…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 text-white text-sm px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-y"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#1F3864' }}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                {saveSuccess && (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                    <Check className="w-4 h-4" /> Saved
                  </span>
                )}
                {saveError && (
                  <span className="text-sm text-red-400">{saveError}</span>
                )}
              </div>
            </div>
          </div>

          {/* Right — client info + pending requirements */}
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-white font-semibold mb-4">Client Info</h2>
              <dl className="space-y-2">
                {caseData.customers?.email && (
                  <div className="flex justify-between">
                    <dt className="text-xs text-slate-500">Email</dt>
                    <dd className="text-sm text-slate-300">{caseData.customers.email}</dd>
                  </div>
                )}
                {caseData.customers?.phone && (
                  <div className="flex justify-between">
                    <dt className="text-xs text-slate-500">Phone</dt>
                    <dd className="text-sm text-slate-300">{caseData.customers.phone}</dd>
                  </div>
                )}
                {caseData.customers?.date_of_birth && (
                  <div className="flex justify-between">
                    <dt className="text-xs text-slate-500">Date of Birth</dt>
                    <dd className="text-sm text-slate-300">{formatDate(caseData.customers.date_of_birth)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-xs text-slate-500">Lead Source</dt>
                  <dd className="text-sm text-slate-300">
                    {caseData.lead_source ? (LEAD_SOURCE_LABELS[caseData.lead_source] ?? caseData.lead_source) : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-slate-500">Referring Agent</dt>
                  <dd className="text-sm text-slate-300">
                    {caseData.agents ? `${caseData.agents.first_name} ${caseData.agents.last_name}` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-slate-500">Submitted</dt>
                  <dd className="text-sm text-slate-300">{formatDate(caseData.created_at)}</dd>
                </div>
                {caseData.placed_at && (
                  <div className="flex justify-between">
                    <dt className="text-xs text-slate-500">Placed</dt>
                    <dd className="text-sm text-emerald-400">{formatDate(caseData.placed_at)}</dd>
                  </div>
                )}
                {caseData.face_amount !== null && (
                  <div className="flex justify-between">
                    <dt className="text-xs text-slate-500">Face Amount</dt>
                    <dd className="text-sm text-slate-300">{formatCurrency(caseData.face_amount)}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">Requirements</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {(() => {
                    const outstanding = pendingRequirements.filter(r => (reqState[r.id] ?? 'inactive') === 'outstanding').length
                    return outstanding > 0
                      ? <span className="text-amber-400 font-medium">{outstanding} outstanding</span>
                      : <span className="text-emerald-400">All clear</span>
                  })()}
                </div>
              </div>
              <ul className="space-y-1">
                {pendingRequirements.map(req => {
                  const state   = reqState[req.id] ?? 'inactive'
                  const updating = reqUpdating[req.id] ?? false
                  return (
                    <li key={req.id}>
                      <button
                        onClick={() => handleRequirementCycle(req.id)}
                        disabled={updating}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-all disabled:opacity-50 ${
                          state === 'outstanding'
                            ? 'bg-amber-950/40 hover:bg-amber-950/60'
                            : state === 'resolved'
                            ? 'bg-emerald-950/30 hover:bg-emerald-950/50'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        {state === 'inactive'    && <Circle       className="w-4 h-4 shrink-0 text-slate-600" />}
                        {state === 'outstanding' && <AlertCircle  className="w-4 h-4 shrink-0 text-amber-400" />}
                        {state === 'resolved'    && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
                        <span className={`text-sm ${
                          state === 'outstanding' ? 'text-amber-200 font-medium' :
                          state === 'resolved'    ? 'line-through text-slate-600' :
                          'text-slate-500'
                        }`}>
                          {req.name}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-slate-600 mt-3 px-1">Click to cycle: inactive → outstanding → resolved → inactive</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
