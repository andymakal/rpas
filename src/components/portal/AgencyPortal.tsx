'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { GaugeChart, GDC_BANDS, APP_BANDS } from './GaugeChart'

type StageTranslation = {
  agency_label: string
  tier: number
  is_active_case: boolean
  is_won: boolean
  is_lost: boolean
}

export type Case = {
  id: string
  internal_status: string
  created_at: string
  placed_at: string | null
  face_amount: number | null
  annual_premium: number | null
  customers: { first_name: string; last_name: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: StageTranslation | null
  products: { name: string; carriers: { short_name: string } | null } | null
}

export type ServiceRequest = {
  id: string
  created_at: string
  resolved_at: string | null
  customers: { first_name: string; last_name: string } | null
  carriers: { short_name: string } | null
  service_request_types: { name: string } | null
  request_statuses: { name: string } | null
}

export type PolicyReview = {
  id: string
  created_at: string
  reviewed_at: string | null
  customers: { first_name: string; last_name: string } | null
  carriers: { short_name: string } | null
  review_statuses: { name: string } | null
  opportunity_types: { name: string } | null
}

export type SpiffRecord = {
  id: string
  earned_at: string
  paid_at: string | null
  amount: number
  agents: { first_name: string; last_name: string } | null
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
  if (!st.is_active_case) return 'bg-slate-100 text-slate-500'
  if (st.tier >= 4) return 'bg-violet-100 text-violet-700'   // deep underwriting / approved
  if (st.tier === 3) return 'bg-indigo-100 text-indigo-700'  // submitted / in review
  if (st.tier === 2) return 'bg-amber-100 text-amber-700'    // app in progress
  return 'bg-blue-100 text-blue-700'                         // tier 1 referral
}

function srStatusClass(s: string | undefined) {
  if (!s) return 'bg-slate-100 text-slate-500'
  if (s === 'Resolved' || s === 'Converted to Review') return 'bg-green-100 text-green-700'
  if (s === 'Awaiting Carrier' || s === 'Pending Client Response') return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'
}

function prStatusClass(s: string | undefined) {
  if (!s) return 'bg-slate-100 text-slate-500'
  if (s.startsWith('New Policy') || s.startsWith('Completed')) return 'bg-green-100 text-green-700'
  if (s === 'Client Declined' || s === 'Complete — No Changes') return 'bg-slate-100 text-slate-500'
  if (s === 'Quoted — Follow Up' || s === 'Follow-Up Needed') return 'bg-amber-100 text-amber-700'
  if (s === 'In Progress') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-600'
}

// ── Case cards ────────────────────────────────────────────────────────────────

function ReferralCard({ c }: { c: Case }) {
  const label = c.stage_translations?.agency_label ?? c.internal_status
  const date  = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const lsp   = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{date}{lsp ? ` · ${lsp}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <AgeBadge dateStr={c.created_at} />
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
            {label}
          </span>
        </div>
      </div>
    </div>
  )
}

function PendingCard({ c }: { c: Case }) {
  const label    = c.stage_translations?.agency_label ?? c.internal_status
  const carrier  = c.products?.carriers?.short_name
  const product  = c.products?.name
  const face     = formatCurrency(c.face_amount)
  const lsp      = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {carrier ?? '—'}{product ? ` · ${product}` : ''}{face ? ` · ${face}` : ''}{lsp ? ` · ${lsp}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <AgeBadge dateStr={c.created_at} />
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stageBadgeClass(c.stage_translations)}`}>
            {label}
          </span>
        </div>
      </div>
    </div>
  )
}

function PlacedCard({ c }: { c: Case }) {
  const carrier = c.products?.carriers?.short_name
  const product = c.products?.name
  const face    = formatCurrency(c.face_amount)
  const lsp     = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const date    = c.placed_at
    ? new Date(c.placed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <div className="bg-emerald-50 rounded-xl border border-emerald-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {carrier ?? '—'}{product ? ` · ${product}` : ''}{face ? ` · ${face}` : ''}{lsp ? ` · ${lsp}` : ''}
          </p>
          <p className="text-xs text-emerald-600 mt-0.5">Placed {date}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 bg-emerald-100 text-emerald-700">
          Policy Placed
        </span>
      </div>
    </div>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
      {label} <span className="ml-2 font-normal normal-case">({count})</span>
    </p>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgencyPortal({
  agency, cases, gdcYtd, appCount, serviceRequests, policyReviews, spiffRecords,
}: {
  agency:          AgencyProps
  cases:           Case[]
  gdcYtd:          number
  appCount:        number
  serviceRequests: ServiceRequest[]
  policyReviews:   PolicyReview[]
  spiffRecords:    SpiffRecord[]
}) {
  const [agentFilter, setAgentFilter] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(`rpas_lsp_${agency.slug}`)
    if (saved) setAgentFilter(saved)
  }, [agency.slug])

  const agentNames = Array.from(new Set(
    cases.map(c => c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null).filter(Boolean)
  )) as string[]

  const filtered = agentFilter
    ? cases.filter(c => {
        const name = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : ''
        return name.toLowerCase().includes(agentFilter.toLowerCase())
      })
    : cases

  // KPI counts — always agency-wide (not filtered by agent)
  const now         = new Date()
  const d30         = new Date(now); d30.setDate(d30.getDate() - 30)
  const d60         = new Date(now); d60.setDate(d60.getDate() - 60)

  const tier1          = cases.filter(c => c.stage_translations?.tier === 1)
  const totalReferrals = tier1.length
  const activeReferrals= tier1.filter(c => c.stage_translations?.is_active_case).length
  const referrals30d   = tier1.filter(c => new Date(c.created_at) >= d30).length
  const referrals60d   = tier1.filter(c => new Date(c.created_at) >= d60).length
  const keptAppts      = cases.filter(c => c.internal_status === 'appointment_kept').length
  const apptRate       = totalReferrals > 0 ? Math.round(keptAppts / totalReferrals * 100) : null
  const pendingCount   = cases.filter(c => (c.stage_translations?.tier ?? 0) >= 2 && c.stage_translations?.is_active_case).length
  const placedCount    = cases.filter(c => c.stage_translations?.is_won === true).length
  const placementRate  = totalReferrals > 0 ? Math.round(placedCount / totalReferrals * 100) : null

  // Filtered lists
  const referrals    = filtered.filter(c => c.stage_translations?.tier === 1 && c.stage_translations?.is_active_case)
  const pendingCases = filtered.filter(c => (c.stage_translations?.tier ?? 0) >= 2 && c.stage_translations?.is_active_case)
  const placedCases  = filtered.filter(c => c.stage_translations?.is_won === true)
  const closedCases  = filtered.filter(c => c.stage_translations?.is_lost === true || c.internal_status === 'snoozed')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 px-6 py-5">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase mb-1">
                Right Path Agency System
              </p>
              <p className="text-white font-bold text-xl leading-tight">{agency.name}</p>
              {(agency.street || agency.phone || agency.email) && (
                <div className="mt-2 space-y-0.5">
                  {agency.street && (
                    <p className="text-slate-400 text-xs">
                      {agency.street}{agency.city ? `, ${agency.city}` : ''}{agency.state ? `, ${agency.state}` : ''}{agency.zip ? ` ${agency.zip}` : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-4">
                    {agency.phone && (
                      <a href={`tel:${agency.phone}`} className="text-slate-300 text-xs hover:text-white transition-colors">
                        {agency.phone}
                      </a>
                    )}
                    {agency.email && (
                      <a href={`mailto:${agency.email}`} className="text-slate-300 text-xs hover:text-white transition-colors">
                        {agency.email}
                      </a>
                    )}
                  </div>
                </div>
              )}
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

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Gauges */}
        <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4 text-center">
            {new Date().getFullYear()} Goal Progress
          </p>
          <div className="grid grid-cols-2 gap-6">
            <GaugeChart value={gdcYtd} max={100000} bands={GDC_BANDS} label="GDC Year-to-Date" formatValue={formatGdc} />
            <GaugeChart value={appCount} max={50} bands={APP_BANDS} label="App Count" formatValue={v => String(Math.round(v))} />
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
              <p className="text-2xl font-bold text-blue-500">{keptAppts}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Kept Appts{apptRate !== null ? <span className="text-slate-400"> · {apptRate}%</span> : ''}
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">{pendingCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">In Underwriting</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{placedCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Placed{placementRate !== null ? <span className="text-slate-400"> · {placementRate}%</span> : ''}
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-400">{serviceRequests.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Service Reqs
                {serviceRequests.length > 0 && (
                  <span className="block text-slate-400">
                    {serviceRequests.filter(s => !s.resolved_at).length} open
                    {' · '}
                    {serviceRequests.filter(s => !!s.resolved_at).length} closed
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Agent filter */}
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
              {referrals.map(c => <ReferralCard key={c.id} c={c} />)}
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

        {/* Placed — wins */}
        {placedCases.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-3">
              Placed Policies <span className="ml-2 font-normal normal-case text-slate-500">({placedCases.length})</span>
            </p>
            <div className="space-y-2">
              {placedCases.map(c => <PlacedCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {/* Closed / Paused */}
        {closedCases.length > 0 && (
          <div>
            <SectionHeader label="Closed / Paused" count={closedCases.length} />
            <div className="space-y-2">
              {closedCases.map(c => {
                const lsp = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
                return (
                  <div key={c.id} className="bg-white rounded-xl border border-slate-100 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-500">
                          {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
                        </p>
                        {lsp && <p className="text-xs text-slate-400 mt-0.5">{lsp}</p>}
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${stageBadgeClass(c.stage_translations)}`}>
                        {c.stage_translations?.agency_label ?? c.internal_status}
                      </span>
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

        {/* Client Services */}
        {(serviceRequests.length > 0 || policyReviews.length > 0) && (
          <div className="bg-white rounded-2xl border border-slate-100 px-5 py-5 space-y-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Client Services
            </p>

            {serviceRequests.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Service Requests
                  <span className="ml-2 font-normal normal-case">
                    ({serviceRequests.filter(r => !r.resolved_at).length} open)
                  </span>
                </p>
                {serviceRequests.map(sr => (
                  <div key={sr.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {sr.customers ? `${sr.customers.first_name} ${sr.customers.last_name}` : '—'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {sr.service_request_types?.name ?? '—'}
                        {sr.carriers?.short_name ? ` · ${sr.carriers.short_name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!sr.resolved_at && <AgeBadge dateStr={sr.created_at} />}
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${srStatusClass(sr.request_statuses?.name)}`}>
                        {sr.request_statuses?.name ?? '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {policyReviews.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Policy Reviews
                  <span className="ml-2 font-normal normal-case">
                    ({policyReviews.filter(r => !r.reviewed_at).length} open)
                  </span>
                </p>
                {policyReviews.map(pr => (
                  <div key={pr.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {pr.customers ? `${pr.customers.first_name} ${pr.customers.last_name}` : '—'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {pr.carriers?.short_name ?? '—'}
                        {pr.opportunity_types?.name ? ` · ${pr.opportunity_types.name}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${prStatusClass(pr.review_statuses?.name)}`}>
                      {pr.review_statuses?.name ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SPIFF earnings */}
        {spiffRecords.length > 0 && (() => {
          // Summarise by LSP
          const byAgent = new Map<string, { name: string; earned: number; paid: number; count: number }>()
          for (const r of spiffRecords) {
            const key  = r.agents ? `${r.agents.first_name} ${r.agents.last_name}` : 'Unknown'
            const prev = byAgent.get(key) ?? { name: key, earned: 0, paid: 0, count: 0 }
            byAgent.set(key, {
              name:    key,
              earned:  prev.earned + Number(r.amount),
              paid:    prev.paid   + (r.paid_at ? Number(r.amount) : 0),
              count:   prev.count  + 1,
            })
          }
          const rows = Array.from(byAgent.values()).sort((a, b) => b.earned - a.earned)
          const totalEarned      = spiffRecords.reduce((s, r) => s + Number(r.amount), 0)
          const totalOutstanding = spiffRecords.filter(r => !r.paid_at).reduce((s, r) => s + Number(r.amount), 0)

          return (
            <div className="bg-white rounded-2xl border border-slate-100 px-5 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">SPIFF Earnings</p>
                <div className="text-right">
                  <p className="text-xs text-slate-400">
                    ${totalEarned.toFixed(2)} earned
                    {totalOutstanding > 0 && <span className="text-amber-600 ml-2">${totalOutstanding.toFixed(2)} pending</span>}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {rows.map(r => (
                  <div key={r.name} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{r.name}</p>
                      <p className="text-xs text-slate-400">{r.count} qualified conversation{r.count !== 1 ? 's' : ''}</p>
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
          )
        })()}

        <p className="text-center text-xs text-slate-400 pb-4">
          Right Path Agency System · Makal Financial Services, LLC
        </p>
      </div>
    </div>
  )
}
