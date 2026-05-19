'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Phone, Building2, User, Calendar, Clock,
  MessageSquare, Mail, AlertCircle, PhoneCall, PhoneOff,
  MessageCircle, ChevronDown, ChevronUp, DollarSign, Pencil, Check, X,
} from 'lucide-react'
import type { ReferralDetail, Tier1Stage, TouchLog, AgentOption } from './page'

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

// Simple inline text input used in edit rows
function EditField({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
      />
    </div>
  )
}

type Props = {
  referral:   ReferralDetail
  stages:     Tier1Stage[]
  touchLog:   TouchLog[]
  agentsList: AgentOption[]
}

export function ReferralEditClient({ referral, stages, touchLog: initialTouchLog, agentsList }: Props) {
  const router = useRouter()

  // ── Case fields ──────────────────────────────────────────────
  const [status, setStatus]       = useState(referral.internal_status)
  const [appointmentDate, setAppointmentDate] = useState(
    referral.appointment_date ? referral.appointment_date.split('T')[0] : ''
  )
  const [notes, setNotes]         = useState(referral.notes ?? '')
  const [saving, setSaving]       = useState(false)
  const [saveMsg, setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // ── Touch log ─────────────────────────────────────────────────
  const [touches, setTouches]         = useState(referral.touches ?? 0)
  const [lastContact, setLastContact] = useState(referral.last_contact_at)
  const [touchLog, setTouchLog]       = useState<TouchLog[]>(initialTouchLog)
  const [logOpen, setLogOpen]         = useState(false)
  const [touchType, setTouchType]     = useState('call')
  const [touchNote, setTouchNote]     = useState('')
  const [logging, setLogging]         = useState(false)
  const [historyOpen, setHistoryOpen] = useState(touchLog.length > 0)

  // ── SPIFF ─────────────────────────────────────────────────────
  const [spiffEarned, setSpiffEarned] = useState(referral.spiff_earned)
  const [spiffSaving, setSpiffSaving] = useState(false)

  // ── Contact editing ───────────────────────────────────────────
  const [editingContact, setEditingContact] = useState(false)
  const [cFirstName, setCFirstName] = useState(referral.customers?.first_name ?? '')
  const [cLastName,  setCLastName]  = useState(referral.customers?.last_name  ?? '')
  const [cPhone,     setCPhone]     = useState(referral.customers?.phone      ?? '')
  const [cEmail,     setCEmail]     = useState(referral.customers?.email      ?? '')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactMsg, setContactMsg]       = useState<{ ok: boolean; text: string } | null>(null)

  // ── LSP editing ───────────────────────────────────────────────
  const [editingLsp, setEditingLsp]       = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(referral.agent_id ?? '')
  const [lspFirstName, setLspFirstName]   = useState(referral.agents?.first_name ?? '')
  const [lspLastName,  setLspLastName]    = useState(referral.agents?.last_name  ?? '')
  const [lspEmail,     setLspEmail]       = useState(referral.agents?.email      ?? '')
  const [lspSaving, setLspSaving]         = useState(false)
  const [lspMsg, setLspMsg]               = useState<{ ok: boolean; text: string } | null>(null)

  // ── Derived ───────────────────────────────────────────────────
  const showApptDate    = APPT_STATUSES.has(status)
  const showRewarmEmail = status === REWARM_STATUS

  const [displayName, setDisplayName] = useState(
    referral.customers ? `${referral.customers.first_name} ${referral.customers.last_name}` : 'Unknown'
  )
  const [displayAgent, setDisplayAgent] = useState(
    referral.agents ? `${referral.agents.first_name} ${referral.agents.last_name}` : null
  )

  const agencyName      = referral.agencies?.display_name ?? referral.agencies?.name ?? '—'
  const agentFirstName  = referral.agents?.first_name ?? 'there'
  const agentEmail      = referral.agents?.email ?? null
  const agencyEmail     = referral.agencies?.contact_email ?? null
  const isOwner         = referral.is_owner_referral

  const rewarmMailto = showRewarmEmail
    ? buildRewarmMailto(displayName, cFirstName, agentFirstName, agentEmail, agencyEmail)
    : null

  // ── Handlers ──────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setSaveMsg(null)
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
    } catch { setSaveMsg({ ok: false, text: 'Network error' }) }
    finally   { setSaving(false) }
  }

  async function handleSaveContact() {
    setContactSaving(true); setContactMsg(null)
    try {
      const res = await fetch(`/api/customers/${referral.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: cFirstName.trim(),
          last_name:  cLastName.trim(),
          phone:      cPhone.trim()  || null,
          email:      cEmail.trim()  || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setContactMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setDisplayName(`${cFirstName.trim()} ${cLastName.trim()}`)
        setContactMsg({ ok: true, text: 'Contact updated' })
        setEditingContact(false)
        router.refresh()
        setTimeout(() => setContactMsg(null), 2000)
      }
    } catch { setContactMsg({ ok: false, text: 'Network error' }) }
    finally   { setContactSaving(false) }
  }

  async function handleSaveLsp() {
    setLspSaving(true); setLspMsg(null)
    try {
      // If the user picked a different agent from the dropdown, reassign the case
      if (selectedAgentId && selectedAgentId !== (referral.agent_id ?? '')) {
        const caseRes = await fetch(`/api/cases/${referral.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: selectedAgentId }),
        })
        if (!caseRes.ok) {
          const j = await caseRes.json()
          setLspMsg({ ok: false, text: j.error ?? 'Reassign failed' })
          return
        }
        const picked = agentsList.find(a => a.id === selectedAgentId)
        if (picked) setDisplayAgent(`${picked.first_name} ${picked.last_name}`)
      }

      // If name/email fields changed on the current agent, patch the agent record
      const currentAgentId = selectedAgentId || referral.agent_id
      if (currentAgentId) {
        const agentRes = await fetch(`/api/agents/${currentAgentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: lspFirstName.trim(),
            last_name:  lspLastName.trim(),
            email:      lspEmail.trim() || null,
          }),
        })
        if (!agentRes.ok) {
          const j = await agentRes.json()
          setLspMsg({ ok: false, text: j.error ?? 'Agent update failed' })
          return
        }
        setDisplayAgent(`${lspFirstName.trim()} ${lspLastName.trim()}`)
      }

      setLspMsg({ ok: true, text: 'LSP updated' })
      setEditingLsp(false)
      router.refresh()
      setTimeout(() => setLspMsg(null), 2000)
    } catch { setLspMsg({ ok: false, text: 'Network error' }) }
    finally   { setLspSaving(false) }
  }

  function handleAgentSelect(agentId: string) {
    setSelectedAgentId(agentId)
    const a = agentsList.find(x => x.id === agentId)
    if (a) {
      setLspFirstName(a.first_name)
      setLspLastName(a.last_name)
      setLspEmail(a.email ?? '')
    }
  }

  async function handleSpiffToggle(checked: boolean) {
    setSpiffSaving(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}/spiff`, {
        method: checked ? 'POST' : 'DELETE',
      })
      if (res.ok) setSpiffEarned(checked)
    } finally { setSpiffSaving(false) }
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
        if (data.touch) { setTouchLog(prev => [data.touch, ...prev]); setHistoryOpen(true) }
        setTouchNote(''); setLogOpen(false)
      }
    } finally { setLogging(false) }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/referrals" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Referrals
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-white text-2xl font-semibold">{displayName}</h1>
              {isOwner && (
                <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-violet-900/50 text-violet-300 border border-violet-800">
                  Agency Owner
                </span>
              )}
            </div>
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
            <textarea
              value={touchNote}
              onChange={e => setTouchNote(e.target.value)}
              rows={2}
              placeholder="Optional note — left VM, will try again Thursday, etc."
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none"
            />
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setLogOpen(false)} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
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
        {/* ── Left — info + activity ── */}
        <div className="space-y-5">

          {/* Contact Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Contact Info</h2>
              <button
                onClick={() => { setEditingContact(o => !o); setContactMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>

            {editingContact ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <EditField label="First name" value={cFirstName} onChange={setCFirstName} />
                  <EditField label="Last name"  value={cLastName}  onChange={setCLastName}  />
                </div>
                <EditField label="Phone" value={cPhone} onChange={setCPhone} type="tel" placeholder="(555) 555-5555" />
                <EditField label="Email" value={cEmail} onChange={setCEmail} type="email" placeholder="client@email.com" />
                {contactMsg && (
                  <p className={`text-xs ${contactMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{contactMsg.text}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSaveContact}
                    disabled={contactSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}
                  >
                    <Check className="w-3.5 h-3.5" /> {contactSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditingContact(false); setContactMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Phone */}
                <div className="flex items-center gap-2.5">
                  <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  {cPhone ? (
                    <a href={`tel:${cPhone}`} className="text-blue-400 hover:text-blue-300 text-sm transition-colors">
                      {cPhone}
                    </a>
                  ) : (
                    <button
                      onClick={() => setEditingContact(true)}
                      className="text-sm text-slate-600 hover:text-slate-400 italic transition-colors"
                    >
                      No phone — add one
                    </button>
                  )}
                </div>

                {/* Email */}
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  {cEmail ? (
                    <a href={`mailto:${cEmail}`} className="text-blue-400 hover:text-blue-300 text-sm transition-colors truncate">
                      {cEmail}
                    </a>
                  ) : (
                    <button
                      onClick={() => setEditingContact(true)}
                      className="text-sm text-slate-600 hover:text-slate-400 italic transition-colors"
                    >
                      No email — add one
                    </button>
                  )}
                </div>

                {/* Agency */}
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <span className="text-slate-300 text-sm">{agencyName}</span>
                </div>

                {/* LSP */}
                {displayAgent && (
                  <div className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300 text-sm">{displayAgent}</span>
                  </div>
                )}

                {/* Lead source */}
                {referral.lead_source && (
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-slate-500 text-xs font-bold">src</span>
                    <span className="text-xs text-slate-500 capitalize">
                      {referral.lead_source === 'agency_referral' ? 'Agency Referral' : referral.lead_source.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}

                {/* Date */}
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <span className="text-slate-500 text-xs">{fmt(referral.created_at)}</span>
                </div>

                {contactMsg && (
                  <p className={`text-xs ${contactMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{contactMsg.text}</p>
                )}
              </div>
            )}
          </div>

          {/* Activity */}
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

          {/* Notes (read-only preview — full edit is in right panel) */}
          {referral.notes && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Notes</h2>
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{referral.notes}</p>
            </div>
          )}

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
                        {t.notes && <p className="text-xs text-slate-400 pl-0.5">{t.notes}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right — editable fields ── */}
        <div className="md:col-span-2 space-y-5">

          {/* Main edit card */}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-5 ring-1 ring-slate-700/50">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-200">Edit Referral</h2>
              <span className="text-xs text-slate-500 ml-1">— make changes below and hit Save</span>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 cursor-pointer"
              >
                {stages.map(s => (
                  <option key={s.id} value={s.internal_status}>{s.agency_label}</option>
                ))}
              </select>
            </div>

            {/* SPIFF */}
            {isOwner ? (
              <div className="flex items-start gap-3 rounded-lg border-2 border-slate-800 bg-slate-800/30 p-4">
                <input type="checkbox" disabled className="mt-0.5 h-4 w-4 rounded opacity-30 cursor-not-allowed" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-500">Kept Appointment</p>
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-violet-900/40 text-violet-400 border border-violet-800">
                      Owner referral — no SPIFF
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    SPIFF applies to LSPs only. Agency owner referrals are not eligible.
                  </p>
                </div>
              </div>
            ) : (
              <label className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-all ${
                spiffEarned ? 'border-emerald-700 bg-emerald-950/30' : 'border-slate-700 hover:border-slate-600'
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
                      ? `$10 SPIFF logged for ${displayAgent ?? 'this LSP'}`
                      : 'Check when the referral has a qualified conversation — triggers $10 SPIFF for the LSP'}
                  </p>
                </div>
              </label>
            )}

            {/* Rewarm email */}
            {showRewarmEmail && (
              <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-sm font-medium text-amber-300">Send rewarm email to the LSP</p>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Let the LSP know you couldn&apos;t reach {cFirstName} and ask them to help re-engage.
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

            {/* Appointment date */}
            {showApptDate && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Appointment Date</label>
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={e => setAppointmentDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={6}
                placeholder="Add notes about this referral…"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600 resize-none"
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

          {/* ── LSP card ── */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-200">LSP / Referring Agent</h2>
              </div>
              <button
                onClick={() => { setEditingLsp(o => !o); setLspMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>

            {editingLsp ? (
              <div className="space-y-3">
                {/* Reassign from dropdown */}
                {agentsList.length > 0 && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Select agent from this agency</label>
                    <select
                      value={selectedAgentId}
                      onChange={e => handleAgentSelect(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 cursor-pointer"
                    >
                      <option value="">— Unassigned —</option>
                      {agentsList.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.first_name} {a.last_name}{a.email ? ` (${a.email})` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">Picking a different agent will reassign this referral. You can also fix the name/email below.</p>
                  </div>
                )}

                {/* Fix the name/email on the selected agent */}
                <div className="grid grid-cols-2 gap-2">
                  <EditField label="First name" value={lspFirstName} onChange={setLspFirstName} />
                  <EditField label="Last name"  value={lspLastName}  onChange={setLspLastName}  />
                </div>
                <EditField label="Email" value={lspEmail} onChange={setLspEmail} type="email" placeholder="agent@email.com" />

                {lspMsg && (
                  <p className={`text-xs ${lspMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{lspMsg.text}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSaveLsp}
                    disabled={lspSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}
                  >
                    <Check className="w-3.5 h-3.5" /> {lspSaving ? 'Saving…' : 'Save LSP'}
                  </button>
                  <button
                    onClick={() => { setEditingLsp(false); setLspMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {displayAgent ? (
                  <p className="text-slate-200 text-sm font-medium">{displayAgent}</p>
                ) : (
                  <p className="text-slate-500 text-sm italic">No LSP assigned</p>
                )}
                {referral.agents?.email && (
                  <p className="text-xs text-slate-500">{referral.agents.email}</p>
                )}
                {lspMsg && (
                  <p className={`text-xs ${lspMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{lspMsg.text}</p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
