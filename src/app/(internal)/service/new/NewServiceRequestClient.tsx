'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, CheckCircle } from 'lucide-react'
import type { AgencyOption, AgentOption } from './page'

const CARRIERS = [
  'Corebridge',
  'Everlake Assurance',
  'Everlake Life',
  'Foresters',
  'Gerber Life',
  'John Hancock',
  'Lincoln Benefit Life',
  'Lincoln Financial',
  'Protective',
  'Prudential',
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
  'Policy Surrender',
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

type PolicyResult = {
  id: string
  policy_number: string
  client_name: string
  carrier: string
  product_type: string | null
  face_amount: number | null
}

type Prefill = {
  clientName:   string
  policyNumber: string
  agencyId:     string
  agentId:      string
  fromCaseId:   string
}

function fmt(n: number | null) {
  if (!n) return null
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

// ── Policy search autocomplete ─────────────────────────────────────────────────
function PolicySearch({
  onSelect,
}: {
  onSelect: (p: PolicyResult) => void
}) {
  const [q, setQ]             = useState('')
  const [results, setResults] = useState<PolicyResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const debounce              = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (q.length < 2) { setResults([]); setOpen(false); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/api/service-policies/search?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        setResults((json.data ?? []) as PolicyResult[])
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [q])

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by policy number or client name…"
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-slate-500 placeholder-slate-500"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            Searching…
          </span>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl divide-y divide-slate-700 max-h-64 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onSelect(p); setQ(''); setOpen(false) }}
              className="w-full text-left px-4 py-3 hover:bg-slate-700 transition-colors"
            >
              <p className="text-sm font-medium text-white font-mono">{p.policy_number}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {p.client_name} · {p.carrier}
                {p.product_type ? ` · ${p.product_type}` : ''}
                {p.face_amount  ? ` · ${fmt(p.face_amount)}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}
      {open && !loading && results.length === 0 && q.length >= 2 && (
        <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl px-4 py-3">
          <p className="text-xs text-slate-500">No existing policies found — fill in the fields below to create one.</p>
        </div>
      )}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────
export function NewServiceRequestClient({
  agencies,
  agents,
  prefill = { clientName: '', policyNumber: '', agencyId: '', agentId: '', fromCaseId: '' },
}: {
  agencies: AgencyOption[]
  agents:   AgentOption[]
  prefill?: Prefill
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // Selected existing policy (skips the new-policy form)
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyResult | null>(null)

  // Policy fields — seeded from prefill when coming from a referral
  const [clientName,    setClientName]    = useState(prefill.clientName)
  const [policyNumber,  setPolicyNumber]  = useState(prefill.policyNumber)
  const [carrier,       setCarrier]       = useState('')
  const [carrierOther,  setCarrierOther]  = useState('')
  const [productType,   setProductType]   = useState('')
  const [issueDate,     setIssueDate]     = useState('')
  const [termLength,    setTermLength]    = useState('')
  const [faceAmount,    setFaceAmount]    = useState('')
  const [annualPremium, setAnnualPremium] = useState('')
  const [premiumMode,   setPremiumMode]   = useState('')
  const [rateClass,     setRateClass]     = useState('')
  const [agencyId,      setAgencyId]      = useState(prefill.agencyId)
  const [agentId,       setAgentId]       = useState(prefill.agentId)
  const [policyNotes,   setPolicyNotes]   = useState('')

  // SR fields
  const [requestType,      setRequestType]      = useState('')
  const [requestTypeOther, setRequestTypeOther] = useState('')
  const [dateReceived,     setDateReceived]      = useState(
    new Date().toISOString().split('T')[0]
  )
  const [srNotes, setSrNotes] = useState('')

  // Filtered agents by selected agency
  const filteredAgents = useMemo(() => {
    if (!agencyId) return agents
    return agents.filter(a => a.agency_id === agencyId)
  }, [agents, agencyId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const resolvedType = requestType === 'Other' ? requestTypeOther.trim() : requestType
    if (!resolvedType) { setError('Request type is required'); return }

    setSaving(true)
    try {
      let bodyPayload: Record<string, unknown>

      if (selectedPolicy) {
        // Existing policy — send policy_id directly
        bodyPayload = {
          policy_id:     selectedPolicy.id,
          request_type:  resolvedType,
          date_received: dateReceived || undefined,
          notes:         srNotes.trim() || null,
        }
      } else {
        // New policy creation path
        const resolvedCarrier = carrier === 'Other' ? carrierOther.trim() : carrier
        if (!clientName.trim())   { setError('Client name is required'); setSaving(false); return }
        if (!policyNumber.trim()) { setError('Policy number is required'); setSaving(false); return }
        if (!resolvedCarrier)     { setError('Carrier is required'); setSaving(false); return }

        bodyPayload = {
          request_type:  resolvedType,
          date_received: dateReceived || undefined,
          notes:         srNotes.trim() || null,
          new_policy: {
            client_name:    clientName.trim(),
            policy_number:  policyNumber.trim(),
            carrier:        resolvedCarrier,
            product_type:   productType    || null,
            issue_date:     issueDate      || null,
            term_length:    termLength.trim() || null,
            face_amount:    faceAmount    ? parseFloat(faceAmount)    : null,
            annual_premium: annualPremium ? parseFloat(annualPremium) : null,
            premium_mode:   premiumMode   || null,
            rate_class:     rateClass     || null,
            agency_id:      agencyId      || null,
            agent_id:       agentId       || null,
            notes:          policyNotes.trim() || null,
          },
        }
      }

      const res  = await fetch('/api/service-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(bodyPayload),
      })
      const json = await res.json()
      if (!res.ok) { setError((json as { error?: string }).error ?? 'Failed to create'); return }

      router.push(`/service/${(json as { data: { id: string } }).data.id}`)
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Policy search ──────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1">Find Existing Policy</h2>
        <p className="text-xs text-slate-500 mb-4">
          Search by policy number or client name. If already in the system, select it to skip re-entering policy details.
        </p>

        {selectedPolicy ? (
          <div className="flex items-start justify-between gap-3 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white font-mono">{selectedPolicy.policy_number}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedPolicy.client_name} · {selectedPolicy.carrier}
                  {selectedPolicy.product_type ? ` · ${selectedPolicy.product_type}` : ''}
                  {selectedPolicy.face_amount  ? ` · ${fmt(selectedPolicy.face_amount)}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPolicy(null)}
              className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <PolicySearch onSelect={setSelectedPolicy} />
        )}
      </div>

      {/* ── Policy Information (hidden when an existing policy is selected) ── */}
      {!selectedPolicy && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">New Policy</h2>
          <p className="text-xs text-slate-500 mb-4">
            No existing policy found above? Fill in the details to create one now.
          </p>
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
      )}

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
