'use client'

import { useState, useMemo, useEffect } from 'react'
import { ChevronUp, ChevronDown, Search, Trophy, TrendingUp, AlertCircle, Star, Mail, X, Copy, ExternalLink } from 'lucide-react'
import type { ScorecardRow } from './page'
import { TEMPLATES, interpolate, buildMailto } from '@/lib/templates'

const POLICY_GOAL = 12  // applies to both annual (Participating) and quarterly (bonus pool)

function fmt$(v: number): string {
  if (v === 0) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

type SortKey = 'name' | 'policies' | 'gdc' | 'referrals' | 'pending' | 'placed_premium' | 'conversion'
type View    = 'quarter' | 'ytd'

// ── Goal progress bar ─────────────────────────────────────────────────────────
function GoalBar({ count, isQuarter }: { count: number; isQuarter: boolean }) {
  const capped   = Math.min(count, POLICY_GOAL)
  const pctFull  = (capped / POLICY_GOAL) * 100
  const achieved = count >= POLICY_GOAL

  const barColor = achieved
    ? 'bg-emerald-500'
    : count >= 9  ? 'bg-amber-400'
    : count >= 5  ? 'bg-blue-400'
    : 'bg-slate-600'

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden min-w-[56px]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pctFull}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums whitespace-nowrap ${
        achieved ? (isQuarter ? 'text-amber-300' : 'text-emerald-400') : 'text-slate-300'
      }`}>
        {count}/{POLICY_GOAL}
        {achieved && <span className="ml-1">{isQuarter ? '🏆' : '✓'}</span>}
      </span>
    </div>
  )
}

// ── Status badge — two modes ──────────────────────────────────────────────────
function AnnualBadge({ count }: { count: number }) {
  if (count >= POLICY_GOAL) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
      <Trophy className="w-3 h-3" /> Participating
    </span>
  )
  if (count >= 9) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 whitespace-nowrap">
      <TrendingUp className="w-3 h-3" /> On Pace
    </span>
  )
  if (count >= 5) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 whitespace-nowrap">
      Progressing
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 whitespace-nowrap">
      <AlertCircle className="w-3 h-3" /> At Risk
    </span>
  )
}

function QuarterBadge({ count }: { count: number }) {
  if (count >= POLICY_GOAL) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 whitespace-nowrap">
      <Star className="w-3 h-3" /> Bonus Pool
    </span>
  )
  if (count >= 9) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap">
      <TrendingUp className="w-3 h-3" /> Close
    </span>
  )
  if (count >= 5) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700/60 text-slate-300 border border-slate-600 whitespace-nowrap">
      In Progress
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-500 border border-slate-700 whitespace-nowrap">
      Early
    </span>
  )
}

// ── Q4 email helpers ──────────────────────────────────────────────────────────

function buildStatusNote(count: number): string {
  if (count >= 19) return `You currently have ${count} placed — you've hit both milestones. Outstanding work.`
  if (count >= 12) return `You currently have ${count} placed — you've already hit Participating status. ${19 - count} more puts you on the bonus grid.`
  if (count >= 9)  return `You currently have ${count} placed and you're on pace for Participating status. ${12 - count} more locks it in.`
  if (count >= 5)  return `You currently have ${count} placed. You need ${12 - count} more for Participating status by year-end.`
  return `You currently have ${count} ${count === 1 ? 'policy' : 'policies'} placed. There's still time to make real progress before year-end.`
}

function buildEmailBody(agency: ScorecardRow): string {
  const portalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${agency.slug}`
  return interpolate(TEMPLATES.q4_agency.body, {
    agency_name:  agency.display_name ?? agency.name,
    portal_url:   portalUrl,
    status_note:  buildStatusNote(agency.allstate_policy_count),
  })
}

// ── Q4 Email Modal ────────────────────────────────────────────────────────────

function Q4EmailModal({ agency, onClose }: { agency: ScorecardRow; onClose: () => void }) {
  const subject = TEMPLATES.q4_agency.subject
  const [body,   setBody]   = useState(() => buildEmailBody(agency))
  const [copied, setCopied] = useState(false)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function copyBody() {
    navigator.clipboard.writeText(body)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => {
        const ta = document.getElementById('q4-email-body') as HTMLTextAreaElement | null
        ta?.select()
      })
  }

  const mailto = buildMailto(agency.contact_email, subject, body)
  const hasEmail = !!agency.contact_email

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Q4 Agency Email</p>
            <h2 className="text-white font-semibold text-base leading-tight">{agency.display_name ?? agency.name}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 -mr-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fields */}
        <div className="px-5 pt-4 flex-shrink-0 space-y-3">
          {/* To */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 w-14 text-right flex-shrink-0">To</span>
            {hasEmail ? (
              <span className="text-slate-200 font-mono text-xs bg-slate-800 rounded px-2.5 py-1.5 flex-1">
                {agency.contact_email}
              </span>
            ) : (
              <span className="text-amber-400 text-xs bg-amber-900/30 border border-amber-800/50 rounded px-2.5 py-1.5 flex-1">
                No contact email on file — add one in the Agency record before sending
              </span>
            )}
          </div>

          {/* Subject */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 w-14 text-right flex-shrink-0">Subject</span>
            <span className="text-slate-200 text-sm bg-slate-800 rounded px-2.5 py-1.5 flex-1 font-medium">
              {subject}
            </span>
          </div>

          {/* Stats pill row */}
          <div className="flex gap-2 ml-[68px]">
            <span className="text-xs bg-slate-800 text-slate-400 rounded-full px-2.5 py-0.5">
              {agency.allstate_policy_count} policies YTD
            </span>
            <span className="text-xs bg-slate-800 text-slate-400 rounded-full px-2.5 py-0.5">
              {agency.allstate_policy_count_q} this quarter
            </span>
          </div>
        </div>

        {/* Body textarea */}
        <div className="px-5 pt-3 pb-1 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Email Body</span>
            <span className="text-xs text-slate-600">Edit directly before opening in Outlook</span>
          </div>
          <textarea
            id="q4-email-body"
            value={body}
            onChange={e => setBody(e.target.value)}
            className="flex-1 min-h-[280px] bg-slate-800 border border-slate-700 rounded-lg p-3.5 text-sm text-slate-200 font-mono leading-relaxed resize-none focus:outline-none focus:border-slate-500"
            spellCheck={false}
          />
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-slate-800 flex items-center gap-3 flex-shrink-0 flex-wrap">
          <button
            onClick={copyBody}
            className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {copied ? <><Copy className="w-4 h-4 text-emerald-400" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Body</>}
          </button>

          <a
            href={hasEmail ? mailto : '#'}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              hasEmail
                ? 'bg-blue-700 hover:bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed pointer-events-none'
            }`}
          >
            <ExternalLink className="w-4 h-4" /> Open in Outlook
          </a>

          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-sm transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

type Props = {
  rows:           ScorecardRow[]
  currentQuarter: number
  year:           number
}

export default function ScorecardClient({ rows, currentQuarter, year }: Props) {
  const [view,         setView]        = useState<View>('quarter')
  const [search,       setSearch]      = useState('')
  const [sortKey,      setSortKey]     = useState<SortKey>('policies')
  const [sortDir,      setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [emailAgency,  setEmailAgency] = useState<ScorecardRow | null>(null)

  const isQuarter = view === 'quarter'

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r =>
      !q
      || (r.display_name ?? r.name).toLowerCase().includes(q)
      || (r.sml_team ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = 0, bv = 0
      switch (sortKey) {
        case 'name':
          return sortDir === 'asc'
            ? (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)
            : (b.display_name ?? b.name).localeCompare(a.display_name ?? a.name)
        case 'policies':
          av = isQuarter ? a.allstate_policy_count_q : a.allstate_policy_count
          bv = isQuarter ? b.allstate_policy_count_q : b.allstate_policy_count
          break
        case 'gdc':
          av = isQuarter ? a.gdc_quarter : a.gdc_ytd
          bv = isQuarter ? b.gdc_quarter : b.gdc_ytd
          break
        case 'referrals':
          av = isQuarter ? a.placed_count_q  : a.referrals_total
          bv = isQuarter ? b.placed_count_q  : b.referrals_total
          break
        case 'pending':
          av = a.pending_count; bv = b.pending_count; break
        case 'placed_premium':
          av = isQuarter ? a.placed_premium_q : a.placed_premium
          bv = isQuarter ? b.placed_premium_q : b.placed_premium
          break
        case 'conversion':
          av = a.referrals_total ? a.placed_count / a.referrals_total : 0
          bv = b.referrals_total ? b.placed_count / b.referrals_total : 0
          break
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [filtered, sortKey, sortDir, isQuarter])

  // Summary counts
  const participating     = rows.filter(r => r.allstate_policy_count    >= POLICY_GOAL).length
  const bonusPool         = rows.filter(r => r.allstate_policy_count_q  >= POLICY_GOAL).length
  const onPaceAnnual      = rows.filter(r => r.allstate_policy_count    >= 9 && r.allstate_policy_count    < POLICY_GOAL).length
  const closeToBonus      = rows.filter(r => r.allstate_policy_count_q  >= 9 && r.allstate_policy_count_q < POLICY_GOAL).length
  const totalGdcYtd       = rows.reduce((s, r) => s + r.gdc_ytd, 0)
  const totalGdcQ         = rows.reduce((s, r) => s + r.gdc_quarter, 0)

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp className="w-3 h-3 opacity-20" />
    return sortDir === 'asc'
      ? <ChevronUp   className="w-3 h-3 text-blue-400" />
      : <ChevronDown className="w-3 h-3 text-blue-400" />
  }

  function Th({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) {
    return (
      <th
        onClick={() => handleSort(k)}
        className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-200 whitespace-nowrap ${className}`}
      >
        <span className="flex items-center gap-1">{label} <SortIcon k={k} /></span>
      </th>
    )
  }

  // Display values based on view
  const policyColLabel  = isQuarter ? `Q${currentQuarter} Policies` : `${year} Policies`
  const gdcColLabel     = isQuarter ? `Q${currentQuarter} GDC`      : `${year} GDC`
  const premiumColLabel = isQuarter ? `Q${currentQuarter} Premium`   : `${year} Premium`
  const referralLabel   = isQuarter ? `Placed Q${currentQuarter}`    : 'Referrals YTD'

  return (
    <div className="space-y-5">
      {emailAgency && (
        <Q4EmailModal agency={emailAgency} onClose={() => setEmailAgency(null)} />
      )}

      {/* Summary strip — two rows, two contexts */}
      <div className="grid grid-cols-2 gap-3">
        {/* Quarterly bonus pool context */}
        <div className="col-span-2 bg-amber-950/30 border border-amber-800/40 rounded-xl px-5 py-4">
          <p className="text-amber-500 text-xs font-semibold uppercase tracking-widest mb-3">
            Q{currentQuarter} Bonus Pool — 12 policies in the quarter
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Bonus Pool Eligible',  value: String(bonusPool),      sub: `≥ 12 policies this quarter`, accent: 'text-amber-300' },
              { label: 'Within Striking Range', value: String(closeToBonus),  sub: '9–11 policies this quarter', accent: 'text-blue-300'  },
              { label: 'Q GDC (Total)',         value: fmt$(totalGdcQ),        sub: 'all agencies combined',      accent: 'text-slate-200' },
              { label: 'Agencies Tracked',      value: String(rows.length),   sub: 'active partners',            accent: 'text-slate-200' },
            ].map(({ label, value, sub, accent }) => (
              <div key={label}>
                <p className="text-slate-500 text-xs mb-0.5">{label}</p>
                <p className={`text-xl font-bold ${accent}`}>{value}</p>
                <p className="text-slate-600 text-xs">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Annual participating context */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl px-5 py-4">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-3">
            {year} Annual — Participating Agency (12 policies/year)
          </p>
          <p className="text-slate-600 text-xs mb-3">
            Reflects RPA-shared business only. Agencies may have additional Allstate production
            from solo writing or prior EFS relationships not visible in this report.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Participating',         value: String(participating),                        sub: `≥ 12 policies YTD`,       accent: 'text-emerald-400' },
              { label: 'On Pace (9–11)',         value: String(onPaceAnnual),                        sub: 'likely to qualify',        accent: 'text-amber-400'   },
              { label: 'At Risk',               value: String(rows.length - participating - onPaceAnnual), sub: 'below 9 policies YTD', accent: 'text-red-400'  },
              { label: `${year} GDC (Total)`,   value: fmt$(totalGdcYtd),                            sub: 'all agencies combined',    accent: 'text-slate-200'   },
            ].map(({ label, value, sub, accent }) => (
              <div key={label}>
                <p className="text-slate-500 text-xs mb-0.5">{label}</p>
                <p className={`text-xl font-bold ${accent}`}>{value}</p>
                <p className="text-slate-600 text-xs">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
          {(['quarter', 'ytd'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                view === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'quarter'
                ? `Q${currentQuarter} — Bonus Pool`
                : `${year} YTD — Participating`}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agency or SML team…"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
          />
        </div>

        <p className="text-slate-500 text-xs ml-auto">{sorted.length} of {rows.length} agencies</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 border-b border-slate-800">
            <tr>
              <Th k="name"           label="Agency"         className="pl-4" />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                SML
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                Status
              </th>
              <Th k="policies"       label={policyColLabel}  />
              <Th k="referrals"      label={referralLabel}   />
              <Th k="pending"        label="Pending"         />
              <Th k="placed_premium" label={premiumColLabel} />
              <Th k="gdc"            label={gdcColLabel}     />
              <Th k="conversion"     label="Conv %"          />
              <th className="px-3 py-2.5 pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {sorted.map(r => {
              const label          = r.display_name ?? r.name
              const policyCount    = isQuarter ? r.allstate_policy_count_q : r.allstate_policy_count
              const placedDisplay  = isQuarter ? r.placed_count_q          : r.referrals_total
              const premiumDisplay = isQuarter ? r.placed_premium_q        : r.placed_premium
              const gdcDisplay     = isQuarter ? r.gdc_quarter             : r.gdc_ytd
              const convRate       = r.referrals_total
                ? Math.round((r.placed_count / r.referrals_total) * 100)
                : null

              return (
                <tr key={r.agency_id} className="hover:bg-slate-800/30 transition-colors">

                  {/* Agency name */}
                  <td className="pl-4 pr-3 py-3">
                    <a
                      href={`/portal/${r.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-slate-200 hover:text-white hover:underline whitespace-nowrap"
                    >
                      {label}
                    </a>
                    {r.referrals_gifted > 0 && (
                      <p className="text-slate-500 text-xs mt-0.5">
                        {r.referrals_portal}p + {r.referrals_gifted} gifted
                      </p>
                    )}
                  </td>

                  {/* SML Team */}
                  <td className="px-3 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {r.sml_team ?? '—'}
                  </td>

                  {/* Status badge */}
                  <td className="px-3 py-3">
                    {isQuarter
                      ? <QuarterBadge count={policyCount} />
                      : <AnnualBadge  count={policyCount} />}
                  </td>

                  {/* Policy count + goal bar */}
                  <td className="px-3 py-3 min-w-[160px]">
                    <GoalBar count={policyCount} isQuarter={isQuarter} />
                  </td>

                  {/* Placed (quarter) or Referrals (ytd) */}
                  <td className="px-3 py-3 tabular-nums text-right text-slate-300">
                    {placedDisplay > 0 ? placedDisplay : <span className="text-slate-600">0</span>}
                  </td>

                  {/* Pending */}
                  <td className="px-3 py-3 tabular-nums text-right text-slate-400">
                    {r.pending_count > 0 ? (
                      <span title={`${fmt$(r.pending_premium)} premium in pipeline`}>
                        {r.pending_count}
                      </span>
                    ) : <span className="text-slate-600">0</span>}
                  </td>

                  {/* Premium */}
                  <td className="px-3 py-3 tabular-nums text-right text-slate-300">
                    {premiumDisplay > 0 ? fmt$(premiumDisplay) : <span className="text-slate-600">—</span>}
                  </td>

                  {/* GDC */}
                  <td className="px-3 py-3 tabular-nums text-right">
                    <span className={gdcDisplay > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                      {fmt$(gdcDisplay)}
                    </span>
                  </td>

                  {/* Conversion */}
                  <td className="px-3 py-3 tabular-nums text-right text-slate-400">
                    {convRate !== null ? `${convRate}%` : '—'}
                  </td>

                  {/* Send Q4 email */}
                  <td className="px-3 py-3 pr-4 text-right">
                    <button
                      onClick={() => setEmailAgency(r)}
                      title="Send Q4 email"
                      className="text-slate-600 hover:text-blue-400 transition-colors"
                    >
                      <Mail className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )
            })}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-slate-500 text-sm">
                  No agencies match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-slate-600 text-xs">
        Policy counts are sourced from the Allstate compensation report (GDC import) and reflect
        RPA-shared business only — policies written by the agency independently or through a prior
        EFS relationship are not included. Annual counts may therefore understate an agency&apos;s
        true Allstate Participating status. Quarterly counts are accurate since the quarter starts
        clean for all partners. Referrals, pending, and placed figures come from RPAS cases.
        GDC reflects credits processed in the period; chargebacks reduce the total.
        {' '}Quarterly bonus pool eligibility requires 12 Allstate-credited policies in Q{currentQuarter}.
      </p>
    </div>
  )
}
