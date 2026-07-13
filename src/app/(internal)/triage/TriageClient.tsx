'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Phone, Mail, Flame, Clock, ChevronDown, ChevronUp,
  CalendarX, Wrench, AlertTriangle, ShieldAlert, FileText, BadgeCheck,
  PhoneCall, PhoneOff, Voicemail, MessageSquare, Calendar, Check, Globe,
} from 'lucide-react'
import type { TriageCase } from './page'
import { fmtDate } from '@/lib/fmt'
import { setNavList } from '@/lib/nav-list'
import { buildHouseholdName } from '@/lib/household'
import { SCRIPTS, APPT_TYPES, TOPIC_MAP, interpolate } from '@/lib/templates'
import { ScriptCard } from '@/components/ScriptCard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysInQueue(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function age(dob: string | null): number | null {
  if (!dob) return null
  const today = new Date()
  const birth = new Date(dob)
  let a = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a--
  return a
}

function parseNotes(raw: string | null): Record<string, string> {
  if (!raw) return {}
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      if (key && val) result[key] = val
    }
  }
  return result
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function daysSinceTouched(c: TriageCase): number {
  const ref = c.last_contact_at ?? c.created_at
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000)
}

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A case is escalation-ready when 7+ touches have been logged OR it's been
// 7+ days since the last contact (or since creation if never touched).
function isEscalationReady(c: TriageCase): boolean {
  if ((c.touches ?? 0) >= 7) return true
  return daysSinceTouched(c) >= 7
}

// A case is Act Now when its follow-up date is today or overdue.
// For cases with no follow_up_date (legacy or pre-first-touch), treat
// 2+ days in queue as act-now so nothing slips.
function isActNow(c: TriageCase, today: string): boolean {
  if (c.follow_up_date) return c.follow_up_date <= today
  return daysInQueue(c.created_at) >= 2
}

// ── Badges ────────────────────────────────────────────────────────────────────

function QueueAgeBadge({ iso }: { iso: string }) {
  const d = daysInQueue(iso)
  let cls = 'bg-emerald-900/40 text-emerald-300 border-emerald-700'
  if (d >= 3) cls = 'bg-amber-900/40 text-amber-300 border-amber-700'
  if (d >= 7) cls = 'bg-red-900/40 text-red-300 border-red-700'
  const label = d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 ${cls}`}>
      <Clock className="w-3 h-3" />{label}
    </span>
  )
}

// ── Section header row ────────────────────────────────────────────────────────

type SectionVariant = 'escalation' | 'act_now' | 'upcoming'

const SECTION_STYLES: Record<SectionVariant, { row: string; label: string; count: string }> = {
  escalation: {
    row:   'bg-red-950/60 border-b border-red-900/40',
    label: 'text-red-300',
    count: 'bg-red-900/50 text-red-300 border border-red-800',
  },
  act_now: {
    row:   'bg-amber-950/40 border-b border-amber-900/30',
    label: 'text-amber-300',
    count: 'bg-amber-900/40 text-amber-300 border border-amber-800',
  },
  upcoming: {
    row:   'bg-slate-800/20 border-b border-slate-800',
    label: 'text-slate-400',
    count: 'bg-slate-800 text-slate-400 border border-slate-700',
  },
}

function SectionHeaderRow({
  variant, label, count, desc,
}: {
  variant: SectionVariant
  label:   string
  count:   number
  desc:    string
}) {
  const s = SECTION_STYLES[variant]
  return (
    <tr className={s.row}>
      <td colSpan={7} className="px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {variant === 'escalation' && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
            {variant === 'act_now'    && <Flame         className="w-3.5 h-3.5 text-amber-400" />}
            {variant === 'upcoming'   && <Clock         className="w-3.5 h-3.5 text-slate-500" />}
            <span className={`text-xs font-semibold uppercase tracking-wider ${s.label}`}>{label}</span>
            <span className={`text-xs font-medium rounded-full px-1.5 py-0.5 ${s.count}`}>{count}</span>
          </div>
          <p className="text-xs text-slate-500">{desc}</p>
        </div>
      </td>
    </tr>
  )
}

type ApptType = typeof APPT_TYPES[number]['value']

function followUpDateStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function todayDateInput(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Row ───────────────────────────────────────────────────────────────────────

function TriageRow({
  c, allIds, section, today,
}: {
  c:       TriageCase
  allIds:  string[]
  section: SectionVariant
  today:   string
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)

  // Touch action state
  const [touchPhase,   setTouchPhase]   = useState<'idle' | 'busy' | 'reached' | 'logged'>('idle')
  const [touchMsg,     setTouchMsg]     = useState('')
  const [localTouches, setLocalTouches] = useState<number | null>(null)
  const [scriptFor,    setScriptFor]    = useState<'voicemail' | 'noanswer' | null>(null)

  // Appointment form state
  const [apptPhase, setApptPhase] = useState<'hidden' | 'form' | 'done'>('hidden')
  const [apptBusy,  setApptBusy]  = useState(false)
  const [apptType,  setApptType]  = useState<ApptType>('life')
  const [apptDate,  setApptDate]  = useState(todayDateInput)
  const [apptTime,  setApptTime]  = useState('10:00')

  // Live transfer state
  const [ltPhase, setLtPhase] = useState<'hidden' | 'confirm' | 'busy' | 'done'>('hidden')

  const agency         = c.agencies?.display_name ?? c.agencies?.name ?? '—'
  const client         = buildHouseholdName(c.customers ?? null, c.household_members ?? [])
  const lsp            = c.agents ? `${c.agents.first_name} ${c.agents.last_name}` : null
  const clientAge      = age(c.customers?.date_of_birth ?? null)
  const parsed         = parseNotes(c.notes)
  const staleDays      = daysSinceTouched(c)
  const displayTouches = localTouches ?? c.touches ?? 0

  const touchBadgeCls = staleDays >= 7
    ? 'bg-red-900/40 text-red-300 border-red-700'
    : staleDays >= 3
    ? 'bg-amber-900/40 text-amber-300 border-amber-700'
    : 'bg-slate-800/60 text-slate-400 border-slate-700'

  function handleRowClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('[data-expand]') || target.closest('[data-action]')) return
    setNavList(allIds)
    router.push(`/referrals/${c.id}`)
  }

  async function handleTouch(touchType: string, label: string, isReached = false) {
    setTouchPhase('busy')
    const res = await fetch(`/api/cases/${c.id}/touch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        touch_type: touchType,
        notes: touchType === 'call' && !isReached ? 'No answer — no voicemail left' : undefined,
      }),
    })
    if (!res.ok) { setTouchPhase('idle'); return }
    setLocalTouches((localTouches ?? c.touches ?? 0) + 1)
    setTouchMsg(`${label} logged · Follow-up: ${followUpDateStr()}`)
    setTouchPhase(isReached ? 'reached' : 'logged')
    if (!isReached) {
      setScriptFor(touchType === 'voicemail' ? 'voicemail' : 'noanswer')
    }
  }

  async function handleLiveTransfer() {
    setLtPhase('busy')
    const now = new Date().toISOString()
    // Transition status + log the call touch in parallel
    const [statusRes] = await Promise.all([
      fetch(`/api/cases/${c.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ internal_status: 'live_transfer' }),
      }),
      fetch(`/api/cases/${c.id}/touch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ touch_type: 'call', notes: 'Live transfer — connected to producer' }),
      }),
    ])
    if (!statusRes.ok) { setLtPhase('confirm'); return }
    setLtPhase('done')
    setTimeout(() => router.refresh(), 1500)
  }

  async function handleSetAppt(e: React.MouseEvent) {
    e.stopPropagation()
    if (!apptDate || !apptTime) return
    setApptBusy(true)
    const appointmentDatetime = `${apptDate}T${apptTime}`
    const res = await fetch(`/api/cases/${c.id}/appointment`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ appointment_date: appointmentDatetime }),
    })
    setApptBusy(false)
    if (!res.ok) return
    // Trigger .ics download without navigating away
    const a = document.createElement('a')
    a.href = `/api/cases/${c.id}/calendar-event?start=${encodeURIComponent(appointmentDatetime)}&type=${apptType}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setApptPhase('done')
    setTimeout(() => router.refresh(), 1800)
  }

  // Right column content varies by section
  function RightCol() {
    if (section === 'escalation') {
      return (
        <div className="text-right space-y-1">
          <p className="text-xs text-slate-500">{fmtDate(c.created_at)}</p>
          <QueueAgeBadge iso={c.created_at} />
        </div>
      )
    }
    if (section === 'act_now') {
      const daysOverdue = c.follow_up_date
        ? Math.floor((new Date(today).getTime() - new Date(c.follow_up_date).getTime()) / 86_400_000)
        : daysInQueue(c.created_at)
      return (
        <div className="text-right">
          <span className={`text-xs font-medium ${daysOverdue > 0 ? 'text-red-400' : 'text-amber-300'}`}>
            {daysOverdue > 0 ? `${daysOverdue}d overdue` : 'Due today'}
          </span>
        </div>
      )
    }
    // upcoming
    if (c.follow_up_date) {
      const daysUntil = Math.ceil(
        (new Date(c.follow_up_date).getTime() - new Date(today).getTime()) / 86_400_000
      )
      return (
        <div className="text-right">
          <p className="text-xs text-slate-400">{fmtDate(c.follow_up_date)}</p>
          <p className="text-xs text-slate-600">
            {daysUntil <= 1 ? 'tomorrow' : `in ${daysUntil}d`}
          </p>
        </div>
      )
    }
    return (
      <div className="text-right">
        <p className="text-xs text-slate-500">{fmtDate(c.created_at)}</p>
        <QueueAgeBadge iso={c.created_at} />
      </div>
    )
  }

  return (
    <>
      <tr
        onClick={handleRowClick}
        className={`cursor-pointer transition-colors border-b border-slate-800/50 ${
          expanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
        }`}
      >
        {/* Contact */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {c.is_hot_lead && <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
            <span className="font-medium text-white">{client}</span>
            {c.is_owner_referral && (
              <span className="text-xs font-medium text-violet-300 bg-violet-900/40 border border-violet-800 rounded px-1.5 py-0.5">
                Owner
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {c.customers?.phone && (
              <a href={`tel:${c.customers.phone}`} onClick={e => e.stopPropagation()}
                className="text-xs text-slate-400 hover:text-blue-400 flex items-center gap-1 transition-colors">
                <Phone className="w-3 h-3" />{c.customers.phone}
              </a>
            )}
            {clientAge && <span className="text-xs text-slate-500">Age {clientAge}</span>}
          </div>
          {c.customers?.email && (
            <div className="mt-0.5">
              <a href={`mailto:${c.customers.email}`} onClick={e => e.stopPropagation()}
                className="text-xs text-slate-500 hover:text-blue-400 flex items-center gap-1 transition-colors">
                <Mail className="w-3 h-3" />{c.customers.email}
              </a>
            </div>
          )}

          {/* Activity badges */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {section === 'escalation' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-red-900/30 text-red-300 border-red-700">
                <AlertTriangle className="w-3 h-3" />
                LSP Re-Warm needed
              </span>
            )}
            {c.suspected_duplicate_customer_id && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-yellow-900/40 text-yellow-300 border-yellow-700">
                <ShieldAlert className="w-3 h-3" />
                Possible duplicate
              </span>
            )}
            {c.policy_count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-emerald-900/30 text-emerald-300 border-emerald-700">
                <BadgeCheck className="w-3 h-3" />
                {c.policy_count} {c.policy_count === 1 ? 'policy' : 'policies'}
              </span>
            )}
            {c.prior_case_count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-blue-900/30 text-blue-300 border-blue-700">
                <FileText className="w-3 h-3" />
                {c.prior_case_count} prior {c.prior_case_count === 1 ? 'case' : 'cases'}
              </span>
            )}
            {c.customers?.preferred_language && c.customers.preferred_language !== 'en' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-violet-900/30 text-violet-300 border-violet-700">
                <Globe className="w-3 h-3" />
                {({es:'Spanish',zh:'Chinese',ru:'Russian',vi:'Vietnamese',other:'Other lang'} as Record<string,string>)[c.customers.preferred_language] ?? c.customers.preferred_language}
              </span>
            )}
            {c.missed_count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium rounded border px-2 py-0.5 bg-amber-900/40 text-amber-300 border-amber-700">
                <CalendarX className="w-3 h-3" />
                {c.missed_count} missed
              </span>
            )}
            {displayTouches > 0 && (
              <span className={`inline-flex items-center gap-1 text-xs rounded border px-2 py-0.5 ${touchBadgeCls}`}>
                <Phone className="w-3 h-3" />
                {displayTouches} touch{displayTouches !== 1 ? 'es' : ''} · {fmtRelative(c.last_contact_at)}
              </span>
            )}
          </div>
        </td>

        {/* Agency */}
        <td className="px-4 py-3 text-sm text-slate-300">{agency}</td>

        {/* Referred by */}
        <td className="px-4 py-3 text-sm text-slate-400">{lsp ?? '—'}</td>

        {/* Type */}
        <td className="px-4 py-3 text-sm text-slate-400">{parsed['Type'] ?? '—'}</td>

        {/* Contact pref */}
        <td className="px-4 py-3">
          <p className="text-xs text-slate-400">{parsed['Contact'] ?? '—'}</p>
          {parsed['Best time'] && <p className="text-xs text-slate-500">{parsed['Best time']}</p>}
        </td>

        {/* Right col — varies by section */}
        <td className="px-4 py-3 text-right">
          <RightCol />
        </td>

        {/* Expand toggle */}
        <td className="px-3 py-3" onClick={e => { e.stopPropagation(); setExpanded(o => !o) }}>
          <div className="flex justify-end">
            {expanded
              ? <ChevronUp   className="w-4 h-4 text-slate-500" />
              : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </div>
        </td>
      </tr>

      {/* Expanded panel */}
      {expanded && (
        <tr className="bg-slate-800/30 border-b border-slate-700/50">
          <td colSpan={7} className="px-5 py-3" data-action="1">

            {/* Context details */}
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-400 mb-3">
              {c.customers?.email && (
                <span><span className="text-slate-500">Email </span>{c.customers.email}</span>
              )}
              {c.agents?.email && (
                <span><span className="text-slate-500">LSP email </span>{c.agents.email}</span>
              )}
              {(c.allstate_policy_number || parsed['Allstate Policy']) && (
                <span>
                  <span className="text-slate-500">Allstate Policy </span>
                  <span className="font-mono">{c.allstate_policy_number ?? parsed['Allstate Policy']}</span>
                </span>
              )}
              {parsed['Flags'] && (
                <span><span className="text-slate-500">Flags </span>{parsed['Flags']}</span>
              )}
              {parsed['Notes'] && (
                <span className="max-w-lg"><span className="text-slate-500">Notes </span>{parsed['Notes']}</span>
              )}
            </div>

            {/* ── Quick-action panel ── */}
            <div className="border-t border-slate-700/50 pt-3 space-y-3" onClick={e => e.stopPropagation()}>

              {/* Touch buttons */}
              {(touchPhase === 'idle' || touchPhase === 'busy') && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 mr-1">Log contact:</span>
                  {([
                    { label: 'Reached',   Icon: PhoneCall,     type: 'call',      reached: true  },
                    { label: 'Voicemail', Icon: Voicemail,     type: 'voicemail', reached: false },
                    { label: 'No Answer', Icon: PhoneOff,      type: 'call',      reached: false },
                    { label: 'Texted',    Icon: MessageSquare, type: 'text',      reached: false },
                  ] as const).map(({ label, Icon, type, reached }) => (
                    <button
                      key={label}
                      disabled={touchPhase === 'busy'}
                      onClick={() => handleTouch(type, label, reached)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium rounded border px-3 py-1.5 transition-colors disabled:opacity-40 ${
                        reached
                          ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700 hover:bg-emerald-900/50'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />{label}
                    </button>
                  ))}
                </div>
              )}

              {/* Touch confirmation */}
              {(touchPhase === 'reached' || touchPhase === 'logged') && touchMsg && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <Check className="w-3.5 h-3.5" /><span>{touchMsg}</span>
                </div>
              )}

              {/* Contact scripts — shown after voicemail or no-answer touch */}
              {touchPhase === 'logged' && scriptFor && (() => {
                const vars = {
                  first_name:     c.customers?.first_name ?? '',
                  lsp_first_name: c.agents?.first_name    ?? '',
                  sender_name:    '[your name]',
                  phone:          '[your phone]',
                }
                return (
                  <div className="space-y-2 pt-1">
                    {scriptFor === 'voicemail' && (
                      <>
                        <ScriptCard
                          label={SCRIPTS.voicemail.label}
                          text={interpolate(SCRIPTS.voicemail.body, vars)}
                        />
                        <ScriptCard
                          label={SCRIPTS.post_voicemail_text.label}
                          text={interpolate(SCRIPTS.post_voicemail_text.body, vars)}
                        />
                      </>
                    )}
                    {scriptFor === 'noanswer' && (
                      <ScriptCard
                        label={SCRIPTS.first_attempt_text.label}
                        text={interpolate(SCRIPTS.first_attempt_text.body, vars)}
                      />
                    )}
                  </div>
                )
              })()}

              {/* After "Reached": live transfer, set appointment, or keep working */}
              {touchPhase === 'reached' && apptPhase === 'hidden' && ltPhase === 'hidden' && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-slate-500">What happened?</span>
                  <button
                    onClick={() => setLtPhase('confirm')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium rounded border px-3 py-1.5 bg-orange-900/30 text-orange-300 border-orange-700 hover:bg-orange-900/50 transition-colors"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />Live Transfer
                  </button>
                  <button
                    onClick={() => setApptPhase('form')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium rounded border px-3 py-1.5 bg-blue-900/30 text-blue-300 border-blue-700 hover:bg-blue-900/50 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5" />Set Appointment
                  </button>
                  <button
                    onClick={() => setTouchPhase('logged')}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Keep in queue
                  </button>
                </div>
              )}

              {/* Live transfer confirmation */}
              {ltPhase === 'confirm' && (() => {
                const ltVars = {
                  first_name:   c.customers?.first_name ?? '',
                  last_name:    c.customers?.last_name  ?? '',
                  lsp_first_name: c.agents?.first_name  ?? '',
                  agency_name:  c.agencies?.display_name ?? c.agencies?.name ?? '',
                  topic:        TOPIC_MAP[/* lead_source not in TriageCase type */ ''] ?? 'life insurance',
                }
                return (
                  <div className="rounded-lg bg-orange-950/30 border border-orange-900/40 p-3 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-orange-200">
                        Confirm live transfer for <span className="font-medium">{client}</span>? This moves the case out of triage.
                      </span>
                      <button
                        onClick={handleLiveTransfer}
                        className="inline-flex items-center gap-1.5 text-xs font-medium rounded border px-3 py-1.5 bg-orange-600 text-white border-orange-500 hover:bg-orange-500 transition-colors"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />Confirm Transfer
                      </button>
                      <button
                        onClick={() => setLtPhase('hidden')}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-2">
                      <ScriptCard
                        label={SCRIPTS.live_transfer_client.label}
                        text={interpolate(SCRIPTS.live_transfer_client.body, ltVars)}
                      />
                      <ScriptCard
                        label={SCRIPTS.live_transfer_briefing.label}
                        text={interpolate(SCRIPTS.live_transfer_briefing.body, ltVars)}
                      />
                    </div>
                  </div>
                )
              })()}

              {/* Live transfer confirmed */}
              {ltPhase === 'done' && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  <span>Live transfer logged · Moving to referral pipeline…</span>
                </div>
              )}

              {/* Appointment form */}
              {apptPhase === 'form' && (
                <div className="flex items-end gap-3 flex-wrap bg-slate-800/60 rounded-lg px-4 py-3 border border-slate-700/50">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Type</p>
                    <div className="flex rounded-md overflow-hidden border border-slate-700">
                      {APPT_TYPES.map(({ value, label, duration }) => (
                        <button
                          key={value}
                          onClick={() => setApptType(value)}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-slate-700 last:border-r-0 ${
                            apptType === value
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {label}
                          <span className={`ml-1.5 text-xs ${apptType === value ? 'text-blue-200' : 'text-slate-600'}`}>
                            {duration}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Date</p>
                    <input
                      type="date"
                      value={apptDate}
                      min={todayDateInput()}
                      onChange={e => setApptDate(e.target.value)}
                      className="bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Time</p>
                    <input
                      type="time"
                      value={apptTime}
                      onChange={e => setApptTime(e.target.value)}
                      className="bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    disabled={!apptDate || !apptTime || apptBusy}
                    onClick={handleSetAppt}
                    className="inline-flex items-center gap-1.5 text-xs font-medium rounded border px-3 py-1.5 bg-blue-600 text-white border-blue-500 hover:bg-blue-500 disabled:opacity-40 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    {apptBusy ? 'Saving…' : 'Confirm + Add to Calendar'}
                  </button>
                  <button
                    onClick={() => setApptPhase('hidden')}
                    className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Appointment confirmed */}
              {apptPhase === 'done' && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  <span>Appointment set · Calendar event downloaded · Removing from queue…</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-700/30">
              <p className="text-xs text-slate-600">Click the row to open the full referral record →</p>
              {(() => {
                const p = new URLSearchParams()
                p.set('from_case_id', c.id)
                const name = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.trim()
                if (name)           p.set('client_name', name)
                if (c.agencies?.id) p.set('agency_id',   c.agencies.id)
                if (c.agents?.id)   p.set('agent_id',    c.agents.id)
                return (
                  <a
                    href={`/service/new?${p.toString()}`}
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-blue-300 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5" />Route to Service Request
                  </a>
                )
              })()}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function TriageClient({ cases }: { cases: TriageCase[] }) {
  const [search,       setSearch]       = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')

  const today = useMemo(() => todayString(), [])

  const agencyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const c of cases) {
      const name = c.agencies?.display_name ?? c.agencies?.name ?? ''
      if (name) seen.add(name)
    }
    return Array.from(seen).sort()
  }, [cases])

  const filtered = useMemo(() => {
    let list = cases
    if (agencyFilter) {
      list = list.filter(c =>
        (c.agencies?.display_name ?? c.agencies?.name ?? '') === agencyFilter
      )
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c => {
        const name  = `${c.customers?.first_name ?? ''} ${c.customers?.last_name ?? ''}`.toLowerCase()
        const agc   = (c.agencies?.display_name ?? c.agencies?.name ?? '').toLowerCase()
        const lsp   = c.agents ? `${c.agents.first_name} ${c.agents.last_name}`.toLowerCase() : ''
        const phone = c.customers?.phone ?? ''
        return name.includes(q) || agc.includes(q) || lsp.includes(q) || phone.includes(q)
      })
    }
    return list
  }, [cases, agencyFilter, search])

  const filteredIds = useMemo(() => filtered.map(c => c.id), [filtered])

  // ── Section splits ─────────────────────────────────────────────────────────
  // Priority: escalation > act_now > upcoming
  // Within escalation: most stale first
  // Within act_now: hot leads first, then most overdue
  // Within upcoming: soonest follow-up first

  const { escalation, actNow, upcoming } = useMemo(() => {
    const esc: TriageCase[] = []
    const act: TriageCase[] = []
    const upc: TriageCase[] = []
    for (const c of filtered) {
      if (isEscalationReady(c))        esc.push(c)
      else if (isActNow(c, today))     act.push(c)
      else                             upc.push(c)
    }
    esc.sort((a, b) => daysSinceTouched(b) - daysSinceTouched(a))
    act.sort((a, b) => {
      if (b.is_hot_lead !== a.is_hot_lead) return b.is_hot_lead ? 1 : -1
      const aDate = a.follow_up_date ?? a.created_at
      const bDate = b.follow_up_date ?? b.created_at
      return aDate < bDate ? -1 : 1
    })
    upc.sort((a, b) => {
      const aDate = a.follow_up_date ?? a.created_at
      const bDate = b.follow_up_date ?? b.created_at
      return aDate < bDate ? -1 : 1
    })
    return { escalation: esc, actNow: act, upcoming: upc }
  }, [filtered, today])

  const escalationCount = cases.filter(isEscalationReady).length
  const actNowCount     = cases.filter(c => !isEscalationReady(c) && isActNow(c, today)).length

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-slate-300 font-medium">Queue is clear</p>
        <p className="text-slate-500 text-sm mt-1">No referrals waiting in triage</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary + filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-slate-400 text-sm">
            <span className="text-white font-semibold">{cases.length}</span> in queue
          </p>
          {escalationCount > 0 && (
            <span className="inline-flex items-center gap-1 text-red-400 text-sm font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />{escalationCount} need re-warm
            </span>
          )}
          {actNowCount > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-400 text-sm">
              <Flame className="w-3.5 h-3.5" />{actNowCount} due today
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={agencyFilter}
            onChange={e => setAgencyFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500"
          >
            <option value="">All agencies</option>
            {agencyOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, agency, LSP, phone…"
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 w-64 focus:outline-none focus:border-slate-500 placeholder-slate-600"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-400 text-sm">No referrals match your filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Agency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Referred by</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Contact pref.</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Follow-up</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {escalation.length > 0 && (
                <>
                  <SectionHeaderRow
                    variant="escalation"
                    label="LSP Re-Warm Needed"
                    count={escalation.length}
                    desc="7+ touches or 7+ days without contact — open referral and send re-warm email"
                  />
                  {escalation.map(c => (
                    <TriageRow key={c.id} c={c} allIds={filteredIds} section="escalation" today={today} />
                  ))}
                </>
              )}
              {actNow.length > 0 && (
                <>
                  <SectionHeaderRow
                    variant="act_now"
                    label="Act Now"
                    count={actNow.length}
                    desc="Follow-up due today or overdue"
                  />
                  {actNow.map(c => (
                    <TriageRow key={c.id} c={c} allIds={filteredIds} section="act_now" today={today} />
                  ))}
                </>
              )}
              {upcoming.length > 0 && (
                <>
                  <SectionHeaderRow
                    variant="upcoming"
                    label="Upcoming"
                    count={upcoming.length}
                    desc="Next follow-up scheduled — check back then"
                  />
                  {upcoming.map(c => (
                    <TriageRow key={c.id} c={c} allIds={filteredIds} section="upcoming" today={today} />
                  ))}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-600">{filtered.length} of {cases.length} referrals</p>
    </div>
  )
}
