'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { GaugeChart, GDC_BANDS, APP_BANDS } from './GaugeChart'
import { buildHouseholdName } from '@/lib/household'

// ── Types ─────────────────────────────────────────────────────────────────────

type StageTranslation = {
  agency_label: string
  tier: number
  is_active_case: boolean
  is_won: boolean
  is_lost: boolean
  is_prospect: boolean
}

export type Case = {
  id: string
  internal_status: string
  created_at: string
  placed_at: string | null
  face_amount: number | null
  annual_premium: number | null
  is_hot_lead: boolean
  lead_source: string | null
  touches: number | null
  last_contact_at: string | null
  customers: { first_name: string; last_name: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: StageTranslation | null
  products: { name: string; carriers: { short_name: string } | null } | null
  case_household_members: { first_name: string; last_name: string }[] | null
}

export type ServiceRequest = {
  id: string
  sr_number: string | null
  created_at: string
  request_type: string | null
  workflow_status: string | null
  date_received: string | null
  date_resolved: string | null
  service_policies: {
    client_name: string | null
    policy_number: string | null
    agents: { first_name: string; last_name: string } | null
  } | null
}

export type PolicyReview = {
  id: string
  review_number: string | null
  created_at: string
  review_type: string | null
  status: string | null
  assigned_to: string | null
  outcome: string | null
  call_completed_at: string | null
  service_policies: {
    client_name: string | null
    policy_number: string | null
    agents: { first_name: string; last_name: string } | null
  } | null
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

// workflow_status values: open | sa_form_sent | form_sent_to_client | form_sent_to_carrier | resolved | cannot_service
const SR_STATUS_LABELS: Record<string, string> = {
  open:                 'Open',
  sa_form_sent:         'SA Form Sent',
  form_sent_to_client:  'Sent to Client',
  form_sent_to_carrier: 'Sent to Carrier',
  resolved:             'Resolved',
  cannot_service:       'Cannot Service',
}

function srStatusClass(s: string | null | undefined) {
  if (!s) return 'bg-slate-100 text-slate-500'
  if (s === 'resolved')             return 'bg-green-100 text-green-700'
  if (s === 'cannot_service')       return 'bg-slate-100 text-slate-500'
  if (s === 'form_sent_to_carrier') return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'   // open, sa_form_sent, form_sent_to_client
}

// status values: prep | complete | no_contact
const PR_STATUS_LABELS: Record<string, string> = {
  prep:       'In Queue',
  complete:   'Complete',
  no_contact: 'No Contact',
}

// review_type values: term | permanent_ul | permanent_wl
const PR_TYPE_LABELS: Record<string, string> = {
  term:         'Term Review',
  permanent_ul: 'UL Review',
  permanent_wl: 'WL Review',
}

function prStatusClass(s: string | null | undefined) {
  if (!s) return 'bg-slate-100 text-slate-500'
  if (s === 'complete')   return 'bg-green-100 text-green-700'
  if (s === 'no_contact') return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'   // prep
}

function fmtDate(dateStr: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', ...opts
  })
}

// ── Touch log ─────────────────────────────────────────────────────────────────

const TOUCH_LABELS: Record<string, string> = {
  call:               'Call',
  voicemail:          'Voicemail',
  text:               'Text',
  email:              'Email',
  missed_appointment: 'Missed Appt.',
}

type TouchEntry = { touch_type: string; touched_at: string }

function TouchLog({ caseId }: { caseId: string }) {
  const params                      = useParams<{ slug: string }>()
  const [open, setOpen]             = useState(false)
  const [loading, setLoading]       = useState(false)
  const [touches, setTouches]       = useState<TouchEntry[] | null>(null)

  async function toggle() {
    if (open) { setOpen(false); return }
    if (touches !== null) { setOpen(true); return }
    setLoading(true)
    try {
      const res  = await fetch(`/api/portal/${params.slug}/cases/${caseId}/touches`)
      const json = await res.json() as { data?: TouchEntry[] }
      setTouches(json.data ?? [])
    } catch {
      setTouches([])
    } finally {
      setLoading(false)
      setOpen(true)
    }
  }

  const count = touches?.length ?? 0

  return (
    <div className="mt-2.5 pt-2.5 border-t border-slate-100">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        {loading
          ? <span className="w-3.5 h-3.5" />
          : open
            ? <ChevronUp className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        {loading
          ? 'Loading…'
          : open
            ? `Touch Log (${count})`
            : 'Touch Log'}
      </button>
      {open && touches !== null && (
        <div className="mt-2 space-y-1.5">
          {touches.length === 0 ? (
            <p className="text-xs text-slate-300 italic pl-3">No touches logged yet.</p>
          ) : (
            touches.map((t, i) => (
              <div key={i} className="flex items-center gap-3 pl-3 text-xs">
                <span className="font-medium text-slate-600 w-24 shrink-0">
                  {TOUCH_LABELS[t.touch_type] ?? t.touch_type}
                </span>
                <span className="text-slate-400">
                  {new Date(t.touched_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
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
  const label       = c.stage_translations?.agency_label ?? c.internal_status
  const date        = fmtDate(c.created_at)
  const lsp         = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const lastContact = c.last_contact_at
    ? `Last contact ${fmtDate(c.last_contact_at, { month: 'short', day: 'numeric' })}`
    : null
  const touchCount  = c.touches ?? 0
  return (
    <div className={`rounded-xl border px-4 py-3 ${c.is_hot_lead ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {c.is_hot_lead && <span title="Hot Lead" className="text-base leading-none">🔥</span>}
            {buildHouseholdName(c.customers ?? null, c.case_household_members ?? [])}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{date}</p>
          {lastContact && (
            <p className="text-xs text-slate-400 mt-0.5">
              {lastContact}
              {touchCount > 0 && <span className="ml-1 text-slate-300">· {touchCount} touch{touchCount !== 1 ? 'es' : ''}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AgeBadge dateStr={c.created_at} />
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
              {label}
            </span>
          </div>
          {c.lead_source && c.lead_source !== 'agency_referral' && (
            <p className="text-xs font-medium text-indigo-500">EFS Generated</p>
          )}
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
        </div>
      </div>
      <TouchLog caseId={c.id} />
    </div>
  )
}

function PendingCard({ c }: { c: Case }) {
  const label       = c.stage_translations?.agency_label ?? c.internal_status
  const carrier     = c.products?.carriers?.short_name
  const product     = c.products?.name
  const face        = formatCurrency(c.face_amount)
  const lsp         = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const subtitle    = [carrier, product, face].filter(Boolean).join(' · ')
  const lastContact = c.last_contact_at
    ? `Last contact ${fmtDate(c.last_contact_at, { month: 'short', day: 'numeric' })}`
    : null
  const touchCount  = c.touches ?? 0
  return (
    <div className={`rounded-xl border px-4 py-3 ${c.is_hot_lead ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {c.is_hot_lead && <span title="Hot Lead" className="text-base leading-none">🔥</span>}
            {buildHouseholdName(c.customers ?? null, c.case_household_members ?? [])}
          </p>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          {lastContact && (
            <p className="text-xs text-slate-400 mt-0.5">
              {lastContact}
              {touchCount > 0 && <span className="ml-1 text-slate-300">· {touchCount} touch{touchCount !== 1 ? 'es' : ''}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AgeBadge dateStr={c.created_at} />
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
              {label}
            </span>
          </div>
          {c.lead_source && c.lead_source !== 'agency_referral' && (
            <p className="text-xs font-medium text-indigo-500">EFS Generated</p>
          )}
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
        </div>
      </div>
      <TouchLog caseId={c.id} />
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
            {buildHouseholdName(c.customers ?? null, c.case_household_members ?? [])}
          </p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          <p className="text-xs text-emerald-600 mt-0.5">Placed {date}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
            Policy Placed
          </span>
          {c.lead_source && c.lead_source !== 'agency_referral' && (
            <p className="text-xs font-medium text-indigo-500">EFS Generated</p>
          )}
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
              {buildHouseholdName(c.customers ?? null, c.case_household_members ?? [])}
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
            {c.lead_source && c.lead_source !== 'agency_referral' && (
            <p className="text-xs font-medium text-indigo-500">EFS Generated</p>
          )}
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
          </div>
        </div>
      </div>

      {!expanded && (
        <div className="px-4 pb-3">
          <TouchLog caseId={c.id} />
        </div>
      )}
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

// ── LSP Re-Engage card ────────────────────────────────────────────────────────
// Shown in the Active Referrals section when a case is at lsp_contact_needed.
// Lets the LSP signal that the client is still interested, which moves the
// case back to triage so the RP team can pick it up again.

function LspReEngageCard({ c, agentFilter, onReengage }: {
  c: Case
  agentFilter: string
  onReengage: (caseId: string, note: string, lspName: string) => Promise<void>
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
      await onReengage(c.id, note.trim(), agentFilter)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${expanded ? 'border-blue-300' : 'border-amber-200'}`}>
      <div className={`px-4 py-3 ${expanded ? 'bg-blue-50' : 'bg-amber-50/60'}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700">
              {buildHouseholdName(c.customers ?? null, c.case_household_members ?? [])}
            </p>
            <p className="text-xs text-amber-700 font-medium mt-0.5">LSP Re-Warm Needed</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              onClick={() => { setExpanded(o => !o); setSubmitError(null) }}
              className={`text-xs font-semibold rounded-lg px-2.5 py-1 border transition-all ${
                expanded
                  ? 'border-blue-300 bg-blue-100 text-blue-700'
                  : 'border-amber-300 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {expanded ? 'Cancel' : 'Still interested?'}
            </button>
            {c.lead_source && c.lead_source !== 'agency_referral' && (
            <p className="text-xs font-medium text-indigo-500">EFS Generated</p>
          )}
          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-blue-200 bg-blue-50/60 px-4 py-4 space-y-3">
          <p className="text-xs font-medium text-slate-600">
            What did the client say? Give us enough detail to follow up effectively.
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Spoke with him — he's ready to talk options, best time is evenings after 6pm..."
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent resize-none"
          />
          {submitError && <p className="text-xs text-red-600">{submitError}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400 leading-snug">
              Will be flagged 🔥 and returned to the contact queue
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting || !note.trim()}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting…' : 'Back in queue 🔥'}
            </button>
          </div>
        </div>
      )}
      {!expanded && (
        <div className="px-4 pb-3">
          <TouchLog caseId={c.id} />
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

  async function handleLspReengage(caseId: string, note: string, lspName: string) {
    const res = await fetch(`/api/portal/${agency.slug}/cases/${caseId}/lsp-reengaged`, {
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
  // Kept appointments = SPIFF records (SPIFF checkbox is set exactly when an appointment was kept)
  // spiffRecords are already YTD-filtered by the server query
  const keptAppts       = spiffRecords.length
  const apptRate        = tier1Ytd.length > 0 ? Math.round(keptAppts / tier1Ytd.length * 100) : null
  const pendingCount    = cases.filter(c => (c.stage_translations?.tier ?? 0) >= 2 && c.stage_translations?.is_active_case).length
  const placedCount     = cases.filter(c => c.stage_translations?.is_won === true).length
  const placementRate   = totalReferrals > 0 ? Math.round(placedCount / totalReferrals * 100) : null

  // ── Filtered + sorted lists ─────────────────────────────────────────────────
  const hotFirst     = (a: Case, b: Case) => (b.is_hot_lead ? 1 : 0) - (a.is_hot_lead ? 1 : 0)
  const referrals    = filtered.filter(c => c.stage_translations?.tier === 1 && c.stage_translations?.is_active_case).sort(hotFirst)
  const pendingCases = filtered.filter(c => (c.stage_translations?.tier ?? 0) >= 2 && c.stage_translations?.is_active_case).sort(hotFirst)
  const placedCases  = filtered.filter(c => c.stage_translations?.is_won === true)
  const closedCases   = filtered.filter(c => c.stage_translations?.is_lost === true || c.internal_status === 'snoozed')
  const prospectCases = filtered.filter(c => c.stage_translations?.is_prospect === true)

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
                  {referrals.map(c =>
                    c.internal_status === 'lsp_contact_needed'
                      ? <LspReEngageCard key={c.id} c={c} agentFilter={agentFilter} onReengage={handleLspReengage} />
                      : <ReferralCard    key={c.id} c={c} />
                  )}
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

            {/* Parked Prospects — not_interested, potentially re-engageable */}
            {prospectCases.length > 0 && (
              <div>
                <SectionHeader label="Parked Prospects" count={prospectCases.length} />
                <div className="space-y-2">
                  {prospectCases.map(c => (
                    <ClosedCard key={c.id} c={c} agentFilter={agentFilter} onRewarm={handleRewarm} />
                  ))}
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
                <SectionHeader label="Service Requests" count={serviceRequests.filter(r => !r.date_resolved).length} />
                <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
                  {serviceRequests.map(sr => {
                    const lsp = sr.service_policies?.agents
                      ? `${sr.service_policies.agents.first_name} ${sr.service_policies.agents.last_name}`
                      : null
                    return (
                      <div key={sr.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {sr.service_policies?.client_name ?? '—'}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {sr.request_type ?? '—'}
                            {sr.service_policies?.policy_number ? ` · ${sr.service_policies.policy_number}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            {!sr.date_resolved && <AgeBadge dateStr={sr.created_at} />}
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${srStatusClass(sr.workflow_status)}`}>
                              {SR_STATUS_LABELS[sr.workflow_status ?? ''] ?? sr.workflow_status ?? '—'}
                            </span>
                          </div>
                          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Policy Reviews */}
            {policyReviews.length > 0 && (
              <div>
                <SectionHeader label="Policy Reviews" count={policyReviews.filter(r => r.status !== 'complete').length} />
                <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
                  {policyReviews.map(pr => {
                    const lsp = pr.service_policies?.agents
                      ? `${pr.service_policies.agents.first_name} ${pr.service_policies.agents.last_name}`
                      : null
                    return (
                      <div key={pr.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {pr.service_policies?.client_name ?? '—'}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {PR_TYPE_LABELS[pr.review_type ?? ''] ?? pr.review_type ?? '—'}
                            {pr.service_policies?.policy_number ? ` · ${pr.service_policies.policy_number}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            {pr.status !== 'complete' && <AgeBadge dateStr={pr.created_at} />}
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${prStatusClass(pr.status)}`}>
                              {PR_STATUS_LABELS[pr.status ?? ''] ?? pr.status ?? '—'}
                            </span>
                          </div>
                          {lsp && <p className="text-xs text-slate-400">{lsp}</p>}
                        </div>
                      </div>
                    )
                  })}
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
