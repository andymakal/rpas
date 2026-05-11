'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type Referral = {
  id: string
  client_first_name: string
  client_last_name: string
  referral_type: string
  status: string
  intake_timestamp: string
  lsp_name: string | null
}

type AgencyProps = {
  name: string
  agentId: string
  slug: string
}

const PORTAL_STATUS: Record<string, { label: string; color: string }> = {
  working:              { label: 'In Contact',     color: 'bg-blue-100 text-blue-700' },
  attempting_contact:   { label: 'In Contact',     color: 'bg-blue-100 text-blue-700' },
  appt_set:             { label: 'Appt Set',       color: 'bg-emerald-100 text-emerald-700' },
  appt_kept:            { label: 'Appt Kept',      color: 'bg-emerald-100 text-emerald-700' },
  appt_missed:          { label: 'Appt Missed',    color: 'bg-yellow-100 text-yellow-700' },
  quoted:               { label: 'Quoted',         color: 'bg-purple-100 text-purple-700' },
  app_submitted:        { label: 'In Review',      color: 'bg-indigo-100 text-indigo-700' },
  pending_underwriting: { label: 'In Review',      color: 'bg-indigo-100 text-indigo-700' },
  placed:               { label: 'Placed ✓',       color: 'bg-green-100 text-green-700' },
  not_interested:       { label: 'Not Interested', color: 'bg-slate-100 text-slate-500' },
  declined:             { label: 'Declined',       color: 'bg-red-100 text-red-600' },
  lost:                 { label: 'Not Placed',     color: 'bg-slate-100 text-slate-500' },
}

const TYPE_LABELS: Record<string, string> = {
  mortgage_protection: 'Mortgage Protection',
  life_review:         'Life Review',
  financial_planning:  'Financial Planning',
  business_owner:      'Business Owner',
  umbrella_flagged:    'Umbrella Flagged',
  wanderer_review:     'Wanderer Review',
  '1035_exchange':     '1035 Exchange',
  tobacco_rerate:      'Tobacco Rerate',
  term_expiry:         'Term Expiry',
  annuity_review:      'Annuity Review',
  uit_rollover:        'UIT Rollover',
  general:             'General',
}

export function AgencyPortal({ agency, referrals }: { agency: AgencyProps; referrals: Referral[] }) {
  const [filter, setFilter] = useState('')
  const [savedName, setSavedName] = useState('')

  useEffect(() => {
    const name = localStorage.getItem(`rpas_lsp_${agency.slug}`)
    if (name) { setSavedName(name); setFilter(name) }
  }, [agency.slug])

  const lspNames = Array.from(new Set(referrals.map(r => r.lsp_name).filter(Boolean))) as string[]

  const filtered = filter
    ? referrals.filter(r => r.lsp_name?.toLowerCase().includes(filter.toLowerCase()))
    : referrals

  const active  = referrals.filter(r => !['placed','not_interested','declined','lost'].includes(r.status)).length
  const placed  = referrals.filter(r => r.status === 'placed').length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase">
              Right Path Agency System
            </p>
            <p className="text-white font-bold text-lg leading-tight">{agency.name}</p>
            {agency.agentId && (
              <p className="text-xs text-slate-400 mt-0.5">Agent {agency.agentId}</p>
            )}
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

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-100 p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{referrals.length}</p>
            <p className="text-xs text-slate-500 mt-1">Total Submitted</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{active}</p>
            <p className="text-xs text-slate-500 mt-1">In Progress</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{placed}</p>
            <p className="text-xs text-slate-500 mt-1">Placed</p>
          </div>
        </div>

        {/* Filter */}
        {lspNames.length > 1 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Filter by Staff Member
              </p>
              {filter && (
                <button onClick={() => setFilter('')}
                  className="text-xs text-slate-400 hover:text-slate-600">
                  Show all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {lspNames.map(name => (
                <button key={name} onClick={() => setFilter(filter === name ? '' : name)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    filter === name
                      ? 'bg-slate-800 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Referral List */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            {filter ? `Referrals — ${filter}` : 'All Referrals'}
            <span className="ml-2 font-normal normal-case">({filtered.length})</span>
          </p>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
              <p className="text-slate-400 text-sm">No referrals found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((r) => {
                const status = PORTAL_STATUS[r.status] ?? { label: r.status, color: 'bg-slate-100 text-slate-500' }
                const date = new Date(r.intake_timestamp).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric'
                })
                return (
                  <div key={r.id} className="bg-white rounded-xl border border-slate-100 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {r.client_first_name} {r.client_last_name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {TYPE_LABELS[r.referral_type] ?? r.referral_type}
                          {r.lsp_name && !filter && (
                            <span className="ml-2 text-slate-400">· {r.lsp_name}</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{date}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 pb-4">
          Right Path Agency System · Makal Financial Services, LLC
        </p>
      </div>
    </div>
  )
}