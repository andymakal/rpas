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
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{date}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 bg-blue-100 text-blue-700">
          {label}
        </span>
      </div>
    </div>
  )
}

function PendingCard({ c }: { c: Case }) {
  const label    = c.stage_translations?.agency_label ?? c.internal_status
  const carrier  = c.products?.carriers?.short_name
  const product  = c.products?.name
  const face     = formatCurrency(c.face_amount)
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {carrier ?? '—'}{product ? ` · ${product}` : ''}{face ? ` · ${face}` : ''}
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 bg-indigo-100 text-indigo-700">
          {label}
        </span>
      </div>
    </div>
  )
}

function PlacedCard({ c }: { c: Case }) {
  const carrier = c.products?.carriers?.short_name
  const product = c.products?.name
  const face    = formatCurrency(c.face_amount)
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
            {carrier ?? '—'}{product ? ` · ${product}` : ''}{face ? ` · ${face}` : ''}
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
  agency, cases, gdcYtd, appCount, serviceRequests, policyReviews,
}: {
  agency:          AgencyProps
  cases:           Case[]
  gdcYtd:          number
  appCount:        number
  serviceRequests: ServiceRequest[]
  policyReviews:   PolicyReview[]
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

  // KPI counts — always agency-wide
  const totalReferrals = cases.length
  const keptAppts      = cases.filter(c => (c.stage_translations?.tier ?? 0) >= 2 || c.stage_translations?.is_won).length
  const pendingCount   = cases.filter(c => c.stage_translations?.tier === 2 && c.stage_translations?.is_active_case).length
  const placedCount    = cases.filter(c => c.stage_translations?.is_won === true).length

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

        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-2xl font-bold text-slate-900">{totalReferrals}</p>
            <p className="text-xs text-slate-500 mt-1">Referrals</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{keptAppts}</p>
            <p className="text-xs text-slate-500 mt-1">Kept Appts</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-2xl font-bold text-indigo-600">{pendingCount}</p>
            <p className="text-xs text-slate-500 mt-1">Pending</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{placedCount}</p>
            <p className="text-xs text-slate-500 mt-1">Placed</p>
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
              {closedCases.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-slate-100 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-500">
                      {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
                    </p>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 bg-slate-100 text-slate-500">
                      {c.stage_translations?.agency_label ?? c.internal_status}
                    </span>
                  </div>
                </div>
              ))}
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
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${srStatusClass(sr.request_statuses?.name)}`}>
                      {sr.request_statuses?.name ?? '—'}
                    </span>
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

        <p className="text-center text-xs text-slate-400 pb-4">
          Right Path Agency System · Makal Financial Services, LLC
        </p>
      </div>
    </div>
  )
}
