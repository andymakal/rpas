'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatPhoneDisplay } from '@/lib/contact-input'
import {
  ArrowLeft, CheckCircle, ShieldOff, FileQuestion, Send,
  AlertTriangle, ChevronRight, X, Building2, User,
  Link2, Link2Off, ClipboardList, Pencil, Save, Plus,
} from 'lucide-react'
import { CustomerSearch } from '@/components/CustomerSearch'
import type { PolicyDetail, PolicyReviewRow, RateClassOption, HouseholdMember } from './page'
import type { ReviewFlag } from '@/lib/reviews/prep'
import {
  CATEGORY_CONFIGS, CATEGORY_OPTIONS,
  type PolicyCategory, type CategoryConfig, type TypeDataField,
} from '@/lib/policy/categories'
import { fmtDate } from '@/lib/fmt'

const SR_TYPES = [
  'Billing Issue', 'Change Payment Info', 'Beneficiary Change',
  'Statement of Insurance', 'Address Update', 'Lapse / Reinstatement',
  'Claims Assistance', 'General Coverage Question',
  'Policy Review', 'Policy Surrender', 'Other',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcAP(amount: number | null, mode: string | null): number | null {
  if (!amount) return null
  const m = (mode ?? 'annual').toLowerCase().trim()
  if (m === 'single') return null
  if (m === 'semi-annual') return amount * 2
  if (m === 'quarterly')   return amount * 4
  if (m === 'monthly eft' || m === 'eft monthly' || m === 'monthly') return amount * 12
  return null // annual → no separate AP line needed
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

function fmtTypeDataValue(field: TypeDataField, raw: unknown): string {
  if (raw == null || raw === '') return '—'
  if (field.type === 'currency') return fmt(Number(raw))
  if (field.type === 'number')   return String(raw)
  if (field.type === 'boolean')  return (raw === true || raw === 'true') ? 'Yes' : 'No'
  return String(raw)
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  const cfg = CATEGORY_CONFIGS[category as PolicyCategory]
  if (!cfg) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${cfg.color}`}>
      {cfg.label}
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

// ── Input / select helpers ────────────────────────────────────────────────────

const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500 placeholder:text-slate-500'
const selectCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-slate-500'

// ── Linked-person field ───────────────────────────────────────────────────────

type PersonLink = { id: string; name: string } | null

function PersonLinkField({
  linked,
  onLink,
  onUnlink,
  householdMembers,
  excludeId,
}: {
  linked:            PersonLink
  onLink:            (id: string, name: string) => void
  onUnlink:          () => void
  householdMembers:  HouseholdMember[]
  excludeId:         string | null
}) {
  const [open, setOpen] = useState(false)

  if (linked) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-900/30 border border-sky-800 text-sky-300 text-xs font-medium">
          <Link2 className="w-3 h-3 shrink-0" />
          {linked.name}
        </span>
        <button
          type="button"
          onClick={onUnlink}
          title="Unlink customer"
          className="text-slate-500 hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 hover:text-sky-400 transition-colors"
      >
        <Link2 className="w-3 h-3" />
        Link to customer…
      </button>
      {open && (
        <div className="mt-1 p-3 bg-slate-950 border border-slate-700 rounded-lg space-y-2 z-20 relative">
          {householdMembers.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">From this household</p>
              <div className="space-y-0.5">
                {householdMembers.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { onLink(m.id, `${m.first_name} ${m.last_name}`); setOpen(false) }}
                    className="w-full text-left text-sm text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors"
                  >
                    {m.first_name} {m.last_name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={householdMembers.length > 0 ? 'pt-2 border-t border-slate-800' : ''}>
            {householdMembers.length > 0 && (
              <p className="text-xs text-slate-500 mb-1.5">Search all customers</p>
            )}
            <CustomerSearch
              exclude={excludeId ?? undefined}
              theme="dark"
              autoFocus={householdMembers.length === 0}
              onSelect={hit => { onLink(hit.id, `${hit.first_name} ${hit.last_name}`); setOpen(false) }}
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full text-center text-xs text-slate-600 hover:text-slate-400 pt-1 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// ── Category-specific view section ───────────────────────────────────────────

function CategoryFieldsView({
  policy,
  config,
}: {
  policy:  PolicyDetail
  config:  CategoryConfig
}) {
  const sf = config.standardFields
  const td = policy.type_data ?? {}

  const insuredLink = policy.insured_customer
    ? { id: policy.insured_customer.id, name: `${policy.insured_customer.first_name} ${policy.insured_customer.last_name}` }
    : null
  const primBenefLink = policy.primary_beneficiary_customer
    ? { id: policy.primary_beneficiary_customer.id, name: `${policy.primary_beneficiary_customer.first_name} ${policy.primary_beneficiary_customer.last_name}` }
    : null
  const contBenefLink = policy.contingent_beneficiary_customer
    ? { id: policy.contingent_beneficiary_customer.id, name: `${policy.contingent_beneficiary_customer.first_name} ${policy.contingent_beneficiary_customer.last_name}` }
    : null

  return (
    <>
      {sf.insured_name && (
        policy.owner_is_insured
          ? <Row label={sf.insured_name} value={<span className="text-slate-500 italic">Same as owner</span>} />
          : insuredLink
            ? <Row label={sf.insured_name} value={
                <Link href={`/customers/${insuredLink.id}`} className="text-sky-400 hover:underline flex items-center gap-1 justify-end">
                  <Link2 className="w-3 h-3" />{insuredLink.name}
                </Link>
              } />
            : (policy.insured_first_name || policy.insured_last_name)
              ? <Row label={sf.insured_name} value={`${policy.insured_first_name ?? ''} ${policy.insured_last_name ?? ''}`.trim()} />
              : null
      )}
      {sf.face_amount && <Row label={sf.face_amount} value={fmt(policy.face_amount)} />}
      {sf.death_benefit_amount && <Row label={sf.death_benefit_amount} value={fmt(policy.death_benefit_amount)} />}
      {sf.cash_value_amount && <Row label={sf.cash_value_amount} value={fmt(policy.cash_value_amount)} />}
      {sf.cost_basis && <Row label={sf.cost_basis} value={fmt(policy.cost_basis)} />}
      {sf.annual_premium && policy.annual_premium != null && (() => {
        const mLow  = (policy.premium_mode ?? 'annual').toLowerCase().trim()
        const short: Record<string, string> = { annual: '/yr', 'semi-annual': '/semi', quarterly: '/qtr', 'monthly eft': '/mo', 'eft monthly': '/mo', monthly: '/mo', single: '' }
        const ap    = calcAP(policy.annual_premium, policy.premium_mode ?? null)
        return (
          <Row label="Billed Premium" value={
            <div>
              <span>{fmt(policy.annual_premium)}<span className="text-slate-500 text-xs ml-0.5">{short[mLow] ?? '/yr'}</span></span>
              {ap != null && mLow !== 'annual' && (
                <p className="text-xs text-slate-500 tabular-nums">AP {fmt(ap)}/yr</p>
              )}
            </div>
          } />
        )
      })()}
      {sf.term_length && <Row label={sf.term_length} value={policy.term_length ?? '—'} />}
      {sf.rate_class && <Row label={sf.rate_class} value={policy.rate_class ?? '—'} />}
      {sf.riders && policy.riders && <Row label={sf.riders} value={policy.riders} />}
      {sf.primary_beneficiary && (
        <Row label={sf.primary_beneficiary} value={
          primBenefLink
            ? <Link href={`/customers/${primBenefLink.id}`} className="text-sky-400 hover:underline flex items-center gap-1 justify-end">
                <Link2 className="w-3 h-3" />{primBenefLink.name}
              </Link>
            : policy.primary_beneficiary ?? '—'
        } />
      )}
      {sf.contingent_beneficiary && (contBenefLink || policy.contingent_beneficiary) && (
        <Row label={sf.contingent_beneficiary} value={
          contBenefLink
            ? <Link href={`/customers/${contBenefLink.id}`} className="text-sky-400 hover:underline flex items-center gap-1 justify-end">
                <Link2 className="w-3 h-3" />{contBenefLink.name}
              </Link>
            : policy.contingent_beneficiary ?? '—'
        } />
      )}

      {/* Type-data fields */}
      {config.typeDataFields.map(f => {
        const val = td[f.key]
        if (val == null || val === '') return null
        return <Row key={f.key} label={f.label} value={fmtTypeDataValue(f, val)} />
      })}
    </>
  )
}

// ── Category-specific edit section ───────────────────────────────────────────

function CategoryFieldsEdit({
  config,
  editFields,
  ef,
  rateClasses,
  typeData,
  setTypeData,
  ownerIsInsured,
  onOwnerIsInsured,
  insuredLink,
  onInsuredLink,
  onInsuredUnlink,
  primBenefLink,
  onPrimBenefLink,
  onPrimBenefUnlink,
  contBenefLink,
  onContBenefLink,
  onContBenefUnlink,
  householdMembers,
  policyCustomerId,
}: {
  config:           CategoryConfig
  editFields:       Record<string, string>
  ef:               (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void
  rateClasses:      RateClassOption[]
  typeData:         Record<string, string>
  setTypeData:      (fn: (prev: Record<string, string>) => Record<string, string>) => void
  ownerIsInsured:   boolean
  onOwnerIsInsured: (v: boolean) => void
  insuredLink:      PersonLink
  onInsuredLink:    (id: string, name: string) => void
  onInsuredUnlink:  () => void
  primBenefLink:    PersonLink
  onPrimBenefLink:  (id: string, name: string) => void
  onPrimBenefUnlink:() => void
  contBenefLink:    PersonLink
  onContBenefLink:  (id: string, name: string) => void
  onContBenefUnlink:() => void
  householdMembers: HouseholdMember[]
  policyCustomerId: string | null
}) {
  const sf = config.standardFields

  function setTd(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setTypeData(prev => ({ ...prev, [key]: e.target.value }))
  }

  return (
    <>
      {/* Insured name */}
      {sf.insured_name && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ownerIsInsured}
              onChange={e => onOwnerIsInsured(e.target.checked)}
              className="w-3.5 h-3.5 rounded bg-slate-700 border-slate-600 accent-sky-500"
            />
            <span className="text-xs text-slate-400">Owner is also the insured</span>
          </label>
          {!ownerIsInsured && (
            <div className="pl-4 border-l border-slate-700 space-y-2">
              {insuredLink ? (
                <PersonLinkField
                  linked={insuredLink}
                  onLink={onInsuredLink}
                  onUnlink={onInsuredUnlink}
                  householdMembers={householdMembers}
                  excludeId={policyCustomerId}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">First Name</label>
                      <input value={editFields.insured_first_name} onChange={ef('insured_first_name')}
                        className={inputCls} placeholder="First" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Last Name</label>
                      <input value={editFields.insured_last_name} onChange={ef('insured_last_name')}
                        className={inputCls} placeholder="Last" />
                    </div>
                  </div>
                  <PersonLinkField
                    linked={null}
                    onLink={onInsuredLink}
                    onUnlink={onInsuredUnlink}
                    householdMembers={householdMembers}
                    excludeId={policyCustomerId}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Standard currency / numeric fields */}
      {sf.face_amount && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.face_amount} ($)</label>
          <input type="number" value={editFields.face_amount} onChange={ef('face_amount')}
            className={inputCls} placeholder="—" />
        </div>
      )}
      {sf.death_benefit_amount && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.death_benefit_amount} ($)</label>
          <input type="number" value={editFields.death_benefit_amount} onChange={ef('death_benefit_amount')}
            className={inputCls} placeholder="—" />
        </div>
      )}
      {sf.cash_value_amount && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.cash_value_amount} ($)</label>
          <input type="number" value={editFields.cash_value_amount} onChange={ef('cash_value_amount')}
            className={inputCls} placeholder="—" />
        </div>
      )}
      {sf.cost_basis && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.cost_basis} ($)</label>
          <input type="number" value={editFields.cost_basis} onChange={ef('cost_basis')}
            className={inputCls} placeholder="—" />
        </div>
      )}
      {sf.annual_premium && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Billed Premium ($)</label>
          <input type="number" value={editFields.annual_premium} onChange={ef('annual_premium')}
            className={inputCls} placeholder="—" />
          {(() => { const ap = editFields.annual_premium ? calcAP(parseFloat(editFields.annual_premium), editFields.premium_mode || null) : null; return ap ? <p className="text-xs text-slate-500 mt-0.5 tabular-nums">AP {fmt(ap)}/yr</p> : null })()}
        </div>
      )}

      {/* Premium mode */}
      {sf.premium_mode && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.premium_mode}</label>
          <select value={editFields.premium_mode} onChange={ef('premium_mode')} className={selectCls}>
            <option value="">—</option>
            {['Annual','Semi-Annual','Quarterly','Monthly EFT'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Term length */}
      {sf.term_length && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.term_length}</label>
          <input value={editFields.term_length} onChange={ef('term_length')}
            className={inputCls} placeholder="e.g. 20 Year" />
        </div>
      )}

      {/* Rate class */}
      {sf.rate_class && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.rate_class}</label>
          <select value={editFields.rate_class} onChange={ef('rate_class')} className={selectCls}>
            <option value="">—</option>
            {rateClasses.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
          </select>
        </div>
      )}

      {/* Riders */}
      {sf.riders && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.riders}</label>
          <input value={editFields.riders} onChange={ef('riders')}
            className={inputCls} placeholder="e.g. WAIVER, CLTR" />
        </div>
      )}

      {/* Primary beneficiary */}
      {sf.primary_beneficiary && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.primary_beneficiary}</label>
          {primBenefLink ? (
            <PersonLinkField
              linked={primBenefLink}
              onLink={onPrimBenefLink}
              onUnlink={onPrimBenefUnlink}
              householdMembers={householdMembers}
              excludeId={null}
            />
          ) : (
            <>
              <input value={editFields.primary_beneficiary} onChange={ef('primary_beneficiary')}
                className={inputCls} placeholder="e.g. Jane Doe (spouse)" />
              <PersonLinkField
                linked={null}
                onLink={onPrimBenefLink}
                onUnlink={onPrimBenefUnlink}
                householdMembers={householdMembers}
                excludeId={null}
              />
            </>
          )}
        </div>
      )}

      {/* Contingent beneficiary */}
      {sf.contingent_beneficiary && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{sf.contingent_beneficiary}</label>
          {contBenefLink ? (
            <PersonLinkField
              linked={contBenefLink}
              onLink={onContBenefLink}
              onUnlink={onContBenefUnlink}
              householdMembers={householdMembers}
              excludeId={null}
            />
          ) : (
            <>
              <input value={editFields.contingent_beneficiary} onChange={ef('contingent_beneficiary')}
                className={inputCls} placeholder="e.g. Children equally" />
              <PersonLinkField
                linked={null}
                onLink={onContBenefLink}
                onUnlink={onContBenefUnlink}
                householdMembers={householdMembers}
                excludeId={null}
              />
            </>
          )}
        </div>
      )}

      {/* Type-data fields */}
      {config.typeDataFields.length > 0 && (
        <div className="pt-2 mt-1 border-t border-slate-800 space-y-3">
          {config.typeDataFields.map(f => (
            <div key={f.key}>
              <label className="block text-xs text-slate-500 mb-1">{f.label}</label>
              {f.type === 'select' ? (
                <select value={typeData[f.key] ?? ''} onChange={setTd(f.key)} className={selectCls}>
                  <option value="">—</option>
                  {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === 'boolean' ? (
                <select value={typeData[f.key] ?? ''} onChange={setTd(f.key)} className={selectCls}>
                  <option value="">—</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  type={f.type === 'currency' || f.type === 'number' ? 'number' : 'text'}
                  value={typeData[f.key] ?? ''}
                  onChange={setTd(f.key)}
                  className={inputCls}
                  placeholder={f.placeholder ?? '—'}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </>
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
  rateClasses,
  reviews: initialReviews,
  flags,
  householdMembers,
}: {
  policy:           PolicyDetail
  agencies:         { id: string; name: string; display_name: string | null }[]
  rateClasses:      RateClassOption[]
  reviews:          PolicyReviewRow[]
  flags:            ReviewFlag[]
  householdMembers: HouseholdMember[]
}) {
  const router = useRouter()

  // ── Local state ───────────────────────────────────────────────────────────────
  const [saStatus,     setSaStatus]     = useState(initial.sa_status)
  const [formSentAt,   setFormSentAt]   = useState<string | null>(initial.sa_form_sent_at)
  const [agencyId,     setAgencyId]     = useState<string | null>(initial.agency_id)
  const [customerId,   setCustomerId]   = useState<string | null>(initial.customer_id)
  const [customerName, setCustomerName] = useState<string | null>(
    initial.customers ? `${initial.customers.first_name} ${initial.customers.last_name}` : null
  )

  // ── Insured / beneficiary link state ──────────────────────────────────────────
  const [ownerIsInsured,  setOwnerIsInsured]  = useState(initial.owner_is_insured ?? true)
  const [insuredCxId,     setInsuredCxId]     = useState<string | null>(initial.insured_customer_id ?? null)
  const [insuredCxName,   setInsuredCxName]   = useState<string | null>(
    initial.insured_customer
      ? `${initial.insured_customer.first_name} ${initial.insured_customer.last_name}`
      : null
  )
  const [primBenefCxId,   setPrimBenefCxId]   = useState<string | null>(initial.primary_beneficiary_customer_id ?? null)
  const [primBenefCxName, setPrimBenefCxName] = useState<string | null>(
    initial.primary_beneficiary_customer
      ? `${initial.primary_beneficiary_customer.first_name} ${initial.primary_beneficiary_customer.last_name}`
      : null
  )
  const [contBenefCxId,   setContBenefCxId]   = useState<string | null>(initial.contingent_beneficiary_customer_id ?? null)
  const [contBenefCxName, setContBenefCxName] = useState<string | null>(
    initial.contingent_beneficiary_customer
      ? `${initial.contingent_beneficiary_customer.first_name} ${initial.contingent_beneficiary_customer.last_name}`
      : null
  )

  const [reviews, setReviews] = useState<PolicyReviewRow[]>(initialReviews)

  // ── Edit state ────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [editFields, setEditFields] = useState({
    carrier:              initial.carrier               ?? '',
    product_type:         initial.product_type          ?? '',
    product_category:     (initial.product_category     ?? '') as PolicyCategory | '',
    face_amount:          initial.face_amount          != null ? String(initial.face_amount)          : '',
    death_benefit_amount: initial.death_benefit_amount != null ? String(initial.death_benefit_amount) : '',
    cash_value_amount:    initial.cash_value_amount    != null ? String(initial.cash_value_amount)    : '',
    cost_basis:           initial.cost_basis           != null ? String(initial.cost_basis)           : '',
    annual_premium:       initial.annual_premium       != null ? String(initial.annual_premium)       : '',
    premium_mode:         initial.premium_mode          ?? '',
    issue_date:           initial.issue_date            ?? '',
    term_length:          initial.term_length           ?? '',
    rate_class:           initial.rate_class            ?? '',
    insured_first_name:   initial.insured_first_name    ?? '',
    insured_last_name:    initial.insured_last_name     ?? '',
    primary_beneficiary:    initial.primary_beneficiary   ?? '',
    contingent_beneficiary: initial.contingent_beneficiary ?? '',
    riders:                 initial.riders                ?? '',
    coverage_status:      initial.coverage_status       ?? 'Active',
    notes:                initial.notes                 ?? '',
  })

  // type_data managed separately (dynamic keys)
  const [typeData, setTypeData] = useState<Record<string, string>>(() => {
    const td = initial.type_data ?? {}
    return Object.fromEntries(
      Object.entries(td).map(([k, v]) => [k, v == null ? '' : String(v)])
    )
  })

  function ef(k: keyof typeof editFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setEditFields(prev => ({ ...prev, [k]: e.target.value }))
  }

  // Derived: active config based on category (live in edit, saved in view)
  const activeCategory = (editing
    ? editFields.product_category
    : initial.product_category
  ) as PolicyCategory | null | ''

  const config: CategoryConfig | null = activeCategory
    ? (CATEGORY_CONFIGS[activeCategory as PolicyCategory] ?? null)
    : null

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSaveEdit() {
    setSaving(true)
    setErr(null)
    try {
      const num = (v: string) => v.trim() === '' ? null : parseFloat(v)

      // Parse type_data back to proper types
      const parsedTypeData: Record<string, unknown> = {}
      if (config) {
        for (const f of config.typeDataFields) {
          const v = typeData[f.key]
          if (v === '' || v === undefined) continue
          if (f.type === 'currency' || f.type === 'number') {
            const n = parseFloat(v)
            if (!isNaN(n)) parsedTypeData[f.key] = n
          } else if (f.type === 'boolean') {
            parsedTypeData[f.key] = v === 'true'
          } else {
            parsedTypeData[f.key] = v
          }
        }
      }

      await patchPolicy({
        carrier:              editFields.carrier.trim()              || initial.carrier,
        product_type:         editFields.product_type               || null,
        product_category:     editFields.product_category           || null,
        face_amount:          num(editFields.face_amount),
        death_benefit_amount: num(editFields.death_benefit_amount),
        cash_value_amount:    num(editFields.cash_value_amount),
        cost_basis:           num(editFields.cost_basis),
        annual_premium:       num(editFields.annual_premium),
        premium_mode:         editFields.premium_mode               || null,
        issue_date:           editFields.issue_date                 || null,
        term_length:          editFields.term_length.trim()         || null,
        rate_class:           editFields.rate_class                 || null,
        insured_first_name:   ownerIsInsured ? null : (insuredCxId ? null : (editFields.insured_first_name.trim() || null)),
        insured_last_name:    ownerIsInsured ? null : (insuredCxId ? null : (editFields.insured_last_name.trim()  || null)),
        primary_beneficiary:  primBenefCxId  ? null : (editFields.primary_beneficiary      || null),
        contingent_beneficiary: contBenefCxId ? null : (editFields.contingent_beneficiary  || null),
        riders:               editFields.riders                     || null,
        coverage_status:      editFields.coverage_status            || 'Active',
        notes:                editFields.notes                      || null,
        // Linking fields
        owner_is_insured:                    ownerIsInsured,
        insured_customer_id:                 ownerIsInsured ? null : insuredCxId,
        primary_beneficiary_customer_id:     primBenefCxId,
        contingent_beneficiary_customer_id:  contBenefCxId,
        type_data:            Object.keys(parsedTypeData).length > 0 ? parsedTypeData : null,
      })
      setEditing(false)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [saving,        setSaving]        = useState(false)
  const [agencySaving,  setAgencySaving]  = useState(false)
  const [err,           setErr]           = useState<string | null>(null)
  const [queuingReview, setQueuingReview] = useState(false)
  const [srModalOpen,   setSrModalOpen]   = useState(false)
  const [srType,        setSrType]        = useState('')
  const [srNotes,       setSrNotes]       = useState('')
  const [creatingSr,    setCreatingSr]    = useState(false)

  // ── PATCH helper ──────────────────────────────────────────────────────────────
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

  // ── SA status ─────────────────────────────────────────────────────────────────
  async function handleSaChange(newStatus: string) {
    if (newStatus === saStatus) return
    setSaving(true); setErr(null)
    try {
      const patch: Record<string, unknown> = { sa_status: newStatus }
      if (newStatus !== 'not_on_file') patch.sa_form_sent_at = null
      await patchPolicy(patch)
      setSaStatus(newStatus)
      if (newStatus !== 'not_on_file') setFormSentAt(null)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleFormSentToggle() {
    setSaving(true); setErr(null)
    const newVal = formSentAt ? null : new Date().toISOString()
    try {
      await patchPolicy({ sa_form_sent_at: newVal })
      setFormSentAt(newVal)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  // ── Agency ────────────────────────────────────────────────────────────────────
  async function handleAgencyChange(newAgencyId: string) {
    setAgencySaving(true); setErr(null)
    try {
      await patchPolicy({ agency_id: newAgencyId || null })
      setAgencyId(newAgencyId || null)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setAgencySaving(false) }
  }

  // ── Customer link ─────────────────────────────────────────────────────────────
  async function handleCustomerLink(cid: string, name: string) {
    setSaving(true); setErr(null)
    try {
      await patchPolicy({ customer_id: cid })
      setCustomerId(cid); setCustomerName(name)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleCustomerUnlink() {
    if (!confirm('Remove customer link from this policy?')) return
    setSaving(true); setErr(null)
    try {
      await patchPolicy({ customer_id: null })
      setCustomerId(null); setCustomerName(null)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  // ── Queue review ──────────────────────────────────────────────────────────────
  async function handleQueueReview() {
    setQueuingReview(true); setErr(null)
    try {
      const res  = await fetch('/api/policy-reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ policy_id: initial.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to queue review')
      setReviews(prev => [json.data as PolicyReviewRow, ...prev])
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to queue review') }
    finally { setQueuingReview(false) }
  }

  // ── New Service Request ───────────────────────────────────────────────────────
  async function handleCreateSR() {
    if (!srType) { setErr('Please select a request type'); return }
    setCreatingSr(true); setErr(null)
    try {
      const res  = await fetch('/api/service-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          policy_id:    initial.id,
          request_type: srType,
          notes:        srNotes.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create service request')
      setSrModalOpen(false)
      setSrType(''); setSrNotes('')
      router.push(`/service/${json.data.id}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to create service request') }
    finally { setCreatingSr(false) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const currentAgency = agencies.find(a => a.id === agencyId)
  const hasOpenReview = reviews.some(r => ['prep', 'scheduled', 'in_progress'].includes(r.status))

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
              <CategoryBadge category={initial.product_category} />
              <StatusBadge status={editFields.coverage_status} />
            </div>
            <p className="text-slate-400 text-sm mt-0.5 font-mono">
              {initial.policy_number} · {initial.carrier}
              {initial.product_type && (
                <span className="text-slate-500"> · {initial.product_type}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSrModalOpen(true); setErr(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Service Request
            </button>
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

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left col */}
          <div className="lg:col-span-2 space-y-5">

            {/* Coverage Details */}
            <Card title="Coverage Details">
              {editing ? (
                <div className="space-y-3">
                  {/* Category */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Category</label>
                    <select
                      value={editFields.product_category}
                      onChange={e => setEditFields(prev => ({ ...prev, product_category: e.target.value as PolicyCategory | '' }))}
                      className={selectCls}
                    >
                      <option value="">— Select category —</option>
                      {CATEGORY_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Carrier + product type */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Carrier</label>
                      <input value={editFields.carrier} onChange={ef('carrier')}
                        className={inputCls} placeholder="e.g. Lincoln Financial" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Product / Sub-type</label>
                      <input value={editFields.product_type} onChange={ef('product_type')}
                        className={inputCls} placeholder="e.g. 20-Year Level Term" />
                    </div>
                  </div>

                  {/* Issue date + coverage status */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Issue Date</label>
                      <input type="date" value={editFields.issue_date} onChange={ef('issue_date')}
                        className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Coverage Status</label>
                      <select value={editFields.coverage_status} onChange={ef('coverage_status')} className={selectCls}>
                        {['Active','Pending','Paid Up','Lapsed','Surrendered','Terminated'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Category-specific fields */}
                  {config ? (
                    <CategoryFieldsEdit
                      config={config}
                      editFields={editFields as unknown as Record<string, string>}
                      ef={ef as unknown as (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void}
                      rateClasses={rateClasses}
                      typeData={typeData}
                      setTypeData={setTypeData}
                      ownerIsInsured={ownerIsInsured}
                      onOwnerIsInsured={setOwnerIsInsured}
                      insuredLink={insuredCxId && insuredCxName ? { id: insuredCxId, name: insuredCxName } : null}
                      onInsuredLink={(id, name) => { setInsuredCxId(id); setInsuredCxName(name) }}
                      onInsuredUnlink={() => { setInsuredCxId(null); setInsuredCxName(null) }}
                      primBenefLink={primBenefCxId && primBenefCxName ? { id: primBenefCxId, name: primBenefCxName } : null}
                      onPrimBenefLink={(id, name) => { setPrimBenefCxId(id); setPrimBenefCxName(name) }}
                      onPrimBenefUnlink={() => { setPrimBenefCxId(null); setPrimBenefCxName(null) }}
                      contBenefLink={contBenefCxId && contBenefCxName ? { id: contBenefCxId, name: contBenefCxName } : null}
                      onContBenefLink={(id, name) => { setContBenefCxId(id); setContBenefCxName(name) }}
                      onContBenefUnlink={() => { setContBenefCxId(null); setContBenefCxName(null) }}
                      householdMembers={householdMembers}
                      policyCustomerId={customerId}
                    />
                  ) : (
                    /* Fallback: show all fields for uncategorised policies */
                    <>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={ownerIsInsured}
                            onChange={e => setOwnerIsInsured(e.target.checked)}
                            className="w-3.5 h-3.5 rounded bg-slate-700 border-slate-600 accent-sky-500"
                          />
                          <span className="text-xs text-slate-400">Owner is also the insured</span>
                        </label>
                        {!ownerIsInsured && (
                          <div className="pl-4 border-l border-slate-700 space-y-2">
                            {insuredCxId && insuredCxName ? (
                              <PersonLinkField
                                linked={{ id: insuredCxId, name: insuredCxName }}
                                onLink={(id, name) => { setInsuredCxId(id); setInsuredCxName(name) }}
                                onUnlink={() => { setInsuredCxId(null); setInsuredCxName(null) }}
                                householdMembers={householdMembers}
                                excludeId={customerId}
                              />
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs text-slate-500 mb-1">Insured First Name</label>
                                    <input value={editFields.insured_first_name} onChange={ef('insured_first_name')}
                                      className={inputCls} placeholder="First" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-slate-500 mb-1">Insured Last Name</label>
                                    <input value={editFields.insured_last_name} onChange={ef('insured_last_name')}
                                      className={inputCls} placeholder="Last" />
                                  </div>
                                </div>
                                <PersonLinkField
                                  linked={null}
                                  onLink={(id, name) => { setInsuredCxId(id); setInsuredCxName(name) }}
                                  onUnlink={() => { setInsuredCxId(null); setInsuredCxName(null) }}
                                  householdMembers={householdMembers}
                                  excludeId={customerId}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {[
                        { label: 'Face Amount ($)',         key: 'face_amount'          },
                        { label: 'Death Benefit ($)',       key: 'death_benefit_amount' },
                        { label: 'Cash Value ($)',          key: 'cash_value_amount'    },
                        { label: 'Cost Basis ($)',          key: 'cost_basis'           },
                        { label: 'Annual Premium ($)',      key: 'annual_premium'       },
                      ].map(({ label, key }) => (
                        <div key={key}>
                          <label className="block text-xs text-slate-500 mb-1">{label}</label>
                          <input type="number" value={editFields[key as keyof typeof editFields]}
                            onChange={ef(key as keyof typeof editFields)}
                            className={inputCls} placeholder="—" />
                        </div>
                      ))}
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Premium Mode</label>
                        <select value={editFields.premium_mode} onChange={ef('premium_mode')} className={selectCls}>
                          <option value="">—</option>
                          {['Annual','Semi-Annual','Quarterly','Monthly EFT'].map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Term Length</label>
                        <input value={editFields.term_length} onChange={ef('term_length')}
                          className={inputCls} placeholder="e.g. 20 Year" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Rate Class</label>
                        <select value={editFields.rate_class ?? ''} onChange={ef('rate_class')} className={selectCls}>
                          <option value="">—</option>
                          {rateClasses.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Riders</label>
                        <input value={editFields.riders} onChange={ef('riders')}
                          className={inputCls} placeholder="e.g. WAIVER, CLTR" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Primary Beneficiary</label>
                        {primBenefCxId && primBenefCxName ? (
                          <PersonLinkField
                            linked={{ id: primBenefCxId, name: primBenefCxName }}
                            onLink={(id, name) => { setPrimBenefCxId(id); setPrimBenefCxName(name) }}
                            onUnlink={() => { setPrimBenefCxId(null); setPrimBenefCxName(null) }}
                            householdMembers={householdMembers}
                            excludeId={null}
                          />
                        ) : (
                          <>
                            <input value={editFields.primary_beneficiary} onChange={ef('primary_beneficiary')}
                              className={inputCls} placeholder="e.g. Jane Doe (spouse)" />
                            <PersonLinkField
                              linked={null}
                              onLink={(id, name) => { setPrimBenefCxId(id); setPrimBenefCxName(name) }}
                              onUnlink={() => { setPrimBenefCxId(null); setPrimBenefCxName(null) }}
                              householdMembers={householdMembers}
                              excludeId={null}
                            />
                          </>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Contingent Beneficiary</label>
                        {contBenefCxId && contBenefCxName ? (
                          <PersonLinkField
                            linked={{ id: contBenefCxId, name: contBenefCxName }}
                            onLink={(id, name) => { setContBenefCxId(id); setContBenefCxName(name) }}
                            onUnlink={() => { setContBenefCxId(null); setContBenefCxName(null) }}
                            householdMembers={householdMembers}
                            excludeId={null}
                          />
                        ) : (
                          <>
                            <input value={editFields.contingent_beneficiary} onChange={ef('contingent_beneficiary')}
                              className={inputCls} placeholder="e.g. Children equally" />
                            <PersonLinkField
                              linked={null}
                              onLink={(id, name) => { setContBenefCxId(id); setContBenefCxName(name) }}
                              onUnlink={() => { setContBenefCxId(null); setContBenefCxName(null) }}
                              householdMembers={householdMembers}
                              excludeId={null}
                            />
                          </>
                        )}
                      </div>
                    </>
                  )}

                  {/* Notes — always shown */}
                  <div className="pt-2 mt-1 border-t border-slate-800">
                    <label className="block text-xs text-slate-500 mb-1">Notes</label>
                    <textarea value={editFields.notes} onChange={ef('notes')} rows={4}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 resize-none"
                      placeholder="Internal notes about this policy…" />
                  </div>
                </div>
              ) : (
                /* View mode */
                <>
                  <Row label="Issue Date" value={fmtDate(initial.issue_date)} />

                  {config ? (
                    <CategoryFieldsView policy={initial} config={config} />
                  ) : (
                    /* Fallback for uncategorised policies */
                    <>
                      {/* Insured */}
                      {initial.owner_is_insured
                        ? <Row label="Insured" value={<span className="text-slate-500 italic">Same as owner</span>} />
                        : initial.insured_customer
                          ? <Row label="Insured" value={
                              <Link href={`/customers/${initial.insured_customer.id}`} className="text-sky-400 hover:underline flex items-center gap-1 justify-end">
                                <Link2 className="w-3 h-3" />
                                {`${initial.insured_customer.first_name} ${initial.insured_customer.last_name}`}
                              </Link>
                            } />
                          : (initial.insured_first_name || initial.insured_last_name)
                            ? <Row label="Insured" value={`${initial.insured_first_name ?? ''} ${initial.insured_last_name ?? ''}`.trim()} />
                            : null
                      }
                      <Row label="Face Amount"   value={fmt(initial.face_amount)} />
                      <Row label="Death Benefit" value={fmt(initial.death_benefit_amount)} />
                      <Row label="Cash Value"    value={fmt(initial.cash_value_amount)} />
                      <Row label="Cost Basis"    value={fmt(initial.cost_basis)} />
                      <Row
                        label={initial.premium_mode && initial.premium_mode.toLowerCase() !== 'annual'
                          ? `Annual Premium (paid ${initial.premium_mode.toLowerCase()})`
                          : 'Annual Premium'}
                        value={fmt(initial.annual_premium)}
                      />
                      {initial.product_type === 'Term' && (
                        <Row label="Term Length" value={initial.term_length ?? '—'} />
                      )}
                      <Row label="Rate Class" value={editFields.rate_class || '—'} />
                      <Row label="Riders"     value={editFields.riders || '—'} />
                      {/* Primary beneficiary */}
                      <Row label="Primary Beneficiary" value={
                        initial.primary_beneficiary_customer
                          ? <Link href={`/customers/${initial.primary_beneficiary_customer.id}`} className="text-sky-400 hover:underline flex items-center gap-1 justify-end">
                              <Link2 className="w-3 h-3" />
                              {`${initial.primary_beneficiary_customer.first_name} ${initial.primary_beneficiary_customer.last_name}`}
                            </Link>
                          : editFields.primary_beneficiary || '—'
                      } />
                      {/* Contingent beneficiary */}
                      {(initial.contingent_beneficiary_customer || editFields.contingent_beneficiary) && (
                        <Row label="Contingent Beneficiary" value={
                          initial.contingent_beneficiary_customer
                            ? <Link href={`/customers/${initial.contingent_beneficiary_customer.id}`} className="text-sky-400 hover:underline flex items-center gap-1 justify-end">
                                <Link2 className="w-3 h-3" />
                                {`${initial.contingent_beneficiary_customer.first_name} ${initial.contingent_beneficiary_customer.last_name}`}
                              </Link>
                            : editFields.contingent_beneficiary || '—'
                        } />
                      )}
                    </>
                  )}

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

          {/* Right col */}
          <div className="space-y-5">

            {/* SA Status */}
            <Card title="SA Status" icon={
              saStatus === 'confirmed'   ? CheckCircle :
              saStatus === 'not_on_file' ? ShieldOff   :
              FileQuestion
            }>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { value: 'confirmed',   label: 'Confirmed', icon: CheckCircle,  active: 'bg-green-900/50 border-green-700 text-green-300' },
                    { value: 'not_on_file', label: 'Not SA',    icon: ShieldOff,    active: 'bg-amber-900/50 border-amber-700 text-amber-300' },
                    { value: 'unknown',     label: 'Unknown',   icon: FileQuestion, active: 'bg-slate-700 border-slate-600 text-slate-200'    },
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
                      <p className="text-xs text-slate-500 mt-1.5">Sent {fmtDate(formSentAt)}</p>
                    )}
                  </div>
                )}

                {saving && <p className="text-xs text-slate-500 animate-pulse">Saving…</p>}
              </div>
            </Card>

            {/* Agency */}
            <Card title="Agency" icon={Building2}>
              <div className="space-y-2">
                {currentAgency && (
                  <p className="text-sm text-slate-200">{currentAgency.display_name ?? currentAgency.name}</p>
                )}
                <select
                  value={agencyId ?? ''}
                  onChange={e => handleAgencyChange(e.target.value)}
                  disabled={agencySaving}
                  className={`${selectCls} disabled:opacity-50`}
                >
                  <option value="">— Unassigned —</option>
                  {agencies.slice().sort((a,b)=>(a.display_name??a.name).localeCompare(b.display_name??b.name)).map(a => (
                    <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
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

                <CustomerSearch<CustomerResult>
                  theme="dark"
                  placeholder="Search by name or phone…"
                  onSelect={c => handleCustomerLink(c.id, `${c.first_name} ${c.last_name}`)}
                  renderRow={(c, { select }) => (
                    <button
                      type="button"
                      onClick={select}
                      className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-slate-200 transition-colors"
                    >
                      <span className="font-medium">{c.last_name}</span>, {c.first_name}
                      {c.phone && <span className="text-slate-500 text-xs ml-2">{formatPhoneDisplay(c.phone)}</span>}
                    </button>
                  )}
                />
              </div>
            </Card>

          </div>
        </div>

        {/* Reviews */}
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
            <div className="px-5 py-8 text-center text-slate-500 text-sm">No reviews yet</div>
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

      {/* New Service Request Modal */}
      {srModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setSrModalOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">New Service Request</h2>
              <button onClick={() => setSrModalOpen(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-0.5">
              <p className="text-xs text-slate-500 font-mono">{initial.policy_number}</p>
              {customerName && <p className="text-xs text-slate-500">{customerName}</p>}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Request Type <span className="text-red-400">*</span>
                </label>
                <select
                  value={srType}
                  onChange={e => setSrType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-500"
                >
                  <option value="">— Select type —</option>
                  {SR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
                <textarea
                  value={srNotes}
                  onChange={e => setSrNotes(e.target.value)}
                  rows={3}
                  placeholder="Add any relevant details…"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500 resize-none"
                />
              </div>
            </div>

            {err && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {err}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setSrModalOpen(false); setErr(null) }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSR}
                disabled={creatingSr || !srType}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}
              >
                <Plus className="w-3.5 h-3.5" />
                {creatingSr ? 'Creating…' : 'Create SR'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
