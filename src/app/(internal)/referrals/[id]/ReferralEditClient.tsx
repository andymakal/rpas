'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Phone, Building2, User, Calendar, Clock,
  MessageSquare, Mail, AlertCircle, PhoneCall, PhoneOff,
  MessageCircle, ChevronDown, ChevronUp, DollarSign, Pencil, Check, X, MapPin,
  CalendarClock, History, Flame, Send,
} from 'lucide-react'
import type { ReferralDetail, Tier1Stage, TouchLog, AgentOption, AgencyOption, StatusHistoryEntry, ProducerOption, HouseholdMember } from './page'
import { HouseholdCard } from '@/components/HouseholdCard'

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTCOME_STATUSES = [
  { value: 'live_transfer',      label: 'Live Transfer',       desc: 'Connected live — handing off to a producer now' },
  { value: 'appointment_set',    label: 'Appointment Set',     desc: 'Scheduled a future call or meeting' },
  { value: 'not_interested',     label: 'Not Interested',      desc: 'Client declined at this time' },
  { value: 'lsp_contact_needed', label: 'LSP Re-Warm Needed',  desc: '7+ attempts with no contact — ask the LSP to re-engage' },
]

const PRODUCER_STATUSES = new Set(['live_transfer', 'appointment_set'])
const APPT_STATUSES     = new Set(['appointment_set', 'appointment_missed'])

const TOBACCO_LABELS: Record<string, string> = {
  none:                 'None',
  cigarettes:           'Cigarettes',
  cigars:               'Cigars',
  vaping:               'Vaping / E-Cig',
  chewing:              'Chewing / Dip',
  nicotine_replacement: 'Nicotine Replacement',
}

const TOUCH_TYPES: { value: string; label: string; icon: React.ReactNode; short: string }[] = [
  { value: 'call',      label: 'Call',      short: 'Called',    icon: <PhoneCall     className="w-4 h-4" /> },
  { value: 'voicemail', label: 'Voicemail', short: 'Voicemail', icon: <PhoneOff      className="w-4 h-4" /> },
  { value: 'text',      label: 'Text',      short: 'Texted',    icon: <MessageCircle className="w-4 h-4" /> },
  { value: 'email',     label: 'Email',     short: 'Emailed',   icon: <Mail          className="w-4 h-4" /> },
]

const TOUCH_COLORS: Record<string, string> = {
  call:      'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  voicemail: 'bg-slate-800/60  text-slate-400   border-slate-700',
  text:      'bg-blue-900/40   text-blue-300    border-blue-800',
  email:     'bg-indigo-900/40 text-indigo-300  border-indigo-800',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmtStatus(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-slate-200">{value}</p>
    </div>
  )
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
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
      />
    </div>
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
    `Would you be able to help re-engage them on your end? We'd love to connect when the timing is right.`,
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

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  referral:         ReferralDetail
  stages:           Tier1Stage[]
  touchLog:         TouchLog[]
  agentsList:       AgentOption[]
  agenciesList:     AgencyOption[]
  statusHistory:    StatusHistoryEntry[]
  producersList:    ProducerOption[]
  householdId:      string | null
  householdMembers: HouseholdMember[]
}

export function ReferralEditClient({
  referral, stages: _stages, touchLog: initialTouchLog,
  agentsList, agenciesList, statusHistory, producersList,
  householdId, householdMembers,
}: Props) {
  const router = useRouter()

  // ── Case fields ───────────────────────────────────────────────
  const [status,          setStatus]          = useState(referral.internal_status)
  const [producerId,      setProducerId]      = useState(referral.producer_id ?? '')
  const [appointmentDate, setAppointmentDate] = useState(
    referral.appointment_date ? referral.appointment_date.split('T')[0] : ''
  )
  const [followUpDate, setFollowUpDate] = useState(referral.follow_up_date ?? '')
  const [notes,        setNotes]        = useState(referral.notes ?? '')
  const [isHotLead,    setIsHotLead]    = useState(referral.is_hot_lead)
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null)
  const [notesSaving,  setNotesSaving]  = useState(false)
  const [notesMsg,     setNotesMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // ── Touch log ─────────────────────────────────────────────────
  const [touches,     setTouches]     = useState(referral.touches ?? 0)
  const [lastContact, setLastContact] = useState(referral.last_contact_at)
  const [touchLog,    setTouchLog]    = useState<TouchLog[]>(initialTouchLog)
  const [logOpen,     setLogOpen]     = useState(false)
  const [touchType,   setTouchType]   = useState('call')
  const [touchNote,   setTouchNote]   = useState('')
  const [logging,     setLogging]     = useState(false)
  const [historyOpen, setHistoryOpen] = useState(touchLog.length > 0)

  // ── SPIFF ──────────────────────────────────────────────────────
  const [spiffEarned, setSpiffEarned] = useState(referral.spiff_earned)
  const [spiffSaving, setSpiffSaving] = useState(false)

  // ── App submission ─────────────────────────────────────────────
  const [submitting,  setSubmitting]  = useState(false)
  const [submitMsg,   setSubmitMsg]   = useState<{ ok: boolean; text: string } | null>(null)

  // ── Contact editing ────────────────────────────────────────────
  const [editingContact,   setEditingContact]   = useState(false)
  const [editingQuoteInfo, setEditingQuoteInfo] = useState(false)
  const [cFirstName,   setCFirstName]   = useState(referral.customers?.first_name     ?? '')
  const [cLastName,    setCLastName]    = useState(referral.customers?.last_name      ?? '')
  const [cPhone,       setCPhone]       = useState(referral.customers?.phone          ?? '')
  const [cEmail,       setCEmail]       = useState(referral.customers?.email          ?? '')
  const [cStreet,      setCStreet]      = useState(referral.customers?.street         ?? '')
  const [cCity,        setCCity]        = useState(referral.customers?.city           ?? '')
  const [cState,       setCState]       = useState(referral.customers?.state          ?? '')
  const [cZip,         setCZip]         = useState(referral.customers?.zip            ?? '')
  const [cDob,         setCDob]         = useState(referral.customers?.date_of_birth  ?? '')
  const [cMarital,     setCMarital]     = useState(referral.customers?.marital_status ?? '')
  const [cGender,      setCGender]      = useState(referral.customers?.gender         ?? '')
  const [cTobacco,     setCTobacco]     = useState(referral.customers?.tobacco_use    ?? '')
  const [cHeightFt,    setCHeightFt]    = useState(referral.customers?.height_ft?.toString()  ?? '')
  const [cHeightIn,    setCHeightIn]    = useState(referral.customers?.height_in?.toString()  ?? '')
  const [cWeight,      setCWeight]      = useState(referral.customers?.weight_lbs?.toString() ?? '')
  const [cHealthNotes, setCHealthNotes] = useState(referral.customers?.health_notes    ?? '')
  const [cSpanish,     setCSpanish]     = useState(referral.customers?.spanish_speaking ?? false)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactMsg,    setContactMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  // ── LSP editing ────────────────────────────────────────────────
  const [editingLsp,      setEditingLsp]      = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(referral.agent_id ?? '')
  const [lspFirstName,    setLspFirstName]    = useState(referral.agents?.first_name ?? '')
  const [lspLastName,     setLspLastName]     = useState(referral.agents?.last_name  ?? '')
  const [lspEmail,        setLspEmail]        = useState(referral.agents?.email      ?? '')
  const [lspSaving,       setLspSaving]       = useState(false)
  const [lspMsg,          setLspMsg]          = useState<{ ok: boolean; text: string } | null>(null)

  // ── Agency editing ─────────────────────────────────────────────
  const [editingAgency,     setEditingAgency]     = useState(false)
  const [selectedAgencyId,  setSelectedAgencyId]  = useState(referral.agency_id ?? '')
  const [displayAgencyName, setDisplayAgencyName] = useState(
    referral.agencies?.display_name ?? referral.agencies?.name ?? '—'
  )
  const [agencySaving, setAgencySaving] = useState(false)
  const [agencyMsg,    setAgencyMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  // ── Derived ────────────────────────────────────────────────────
  const showProducerDropdown = PRODUCER_STATUSES.has(status)
  const showRewarmEmail      = status === 'lsp_contact_needed'
  const showApptDate         = APPT_STATUSES.has(status)

  const parsedNotes    = parseNotes(referral.notes)
  const allstatePolicy = parsedNotes['Allstate Policy'] ?? null

  const [displayName,  setDisplayName]  = useState(
    referral.customers ? `${referral.customers.first_name} ${referral.customers.last_name}` : 'Unknown'
  )
  const [displayAgent, setDisplayAgent] = useState(
    referral.agents ? `${referral.agents.first_name} ${referral.agents.last_name}` : null
  )

  const agencyName     = displayAgencyName
  const agentFirstName = referral.agents?.first_name ?? 'there'
  const agentEmail     = referral.agents?.email ?? null
  const agencyEmail    = referral.agencies?.contact_email ?? null
  const isOwner        = referral.is_owner_referral

  const rewarmMailto = showRewarmEmail
    ? buildRewarmMailto(displayName, cFirstName, agentFirstName, agentEmail, agencyEmail)
    : null

  const isFromTriage = referral.internal_status === 'triage' || referral.internal_status === 'active_referral'

  // ── Handlers ───────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setSaveMsg(null)
    const body: Record<string, unknown> = {
      internal_status: status,
      follow_up_date:  followUpDate || null,
      is_hot_lead:     isHotLead,
    }
    if (showProducerDropdown) body.producer_id = producerId || null
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

  async function handleSaveNotes() {
    setNotesSaving(true); setNotesMsg(null)
    const body: Record<string, unknown> = { notes: notes || null }
    if (showApptDate) body.appointment_date = appointmentDate || null
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json()
        setNotesMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setNotesMsg({ ok: true, text: 'Saved' })
        setTimeout(() => setNotesMsg(null), 2000)
      }
    } catch { setNotesMsg({ ok: false, text: 'Network error' }) }
    finally   { setNotesSaving(false) }
  }

  async function handleSaveContact() {
    setContactSaving(true); setContactMsg(null)
    try {
      const res = await fetch(`/api/customers/${referral.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name:       cFirstName.trim(),
          last_name:        cLastName.trim(),
          phone:            cPhone.trim()       || null,
          email:            cEmail.trim()       || null,
          street:           cStreet.trim()      || null,
          city:             cCity.trim()        || null,
          state:            cState.trim()       || null,
          zip:              cZip.trim()         || null,
          date_of_birth:    cDob               || null,
          marital_status:   cMarital            || null,
          gender:           cGender             || null,
          tobacco_use:      cTobacco            || null,
          height_ft:        cHeightFt  ? parseInt(cHeightFt)  : null,
          height_in:        cHeightIn  ? parseInt(cHeightIn)  : null,
          weight_lbs:       cWeight    ? parseInt(cWeight)    : null,
          health_notes:     cHealthNotes.trim() || null,
          spanish_speaking: cSpanish,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setContactMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setDisplayName(`${cFirstName.trim()} ${cLastName.trim()}`)
        setContactMsg({ ok: true, text: 'Contact updated' })
        setEditingContact(false)
        setEditingQuoteInfo(false)
        router.refresh()
        setTimeout(() => setContactMsg(null), 2000)
      }
    } catch { setContactMsg({ ok: false, text: 'Network error' }) }
    finally   { setContactSaving(false) }
  }

  async function handleSaveLsp() {
    setLspSaving(true); setLspMsg(null)
    try {
      const currentAgentId = selectedAgentId || referral.agent_id
      if (!currentAgentId) {
        if (!lspFirstName.trim() || !lspLastName.trim()) {
          setLspMsg({ ok: false, text: 'Enter a first and last name to add an LSP' })
          return
        }
        const createRes = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: lspFirstName.trim(), last_name: lspLastName.trim(),
            email: lspEmail.trim() || null, agency_id: referral.agency_id,
          }),
        })
        if (!createRes.ok) { const j = await createRes.json(); setLspMsg({ ok: false, text: j.error ?? 'Could not create agent' }); return }
        const { data: newAgent } = await createRes.json()
        const caseRes = await fetch(`/api/cases/${referral.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: newAgent.id }),
        })
        if (!caseRes.ok) { const j = await caseRes.json(); setLspMsg({ ok: false, text: j.error ?? 'Could not assign agent' }); return }
        setSelectedAgentId(newAgent.id)
        setDisplayAgent(`${newAgent.first_name} ${newAgent.last_name}`)
        if (spiffEarned) {
          await fetch(`/api/cases/${referral.id}/spiff`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: newAgent.id }),
          })
        }
        setLspMsg({ ok: true, text: 'LSP created and assigned' }); setEditingLsp(false)
        router.refresh(); setTimeout(() => setLspMsg(null), 2000); return
      }
      if (selectedAgentId && selectedAgentId !== (referral.agent_id ?? '')) {
        const caseRes = await fetch(`/api/cases/${referral.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: selectedAgentId }),
        })
        if (!caseRes.ok) { const j = await caseRes.json(); setLspMsg({ ok: false, text: j.error ?? 'Reassign failed' }); return }
        const picked = agentsList.find(a => a.id === selectedAgentId)
        if (picked) setDisplayAgent(`${picked.first_name} ${picked.last_name}`)
      }
      const agentRes = await fetch(`/api/agents/${currentAgentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: lspFirstName.trim(), last_name: lspLastName.trim(), email: lspEmail.trim() || null }),
      })
      if (!agentRes.ok) { const j = await agentRes.json(); setLspMsg({ ok: false, text: j.error ?? 'Agent update failed' }); return }
      setDisplayAgent(`${lspFirstName.trim()} ${lspLastName.trim()}`)
      if (spiffEarned) {
        await fetch(`/api/cases/${referral.id}/spiff`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: currentAgentId }),
        })
      }
      setLspMsg({ ok: true, text: 'LSP updated' }); setEditingLsp(false)
      router.refresh(); setTimeout(() => setLspMsg(null), 2000)
    } catch { setLspMsg({ ok: false, text: 'Network error' }) }
    finally   { setLspSaving(false) }
  }

  async function handleSaveAgency() {
    if (!selectedAgencyId) { setAgencyMsg({ ok: false, text: 'Please select an agency' }); return }
    setAgencySaving(true); setAgencyMsg(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_id: selectedAgencyId }),
      })
      if (!res.ok) {
        const j = await res.json(); setAgencyMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        const picked = agenciesList.find(a => a.id === selectedAgencyId)
        if (picked) setDisplayAgencyName(picked.display_name ?? picked.name)
        setAgencyMsg({ ok: true, text: 'Agency updated' }); setEditingAgency(false)
        router.refresh(); setTimeout(() => setAgencyMsg(null), 2000)
      }
    } catch { setAgencyMsg({ ok: false, text: 'Network error' }) }
    finally   { setAgencySaving(false) }
  }

  function handleAgentSelect(agentId: string) {
    setSelectedAgentId(agentId)
    const a = agentsList.find(x => x.id === agentId)
    if (a) { setLspFirstName(a.first_name); setLspLastName(a.last_name); setLspEmail(a.email ?? '') }
  }

  async function handleSpiffToggle(checked: boolean) {
    setSpiffSaving(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}/spiff`, { method: checked ? 'POST' : 'DELETE' })
      if (res.ok) setSpiffEarned(checked)
    } finally { setSpiffSaving(false) }
  }

  async function handleSpanishToggle(checked: boolean) {
    setCSpanish(checked)
    await fetch(`/api/customers/${referral.customer_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spanish_speaking: checked }),
    })
  }

  async function handleSubmitApp() {
    setSubmitting(true); setSubmitMsg(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_status: 'app_submitted' }),
      })
      if (!res.ok) {
        const j = await res.json()
        setSubmitMsg({ ok: false, text: j.error ?? 'Failed to submit application' })
      } else {
        router.push(`/cases/${referral.id}`)
      }
    } catch { setSubmitMsg({ ok: false, text: 'Network error' }) }
    finally   { setSubmitting(false) }
  }

  async function handleLogTouch() {
    setLogging(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}/touch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touch_type: touchType, notes: touchNote.trim() || undefined }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setTouches(data.touches)
        setLastContact(data.last_contact_at)
        if (data.touch) { setTouchLog(prev => [data.touch, ...prev]); setHistoryOpen(true) }
        setTouchNote(''); setLogOpen(false)
        if (data.advanced_to_active) router.refresh()
      }
    } finally { setLogging(false) }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <Link
          href={isFromTriage ? '/triage' : '/referrals'}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {isFromTriage ? 'Back to Triage' : 'Back to Referrals'}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {isHotLead && <Flame className="w-5 h-5 text-orange-400 flex-shrink-0" />}
              <h1 className="text-white text-2xl font-semibold">{displayName}</h1>
              {isOwner && (
                <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-violet-900/50 text-violet-300 border border-violet-800">
                  Agency Owner
                </span>
              )}
              {isHotLead && (
                <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-orange-900/50 text-orange-300 border border-orange-800">
                  Hot Lead
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
                <button key={t.value} type="button" onClick={() => setTouchType(t.value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border transition-all ${
                    touchType === t.value
                      ? 'border-white/20 bg-slate-700 text-white'
                      : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <textarea value={touchNote} onChange={e => setTouchNote(e.target.value)} rows={2}
              placeholder="Optional note — left VM, will try again Thursday, etc."
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none" />
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setLogOpen(false)} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
              <button onClick={handleLogTouch} disabled={logging}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1F3864' }}>
                {logging ? 'Logging…' : 'Log it'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* ═══════════════ LEFT COLUMN ═══════════════ */}
        <div className="space-y-5">

          {/* 1 — Contact Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Contact Info</h2>
              <button onClick={() => { setEditingContact(o => !o); setContactMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
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
                <EditField label="Street Address" value={cStreet} onChange={setCStreet} placeholder="123 Main St" />
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <EditField label="City" value={cCity} onChange={setCCity} placeholder="Springfield" />
                  </div>
                  <EditField label="State" value={cState} onChange={setCState} placeholder="IL" />
                </div>
                <EditField label="ZIP Code" value={cZip} onChange={setCZip} placeholder="62701" />
                <label className="flex items-center gap-3 cursor-pointer pt-1">
                  <input type="checkbox" checked={cSpanish} onChange={e => setCSpanish(e.target.checked)}
                    className="h-4 w-4 rounded accent-blue-500 cursor-pointer" />
                  <span className="text-sm text-slate-200">Spanish Speaking</span>
                </label>
                {contactMsg && (
                  <p className={`text-xs ${contactMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{contactMsg.text}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handleSaveContact} disabled={contactSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    <Check className="w-3.5 h-3.5" /> {contactSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingContact(false); setContactMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  {cPhone ? (
                    <a href={`tel:${cPhone}`} className="text-blue-400 hover:text-blue-300 text-sm transition-colors">{cPhone}</a>
                  ) : (
                    <button onClick={() => setEditingContact(true)} className="text-sm text-slate-600 hover:text-slate-400 italic transition-colors">No phone — add one</button>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  {cEmail ? (
                    <a href={`mailto:${cEmail}`} className="text-blue-400 hover:text-blue-300 text-sm transition-colors truncate">{cEmail}</a>
                  ) : (
                    <button onClick={() => setEditingContact(true)} className="text-sm text-slate-600 hover:text-slate-400 italic transition-colors">No email — add one</button>
                  )}
                </div>
                <div className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                  {cStreet || cCity ? (
                    <div className="text-sm text-slate-300 leading-snug">
                      {cStreet && <div>{cStreet}</div>}
                      {(cCity || cState || cZip) && (
                        <div>{[cCity, cState].filter(Boolean).join(', ')}{cZip ? ` ${cZip}` : ''}</div>
                      )}
                    </div>
                  ) : (
                    <button onClick={() => setEditingContact(true)} className="text-sm text-slate-600 hover:text-slate-400 italic transition-colors">No address — add one</button>
                  )}
                </div>
                {allstatePolicy && (
                  <div className="flex items-start gap-2.5">
                    <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-slate-500">Allstate Policy</p>
                      <p className="text-sm text-slate-300 font-mono">{allstatePolicy}</p>
                    </div>
                  </div>
                )}
                {referral.lead_source && (
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-slate-500 text-xs font-bold">src</span>
                    <span className="text-xs text-slate-500 capitalize">
                      {referral.lead_source === 'agency_referral' ? 'Agency Referral' : referral.lead_source.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={cSpanish}
                    onChange={e => handleSpanishToggle(e.target.checked)}
                    className="h-4 w-4 rounded accent-blue-500 cursor-pointer" />
                  <span className={`text-sm transition-colors ${cSpanish ? 'text-blue-300' : 'text-slate-500 group-hover:text-slate-300'}`}>
                    Spanish Speaking
                  </span>
                </label>
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

          {/* 2 — Activity */}
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

          {/* 3 — Kept Appointment / SPIFF */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            {isOwner ? (
              <div className="flex items-start gap-3">
                <input type="checkbox" disabled className="mt-0.5 h-4 w-4 rounded opacity-30 cursor-not-allowed" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-500">Kept Appointment</p>
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-violet-900/40 text-violet-400 border border-violet-800">
                      Owner referral — no SPIFF
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">SPIFF applies to LSPs only.</p>
                </div>
              </div>
            ) : (
              <label className={`flex items-start gap-3 rounded-lg border-2 p-3 cursor-pointer transition-all ${
                spiffEarned ? 'border-emerald-700 bg-emerald-950/30' : 'border-slate-700 hover:border-slate-600'
              }`}>
                <input type="checkbox" checked={spiffEarned} disabled={spiffSaving}
                  onChange={e => handleSpiffToggle(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-emerald-500 cursor-pointer" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${spiffEarned ? 'text-emerald-300' : 'text-slate-200'}`}>
                      Kept Appointment
                    </p>
                    {spiffEarned && (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-800">
                        <DollarSign className="w-3 h-3" /> SPIFF earned
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
          </div>

          {/* 4 — LSP / Referring Agent */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-200">LSP / Referring Agent</h2>
              </div>
              <button onClick={() => { setEditingLsp(o => !o); setLspMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            {editingLsp ? (
              <div className="space-y-3">
                {agentsList.length > 0 ? (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Select agent from this agency</label>
                    <select value={selectedAgentId} onChange={e => handleAgentSelect(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                      <option value="">— Unassigned —</option>
                      {agentsList.map(a => (
                        <option key={a.id} value={a.id}>{a.first_name} {a.last_name}{a.email ? ` (${a.email})` : ''}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No agents on file — enter below to add one.</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <EditField label="First name" value={lspFirstName} onChange={setLspFirstName} />
                  <EditField label="Last name"  value={lspLastName}  onChange={setLspLastName}  />
                </div>
                <EditField label="Email" value={lspEmail} onChange={setLspEmail} type="email" placeholder="agent@email.com" />
                {lspMsg && <p className={`text-xs ${lspMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{lspMsg.text}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handleSaveLsp} disabled={lspSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    <Check className="w-3.5 h-3.5" /> {lspSaving ? 'Saving…' : 'Save LSP'}
                  </button>
                  <button onClick={() => { setEditingLsp(false); setLspMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {displayAgent
                  ? <p className="text-slate-200 text-sm font-medium">{displayAgent}</p>
                  : <p className="text-slate-500 text-sm italic">No LSP assigned</p>}
                {referral.agents?.email && <p className="text-xs text-slate-500">{referral.agents.email}</p>}
                {lspMsg && <p className={`text-xs ${lspMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{lspMsg.text}</p>}
              </div>
            )}
          </div>

          {/* 5 — Agency */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-200">Agency</h2>
              </div>
              <button onClick={() => { setEditingAgency(o => !o); setAgencyMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            {editingAgency ? (
              <div className="space-y-3">
                <select value={selectedAgencyId} onChange={e => setSelectedAgencyId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">— Unassigned —</option>
                  {agenciesList.map(a => (
                    <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
                  ))}
                </select>
                {agencyMsg && <p className={`text-xs ${agencyMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{agencyMsg.text}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handleSaveAgency} disabled={agencySaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    <Check className="w-3.5 h-3.5" /> {agencySaving ? 'Saving…' : 'Save Agency'}
                  </button>
                  <button onClick={() => { setEditingAgency(false); setAgencyMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-slate-200 text-sm font-medium">{agencyName}</p>
                {agencyMsg && <p className={`text-xs ${agencyMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{agencyMsg.text}</p>}
              </div>
            )}
          </div>

          {/* 6 — Household */}
          <HouseholdCard
            currentCustomerId={referral.customer_id}
            currentCaseId={referral.id}
            householdId={householdId}
            members={householdMembers}
            currentPersonName={displayName}
            agencyId={referral.agency_id}
          />

          {/* 7 — Status History */}
          {statusHistory.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Status History
              </h2>
              <div className="space-y-3">
                {statusHistory.map((h, i) => (
                  <div key={h.id} className="flex items-start gap-2.5">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-slate-600 mt-1 flex-shrink-0" />
                      {i < statusHistory.length - 1 && (
                        <div className="w-px flex-1 bg-slate-800 mt-1 min-h-[16px]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <p className="text-sm text-slate-200">{fmtStatus(h.to_status)}</p>
                      {h.from_status && <p className="text-xs text-slate-600">from {fmtStatus(h.from_status)}</p>}
                      <p className="text-xs text-slate-600 mt-0.5">{fmt(h.changed_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7 — Touch History */}
          {touchLog.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button onClick={() => setHistoryOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide hover:text-slate-200 transition-colors">
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
                            {typeInfo?.icon}{typeInfo?.short ?? t.touch_type}
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

        {/* ═══════════════ RIGHT COLUMN ═══════════════ */}
        <div className="md:col-span-2 space-y-5">

          {/* 1 — Edit Referral */}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-5 ring-1 ring-slate-700/50">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-200">Edit Referral</h2>
            </div>

            {/* Outcome selector */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-3">Outcome</label>
              <div className="grid grid-cols-2 gap-2">
                {OUTCOME_STATUSES.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setStatus(o.value)}
                    className={`flex flex-col gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                      status === o.value
                        ? 'border-blue-500 bg-blue-950/40'
                        : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <span className={`text-xs font-semibold ${status === o.value ? 'text-blue-300' : 'text-slate-300'}`}>
                      {o.label}
                    </span>
                    <span className="text-xs text-slate-500 leading-snug">{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Producer dropdown */}
            {showProducerDropdown && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Who received this referral?
                </label>
                <select value={producerId} onChange={e => setProducerId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 cursor-pointer">
                  <option value="">Select producer...</option>
                  {producersList.map(p => (
                    <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                  ))}
                </select>
              </div>
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
                    </span>
                  </div>
                )}
                <a href={rewarmMailto ?? '#'}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    agentEmail ? 'bg-amber-700 hover:bg-amber-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed pointer-events-none'
                  }`}>
                  <Mail className="w-4 h-4" /> Open in Outlook
                </a>
              </div>
            )}

            {/* Hot Lead toggle */}
            <label className={`flex items-start gap-3 rounded-lg border-2 p-3 cursor-pointer transition-all ${
              isHotLead ? 'border-orange-700 bg-orange-950/30' : 'border-slate-700 hover:border-slate-600'
            }`}>
              <input type="checkbox" checked={isHotLead} onChange={e => setIsHotLead(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-orange-500 cursor-pointer" />
              <div>
                <div className="flex items-center gap-1.5">
                  <Flame className={`w-3.5 h-3.5 ${isHotLead ? 'text-orange-400' : 'text-slate-500'}`} />
                  <p className={`text-sm font-medium ${isHotLead ? 'text-orange-300' : 'text-slate-200'}`}>Hot Lead</p>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">High priority — flag for immediate attention</p>
              </div>
            </label>

            {/* Follow-up date */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5" /> Follow-up Date
              </label>
              <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" />
              {followUpDate && (
                <button type="button" onClick={() => setFollowUpDate('')}
                  className="mt-1 text-xs text-slate-600 hover:text-slate-400">
                  Clear follow-up
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              {saveMsg
                ? <p className={`text-sm ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg.text}</p>
                : <span />}
              <button onClick={handleSave} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>

          {/* 2 — Application Bridge */}
          {referral.stage_translations?.tier === 1 && (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-emerald-300">Ready to Apply?</h2>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                When the client is ready to move forward with a life insurance application,
                use this to hand off to case management.
                The record moves to the{' '}
                <span className="text-slate-300 font-medium">Cases</span> pipeline.
              </p>
              {submitMsg && (
                <p className={`text-xs ${submitMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{submitMsg.text}</p>
              )}
              <button
                onClick={handleSubmitApp}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting…' : 'Application Submitted'}
              </button>
            </div>
          )}

          {/* 3 — Quote Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Quote Info</h2>
              <button onClick={() => { setEditingQuoteInfo(o => !o); setContactMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>

            {editingQuoteInfo ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <EditField label="Date of Birth" value={cDob} onChange={setCDob} type="date" />
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Gender</label>
                    <select value={cGender} onChange={e => setCGender(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Marital Status</label>
                    <select value={cMarital} onChange={e => setCMarital(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                      <option value="">Select</option>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="divorced">Divorced</option>
                      <option value="widowed">Widowed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Tobacco / Nicotine</label>
                    <select value={cTobacco} onChange={e => setCTobacco(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                      <option value="">Select</option>
                      <option value="none">None</option>
                      <option value="cigarettes">Cigarettes</option>
                      <option value="cigars">Cigars</option>
                      <option value="vaping">Vaping / E-Cig</option>
                      <option value="chewing">Chewing / Dip</option>
                      <option value="nicotine_replacement">Nicotine Replacement</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <EditField label="Height (ft)" value={cHeightFt} onChange={setCHeightFt} type="number" placeholder="5" />
                  <EditField label="Height (in)" value={cHeightIn} onChange={setCHeightIn} type="number" placeholder="10" />
                  <EditField label="Weight (lbs)" value={cWeight}  onChange={setCWeight}   type="number" placeholder="175" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Health Notes</label>
                  <textarea value={cHealthNotes} onChange={e => setCHealthNotes(e.target.value)} rows={3}
                    placeholder="Medications, conditions, surgeries, anything relevant to underwriting…"
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
                </div>
                {contactMsg && (
                  <p className={`text-xs ${contactMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{contactMsg.text}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handleSaveContact} disabled={contactSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    <Check className="w-3.5 h-3.5" /> {contactSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingQuoteInfo(false); setContactMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <QuoteRow label="DOB"     value={cDob    ? fmt(cDob) : '—'} />
                  <QuoteRow label="Gender"  value={cGender  ? cGender.charAt(0).toUpperCase()  + cGender.slice(1)  : '—'} />
                  <QuoteRow label="Marital" value={cMarital ? cMarital.charAt(0).toUpperCase() + cMarital.slice(1) : '—'} />
                  <QuoteRow label="Tobacco" value={cTobacco ? (TOBACCO_LABELS[cTobacco] ?? cTobacco) : '—'} />
                  <QuoteRow label="Height"  value={(cHeightFt || cHeightIn) ? `${cHeightFt || '?'}′ ${cHeightIn || '0'}″` : '—'} />
                  <QuoteRow label="Weight"  value={cWeight ? `${cWeight} lbs` : '—'} />
                </div>
                {cHealthNotes ? (
                  <div className="pt-1 border-t border-slate-800">
                    <p className="text-xs text-slate-500 mb-1">Health Notes</p>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{cHealthNotes}</p>
                  </div>
                ) : (
                  <button onClick={() => setEditingQuoteInfo(true)}
                    className="text-xs text-slate-600 hover:text-slate-400 italic transition-colors">
                    No health notes yet — add them
                  </button>
                )}
              </>
            )}
          </div>

          {/* 4 — Appointment & Notes */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Appointment & Notes
            </h2>

            {showApptDate && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Appointment Date</label>
                <input type="date" value={appointmentDate} onChange={e => setAppointmentDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" />
              </div>
            )}

            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={6}
              placeholder="Notes about this referral — add context from each call…"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600 resize-none" />

            <div className="flex items-center justify-between">
              {notesMsg
                ? <p className={`text-sm ${notesMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{notesMsg.text}</p>
                : <span />}
              <button onClick={handleSaveNotes} disabled={notesSaving}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}>
                {notesSaving ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
