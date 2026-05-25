'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { AgencyOption, AgentOption } from './page'

const CARRIERS = [
  'Everlake Life',
  'Lincoln Benefit Life',
  'Prudential',
  'John Hancock',
  'Foresters',
  'Gerber Life',
  'Other',
]

const PRODUCT_TYPES = [
  'Term Life',
  'Whole Life',
  'Universal Life',
  'Variable Universal Life',
  'Indexed Universal Life',
  'Final Expense',
  'Other',
]

const PREMIUM_MODES = ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly', 'EFT Monthly']

const REQUEST_TYPES = [
  'Billing Issue',
  'Change Payment Info',
  'Beneficiary Change',
  'Statement of Insurance',
  'Address Update',
  'Lapse / Reinstatement',
  'Claims Assistance',
  'General Coverage Question',
  'Policy Review',
  'Other',
]

const RATE_CLASSES = [
  'Preferred Plus', 'Preferred', 'Standard Plus', 'Standard',
  'Table 2', 'Table 4', 'Table 6', 'Table 8',
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500 placeholder-slate-500'
const selectCls = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500'

// ── Component ──────────────────────────────────────────────────────────────────
export function NewServiceRequestClient({
  agencies,
  agents,
}: {
  agencies: AgencyOption[]
  agents:   AgentOption[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // Policy fields
  const [clientName,    setClientName]    = useState('')
  const [policyNumber,  setPolicyNumber]  = useState('')
  const [carrier,       setCarrier]       = useState('')
  const [carrierOther,  setCarrierOther]  = useState('')
  const [productType,   setProductType]   = useState('')
  const [issueDate,     setIssueDate]     = useState('')
  const [termLength,    setTermLength]    = useState('')
  const [faceAmount,    setFaceAmount]    = useState('')
  const [annualPremium, setAnnualPremium] = useState('')
  const [premiumMode,   setPremiumMode]   = useState('')
  const [rateClass,     setRateClass]     = useState('')
  const [agencyId,      setAgencyId]      = useState('')
  const [agentId,       setAgentId]       = useState('')
  const [policyNotes,   setPolicyNotes]   = useState('')

  // SR fields
  const [requestType,   setRequestType]   = useState('')
  const [requestTypeOther, setRequestTypeOther] = useState('')
  const [dateReceived,  setDateReceived]  = useState(
    new Date().toISOString().split('T')[0]
  )
  const [srNotes,       setSrNotes]       = useState('')

  // Filtered agents by selected agency
  const filteredAgents = useMemo(() => {
    if (!agencyId) return agents
    return agents.filter(a => a.agency_id === agencyId)
  }, [agents, agencyId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const resolvedCarrier = carrier === 'Other' ? carrierOther.trim() : carrier
    const resolvedType    = requestType === 'Other' ? requestTypeOther.trim() : requestType

    if (!clientName.trim())    { setError('Client name is required'); return }
    if (!policyNumber.trim())  { setError('Policy number is required'); return }
    if (!resolvedCarrier)      { setError('Carrier is required'); return }
    if (!resolvedType)         { setError('Request type is required'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type:  resolvedType,
          date_received: dateReceived || undefined,
          notes:         srNotes.trim() || null,
          new_policy: {
            client_name:    clientName.trim(),
            policy_number:  policyNumber.trim(),
            carrier:        resolvedCarrier,
            product_type:   productType || null,
            issue_date:     issueDate   || null,
            term_length:    termLength.trim()    || null,
            face_amount:    faceAmount    ? parseFloat(faceAmount)    : null,
            annual_premium: annualPremium ? parseFloat(annualPremium) : null,
            premium_mode:   premiumMode   || null,
            rate_class:     rateClass     || null,
            agency_id:      agencyId      || null,
            agent_id:       agentId       || null,
            notes:          policyNotes.trim() || null,
          },
        }),
      })

      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create'); return }

      router.push(`/service/${json.data.id}`)
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Policy Information ─────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Policy Information</h2>
        <div className="space-y-4">

          <div className="grid grid-cols-2 gap-4">
            <Field label="Client Name *">
              <input
                type="text"
                className={inputCls}
                placeholder="First Last"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
              />
            </Field>
            <Field label="Policy Number *">
              <input
                type="text"
                className={inputCls}
                placeholder="e.g. 0123456789"
                value={policyNumber}
                onChange={e => setPolicyNumber(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Carrier *">
              <select className={selectCls} value={carrier} onChange={e => setCarrier(e.target.value)}>
                <option value="">Select carrier…</option>
                {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            {carrier === 'Other' && (
              <Field label="Carrier Name">
                <input
                  type="text"
                  className={inputCls}
                  placeholder="Enter carrier name"
                  value={carrierOther}
                  onChange={e => setCarrierOther(e.target.value)}
                />
              </Field>
            )}
            <Field label="Product Type">
              <select className={selectCls} value={productType} onChange={e => setProductType(e.target.value)}>
                <option value="">Select type…</option>
                {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Issue Date">
              <input
                type="date"
                className={inputCls}
                value={issueDate}
                onChange={e => setIssueDate(e.target.value)}
              />
            </Field>
            <Field label="Term Length" hint="e.g. 20 Year, Permanent">
              <input
                type="text"
                className={inputCls}
                placeholder="e.g. 20 Year"
                value={termLength}
                onChange={e => setTermLength(e.target.value)}
              />
            </Field>
            <Field label="Rate Class">
              <select className={selectCls} value={rateClass} onChange={e => setRateClass(e.target.value)}>
                <option value="">Select…</option>
                {RATE_CLASSES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Face Amount">
              <input
                type="number"
                min="0"
                className={inputCls}
                placeholder="500000"
                value={faceAmount}
                onChange={e => setFaceAmount(e.target.value)}
              />
            </Field>
            <Field label="Annual Premium">
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                placeholder="1200.00"
                value={annualPremium}
                onChange={e => setAnnualPremium(e.target.value)}
              />
            </Field>
            <Field label="Premium Mode">
              <select className={selectCls} value={premiumMode} onChange={e => setPremiumMode(e.target.value)}>
                <option value="">Select…</option>
                {PREMIUM_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Referring Agency">
              <select
                className={selectCls}
                value={agencyId}
                onChange={e => { setAgencyId(e.target.value); setAgentId('') }}
              >
                <option value="">No agency</option>
                {agencies.map(a => (
                  <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="LSP / Agent">
              <select
                className={selectCls}
                value={agentId}
                onChange={e => setAgentId(e.target.value)}
              >
                <option value="">No agent</option>
                {filteredAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Policy Notes">
            <textarea
              rows={2}
              className={inputCls}
              placeholder="Any notes about this policy…"
              value={policyNotes}
              onChange={e => setPolicyNotes(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* ── Service Request ────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Service Request</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Request Type *">
              <select className={selectCls} value={requestType} onChange={e => setRequestType(e.target.value)}>
                <option value="">Select type…</option>
                {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            {requestType === 'Other' && (
              <Field label="Describe Request">
                <input
                  type="text"
                  className={inputCls}
                  placeholder="Describe the request"
                  value={requestTypeOther}
                  onChange={e => setRequestTypeOther(e.target.value)}
                />
              </Field>
            )}
            <Field label="Date Received">
              <input
                type="date"
                className={inputCls}
                value={dateReceived}
                onChange={e => setDateReceived(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              rows={3}
              className={inputCls}
              placeholder="What was requested? Any context from the client or agent…"
              value={srNotes}
              onChange={e => setSrNotes(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* ── Submit ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: '#1F3864' }}
        >
          {saving ? 'Creating…' : 'Create Service Request'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-5 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
