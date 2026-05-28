'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, CheckCircle2, XCircle, AlertCircle, Save, Pencil } from 'lucide-react'
import type { ServiceRequestDetail, AgencyOption, AgentOption } from './page'
import { fmtDate as fmt } from '@/lib/fmt'

// ── Constants ─────────────────────────────────────────────────────────────────

const WORKFLOW_STEPS: { key: string; label: string }[] = [
  { key: 'open',                 label: 'Open'                 },
  { key: 'sa_form_sent',         label: 'SA Form Sent'         },
  { key: 'form_sent_to_client',  label: 'Form → Client'        },
  { key: 'form_sent_to_carrier', label: 'Form → Carrier'       },
  { key: 'resolved',             label: 'Resolved'             },
]

const WORKFLOW_COLORS: Record<string, string> = {
  open:                  'text-blue-400 bg-blue-400/10 border border-blue-400/20',
  sa_form_sent:          'text-yellow-400 bg-yellow-400/10 border border-yellow-400/20',
  form_sent_to_client:   'text-orange-400 bg-orange-400/10 border border-orange-400/20',
  form_sent_to_carrier:  'text-purple-400 bg-purple-400/10 border border-purple-400/20',
  resolved:              'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
  cannot_service:        'text-slate-500 bg-slate-500/10 border border-slate-500/20',
}

const SA_LABELS: Record<string, string> = {
  unknown:     'Unknown',
  confirmed:   'Confirmed — We are SA',
  not_on_file: 'Not on File',
}

const REQUEST_TYPES = [
  'Billing Issue', 'Change Payment Info', 'Beneficiary Change',
  'Statement of Insurance', 'Address Update', 'Lapse / Reinstatement',
  'Claims Assistance', 'General Coverage Question', 'Policy Review', 'Policy Surrender', 'Other',
]

const CARRIERS = [
  'Corebridge', 'Everlake Assurance', 'Everlake Life',
  'Foresters', 'Gerber Life', 'John Hancock',
  'Lincoln Benefit Life', 'Lincoln Financial', 'Protective', 'Prudential',
  'Other',
]

const PRODUCT_TYPES = [
  'Term Life', 'Whole Life', 'Universal Life', 'Variable Universal Life',
  'Indexed Universal Life', 'Final Expense', 'Other',
]

const PREMIUM_MODES = ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly', 'EFT Monthly']

const RATE_CLASSES = [
  'Preferred Plus', 'Preferred', 'Standard Plus', 'Standard',
  'Table 2', 'Table 4', 'Table 6', 'Table 8',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(val)
}

const inputCls  = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500 placeholder-slate-500'
const selectCls = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ServiceRequestClient({
  sr: initialSr,
  agencies,
  agents,
}: {
  sr:       ServiceRequestDetail
  agencies: AgencyOption[]
  agents:   AgentOption[]
}) {
  const router = useRouter()

  // ── SR local state ──────────────────────────────────────────────────────
  const [sr,            setSr]           = useState(initialSr)
  const policy = sr.service_policies

  const [workflowStatus, setWorkflowStatus] = useState(sr.workflow_status)
  const [requestType,    setRequestType]    = useState(sr.request_type)
  const [dateReceived,   setDateReceived]   = useState(sr.date_received)
  const [dateResolved,   setDateResolved]   = useState(sr.date_resolved ?? '')
  const [srNotes,        setSrNotes]        = useState(sr.notes ?? '')
  const [srSaving,       setSrSaving]       = useState(false)
  const [srError,        setSrError]        = useState<string | null>(null)
  const [srSaved,        setSrSaved]        = useState(false)

  // ── Record Info date editing ────────────────────────────────────────────
  const [editingDates,  setEditingDates]  = useState(false)
  const [datesSaving,   setDatesSaving]   = useState(false)
  const [datesError,    setDatesError]    = useState<string | null>(null)
  const [datesSaved,    setDatesSaved]    = useState(false)

  // ── Policy local state ──────────────────────────────────────────────────
  const [editingPolicy, setEditingPolicy]   = useState(false)
  const [clientName,    setClientName]      = useState(policy?.client_name ?? '')
  const [policyNumber,  setPolicyNumber]    = useState(policy?.policy_number ?? '')
  const [carrier,       setCarrier]         = useState(policy?.carrier ?? '')
  const [productType,   setProductType]     = useState(policy?.product_type ?? '')
  const [issueDate,     setIssueDate]       = useState(policy?.issue_date ?? '')
  const [termLength,    setTermLength]      = useState(policy?.term_length ?? '')
  const [faceAmount,    setFaceAmount]      = useState(policy?.face_amount != null ? String(policy.face_amount) : '')
  const [annualPremium, setAnnualPremium]   = useState(policy?.annual_premium != null ? String(policy.annual_premium) : '')
  const [premiumMode,   setPremiumMode]     = useState(policy?.premium_mode ?? '')
  const [rateClass,     setRateClass]       = useState(policy?.rate_class ?? '')
  const [saStatus,      setSaStatus]        = useState(policy?.sa_status ?? 'unknown')
  const [agencyId,      setAgencyId]        = useState(policy?.agency_id ?? '')
  const [agentId,       setAgentId]         = useState(policy?.agent_id ?? '')
  const [policyNotes,   setPolicyNotes]     = useState(policy?.notes ?? '')
  const [policySaving,  setPolicySaving]    = useState(false)
  const [policyError,   setPolicyError]     = useState<string | null>(null)
  const [policySaved,   setPolicySaved]     = useState(false)

  // Filtered agents
  const filteredAgents = useMemo(() => {
    if (!agencyId) return agents
    return agents.filter(a => a.agency_id === agencyId)
  }, [agents, agencyId])

  // ── Advance workflow ────────────────────────────────────────────────────
  async function advanceWorkflow(newStatus: string) {
    setSrError(null)
    const patch: Record<string, string | null> = { workflow_status: newStatus }
    if (newStatus === 'resolved' && !dateResolved) {
      patch.date_resolved = new Date().toISOString().split('T')[0]
    }

    const res = await fetch(`/api/service-requests/${sr.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const json = await res.json()
    if (!res.ok) { setSrError(json.error ?? 'Failed to update'); return }

    setWorkflowStatus(newStatus)
    if (patch.date_resolved) setDateResolved(patch.date_resolved)
    setSr(prev => ({ ...prev, workflow_status: newStatus }))
  }

  // ── Save SR notes / dates ───────────────────────────────────────────────
  async function handleSaveSr() {
    setSrSaving(true); setSrError(null); setSrSaved(false)
    try {
      const res = await fetch(`/api/service-requests/${sr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type:  requestType,
          date_received: dateReceived || null,
          date_resolved: dateResolved || null,
          notes:         srNotes.trim() || null,
          workflow_status: workflowStatus,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setSrError(json.error ?? 'Failed to save'); return }
      setSrSaved(true)
      setTimeout(() => setSrSaved(false), 2500)
    } catch { setSrError('Network error') }
    finally { setSrSaving(false) }
  }

  // ── Save Record Info dates only ─────────────────────────────────────────
  async function handleSaveDates() {
    setDatesSaving(true); setDatesError(null); setDatesSaved(false)
    try {
      const res = await fetch(`/api/service-requests/${sr.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_received: dateReceived || null,
          date_resolved: dateResolved || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setDatesError(json.error ?? 'Failed to save'); return }
      setDatesSaved(true)
      setEditingDates(false)
      setTimeout(() => setDatesSaved(false), 2500)
    } catch { setDatesError('Network error') }
    finally { setDatesSaving(false) }
  }

  // ── Save policy ─────────────────────────────────────────────────────────
  async function handleSavePolicy() {
    if (!policy) return
    setPolicySaving(true); setPolicyError(null); setPolicySaved(false)
    try {
      const res = await fetch(`/api/service-policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name:    clientName.trim() || null,
          policy_number:  policyNumber.trim() || null,
          carrier:        carrier || null,
          product_type:   productType || null,
          issue_date:     issueDate || null,
          term_length:    termLength.trim() || null,
          face_amount:    faceAmount    ? parseFloat(faceAmount)    : null,
          annual_premium: annualPremium ? parseFloat(annualPremium) : null,
          premium_mode:   premiumMode || null,
          rate_class:     rateClass || null,
          sa_status:      saStatus,
          agency_id:      agencyId || null,
          agent_id:       agentId || null,
          notes:          policyNotes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setPolicyError(json.error ?? 'Failed to save'); return }
      setPolicySaved(true)
      setEditingPolicy(false)
      setTimeout(() => setPolicySaved(false), 2500)
      router.refresh()
    } catch { setPolicyError('Network error') }
    finally { setPolicySaving(false) }
  }

  // ── Cannot service shortcut ─────────────────────────────────────────────
  async function markCannotService() {
    if (!confirm('Mark this request as Cannot Service?')) return
    await advanceWorkflow('cannot_service')
  }

  const isClosed = workflowStatus === 'resolved' || workflowStatus === 'cannot_service'

  // Current step index
  const stepIdx = WORKFLOW_STEPS.findIndex(s => s.key === workflowStatus)

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push('/service')}
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-3"
          >
            <ChevronLeft className="w-4 h-4" /> Service
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-white text-2xl font-semibold">
              {sr.sr_number ?? 'Service Request'}
            </h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${WORKFLOW_COLORS[workflowStatus] ?? WORKFLOW_COLORS.open}`}>
              {workflowStatus === 'cannot_service' ? 'Cannot Service' : WORKFLOW_STEPS.find(s => s.key === workflowStatus)?.label ?? workflowStatus}
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-0.5">
            {policy?.client_name ?? '—'} · {policy?.policy_number ?? '—'} · {policy?.carrier ?? '—'}
          </p>
        </div>
      </div>

      {/* ── Workflow Progress ────────────────────────────────────────────── */}
      {!isClosed && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Workflow Progress</h2>
          <div className="flex items-center gap-0 mb-4 overflow-x-auto pb-1">
            {WORKFLOW_STEPS.map((step, i) => {
              const done    = i < stepIdx
              const current = i === stepIdx
              const next    = i === stepIdx + 1
              return (
                <div key={step.key} className="flex items-center min-w-0">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${
                      done    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' :
                      current ? 'border-blue-500 bg-blue-500/20 text-blue-400' :
                                'border-slate-700 bg-slate-800 text-slate-600'
                    }`}>
                      {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-xs font-bold">{i + 1}</span>}
                    </div>
                    <span className={`text-xs mt-1.5 whitespace-nowrap ${
                      current ? 'text-white font-medium' : done ? 'text-emerald-400' : 'text-slate-600'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                  {i < WORKFLOW_STEPS.length - 1 && (
                    <div className={`h-0.5 w-8 mx-1 shrink-0 mt-[-14px] ${i < stepIdx ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Next step button */}
          {stepIdx < WORKFLOW_STEPS.length - 1 && (
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => advanceWorkflow(WORKFLOW_STEPS[stepIdx + 1].key)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1F3864' }}
              >
                Advance to: {WORKFLOW_STEPS[stepIdx + 1].label} →
              </button>
              <button
                onClick={markCannotService}
                className="px-4 py-2 rounded-lg text-sm font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition-colors"
              >
                Cannot Service
              </button>
            </div>
          )}
        </div>
      )}

      {/* Closed banner */}
      {isClosed && (
        <div className={`rounded-xl p-4 border flex items-center gap-3 ${
          workflowStatus === 'resolved'
            ? 'bg-emerald-400/5 border-emerald-400/20'
            : 'bg-slate-800 border-slate-700'
        }`}>
          {workflowStatus === 'resolved'
            ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            : <XCircle className="w-5 h-5 text-slate-500 shrink-0" />}
          <div className="flex-1">
            <p className={`text-sm font-medium ${workflowStatus === 'resolved' ? 'text-emerald-400' : 'text-slate-400'}`}>
              {workflowStatus === 'resolved' ? 'Resolved' : 'Cannot Service'}
            </p>
            {dateResolved && <p className="text-xs text-slate-500 mt-0.5">Closed {fmt(dateResolved)}</p>}
          </div>
          <button
            onClick={() => advanceWorkflow('open')}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Reopen
          </button>
        </div>
      )}

      {/* ── Two-column layout ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Left: Policy Card ────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Policy Information</h2>
            {!editingPolicy && (
              <button
                onClick={() => setEditingPolicy(true)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            )}
          </div>

          {/* SA Status — always prominent */}
          <div className="mb-4 p-3 rounded-lg bg-slate-800 border border-slate-700">
            <p className="text-xs font-medium text-slate-400 mb-2">Servicing Agent Status</p>
            <div className="flex gap-2 flex-wrap">
              {(['unknown', 'confirmed', 'not_on_file'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSaStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    saStatus === s
                      ? s === 'confirmed'    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      : s === 'not_on_file'  ? 'bg-red-500/20 border-red-500 text-red-300'
                      :                        'bg-slate-700 border-slate-500 text-slate-200'
                      : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                  }`}
                >
                  {s === 'unknown' && <AlertCircle className="w-3 h-3 inline mr-1" />}
                  {s === 'confirmed' && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                  {s === 'not_on_file' && <XCircle className="w-3 h-3 inline mr-1" />}
                  {SA_LABELS[s]}
                </button>
              ))}
            </div>
            {saStatus !== (policy?.sa_status ?? 'unknown') && (
              <button
                onClick={async () => {
                  if (!policy) return
                  const res = await fetch(`/api/service-policies/${policy.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sa_status: saStatus }),
                  })
                  if (res.ok) router.refresh()
                }}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Save SA status →
              </button>
            )}
          </div>

          {!editingPolicy ? (
            /* ── Read view ── */
            <div className="space-y-2.5">
              <Row label="Client"    value={policy?.client_name    ?? '—'} />
              <Row label="Policy #"  value={policy?.policy_number  ?? '—'} mono />
              <Row label="Carrier"   value={policy?.carrier        ?? '—'} />
              <Row label="Product"   value={policy?.product_type   ?? '—'} />
              <Row label="Issue Date" value={fmt(policy?.issue_date ?? null)} />
              <Row label="Term"      value={policy?.term_length    ?? '—'} />
              <Row label="Rate Class" value={policy?.rate_class    ?? '—'} />
              <Row label="Face Amount"    value={fmtCurrency(policy?.face_amount)} />
              <Row label="Annual Premium" value={fmtCurrency(policy?.annual_premium)} />
              <Row label="Premium Mode"   value={policy?.premium_mode ?? '—'} />
              {policy?.agencies && (
                <Row label="Agency" value={policy.agencies.display_name ?? policy.agencies.name} />
              )}
              {policy?.agents && (
                <Row label="LSP" value={`${policy.agents.first_name} ${policy.agents.last_name}`} />
              )}
              {policy?.notes && (
                <div className="pt-1">
                  <p className="text-xs text-slate-500 mb-0.5">Notes</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{policy.notes}</p>
                </div>
              )}
              {policySaved && <p className="text-xs text-emerald-400">Saved ✓</p>}
            </div>
          ) : (
            /* ── Edit view ── */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client Name">
                  <input type="text" className={inputCls} value={clientName} onChange={e => setClientName(e.target.value)} />
                </Field>
                <Field label="Policy Number">
                  <input type="text" className={inputCls} value={policyNumber} onChange={e => setPolicyNumber(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Carrier">
                  <select className={selectCls} value={carrier} onChange={e => setCarrier(e.target.value)}>
                    <option value="">Select…</option>
                    {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Product Type">
                  <select className={selectCls} value={productType} onChange={e => setProductType(e.target.value)}>
                    <option value="">Select…</option>
                    {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Issue Date">
                  <input type="date" className={inputCls} value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                </Field>
                <Field label="Term Length">
                  <input type="text" className={inputCls} placeholder="e.g. 20 Year" value={termLength} onChange={e => setTermLength(e.target.value)} />
                </Field>
                <Field label="Rate Class">
                  <select className={selectCls} value={rateClass} onChange={e => setRateClass(e.target.value)}>
                    <option value="">Select…</option>
                    {RATE_CLASSES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Face Amount">
                  <input type="number" min="0" className={inputCls} value={faceAmount} onChange={e => setFaceAmount(e.target.value)} />
                </Field>
                <Field label="Annual Premium">
                  <input type="number" min="0" step="0.01" className={inputCls} value={annualPremium} onChange={e => setAnnualPremium(e.target.value)} />
                </Field>
                <Field label="Premium Mode">
                  <select className={selectCls} value={premiumMode} onChange={e => setPremiumMode(e.target.value)}>
                    <option value="">Select…</option>
                    {PREMIUM_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Agency">
                  <select className={selectCls} value={agencyId} onChange={e => { setAgencyId(e.target.value); setAgentId('') }}>
                    <option value="">No agency</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>)}
                  </select>
                </Field>
                <Field label="LSP / Agent">
                  <select className={selectCls} value={agentId} onChange={e => setAgentId(e.target.value)}>
                    <option value="">No agent</option>
                    {filteredAgents.map(a => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Policy Notes">
                <textarea rows={2} className={inputCls} value={policyNotes} onChange={e => setPolicyNotes(e.target.value)} />
              </Field>

              {policyError && <p className="text-xs text-red-400">{policyError}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSavePolicy}
                  disabled={policySaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#1F3864' }}
                >
                  <Save className="w-3.5 h-3.5" />
                  {policySaving ? 'Saving…' : 'Save Policy'}
                </button>
                <button
                  onClick={() => setEditingPolicy(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: SR Details ────────────────────────────────────────── */}
        <div className="space-y-5">

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Request Details</h2>
            <div className="space-y-3">
              <Field label="Request Type">
                <select
                  className={selectCls}
                  value={requestType}
                  onChange={e => setRequestType(e.target.value)}
                >
                  {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value={requestType}>{requestType}</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date Received">
                  <input
                    type="date"
                    className={inputCls}
                    value={dateReceived}
                    onChange={e => setDateReceived(e.target.value)}
                  />
                </Field>
                <Field label="Date Resolved">
                  <input
                    type="date"
                    className={inputCls}
                    value={dateResolved}
                    onChange={e => setDateResolved(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Workflow Status">
                <select
                  className={selectCls}
                  value={workflowStatus}
                  onChange={e => setWorkflowStatus(e.target.value)}
                >
                  {WORKFLOW_STEPS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  <option value="cannot_service">Cannot Service</option>
                </select>
              </Field>
              <Field label="Notes">
                <textarea
                  rows={4}
                  className={inputCls}
                  placeholder="What was requested? Steps taken, client contact, next steps…"
                  value={srNotes}
                  onChange={e => setSrNotes(e.target.value)}
                />
              </Field>

              {srError  && <p className="text-xs text-red-400">{srError}</p>}
              {srSaved  && <p className="text-xs text-emerald-400">Saved ✓</p>}

              <button
                onClick={handleSaveSr}
                disabled={srSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}
              >
                <Save className="w-3.5 h-3.5" />
                {srSaving ? 'Saving…' : 'Save Request'}
              </button>
            </div>
          </div>

          {/* ── Record Info ──────────────────────────────────────────── */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide">Record Info</h2>
              <button
                onClick={() => { setEditingDates(o => !o); setDatesError(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <Pencil className="w-3 h-3" /> {editingDates ? 'Cancel' : 'Edit dates'}
              </button>
            </div>

            <div className="space-y-1.5">
              <Row label="SR Number"  value={sr.sr_number ?? '—'} mono />
              <Row label="Created"    value={fmt(sr.created_at)} />
              <Row label="Updated"    value={fmt(sr.updated_at)} />
            </div>

            {editingDates ? (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Date Received</label>
                  <input
                    type="date"
                    value={dateReceived ?? ''}
                    onChange={e => setDateReceived(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Date Resolved</label>
                  <input
                    type="date"
                    value={dateResolved}
                    onChange={e => setDateResolved(e.target.value)}
                    className={inputCls}
                  />
                </div>
                {datesError && <p className="text-xs text-red-400">{datesError}</p>}
                {datesSaved  && <p className="text-xs text-emerald-400">Saved ✓</p>}
                <button
                  onClick={handleSaveDates}
                  disabled={datesSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#1F3864' }}
                >
                  <Save className="w-3 h-3" />
                  {datesSaving ? 'Saving…' : 'Save Dates'}
                </button>
              </div>
            ) : (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                <Row label="Date Received" value={dateReceived ? fmt(dateReceived) : '—'} />
                <Row label="Date Resolved" value={dateResolved ? fmt(dateResolved) : '—'} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Row helper ────────────────────────────────────────────────────────────────
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm py-0.5">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs text-slate-300' : 'text-slate-200'}`}>
        {value}
      </span>
    </div>
  )
}
