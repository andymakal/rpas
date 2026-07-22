'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Phone, Building2, User, Calendar, Clock,
  Mail, AlertCircle, PhoneCall, PhoneOff,
  MessageCircle, ChevronDown, ChevronUp, DollarSign, Pencil, Check, X, MapPin,
  CalendarClock, CalendarX, History, Flame, Wrench, Send,
  ChevronLeft, ChevronRight, Users, UserPlus, Trash2, GitMerge,
} from 'lucide-react'
import type { ReferralDetail, Tier1Stage, TouchLog, AgentOption, AgencyOption, StatusHistoryEntry, ProducerOption, HouseholdMember, SuspectedDuplicate, NotInterestedReason, ReferralNote } from './page'
import { HouseholdCard } from '@/components/HouseholdCard'
import { NotesLog } from '@/components/NotesLog'
import type { NoteEntry } from '@/components/NotesLog'
import { fmtDate as fmt } from '@/lib/fmt'
import { useNavList } from '@/lib/nav-list'
import { buildHouseholdName } from '@/lib/household'
import { addRecentItem } from '@/lib/recent-items'
import { TEMPLATES, SCRIPTS, APPT_TYPES, TOPIC_MAP, interpolate, buildMailto, fmtEmailDate, fmtTime12 } from '@/lib/templates'
import { ScriptCard } from '@/components/ScriptCard'
import { LEAD_SOURCE_OPTIONS } from '@/lib/constants/referral-options'

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTCOME_STATUSES = [
  { value: 'live_transfer',      label: 'Live Transfer',       desc: 'Connected live — handing off to a producer now' },
  { value: 'appointment_set',    label: 'Appointment Set',     desc: 'Scheduled a future call or meeting' },
  { value: 'quoted',             label: 'Quote Provided',      desc: 'A quote was run and presented to the client' },
  { value: 'not_interested',     label: 'Not Interested',      desc: 'Client declined at this time' },
  { value: 'lsp_contact_needed', label: 'LSP Re-Warm Needed',  desc: '7+ attempts with no contact — ask the LSP to re-engage' },
]

const PRODUCER_STATUSES = new Set(['live_transfer', 'appointment_set'])
const APPT_STATUSES     = new Set(['appointment_set', 'appointment_missed'])

const CARRIERS = [
  'Corebridge',
  'Everlake Assurance',
  'Everlake Life',
  'Foresters',
  'Gerber Life',
  'John Hancock',
  'Lincoln Benefit Life',
  'Lincoln Financial',
  'Pacific Life',
  'Protective',
  'Prudential',
  'Other',
]

const PRODUCT_TYPES = [
  'Final Expense',
  'Indexed Universal Life',
  'Term Life',
  'Universal Life',
  'Variable Universal Life',
  'Whole Life',
  'Other',
]

const TOBACCO_LABELS: Record<string, string> = {
  none:                 'None',
  cigarettes:           'Cigarettes',
  cigars:               'Cigars',
  vaping:               'Vaping / E-Cig',
  chewing:              'Chewing / Dip',
  nicotine_replacement: 'Nicotine Replacement',
}

// Logger shows only contact types; missed_appointment is logged via its own CTA
const TOUCH_TYPES: { value: string; label: string; icon: React.ReactNode; short: string }[] = [
  { value: 'call',               label: 'Call',          short: 'Called',    icon: <PhoneCall     className="w-4 h-4" /> },
  { value: 'voicemail',          label: 'Voicemail',     short: 'Voicemail', icon: <PhoneOff      className="w-4 h-4" /> },
  { value: 'text',               label: 'Text',          short: 'Texted',    icon: <MessageCircle className="w-4 h-4" /> },
  { value: 'email',              label: 'Email',         short: 'Emailed',   icon: <Mail          className="w-4 h-4" /> },
  { value: 'missed_appointment', label: 'Missed Appt.',  short: 'No Show',   icon: <CalendarX     className="w-4 h-4" /> },
]

const TOUCH_COLORS: Record<string, string> = {
  call:               'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  voicemail:          'bg-slate-800/60  text-slate-400   border-slate-700',
  text:               'bg-blue-900/40   text-blue-300    border-blue-800',
  email:              'bg-indigo-900/40 text-indigo-300  border-indigo-800',
  missed_appointment: 'bg-amber-900/40  text-amber-300   border-amber-800',
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

function formatPhone(v: string): string {
  const digits = v.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
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
  clientName: string,
  agentFirstName: string, agentEmail: string | null, agencyEmail: string | null,
  touchCount: number, daysElapsed: number,
  senderName: string,
): string {
  const toEmail = agentEmail ?? agencyEmail
  if (!toEmail) return '#'
  const subject = `${clientName}: unable to make contact`
  const body = [
    `Hi ${agentFirstName},`,
    '',
    `We've made ${touchCount} contact attempt${touchCount !== 1 ? 's' : ''} with ${clientName} over the past ${daysElapsed} day${daysElapsed !== 1 ? 's' : ''} - calls, texts, and emails - with no response.`,
    '',
    `Can you see if they're still interested? We're happy to take care of them if they are.`,
    '',
    'Regards,',
    senderName,
    'Allstate Financial Services',
  ].join('\n')
  // mailto: URIs require RFC 3986 percent-encoding (encodeURIComponent),
  // NOT URLSearchParams which uses form-encoding (+) — Outlook renders + literally.
  // If no agent email, fall back to agency contact as the To: (no CC needed).
  const parts: string[] = []
  if (agentEmail && agencyEmail) parts.push(`cc=${encodeURIComponent(agencyEmail)}`)
  parts.push(`subject=${encodeURIComponent(subject)}`)
  parts.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${toEmail}?${parts.join('&')}`
}

// ── Main component ─────────────────────────────────────────────────────────────

type MergeCandidate = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  city: string | null
  state: string | null
  case_count: number
}

type Props = {
  referral:               ReferralDetail
  stages:                 Tier1Stage[]
  touchLog:               TouchLog[]
  agentsList:             AgentOption[]
  agenciesList:           AgencyOption[]
  statusHistory:          StatusHistoryEntry[]
  producersList:          ProducerOption[]
  householdId:            string | null
  householdMembers:       HouseholdMember[]
  suspectedDuplicate:     SuspectedDuplicate | null
  notInterestedReasons:   NotInterestedReason[]
  initialNotes:           ReferralNote[]
}

export function ReferralEditClient({
  referral, stages: _stages, touchLog: initialTouchLog,
  agentsList, agenciesList, statusHistory, producersList,
  householdId, householdMembers, suspectedDuplicate: initialSuspectedDuplicate,
  notInterestedReasons, initialNotes,
}: Props) {
  const router = useRouter()

  // ── Duplicate detection state ─────────────────────────────────
  const [suspectedDuplicate, setSuspectedDuplicate] = useState<SuspectedDuplicate | null>(initialSuspectedDuplicate)
  const [dupWorking,         setDupWorking]         = useState(false)
  const [dupError,           setDupError]           = useState<string | null>(null)

  // ── Manual merge state ────────────────────────────────────────
  const [mergeOpen,      setMergeOpen]      = useState(false)
  const [mergeQuery,     setMergeQuery]     = useState('')
  const [mergeResults,   setMergeResults]   = useState<MergeCandidate[]>([])
  const [mergeSearching, setMergeSearching] = useState(false)
  const [mergeTarget,    setMergeTarget]    = useState<MergeCandidate | null>(null)
  const [mergeWorking,   setMergeWorking]   = useState(false)
  const [mergeError,     setMergeError]     = useState<string | null>(null)
  const [deleteConfirm,  setDeleteConfirm]  = useState(false)
  const [deleting,       setDeleting]       = useState(false)
  const [deleteError,    setDeleteError]    = useState<string | null>(null)

  async function handleMerge() {
    if (!suspectedDuplicate) return
    if (!confirm(
      `Merge this record into ${suspectedDuplicate.first_name} ${suspectedDuplicate.last_name}?\n\n` +
      `This case will be moved to their existing record and this customer entry will be deleted. This cannot be undone.`
    )) return
    setDupWorking(true); setDupError(null)
    try {
      const res = await fetch(`/api/customers/${referral.customer_id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge_into_id: suspectedDuplicate.id }),
      })
      const json = await res.json()
      if (!res.ok) { setDupError(json.error ?? 'Merge failed'); return }
      setSuspectedDuplicate(null)
      router.refresh()
    } catch { setDupError('Network error') }
    finally { setDupWorking(false) }
  }

  async function handleDismissDuplicate() {
    setDupWorking(true); setDupError(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspected_duplicate_customer_id: null }),
      })
      if (!res.ok) { setDupError('Failed to dismiss'); return }
      setSuspectedDuplicate(null)
    } catch { setDupError('Network error') }
    finally { setDupWorking(false) }
  }

  async function handleMergeSearch(q: string) {
    setMergeQuery(q)
    setMergeTarget(null)
    if (q.trim().length < 2) { setMergeResults([]); return }
    setMergeSearching(true)
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q.trim())}&dedup=true`)
      const json = await res.json()
      setMergeResults(
        (json.data ?? []).filter((c: MergeCandidate) => c.id !== referral.customer_id)
      )
    } catch { setMergeResults([]) }
    finally { setMergeSearching(false) }
  }

  async function handleManualMerge() {
    if (!mergeTarget) return
    if (!confirm(
      `Merge this record (${cFirstName} ${cLastName}) into ${mergeTarget.first_name} ${mergeTarget.last_name}?\n\n` +
      `All cases from this record will move to the other. This record will then be deleted. This cannot be undone.`
    )) return
    setMergeWorking(true); setMergeError(null)
    try {
      const res = await fetch(`/api/customers/${referral.customer_id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge_into_id: mergeTarget.id }),
      })
      const json = await res.json()
      if (!res.ok) { setMergeError(json.error ?? 'Merge failed'); return }
      router.push('/referrals')
    } catch { setMergeError('Network error') }
    finally { setMergeWorking(false) }
  }

  async function handleDeleteReferral() {
    setDeleting(true); setDeleteError(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        setDeleteError(json.error ?? 'Delete failed')
        return
      }
      router.push('/referrals')
    } catch { setDeleteError('Network error') }
    finally { setDeleting(false) }
  }

  // ── Case fields ───────────────────────────────────────────────
  const [status,          setStatus]          = useState(referral.internal_status)
  const [producerId,      setProducerId]      = useState(referral.producer_id ?? '')
  const [appointmentDate, setAppointmentDate] = useState(
    referral.appointment_date ? referral.appointment_date.split('T')[0] : ''
  )
  const [appointmentTime, setAppointmentTime] = useState(referral.appointment_time ?? '')
  const [followUpDate, setFollowUpDate] = useState(referral.follow_up_date ?? '')
  const [alPolicy,     setAlPolicy]     = useState(referral.allstate_policy_number ?? '')
  const [lostReasonId, setLostReasonId] = useState(referral.lost_reason_id ?? '')
  const [leadSource,   setLeadSource]   = useState(referral.lead_source ?? '')
  const [isHotLead,    setIsHotLead]    = useState(referral.is_hot_lead)
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null)

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

  // ── Missed appointment ────────────────────────────────────────
  const [missedOpen,    setMissedOpen]    = useState(false)
  const [missedNote,    setMissedNote]    = useState('')
  const [missedWorking, setMissedWorking] = useState(false)
  const [missedError,   setMissedError]   = useState<string | null>(null)

  // ── LSP re-engagement (lsp_contact_needed → triage) ───────────
  const [lspReengageOpen,    setLspReengageOpen]    = useState(false)
  const [lspReengageNote,    setLspReengageNote]    = useState('')
  const [lspReengageWorking, setLspReengageWorking] = useState(false)
  const [lspReengageError,   setLspReengageError]   = useState<string | null>(null)

  // ── Household members ─────────────────────────────────────────
  type HouseholdMember = ReferralDetail['household_members'][number]
  const [members, setMembers]             = useState<HouseholdMember[]>(referral.household_members ?? [])
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [memberEdits, setMemberEdits]     = useState<Partial<HouseholdMember>>({})
  const [memberSaving, setMemberSaving]   = useState(false)
  const [memberError, setMemberError]     = useState<string | null>(null)
  const [addingMember, setAddingMember]   = useState(false)
  const [newMember, setNewMember]         = useState({ first_name: '', last_name: '', date_of_birth: '' })
  const [addSaving, setAddSaving]         = useState(false)
  const [addError, setAddError]           = useState<string | null>(null)

  async function handleSaveMember(id: string) {
    setMemberSaving(true); setMemberError(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}/household-members/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memberEdits),
      })
      if (!res.ok) { const j = await res.json(); setMemberError(j.error ?? 'Save failed'); return }
      const { data } = await res.json()
      setMembers(prev => prev.map(m => m.id === id ? { ...m, ...data } : m))
      setEditingMemberId(null)
    } catch { setMemberError('Network error') }
    finally { setMemberSaving(false) }
  }

  async function handleDeleteMember(id: string) {
    if (!confirm('Remove this household member?')) return
    try {
      await fetch(`/api/cases/${referral.id}/household-members/${id}`, { method: 'DELETE' })
      setMembers(prev => prev.filter(m => m.id !== id))
      if (editingMemberId === id) setEditingMemberId(null)
    } catch { /* ignore */ }
  }

  async function handleAddMember() {
    if (!newMember.first_name.trim() || !newMember.last_name.trim()) {
      setAddError('First and last name are required')
      return
    }
    setAddSaving(true); setAddError(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}/household-members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMember),
      })
      if (!res.ok) { const j = await res.json(); setAddError(j.error ?? 'Failed to add'); return }
      const { data } = await res.json()
      setMembers(prev => [...prev, data])
      setNewMember({ first_name: '', last_name: '', date_of_birth: '' })
      setAddingMember(false)
    } catch { setAddError('Network error') }
    finally { setAddSaving(false) }
  }

  // ── Email CTAs — sender name (pre-filled from assigned producer if set) ───
  const assignedProducer = producersList.find(p => p.id === referral.producer_id)
  const [emailSenderName, setEmailSenderName] = useState(
    assignedProducer ? `${assignedProducer.first_name} ${assignedProducer.last_name}` : ''
  )
  // Appointment type for confirmation / reminder email (not stored in DB — sender picks at send time)
  const [apptEmailType, setApptEmailType] = useState<typeof APPT_TYPES[number]['value']>('life')
  // Phone number for voicemail / text scripts (team member's RingCentral number)
  const [senderPhone, setSenderPhone] = useState('')

  // ── Recently viewed ────────────────────────────────────────────
  useEffect(() => {
    addRecentItem({
      id:       referral.id,
      type:     'referral',
      label:    buildHouseholdName(referral.customers ?? null, referral.household_members ?? []),
      sublabel: referral.stage_translations?.agency_label ?? referral.internal_status,
      href:     `/referrals/${referral.id}`,
    })
  }, [referral.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── List navigation ────────────────────────────────────────────
  const { prevId, nextId, position, total } = useNavList(referral.id)



  // ── Quote fields ───────────────────────────────────────────────
  // Pre-populated from existing values if the case was already quoted
  const [quotedFaceAmount,   setQuotedFaceAmount]   = useState(
    referral.face_amount ? String(referral.face_amount) : ''
  )
  const [quotedCarrier,      setQuotedCarrier]      = useState(referral.quoted_carrier      ?? '')
  const [quotedProductType,  setQuotedProductType]  = useState(referral.quoted_product_type ?? '')

  // ── Close as existing service (no new SR needed) ──────────────
  const [closingSr, setClosingSr] = useState(false)

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
  const [cLanguage,    setCLanguage]    = useState(referral.customers?.preferred_language ?? 'en')
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
  const showProducerDropdown    = PRODUCER_STATUSES.has(status)
  const showRewarmEmail         = status === 'lsp_contact_needed'
  const showApptDate            = APPT_STATUSES.has(status)
  const showFaceAmountInput     = status === 'quoted'

  // Filter lost reasons by pipeline stage: triage-side cases see triage+both;
  // producer-side cases see producer+both.
  const TRIAGE_STATUSES = new Set(['triage', 'active_referral', 'lsp_contact_needed'])
  const contextForReasons = TRIAGE_STATUSES.has(referral.internal_status) ? 'triage' : 'producer'
  const filteredNiReasons = notInterestedReasons.filter(
    r => r.context === contextForReasons || r.context === 'both'
  )
  const showNotInterestedReason = status === 'not_interested' && filteredNiReasons.length > 0
  // Keyed off server-confirmed status (props), not local state — action should
  // only be available when the DB actually says appointment_set
  const showMissedAppt       = referral.internal_status === 'appointment_set'
  const showLspReengage      = referral.internal_status === 'lsp_contact_needed'

  const parsedNotes       = parseNotes(referral.notes)
  const allstatePolicy    = parsedNotes['Allstate Policy'] ?? null

  const [displayName,  setDisplayName]  = useState(
    buildHouseholdName(
      referral.customers ?? null,
      referral.household_members ?? [],
    )
  )
  const [displayAgent, setDisplayAgent] = useState(
    referral.agents ? `${referral.agents.first_name} ${referral.agents.last_name}` : null
  )

  const agencyName     = displayAgencyName
  const agentFirstName = referral.agents?.first_name ?? 'there'
  const agentEmail     = referral.agents?.email ?? null
  const agencyEmail    = referral.agencies?.contact_email ?? null
  const isOwner        = referral.is_owner_referral

  const rewarmDaysElapsed = referral.created_at
    ? Math.max(1, Math.floor((Date.now() - new Date(referral.created_at).getTime()) / 86_400_000))
    : 0

  const rewarmMailto = showRewarmEmail
    ? buildRewarmMailto(
        displayName, agentFirstName, agentEmail, agencyEmail,
        touches, rewarmDaysElapsed,
        emailSenderName || 'Makal Financial Services',
      )
    : null

  const isFromTriage = referral.internal_status === 'triage' || referral.internal_status === 'active_referral'

  // ── Service referral detection ──────────────────────────────────
  // lead_source is set on all new submissions; fall back to notes parsing for older records
  // parsedNotes already declared above — reuse it here
  const isServiceReferral = referral.lead_source === 'existing_service'
    || parsedNotes['Type'] === 'existing_service'
  const lifePolicyNumber  = parsedNotes['Life Policy'] ?? null

  // Pre-build the /service/new URL so Abigail lands with everything filled in
  const serviceNewUrl = (() => {
    const p = new URLSearchParams()
    const firstName = referral.customers?.first_name ?? ''
    const lastName  = referral.customers?.last_name  ?? ''
    if (firstName || lastName) p.set('client_name', `${firstName} ${lastName}`.trim())
    if (lifePolicyNumber)      p.set('policy_number', lifePolicyNumber)
    if (referral.agency_id)    p.set('agency_id', referral.agency_id)
    if (referral.agent_id)     p.set('agent_id', referral.agent_id ?? '')
    p.set('from_case_id', referral.id)
    return `/service/new?${p.toString()}`
  })()

  // ── Handlers ───────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setSaveMsg(null)
    const body: Record<string, unknown> = {
      internal_status: status,
      follow_up_date:  followUpDate || null,
      is_hot_lead:     isHotLead,
      lead_source:     leadSource   || null,
    }
    if (showProducerDropdown) body.producer_id = producerId || null
    // Save the "not interested" reason alongside the status
    body.lost_reason_id = (status === 'not_interested' && lostReasonId)
      ? lostReasonId
      : null
    if (status === 'quoted') {
      if (quotedCarrier.trim())     body.quoted_carrier      = quotedCarrier.trim()
      if (quotedProductType.trim()) body.quoted_product_type = quotedProductType.trim()
      if (quotedFaceAmount.trim()) {
        const amt = parseFloat(quotedFaceAmount.replace(/[^0-9.]/g, ''))
        if (!isNaN(amt) && amt > 0) body.face_amount = amt
      }
    }
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

  const [apptSaving, setApptSaving] = useState(false)
  const [apptMsg,    setApptMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSaveApptInfo() {
    setApptSaving(true); setApptMsg(null)
    const body: Record<string, unknown> = {
      allstate_policy_number: alPolicy.trim() || null,
    }
    if (showApptDate) {
      body.appointment_date = appointmentDate || null
      body.appointment_time = appointmentTime || null
    }
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json()
        setApptMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setApptMsg({ ok: true, text: 'Saved' })
        setTimeout(() => setApptMsg(null), 2000)
      }
    } catch { setApptMsg({ ok: false, text: 'Network error' }) }
    finally   { setApptSaving(false) }
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
          health_notes:      cHealthNotes.trim() || null,
          preferred_language: cLanguage || 'en',
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setContactMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setDisplayName(buildHouseholdName(
          { first_name: cFirstName.trim(), last_name: cLastName.trim() },
          members,
        ))
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

  async function handleLanguageChange(lang: string) {
    setCLanguage(lang)
    await fetch(`/api/customers/${referral.customer_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferred_language: lang }),
    })
  }

  async function handleMissedAppointment() {
    setMissedWorking(true); setMissedError(null)
    try {
      const res = await fetch(`/api/cases/${referral.id}/missed-appointment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notes: missedNote.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json()
        setMissedError((j as { error?: string }).error ?? 'Failed to log missed appointment')
        return
      }
      router.push('/triage')
    } catch {
      setMissedError('Network error — please try again')
    } finally {
      setMissedWorking(false)
    }
  }

  async function handleCloseAsExistingService() {
    if (!confirm(
      'Remove this referral from the queue without creating a new service request?\n\n' +
      'Use this when the service request already exists. The referral will be marked as an existing service case.'
    )) return
    setClosingSr(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_status: 'existing_service' }),
      })
      if (res.ok) {
        router.push(isFromTriage ? '/triage' : '/referrals')
      }
    } catch { /* ignore — button re-enables */ }
    finally { setClosingSr(false) }
  }

  async function handleLspReengage() {
    setLspReengageWorking(true); setLspReengageError(null)
    try {
      if (lspReengageNote.trim()) {
        const noteRes = await fetch(`/api/cases/${referral.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: 'triage', body: lspReengageNote.trim() }),
        })
        if (!noteRes.ok) {
          const j = await noteRes.json()
          setLspReengageError(j.error ?? 'Failed to save note')
          return
        }
      }
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_status: 'triage', is_hot_lead: true, follow_up_date: new Date().toISOString().slice(0, 10) }),
      })
      if (!res.ok) {
        const j = await res.json()
        setLspReengageError(j.error ?? 'Failed to update')
      } else {
        router.push(isFromTriage ? '/triage' : '/referrals')
      }
    } catch { setLspReengageError('Network error') }
    finally   { setLspReengageWorking(false) }
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
        <div className="flex items-center justify-between mb-4">
          <Link
            href={isFromTriage ? '/triage' : '/referrals'}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {isFromTriage ? 'Back to Triage' : 'Back to Referrals'}
          </Link>
          {total > 0 && (
            <div className="flex items-center gap-1">
              <button onClick={() => router.push(`/referrals/${prevId}`)} disabled={!prevId}
                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-500 tabular-nums w-16 text-center">{position} / {total}</span>
              <button onClick={() => router.push(`/referrals/${nextId}`)} disabled={!nextId}
                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
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
            <div className="mt-1.5 flex items-center gap-3 flex-wrap">
              <StatusBadge st={referral.stage_translations} />
              <Link
                href={`/customers/${referral.customer_id}`}
                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
              >
                <User className="w-3 h-3" /> Customer Card
              </Link>
            </div>
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

      {/* ── Suspected duplicate banner ───────────────────────────────
          Shown when a new referral's phone matches an existing customer.
          Dulce resolves this before actioning — merge or dismiss. */}
      {suspectedDuplicate && (
        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">Possible Duplicate Customer</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Same phone number as{' '}
                  <span className="text-slate-200 font-medium">
                    {suspectedDuplicate.first_name} {suspectedDuplicate.last_name}
                  </span>
                  {suspectedDuplicate.agency_name && (
                    <> · <span className="text-slate-300">{suspectedDuplicate.agency_name}</span></>
                  )}
                  {' '}· {suspectedDuplicate.case_count} case{suspectedDuplicate.case_count !== 1 ? 's' : ''} on file
                </p>
                {dupError && <p className="text-xs text-red-400 mt-1">{dupError}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleMerge}
                disabled={dupWorking}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1F3864' }}
              >
                {dupWorking ? 'Working…' : 'Merge →'}
              </button>
              <button
                onClick={handleDismissDuplicate}
                disabled={dupWorking}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-slate-800 border border-slate-700 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                Different person
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Service referral banner ─────────────────────────────────
          Prominent banner when logged as existing_service; subtle link for all others.
          Either way, anyone who picks this up can route it to Abigail in one click. */}
      {isServiceReferral ? (
        <div className="mb-5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Wrench className="w-5 h-5 text-blue-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-300">Service Request — Route to Abigail</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lifePolicyNumber
                    ? `Policy ${lifePolicyNumber} · Create a service request to begin tracking`
                    : 'Legacy LBL / Everlake policy — create a service request to begin tracking'}
                </p>
              </div>
            </div>
            <a
              href={serviceNewUrl}
              className="shrink-0 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#1F3864' }}
            >
              <Wrench className="w-3.5 h-3.5" />
              Create Service Request
            </a>
          </div>
          <div className="border-t border-blue-500/20 pt-2">
            <button
              onClick={handleCloseAsExistingService}
              disabled={closingSr}
              className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors"
            >
              {closingSr ? 'Removing…' : 'SR already exists — remove from queue without creating a duplicate'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-5 flex items-center justify-end gap-4">
          <button
            onClick={handleCloseAsExistingService}
            disabled={closingSr}
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 disabled:opacity-50 transition-colors"
          >
            {closingSr ? 'Removing…' : 'SR already exists — remove from queue'}
          </button>
          <a
            href={serviceNewUrl}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <Wrench className="w-3.5 h-3.5" />
            Route to Service Request
          </a>
        </div>
      )}

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
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Phone</label>
                  <input
                    type="tel" value={cPhone} placeholder="(555) 555-5555"
                    onChange={e => setCPhone(formatPhone(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                  />
                </div>
                <EditField label="Email" value={cEmail} onChange={setCEmail} type="email" placeholder="client@email.com" />
                <EditField label="Street Address" value={cStreet} onChange={setCStreet} placeholder="123 Main St" />
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <EditField label="City" value={cCity} onChange={setCCity} placeholder="Springfield" />
                  </div>
                  <EditField label="State" value={cState} onChange={setCState} placeholder="IL" />
                </div>
                <EditField label="ZIP Code" value={cZip} onChange={setCZip} placeholder="62701" />
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Preferred language</label>
                  <select value={cLanguage} onChange={e => setCLanguage(e.target.value)} className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100">
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="zh">Chinese</option>
                    <option value="ru">Russian</option>
                    <option value="vi">Vietnamese</option>
                    <option value="other">Other</option>
                  </select>
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
                {alPolicy && (
                  <div className="flex items-start gap-2.5">
                    <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-slate-500">Allstate Policy</p>
                      <p className="text-sm text-slate-300 font-mono">{alPolicy}</p>
                    </div>
                  </div>
                )}
                {leadSource && (
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-slate-500 text-xs font-bold">src</span>
                    <span className="text-xs text-slate-500">
                      {LEAD_SOURCE_OPTIONS.find(o => o.value === leadSource)?.label ?? leadSource.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <span className="text-sm text-slate-500">Language:</span>
                  <select value={cLanguage} onChange={e => handleLanguageChange(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-slate-200">
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="zh">Chinese</option>
                    <option value="ru">Russian</option>
                    <option value="vi">Vietnamese</option>
                    <option value="other">Other</option>
                  </select>
                </div>
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

          {/* 2 — Household Members */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Household
                {members.length > 0 && (
                  <span className="ml-1 text-xs font-normal text-slate-500">+{members.length}</span>
                )}
              </h2>
              {!addingMember && (
                <button onClick={() => { setAddingMember(true); setAddError(null) }}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                  <UserPlus className="w-3 h-3" /> Add
                </button>
              )}
            </div>

            {/* Existing members */}
            {members.length === 0 && !addingMember && (
              <p className="text-xs text-slate-600">No additional household members yet.</p>
            )}
            {members.map(m => (
              <div key={m.id} className="rounded-lg border border-slate-800 bg-slate-800/30 p-3 space-y-2">
                {editingMemberId === m.id ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">First name</label>
                        <input value={memberEdits.first_name ?? m.first_name}
                          onChange={e => setMemberEdits(p => ({ ...p, first_name: e.target.value }))}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Last name</label>
                        <input value={memberEdits.last_name ?? m.last_name}
                          onChange={e => setMemberEdits(p => ({ ...p, last_name: e.target.value }))}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Date of birth</label>
                      <input type="date" value={memberEdits.date_of_birth ?? m.date_of_birth ?? ''}
                        onChange={e => setMemberEdits(p => ({ ...p, date_of_birth: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Gender</label>
                        <select value={memberEdits.gender ?? m.gender ?? ''}
                          onChange={e => setMemberEdits(p => ({ ...p, gender: e.target.value }))}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                          <option value="">Select</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Tobacco</label>
                        <select value={memberEdits.tobacco_use ?? m.tobacco_use ?? ''}
                          onChange={e => setMemberEdits(p => ({ ...p, tobacco_use: e.target.value }))}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                          <option value="">Select</option>
                          <option value="none">None</option>
                          <option value="cigarettes">Cigarettes</option>
                          <option value="cigars">Cigars</option>
                          <option value="vaping">Vaping</option>
                          <option value="chewing">Chewing</option>
                          <option value="nicotine_replacement">Nicotine replacement</option>
                        </select>
                      </div>
                    </div>
                    {/* Quote fields */}
                    <p className="text-xs font-medium text-slate-400 pt-1">Quote</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Carrier</label>
                        <select value={memberEdits.quoted_carrier ?? m.quoted_carrier ?? ''}
                          onChange={e => setMemberEdits(p => ({ ...p, quoted_carrier: e.target.value }))}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                          <option value="">Select…</option>
                          {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Product</label>
                        <select value={memberEdits.quoted_product_type ?? m.quoted_product_type ?? ''}
                          onChange={e => setMemberEdits(p => ({ ...p, quoted_product_type: e.target.value }))}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                          <option value="">Select…</option>
                          {PRODUCT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Face amount</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                        <input type="number" min="0" step="1000"
                          value={memberEdits.face_amount ?? m.face_amount ?? ''}
                          onChange={e => setMemberEdits(p => ({ ...p, face_amount: e.target.value ? Number(e.target.value) : null }))}
                          placeholder="e.g. 500000"
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                      </div>
                    </div>
                    {memberError && <p className="text-xs text-red-400">{memberError}</p>}
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => handleSaveMember(m.id)} disabled={memberSaving}
                        className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-colors">
                        {memberSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => { setEditingMemberId(null); setMemberEdits({}); setMemberError(null) }}
                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{m.first_name} {m.last_name}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        {m.date_of_birth && <p className="text-xs text-slate-500">{fmt(m.date_of_birth)}</p>}
                        {m.quoted_carrier && (
                          <p className="text-xs text-slate-400">{m.quoted_carrier}{m.quoted_product_type ? ` · ${m.quoted_product_type}` : ''}</p>
                        )}
                        {m.face_amount && (
                          <p className="text-xs text-slate-400">${m.face_amount.toLocaleString()}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditingMemberId(m.id); setMemberEdits({}); setMemberError(null) }}
                        className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteMember(m.id)}
                        className="p-1 text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add member form */}
            {addingMember && (
              <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-300">New household member</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">First name *</label>
                    <input value={newMember.first_name} onChange={e => setNewMember(p => ({ ...p, first_name: e.target.value }))}
                      placeholder="Jane"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Last name *</label>
                    <input value={newMember.last_name} onChange={e => setNewMember(p => ({ ...p, last_name: e.target.value }))}
                      placeholder="Smith"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Date of birth</label>
                  <input type="date" value={newMember.date_of_birth} onChange={e => setNewMember(p => ({ ...p, date_of_birth: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                </div>
                {addError && <p className="text-xs text-red-400">{addError}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handleAddMember} disabled={addSaving}
                    className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-colors">
                    {addSaving ? 'Adding…' : 'Add to household'}
                  </button>
                  <button onClick={() => { setAddingMember(false); setNewMember({ first_name: '', last_name: '', date_of_birth: '' }); setAddError(null) }}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3 — Activity */}
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
                          <span suppressHydrationWarning className="text-xs text-slate-500 flex-shrink-0">{fmtTime(t.touched_at)}</span>
                        </div>
                        {t.notes && <p className="text-xs text-slate-400 pl-0.5">{t.notes}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Danger zone — merge or delete */}
          <div className="pt-1 border-t border-slate-800/50 space-y-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => { setMergeOpen(o => !o); setMergeQuery(''); setMergeResults([]); setMergeTarget(null); setMergeError(null); setDeleteConfirm(false) }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                <GitMerge className="w-3.5 h-3.5" />
                {mergeOpen ? 'Cancel merge' : 'Merge duplicate…'}
              </button>
              <button
                onClick={() => { setDeleteConfirm(o => !o); setMergeOpen(false); setDeleteError(null) }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteConfirm ? 'Cancel' : 'Delete referral…'}
              </button>
            </div>

            {deleteConfirm && (
              <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-4 space-y-3">
                <p className="text-xs text-slate-300">
                  Permanently delete this referral for{' '}
                  <span className="font-medium">{cFirstName} {cLastName}</span>?
                  Touch history and all associated data will be removed. This cannot be undone.
                </p>
                {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDeleteReferral}
                    disabled={deleting}
                    className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete referral'}
                  </button>
                  <button
                    onClick={() => { setDeleteConfirm(false); setDeleteError(null) }}
                    className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {mergeOpen && (
              <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
                <p className="text-xs font-medium text-slate-300">Find the record to keep</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  All cases from{' '}
                  <span className="text-slate-300">{cFirstName} {cLastName}</span>{' '}
                  will move to the selected record, then this record will be deleted.
                </p>
                <input
                  type="text"
                  value={mergeQuery}
                  onChange={e => handleMergeSearch(e.target.value)}
                  placeholder="Search by name or phone…"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                />
                {mergeSearching && <p className="text-xs text-slate-500">Searching…</p>}
                {mergeResults.length > 0 && !mergeTarget && (
                  <div className="divide-y divide-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                    {mergeResults.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setMergeTarget(c)}
                        className="w-full flex items-start justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-800 transition-colors"
                      >
                        <div>
                          <p className="text-sm text-slate-200 font-medium">{c.first_name} {c.last_name}</p>
                          <p className="text-xs text-slate-500">
                            {c.phone ?? 'No phone'}
                            {c.city ? ` · ${c.city}${c.state ? `, ${c.state}` : ''}` : ''}
                          </p>
                        </div>
                        <span className="text-xs text-slate-500 shrink-0">
                          {c.case_count} case{c.case_count !== 1 ? 's' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {mergeTarget && (
                  <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 space-y-3">
                    <div className="text-xs space-y-1.5">
                      <p>
                        <span className="text-slate-500">Delete: </span>
                        <span className="text-slate-200">{cFirstName} {cLastName}</span>
                        <span className="text-slate-600"> (this record)</span>
                      </p>
                      <p>
                        <span className="text-slate-500">Keep: </span>
                        <span className="text-slate-200">{mergeTarget.first_name} {mergeTarget.last_name}</span>
                        <span className="text-slate-600"> ({mergeTarget.case_count} case{mergeTarget.case_count !== 1 ? 's' : ''})</span>
                      </p>
                    </div>
                    {mergeError && <p className="text-xs text-red-400">{mergeError}</p>}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleManualMerge}
                        disabled={mergeWorking}
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {mergeWorking ? 'Merging…' : 'Confirm Merge'}
                      </button>
                      <button
                        onClick={() => setMergeTarget(null)}
                        className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

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

            {/* Not Interested reason dropdown */}
            {showNotInterestedReason && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Reason <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <select
                  value={lostReasonId}
                  onChange={e => setLostReasonId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 cursor-pointer"
                >
                  <option value="">Select a reason…</option>
                  {filteredNiReasons.map(r => (
                    <option key={r.id} value={r.id}>{r.agency_label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Carrier / Product / Face Amount — shown when Quote Provided is selected */}
            {showFaceAmountInput && (
              <div className="space-y-3 rounded-lg border border-slate-700/60 bg-slate-800/30 p-3">
                <p className="text-xs font-medium text-slate-400">Quote details <span className="text-slate-600 font-normal">(all optional)</span></p>

                {/* Carrier + Product type */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Carrier</label>
                    <select
                      value={quotedCarrier}
                      onChange={e => setQuotedCarrier(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    >
                      <option value="">Select…</option>
                      {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Product type</label>
                    <select
                      value={quotedProductType}
                      onChange={e => setQuotedProductType(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    >
                      <option value="">Select…</option>
                      {PRODUCT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                {/* Face amount */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Face amount</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={quotedFaceAmount}
                      onChange={e => setQuotedFaceAmount(e.target.value)}
                      placeholder="e.g. 500000"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Live transfer scripts */}
            {status === 'live_transfer' && (() => {
              const ltVars = {
                first_name:     cFirstName,
                last_name:      cLastName,
                lsp_first_name: agentFirstName !== 'there' ? agentFirstName : '',
                agency_name:    displayAgencyName,
                topic:          TOPIC_MAP[referral.lead_source ?? ''] ?? 'life insurance',
              }
              return (
                <div className="rounded-lg border border-orange-800/40 bg-orange-950/20 p-4 space-y-2">
                  <p className="text-xs font-medium text-orange-300 uppercase tracking-wide">Live Transfer Scripts</p>
                  <ScriptCard label={SCRIPTS.live_transfer_client.label}   text={interpolate(SCRIPTS.live_transfer_client.body,   ltVars)} />
                  <ScriptCard label={SCRIPTS.live_transfer_briefing.label} text={interpolate(SCRIPTS.live_transfer_briefing.body, ltVars)} />
                </div>
              )
            })()}

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
                  {agentEmail
                    ? <>Let the LSP know you couldn&apos;t reach {cFirstName} and ask them to help re-engage.{agencyEmail && <> The agency contact will be copied.</>}</>
                    : agencyEmail
                      ? <>No agent email on file — this will go to the agency contact instead.</>
                      : <>No agent or agency email on file.</>
                  }
                </p>
                {!agentEmail && !agencyEmail && (
                  <div className="flex items-start gap-2 text-xs text-amber-500/80">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>Add an agent or agency contact email to enable this button.</span>
                  </div>
                )}
                <a href={rewarmMailto ?? '#'}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    (agentEmail || agencyEmail) ? 'bg-amber-700 hover:bg-amber-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed pointer-events-none'
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

            {/* Lead source */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Lead Source</label>
              <select
                value={leadSource}
                onChange={e => setLeadSource(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 cursor-pointer"
              >
                <option value="">— Not set —</option>
                {LEAD_SOURCE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

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

          {/* ── Email CTAs ─────────────────────────────────────────────────────
               Contextual email drafts keyed off server-confirmed status.
               Each opens a pre-composed draft in Outlook — human clicks Send. */}

          {/* Contact Scripts — triage + active_referral */}
          {(referral.internal_status === 'triage' || referral.internal_status === 'active_referral') && (() => {
            const scriptVars = {
              first_name:     cFirstName,
              lsp_first_name: agentFirstName !== 'there' ? agentFirstName : '',
              sender_name:    emailSenderName || '[your name]',
              phone:          senderPhone     || '[your phone]',
            }
            return (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-slate-300">Contact Scripts</h2>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Your name</label>
                    <input value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)}
                      placeholder="Dulce"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Your phone</label>
                    <input value={senderPhone} onChange={e => setSenderPhone(e.target.value)}
                      placeholder="(814) 555-0100"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                </div>
                <div className="space-y-2">
                  <ScriptCard label={SCRIPTS.voicemail.label}          text={interpolate(SCRIPTS.voicemail.body,          scriptVars)} />
                  <ScriptCard label={SCRIPTS.post_voicemail_text.label} text={interpolate(SCRIPTS.post_voicemail_text.body, scriptVars)} />
                  <ScriptCard label={SCRIPTS.first_attempt_text.label}  text={interpolate(SCRIPTS.first_attempt_text.body,  scriptVars)} />
                </div>
              </div>
            )
          })()}

          {/* Welcome / First Outreach — active_referral */}
          {referral.internal_status === 'active_referral' && (
            <div className="rounded-xl border border-blue-800/40 bg-blue-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-blue-300">Send Welcome Email</h2>
              </div>
              <p className="text-xs text-slate-400">Introduce yourself and let {cFirstName} know why you're reaching out.</p>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Your name</label>
                <input value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)}
                  placeholder="Dulce"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
              </div>
              <a href={buildMailto(
                  referral.customers?.email,
                  interpolate(TEMPLATES.welcome.subject, {
                    lsp_first_name: referral.agents?.first_name ?? 'Your agent',
                    topic:          TOPIC_MAP[referral.lead_source ?? ''] ?? 'life insurance',
                  }),
                  interpolate(TEMPLATES.welcome.body, {
                    first_name:     cFirstName,
                    sender_name:    emailSenderName || '{sender_name}',
                    lsp_first_name: referral.agents?.first_name ?? 'Your agent',
                    lsp_name:       referral.agents ? `${referral.agents.first_name} ${referral.agents.last_name}` : 'your agent',
                    topic:          TOPIC_MAP[referral.lead_source ?? ''] ?? 'life insurance',
                  })
                )}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${referral.customers?.email ? 'text-white bg-blue-700 hover:bg-blue-600' : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'}`}>
                <Mail className="w-3.5 h-3.5" />
                {referral.customers?.email ? 'Open in Outlook' : 'No client email on file'}
              </a>
            </div>
          )}

          {/* Appointment emails — appointment_set */}
          {referral.internal_status === 'appointment_set' && (() => {
            const apptTypeCfg = APPT_TYPES.find(t => t.value === apptEmailType) ?? APPT_TYPES[1]
            const apptVars = {
              first_name:           cFirstName,
              sender_name:          emailSenderName || '{sender_name}',
              appointment_type:     apptTypeCfg.label,
              appointment_duration: apptTypeCfg.duration,
              appointment_date:     fmtEmailDate(referral.appointment_date),
              appointment_time:     fmtTime12(referral.appointment_time) || 'TBD',
            }
            return (
              <div className="rounded-xl border border-blue-800/40 bg-blue-950/20 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-400" />
                  <h2 className="text-sm font-semibold text-blue-300">Appointment Emails</h2>
                </div>

                {/* Shared fields */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Your name</label>
                    <input value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)}
                      placeholder="Dulce"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Appointment type</label>
                    <div className="flex rounded-md overflow-hidden border border-slate-700">
                      {APPT_TYPES.map(({ value, label, duration }) => (
                        <button key={value} type="button" onClick={() => setApptEmailType(value)}
                          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors border-r border-slate-700 last:border-r-0 ${
                            apptEmailType === value
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}>
                          {label}
                          <span className={`ml-1.5 text-xs ${apptEmailType === value ? 'text-blue-200' : 'text-slate-600'}`}>
                            {duration}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Confirmation */}
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Confirmation</p>
                  <a href={buildMailto(
                      referral.customers?.email,
                      interpolate(TEMPLATES.appointment_confirmed.subject, apptVars),
                      interpolate(TEMPLATES.appointment_confirmed.body, apptVars),
                    )}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${referral.customers?.email ? 'text-white bg-blue-700 hover:bg-blue-600' : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'}`}>
                    <Mail className="w-3.5 h-3.5" />
                    {referral.customers?.email ? 'Open in Outlook' : 'No client email on file'}
                  </a>
                </div>

                {/* Reminder */}
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Reminder (day before)</p>
                  <a href={buildMailto(
                      referral.customers?.email,
                      interpolate(TEMPLATES.appointment_reminder.subject, apptVars),
                      interpolate(TEMPLATES.appointment_reminder.body, apptVars),
                    )}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${referral.customers?.email ? 'text-white bg-blue-700 hover:bg-blue-600' : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'}`}>
                    <Mail className="w-3.5 h-3.5" />
                    {referral.customers?.email ? 'Open in Outlook' : 'No client email on file'}
                  </a>
                </div>
              </div>
            )
          })()}

          {/* Quote Follow-Up — quoted */}
          {referral.internal_status === 'quoted' && (() => {
            const todayStr = new Date().toISOString().slice(0, 10)
            const followUpDue = !!(referral.follow_up_date && referral.follow_up_date <= todayStr)
            const daysOverdue = referral.follow_up_date
              ? Math.floor((new Date(todayStr).getTime() - new Date(referral.follow_up_date).getTime()) / 86_400_000)
              : 0
            return (
              <div className={`rounded-xl border p-5 space-y-3 ${followUpDue ? 'border-amber-700/60 bg-amber-950/30' : 'border-blue-800/40 bg-blue-950/20'}`}>
                <div className="flex items-center gap-2">
                  <Mail className={`w-4 h-4 ${followUpDue ? 'text-amber-400' : 'text-blue-400'}`} />
                  <h2 className={`text-sm font-semibold ${followUpDue ? 'text-amber-300' : 'text-blue-300'}`}>Send Quote Follow-Up</h2>
                  {followUpDue && (
                    <span className="ml-auto text-xs font-medium text-amber-400">
                      {daysOverdue === 0 ? 'Due today' : `${daysOverdue}d overdue`}
                    </span>
                  )}
                </div>
                <p className={`text-xs leading-relaxed ${followUpDue ? 'text-amber-300/80' : 'text-slate-400'}`}>
                  {followUpDue
                    ? `Time to check back in with ${cFirstName}${daysOverdue > 0 ? ` — it's been ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} since the quote` : ''}.`
                    : `Check in with ${cFirstName} after the quote.`
                  }
                </p>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Your name</label>
                  <input value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)}
                    placeholder="Dulce"
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                </div>
                <a href={buildMailto(
                    referral.customers?.email,
                    TEMPLATES.quote_followup.subject,
                    interpolate(TEMPLATES.quote_followup.body, {
                      first_name:  cFirstName,
                      sender_name: emailSenderName || '{sender_name}',
                    })
                  )}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${referral.customers?.email ? followUpDue ? 'text-white bg-amber-700 hover:bg-amber-600' : 'text-white bg-blue-700 hover:bg-blue-600' : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'}`}>
                  <Mail className="w-3.5 h-3.5" />
                  {referral.customers?.email ? 'Open in Outlook' : 'No client email on file'}
                </a>
              </div>
            )
          })()}

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

          {/* 3b — Missed appointment CTA (only when appointment_set) */}
          {showMissedAppt && (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <CalendarX className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-300">Client didn&apos;t answer?</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Log a no-show and send this back to the triage queue.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setMissedOpen(o => !o); setMissedError(null) }}
                  className={`shrink-0 text-xs font-semibold rounded-lg px-3 py-2 border transition-all ${
                    missedOpen
                      ? 'border-amber-600 bg-amber-900/40 text-amber-300'
                      : 'border-amber-700/50 text-amber-400 hover:bg-amber-950/40'
                  }`}
                >
                  {missedOpen ? 'Cancel' : 'Log Missed Appointment'}
                </button>
              </div>

              {missedOpen && (
                <div className="border-t border-amber-800/40 bg-amber-950/30 px-5 py-4 space-y-3">
                  <textarea
                    value={missedNote}
                    onChange={e => setMissedNote(e.target.value)}
                    rows={2}
                    placeholder="Optional note — e.g. Called at appointment time, no answer. Left voicemail."
                    className="w-full bg-slate-800 border border-amber-800/40 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-amber-600 placeholder-slate-600 resize-none"
                  />
                  {missedError && <p className="text-xs text-red-400">{missedError}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500 leading-snug">
                      Logs a no-show touch and moves this back to triage
                    </p>
                    <button
                      type="button"
                      onClick={handleMissedAppointment}
                      disabled={missedWorking}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    >
                      <CalendarX className="w-4 h-4" />
                      {missedWorking ? 'Logging…' : 'Confirm — Back to Triage'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LSP re-engagement — shown when DB status is lsp_contact_needed */}
          {showLspReengage && (
            <div className="rounded-xl border border-blue-700/50 bg-blue-950/20 overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Flame className="w-5 h-5 text-blue-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-300">LSP confirmed re-engagement?</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Move this back to triage so the team can follow up.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setLspReengageOpen(o => !o); setLspReengageError(null) }}
                  className={`shrink-0 text-xs font-semibold rounded-lg px-3 py-2 border transition-all ${
                    lspReengageOpen
                      ? 'border-blue-600 bg-blue-900/40 text-blue-300'
                      : 'border-blue-700/50 text-blue-400 hover:bg-blue-950/40'
                  }`}
                >
                  {lspReengageOpen ? 'Cancel' : 'Return to Triage'}
                </button>
              </div>

              {lspReengageOpen && (
                <div className="border-t border-blue-800/40 bg-blue-950/30 px-5 py-4 space-y-3">
                  <textarea
                    value={lspReengageNote}
                    onChange={e => setLspReengageNote(e.target.value)}
                    rows={2}
                    placeholder="Optional — e.g. LSP called, said client is ready to talk options now."
                    className="w-full bg-slate-800 border border-blue-800/40 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-600 placeholder-slate-600 resize-none"
                  />
                  {lspReengageError && <p className="text-xs text-red-400">{lspReengageError}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500 leading-snug">
                      Flags 🔥 and moves back to the triage queue
                    </p>
                    <button
                      type="button"
                      onClick={handleLspReengage}
                      disabled={lspReengageWorking}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                      <Flame className="w-4 h-4" />
                      {lspReengageWorking ? 'Moving…' : 'Confirm — Back to Triage'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4 — Appointment & Allstate Policy */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" /> Appointment & Allstate Policy
            </h2>

            {/* Allstate Policy # — always editable */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Allstate Policy #</label>
              <input
                type="text"
                value={alPolicy}
                onChange={e => setAlPolicy(e.target.value)}
                placeholder="e.g. 123456789"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm font-mono rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>

            {showApptDate && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Appointment Date</label>
                  <input type="date" value={appointmentDate} onChange={e => setAppointmentDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Time</label>
                  <input type="time" value={appointmentTime} onChange={e => setAppointmentTime(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              {apptMsg
                ? <p className={`text-sm ${apptMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{apptMsg.text}</p>
                : <span />}
              <button onClick={handleSaveApptInfo} disabled={apptSaving}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}>
                {apptSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* 5 — Notes Log */}
          <NotesLog
            initialNotes={initialNotes as NoteEntry[]}
            apiPath={`/api/cases/${referral.id}/notes`}
            defaultSection="triage"
          />

        </div>
      </div>
    </div>
  )
}
