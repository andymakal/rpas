'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Save, Loader2, Printer, CheckCircle, Trash2, Plus, FileText, Link2 } from 'lucide-react'
import type { FinancialReviewDetail, RpasPolicy, HouseholdMember, ParsedContract } from './page'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v}%`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Contract card ─────────────────────────────────────────────────────────────

function ContractCard({ contract, index }: { contract: ParsedContract; index: number }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500 bg-slate-700 px-2 py-0.5 rounded">
            {index + 1}
          </span>
          <div>
            <p className="text-white font-medium">
              {contract.carrier}{contract.product_name ? ` — ${contract.product_name}` : ''}
            </p>
            <p className="text-slate-400 text-xs mt-0.5">
              {contract.annuity_type ?? 'Annuity'}
              {contract.contract_number ? ` · ${contract.contract_number}` : ''}
              {contract.account_type ? ` · ${contract.account_type}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white font-semibold">{fmtCurrency(contract.account_value)}</span>
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-5 py-4 space-y-4 bg-slate-900/40">
          {/* Values grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Owner"            value={contract.owner} />
            {contract.joint_owner && <Field label="Joint Owner" value={contract.joint_owner} />}
            <Field label="Account Value"       value={fmtCurrency(contract.account_value)} />
            <Field label="Surrender Value"    value={fmtCurrency(contract.surrender_value)} />
            <Field label="Total Premiums Paid" value={fmtCurrency(contract.total_premiums_paid ?? contract.cost_basis)} />
            {contract.initial_premium != null && contract.total_premiums_paid != null && contract.initial_premium !== contract.total_premiums_paid && (
              <Field label="Initial Premium" value={fmtCurrency(contract.initial_premium)} />
            )}
            <Field label="Issue Date"       value={fmtDate(contract.issue_date)} />
            <Field label="Valuation Date"   value={fmtDate(contract.valuation_date)} />
            <Field label="Free Withdrawal"  value={fmtPct(contract.free_withdrawal_pct)} />
          </div>

          {/* Surrender info */}
          {(contract.surrender_period || contract.current_surrender_charge_pct != null || contract.current_surrender_charge_amt != null) && (
            <div className="border-t border-slate-800 pt-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Surrender</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {contract.surrender_period && <Field label="Surrender Period" value={contract.surrender_period} />}
                {contract.current_surrender_charge_pct != null && (
                  <Field label="Current Charge %" value={fmtPct(contract.current_surrender_charge_pct)} />
                )}
                {contract.current_surrender_charge_amt != null && (
                  <Field label="Surrender Charge $" value={fmtCurrency(contract.current_surrender_charge_amt)} />
                )}
              </div>
              {contract.surrender_schedule?.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-slate-500 mb-2">Surrender schedule</p>
                  <div className="flex flex-wrap gap-2">
                    {contract.surrender_schedule.map(s => (
                      <span key={s.year} className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300">
                        Yr {s.year}: {s.charge_pct}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Income benefit */}
          {contract.income_benefit && (
            <div className="border-t border-slate-800 pt-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                Income Benefit
                {contract.income_benefit.rider_name && (
                  <span className="ml-2 normal-case text-slate-500 font-normal">
                    {contract.income_benefit.rider_name}
                  </span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="Income Base"    value={fmtCurrency(contract.income_benefit.benefit_base)} />
                <Field label="Rollup Rate"    value={fmtPct(contract.income_benefit.guaranteed_rollup_rate)} />
                <Field label="Withdrawal %"   value={fmtPct(contract.income_benefit.withdrawal_pct)} />
                <Field label="Annual Income"  value={fmtCurrency(contract.income_benefit.annual_income)} />
                <Field label="Income Start"   value={fmtDate(contract.income_benefit.income_start_date)} />
                <Field label="Status"         value={contract.income_benefit.income_status ?? '—'} />
              </div>
            </div>
          )}

          {contract.notes && (
            <div className="border-t border-slate-800 pt-3">
              <p className="text-xs text-slate-500 mb-1">Notes</p>
              <p className="text-sm text-slate-300">{contract.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-slate-200 mt-0.5">{value || '—'}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['draft', 'ready', 'delivered']
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', ready: 'Ready', delivered: 'Delivered' }

export function FinancialReviewClient({
  review,
  rpasId,
  policies,
  householdMembers,
}: {
  review:           FinancialReviewDetail
  rpasId:           string
  policies:         RpasPolicy[]
  householdMembers: HouseholdMember[]
}) {
  const [notes,    setNotes]    = useState(review.recommendation_notes ?? '')
  const [status,   setStatus]   = useState(review.status)
  const [contracts, setContracts] = useState(review.contracts)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Supplement panel
  const [supplementOpen, setSupplementOpen] = useState(false)
  const [supplementMode, setSupplementMode] = useState<'statement' | 'info'>('statement')
  const [supplementUrl,  setSupplementUrl]  = useState('')
  const [supplementFile, setSupplementFile] = useState<File | null>(null)
  const [supplementing,  setSupplementing]  = useState(false)
  const [supplementError, setSupplementError] = useState<string | null>(null)
  const supplementFileRef = useRef<HTMLInputElement>(null)

  async function handleSupplement() {
    setSupplementError(null)
    setSupplementing(true)
    try {
      let res: Response
      if (supplementMode === 'info' && supplementUrl.trim()) {
        res = await fetch(`/api/financial-review/${rpasId}/supplement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: supplementUrl.trim() }),
        })
      } else if (supplementFile) {
        const fd = new FormData()
        fd.append('pdf', supplementFile)
        fd.append('mode', supplementMode)
        res = await fetch(`/api/financial-review/${rpasId}/supplement`, { method: 'POST', body: fd })
      } else {
        setSupplementError('Please choose a file or enter a URL.')
        setSupplementing(false)
        return
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      if (supplementMode === 'statement') {
        const added = json.added ?? 0
        if (added === 0) {
          setSupplementError('No contracts were found in that PDF. Try a different document.')
          setSupplementing(false)
          return
        }
        if (json.data?.contracts) setContracts(json.data.contracts)
        setSupplementError(`✓ Added ${added} contract${added !== 1 ? 's' : ''}.`)
        setSupplementFile(null)
      }
      if (supplementMode === 'info') {
        if (json.data?.recommendation_notes != null) setNotes(json.data.recommendation_notes)
        setSupplementError('✓ Product info appended to notes.')
        setSupplementFile(null)
        setSupplementUrl('')
      }
    } catch (err) {
      setSupplementError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSupplementing(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    await fetch(`/api/financial-review/${rpasId}`, { method: 'DELETE' })
    window.location.href = '/financial-review'
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    await fetch(`/api/financial-review/${rpasId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendation_notes: notes, status }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const c = review.customers

  return (
    <div className="flex min-h-screen">
      {/* Main content */}
      <div className="flex-1 p-8 min-w-0">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/financial-review" className="text-slate-400 hover:text-slate-200 transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-white text-2xl font-semibold">
                    {c ? `${c.first_name} ${c.last_name}` : 'Unnamed Review'}
                  </h1>
                  <span className="text-xs font-mono text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
                    {review.review_number}
                  </span>
                </div>
                {c && (c.city || c.state) && (
                  <p className="text-slate-400 text-sm mt-0.5">
                    {[c.city, c.state].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  confirmDelete
                    ? 'border-red-700 bg-red-900/20 text-red-400 hover:bg-red-900/40'
                    : 'border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-700'
                }`}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {confirmDelete ? 'Confirm delete' : 'Delete'}
              </button>

              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>

              <Link
                href={`/financial-review/${rpasId}/print`}
                target="_blank"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700 transition-colors"
              >
                <Printer className="w-4 h-4" />
                Print
              </Link>

              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1F3864' }}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : saved ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          {/* Contracts */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-slate-300 text-sm font-medium uppercase tracking-wider">
                Extracted Contracts ({contracts.filter(c => c.carrier?.trim()).length})
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setSupplementMode('statement'); setSupplementOpen(o => !o) }}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Statement
                </button>
                <button
                  onClick={() => { setSupplementMode('info'); setSupplementOpen(o => !o) }}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Add Product Info
                </button>
              </div>
            </div>

            {/* Supplement panel */}
            {supplementOpen && (
              <div className="mb-4 border border-slate-700 rounded-lg p-4 bg-slate-800/40">
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setSupplementMode('statement')}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${supplementMode === 'statement' ? 'border-blue-600 bg-blue-900/30 text-blue-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                  >
                    Carrier Statement
                  </button>
                  <button
                    onClick={() => setSupplementMode('info')}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${supplementMode === 'info' ? 'border-blue-600 bg-blue-900/30 text-blue-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                  >
                    Product Info
                  </button>
                </div>

                {supplementMode === 'info' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">Paste a carrier product page URL or upload a fact sheet PDF — Claude will summarize key features and append to notes.</p>
                    <input
                      type="url"
                      value={supplementUrl}
                      onChange={e => setSupplementUrl(e.target.value)}
                      placeholder="https://www.carrier.com/product-page"
                      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-600">— or upload a PDF —</p>
                    <input ref={supplementFileRef} type="file" accept="application/pdf" className="hidden"
                      onChange={e => setSupplementFile(e.target.files?.[0] ?? null)} />
                    <button onClick={() => supplementFileRef.current?.click()}
                      className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 border border-dashed border-slate-700 rounded px-3 py-2 w-full justify-center transition-colors">
                      <FileText className="w-3.5 h-3.5" />
                      {supplementFile ? supplementFile.name : 'Choose PDF'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">Upload another carrier statement — contracts will be extracted and added to this review.</p>
                    <input ref={supplementFileRef} type="file" accept="application/pdf" className="hidden"
                      onChange={e => setSupplementFile(e.target.files?.[0] ?? null)} />
                    <button onClick={() => supplementFileRef.current?.click()}
                      className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 border border-dashed border-slate-700 rounded px-3 py-2 w-full justify-center transition-colors">
                      <FileText className="w-3.5 h-3.5" />
                      {supplementFile ? supplementFile.name : 'Choose PDF'}
                    </button>
                  </div>
                )}

                {supplementError && (
                  <p className={`text-xs mt-2 ${supplementError.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                    {supplementError}
                  </p>
                )}

                <div className="flex gap-2 mt-3">
                  <button onClick={handleSupplement} disabled={supplementing}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#1F3864' }}>
                    {supplementing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {supplementing ? 'Analyzing...' : 'Analyze & Add'}
                  </button>
                  <button onClick={() => { setSupplementOpen(false); setSupplementFile(null); setSupplementUrl(''); setSupplementError(null) }}
                    className="text-xs px-3 py-1.5 rounded text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(() => {
              const visible = contracts.filter(c => c.carrier?.trim())
              if (visible.length === 0) return (
                <div className="text-center py-10 border border-dashed border-slate-700 rounded-lg text-slate-500 text-sm">
                  No contracts extracted from the uploaded document.
                </div>
              )
              return (
                <div className="space-y-3">
                  {visible.map((c, i) => (
                    <ContractCard key={i} contract={c} index={i} />
                  ))}
                </div>
              )
            })()}
          </section>

          {/* Recommendation notes */}
          <section>
            <h2 className="text-slate-300 text-sm font-medium uppercase tracking-wider mb-3">
              Recommendation Notes
            </h2>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Summary of findings, recommendations, and action items for the client..."
              rows={6}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-blue-500 resize-y"
            />
          </section>
        </div>
      </div>

      {/* Right sidebar — RPAS context */}
      <aside className="w-72 shrink-0 border-l border-slate-800 p-5 space-y-6 bg-slate-900/30 overflow-y-auto">
        {/* Client info */}
        {c && (
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Client</p>
            <div className="space-y-1.5">
              <Link
                href={`/customers/${c.id}`}
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-sm font-medium"
              >
                {c.first_name} {c.last_name}
                <ExternalLink className="w-3 h-3" />
              </Link>
              {c.phone && <p className="text-slate-400 text-xs">{c.phone}</p>}
              {c.email && <p className="text-slate-400 text-xs">{c.email}</p>}
            </div>
          </div>
        )}

        {/* Household members */}
        {householdMembers.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Household</p>
            <div className="space-y-2">
              {householdMembers.map(m => (
                <Link
                  key={m.id}
                  href={`/customers/${m.id}`}
                  className="flex items-center gap-1.5 text-slate-300 hover:text-white text-sm"
                >
                  {m.first_name} {m.last_name}
                  <ExternalLink className="w-3 h-3 text-slate-600" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Policies in RPAS */}
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
            Policies in RPAS {policies.length > 0 && `(${policies.length})`}
          </p>
          {policies.length === 0 ? (
            <p className="text-slate-600 text-xs">No policies on file</p>
          ) : (
            <div className="space-y-3">
              {policies.map(p => (
                <Link
                  key={p.id}
                  href={`/policies/${p.id}`}
                  className="block hover:bg-slate-800/50 rounded-lg p-2 -mx-2 transition-colors group"
                >
                  <p className="text-slate-200 text-sm group-hover:text-white transition-colors">
                    {p.carrier}
                  </p>
                  <p className="text-slate-500 text-xs mt-0.5">{p.product_type ?? p.product_category}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-slate-600 text-xs font-mono">{p.policy_number}</span>
                    {(p.cash_value_amount ?? p.face_amount) != null && (
                      <span className="text-slate-400 text-xs">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p.cash_value_amount ?? p.face_amount ?? 0)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
