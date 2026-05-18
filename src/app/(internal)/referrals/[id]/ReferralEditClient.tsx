'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Phone, Building2, User, Calendar, Clock,
  MessageSquare, Mail, AlertCircle, PhoneCall, PhoneOff,
  MessageCircle, ChevronDown, ChevronUp, DollarSign,
} from 'lucide-react'
import type { ReferralDetail, Tier1Stage, TouchLog } from './page'

const APPT_STATUSES  = new Set(['appointment_set', 'appointment_kept', 'appointment_missed'])
const REWARM_STATUS  = 'back_to_agency'

const TOUCH_TYPES: { value: string; label: string; icon: React.ReactNode; short: string }[] = [
  { value: 'call',      label: 'Call',      short: 'Called',    icon: <PhoneCall    className="w-4 h-4" /> },
  { value: 'voicemail', label: 'Voicemail', short: 'Voicemail', icon: <PhoneOff     className="w-4 h-4" /> },
  { value: 'text',      label: 'Text',      short: 'Texted',    icon: <MessageCircle className="w-4 h-4" /> },
  { value: 'email',     label: 'Email',     short: 'Emailed',   icon: <Mail         className="w-4 h-4" /> },
]

const TOUCH_COLORS: Record<string, string> = {
  call:      'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  voicemail: 'bg-slate-800/60  text-slate-400   border-slate-700',
  text:      'bg-blue-900/40   text-blue-300    border-blue-800',
  email:     'bg-indigo-900/40 text-indigo-300  border-indigo-800',
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'Never'
  const d = daysAgo(iso)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

function StatusBadge({ st }: { st: ReferralDetail['stage_translations'] }) {
  if (!st) return null
  let cls = 'bg-blue-900/50 text-blue-300 border border-blue-800'
  if (st.is_won)  cls = 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (st.is_lost) cls = 'bg-slate-800/70 text-slate-400 border border-slate-700'
  return (
    <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-medium ${cls}`}>
      {st.agency_label}
    </span>
  )
}

function buildRewarmMailto(
  clientName: string, clientFirstName: string,
  agentFirstName: string, agentEmail: string | null, agencyEmail: string | null,
): string {
  const subject = `Referral Follow-Up – ${clientName}`
  const body = [
    `Hi ${agentFirstName},`,
    '',
    `I wanted to reach out regarding the referral you sent over for ${clientName}. Unfortunately, we've been unable to make contact with ${clientFirstName} at this time.`,
    '',
    `Would you be able to help re-engage them on your end? We'd love to connect when the timing is right. Please let us know if there's anything you can do to help facilitate that conversation.`,
    '',
    'Thank you for thinking of us — we appreciate the partnership!',
    '',
    'Best,',
    'Makal Financial Services',
  ].join('\n')

  const params = new URLSearchParams()
  if (agencyEmail) params.set('cc', agencyEmail)
  params.set('subject', subject)
  params.set('body', body)
  return `mailto:${agentEmail ?? ''}?${params.toString()}`
}

type Props = {
  referral:  ReferralDetail
  stages:    Tier1Stage[]
  touchLog:  TouchLog[]
}

export function ReferralEditClient({ referral, stages, touchLog: initialTouchLog }: Props) {
  const router = useRouter()

  const [status, setStatus]       = useState(referral.internal_status)
  const [appointmentDate, setAppointmentDate] = useState(
    referral.appointment_date ? referral.appointment_date.split('T')[0] : ''
  )
  const [notes, setNotes]         = useState(referral.notes ?? '')
  const [touches, setTouches]     = useState(referral.touches ?? 0)
  const [lastContact, setLastContact] = useState(referral.last_contact_at)
  const [touchLog, setTouchLog]   = useState<TouchLog[]>(initialTouchLog)

  // Touch logger state
  const [logOpen, setLogOpen]     = useState(false)
  const [touchType, setTouchType] = useState('call')
  const [touchNote, setTouchNote] = useState('')
  const [logging, setLogging]     = useState(false)

  // History expand
  const [historyOpen, setHistoryOpen] = useState(touchLog.length > 0)

  const [spiffEarned, setSpiffEarned] = useState(referral.spiff_earned)
  const [spiffSaving, setSpiffSaving] = useState(false)

  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const showApptDate    = APPT_STATUSES.has(status)
  const showRewarmEmail = status === REWARM_STATUS

  const clientName      = referral.customers ? `${referral.customers.first_name} ${referral.customers.last_name}` : 'Unknown'
  const clientFirstName = referral.customers?.first_name ?? 'them'
  const agencyName      = referral.agencies?.display_name ?? referral.agencies?.name ?? '—'
  const agentName       = referral.agents ? `${referral.agents.first_name} ${referral.agents.last_name}` : null
  const agentFirstName  = referral.agents?.first_name ?? 'there'
  const agentEmail      = referral.agents?.email ?? null
  const agencyEmail     = referral.agencies?.contact_email ?? null

  const rewarmMailto = showRewarmEmail
    ? buildRewarmMailto(clientName, clientFirstName, agentFirstName, agentEmail, agencyEmail)
    : null

  async function handleSpiffToggle(checked: boolean) {
    setSpiffSaving(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}/spiff`, {
        method: checked ? 'POST' : 'DELETE',
      })
      if (res.ok) setSpiffEarned(checked)
    } finally {
      setSpiffSaving(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    const body: Record<string, unknown> = { internal_status: status, notes: notes || null }
    if (showApptDate) body.appointment_date = appointmentDate || null
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json()
        setSaveMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setSaveMsg({ ok: true, text: 'Saved' })
        router.refresh()
        setTimeout(() => setSaveMsg(null), 2000)
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleLogTouch() {
    setLogging(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}/touch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touch_type: touchType, notes: touchNote.trim() || undefined }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setTouches(data.touches)
        setLastContact(data.last_contact_at)
        if (data.touch) {
          setTouchLog(prev => [data.touch, ...prev])
          setHistoryOpen(true)
        }
        setTouchNote('')
        setLogOpen(false)
      }
    } finally {
      setLogging(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/referrals" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Referrals
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl font-semibold">{clientName}</h1>
            <div className="mt-1.5"><StatusBadge st={referral.stage_translations} /></div>
          </div>
          <button
            onClick={() => setLogOpen(o => !o)}
            className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            <Phone className="w-4 h-4" />
            Log a Touch
            {logOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Touch logger panel */}
        {logOpen && (
          <div className="mt-4 bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Log a Touch</p>

            {/* Type picker */}
            <div className="flex gap-2 flex-wrap">
              {TOUCH_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTouchType(t.value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border transition-all ${
                    touchType === t.value
                      ? 'border-white/20 bg-slate-700 text-white'
                      : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Optional note */}
            <textarea
              value={touchNote}
              onChange={e => setTouchNote(e.target.value)}
              rows={2}
              placeholder="Optional note — left VM, will try again Thursday, etc."
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none"
            />

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setLogOpen(false)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleLogTouch}
                disabled={logging}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1F3864' }}
              >
                {logging ? 'Logging…' : 'Log it'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left — info + activity */}
        <div className="space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Contact Info</h2>
            {referral.customers?.phone && (
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="text-slate-200 text-sm">{referral.customers.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span className="text-slate-200 text-sm">{agencyName}</span>
            </div>
            {agentName && (
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="text-slate-200 text-sm">{agentName}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <Calendar className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span className="text-slate-200 text-sm">{fmt(referral.created_at)}</span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Activity</h2>
            <div className="flex items-start gap-2.5">
              <Phone className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-200 text-sm">{touches} touch{touches !== 1 ? 'es' : ''}</p>
                <p className="text-xs text-slate-500">Last: {fmtRelative(lastContact)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs text-slate-500">In system</p>
                  <p className="text-slate-200 text-sm">
                    {daysAgo(referral.created_at)}d
                    <span className="text-slate-500 text-xs ml-1.5">since {fmt(referral.created_at)}</span>
                  </p>
                </div>
                {referral.status_entered_at && (
                  <div>
                    <p className="text-xs text-slate-500">In current status</p>
                    <p className="text-slate-200 text-sm">
                      {daysAgo(referral.status_entered_at)}d
                      <span className="text-slate-500 text-xs ml-1.5">since {fmt(referral.status_entered_at)}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Touch history */}
          {touchLog.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setHistoryOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide hover:text-slate-200 transition-colors"
              >
                <span>Touch History ({touchLog.length})</span>
                {historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {historyOpen && (
                <div className="border-t border-slate-800 divide-y divide-slate-800/50">
                  {touchLog.map(t => {
                    const typeInfo = TOUCH_TYPES.find(x => x.value === t.touch_type)
                    return (
                      <div key={t.id} className="px-5 py-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium border ${TOUCH_COLORS[t.touch_type] ?? TOUCH_COLORS.call}`}>
                            {typeInfo?.icon}
                            {typeInfo?.short ?? t.touch_type}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{fmtTime(t.touched_at)}</span>
                        </div>
                        {t.notes && (
                          <p className="text-xs text-slate-400 pl-0.5">{t.notes}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — editable fields */}
        <div className="md:col-span-2 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Update Referral</h2>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
              >
                {stages.map(s => (
                  <option key={s.id} value={s.internal_status}>{s.agency_label}</option>
                ))}
              </select>
            </div>

            {/* Kept Appointment / SPIFF */}
            <label className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-all ${
              spiffEarned
                ? 'border-emerald-700 bg-emerald-950/30'
                : 'border-slate-700 hover:border-slate-600'
            }`}>
              <input
                type="checkbox"
                checked={spiffEarned}
                disabled={spiffSaving}
                onChange={e => handleSpiffToggle(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-500 cursor-pointer"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${spiffEarned ? 'text-emerald-300' : 'text-slate-200'}`}>
                    Kept Appointment
                  </p>
                  {spiffEarned && (
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-800">
                      <DollarSign className="w-3 h-3" />SPIFF earned
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {spiffEarned
                    ? `$10 SPIFF logged for ${agentName ?? 'this LSP'}`
                    : 'Check when the referral has a qualified conversation with us — triggers $10 SPIFF for the LSP'}
                </p>
              </div>
            </label>

            {/* Rewarm email prompt */}
            {showRewarmEmail && (
              <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-sm font-medium text-amber-300">Send rewarm email to the LSP</p>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Let the LSP know you couldn't reach {clientFirstName} and ask them to help re-engage.
                  {agencyEmail && <> The agency contact will be copied.</>}
                </p>
                {(!agentEmail || !agencyEmail) && (
                  <div className="flex items-start gap-2 text-xs text-amber-500/80">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>
                      {!agentEmail && 'No email on file for this LSP. '}
                      {!agencyEmail && 'No contact email on file for this agency. '}
                      Add them in the Agencies admin page to enable this feature.
                    </span>
                  </div>
                )}
                <a
                  href={rewarmMailto ?? '#'}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    agentEmail
                      ? 'bg-amber-700 hover:bg-amber-600 text-white'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed pointer-events-none'
                  }`}
                >
                  <Mail className="w-4 h-4" /> Open in Outlook
                </a>
              </div>
            )}

            {showApptDate && (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Appointment Date</label>
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={e => setAppointmentDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={6}
                placeholder="Add notes about this referral…"
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              {saveMsg ? (
                <p className={`text-sm ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg.text}</p>
              ) : <span />}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
