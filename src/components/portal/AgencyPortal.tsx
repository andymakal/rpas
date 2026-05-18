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
  customers: { first_name: string; last_name: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: StageTranslation | null
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
  name: string
  slug: string
}

const TIER_BADGE: Record<number, { color: string }> = {
  1: { color: 'bg-blue-100 text-blue-700' },
  2: { color: 'bg-indigo-100 text-indigo-700' },
  3: { color: 'bg-emerald-100 text-emerald-700' },
}

function statusBadgeClass(st: StageTranslation | null, internal_status: string): string {
  if (internal_status === 'placed' || st?.is_won) return 'bg-green-100 text-green-700'
  if (st?.is_lost) return 'bg-slate-100 text-slate-500'
  if (internal_status === 'snoozed') return 'bg-yellow-100 text-yellow-700'
  return TIER_BADGE[st?.tier ?? 1]?.color ?? 'bg-slate-100 text-slate-500'
}

function formatGdc(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${Math.round(v)}`
}

function formatApps(v: number) {
  return String(Math.round(v))
}

function srStatusClass(statusName: string | undefined): string {
  if (!statusName) return 'bg-slate-100 text-slate-500'
  if (statusName === 'Resolved' || statusName === 'Converted to Review') return 'bg-green-100 text-green-700'
  if (statusName === 'Awaiting Carrier' || statusName === 'Pending Client Response') return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'
}

function prStatusClass(statusName: string | undefined): string {
  if (!statusName) return 'bg-slate-100 text-slate-500'
  if (statusName.startsWith('New Policy') || statusName.startsWith('Completed')) return 'bg-green-100 text-green-700'
  if (statusName === 'Client Declined' || statusName === 'Complete — No Changes') return 'bg-slate-100 text-slate-500'
  if (statusName === 'Quoted — Follow Up' || statusName === 'Follow-Up Needed') return 'bg-amber-100 text-amber-700'
  if (statusName === 'In Progress') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-600'
}

export function AgencyPortal({
  agency,
  cases,
  gdcYtd,
  appCount,
  serviceRequests,
  policyReviews,
}: {
  agency: AgencyProps
  cases: Case[]
  gdcYtd: number
  appCount: number
  serviceRequests: ServiceRequest[]
  policyReviews: PolicyReview[]
}) {
  const [agentFilter, setAgentFilter] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(`rpas_lsp_${agency.slug}`)
    if (saved) setAgentFilter(saved)
  }, [agency.slug])

  const agentNames = Array.from(
    new Set(
      cases
        .map(c => c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null)
        .filter(Boolean)
    )
  ) as string[]

  const filtered = agentFilter
    ? cases.filter(c => {
        const name = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : ''
        return name.toLowerCase().includes(agentFilter.toLowerCase())
      })
    : cases

  // KPI counts (unfiltered — always show agency-wide totals)
  const totalReferrals   = cases.length
  const keptAppts        = cases.filter(c => (c.stage_translations?.tier ?? 0) >= 2 || c.stage_translations?.is_won).length
  const pendingCases     = cases.filter(c => c.stage_translations?.tier === 2 && c.stage_translations?.is_active_case).length
  const placedCount      = cases.filter(c => c.stage_translations?.is_won === true).length

  // Case lists (filtered by agent)
  const activeCases = filtered.filter(c => c.stage_translations?.is_active_case === true)
  const placedCases = filtered.filter(c => c.stage_translations?.is_won === true)
  const closedCases = filtered.filter(c =>
    c.stage_translations?.is_lost === true || c.internal_status === 'snoozed'
  )

  function CaseCard({ c }: { c: Case }) {
    const st = c.stage_translations
    const badgeCls = statusBadgeClass(st, c.internal_status)
    const label = st?.agency_label ?? c.internal_status
    const date = new Date(c.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
    const agentName = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null

    return (
      <div className="bg-white rounded-xl border border-slate-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {agentName && !agentFilter && (
                <span className="text-slate-400">{agentName} · </span>
              )}
              {date}
            </p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${badgeCls}`}>
            {label}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase">
              Right Path Agency System
            </p>
            <p className="text-white font-bold text-lg leading-tight">{agency.name}</p>
          </div>
          <Link
            href={`/intake/${agency.slug}`}
            className="text-xs font-semibold text-slate-300 border border-slate-600
              rounded-lg px-3 py-2 hover:bg-slate-800 transition-colors"
          >
            + Submit Referral
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Gauges */}
        <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4 text-center">
            {new Date().getFullYear()} Goal Progress
          </p>
          <div className="grid grid-cols-2 gap-6">
            <GaugeChart
              value={gdcYtd}
              max={100000}
              bands={GDC_BANDS}
              label="GDC Year-to-Date"
              formatValue={formatGdc}
            />
            <GaugeChart
              value={appCount}
              max={50}
              bands={APP_BANDS}
              label="App Count"
              formatValue={formatApps}
            />
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
            <p className="text-2xl font-bold text-indigo-600">{pendingCases}</p>
            <p className="text-xs text-slate-500 mt-1">Pending</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{placedCount}</p>
            <p className="text-xs text-slate-500 mt-1">Placed</p>
          </div>
        </div>

        {agentNames.length > 1 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Filter by LSP
              </p>
              {agentFilter && (
                <button onClick={() => setAgentFilter('')}
                  className="text-xs text-slate-400 hover:text-slate-600">
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

        {activeCases.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              In Progress <span className="ml-2 font-normal normal-case">({activeCases.length})</span>
            </p>
            <div className="space-y-2">
              {activeCases.map(c => <CaseCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {placedCases.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Placed <span className="ml-2 font-normal normal-case">({placedCases.length})</span>
            </p>
            <div className="space-y-2">
              {placedCases.map(c => <CaseCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {closedCases.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Closed / Paused <span className="ml-2 font-normal normal-case">({closedCases.length})</span>
            </p>
            <div className="space-y-2">
              {closedCases.map(c => <CaseCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
            <p className="text-slate-400 text-sm">No cases found.</p>
          </div>
        )}

        {/* Client Services — transparency panel */}
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
                {serviceRequests.map(sr => {
                  const clientName = sr.customers
                    ? `${sr.customers.first_name} ${sr.customers.last_name}`
                    : '—'
                  const status = sr.request_statuses?.name
                  const type   = sr.service_request_types?.name ?? '—'
                  const carrier = sr.carriers?.short_name
                  return (
                    <div key={sr.id} className="flex items-center justify-between gap-3 py-2
                      border-b border-slate-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{clientName}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {type}{carrier ? ` · ${carrier}` : ''}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0
                        ${srStatusClass(status)}`}>
                        {status ?? '—'}
                      </span>
                    </div>
                  )
                })}
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
                {policyReviews.map(pr => {
                  const clientName = pr.customers
                    ? `${pr.customers.first_name} ${pr.customers.last_name}`
                    : '—'
                  const status = pr.review_statuses?.name
                  const carrier = pr.carriers?.short_name
                  const opportunity = pr.opportunity_types?.name
                  return (
                    <div key={pr.id} className="flex items-center justify-between gap-3 py-2
                      border-b border-slate-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{clientName}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {carrier ?? '—'}{opportunity ? ` · ${opportunity}` : ''}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0
                        ${prStatusClass(status)}`}>
                        {status ?? '—'}
                      </span>
                    </div>
                  )
                })}
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
