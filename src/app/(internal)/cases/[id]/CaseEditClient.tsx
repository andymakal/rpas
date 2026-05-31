'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Phone, Building2, User, Calendar, Clock,
  MessageSquare, Mail, PhoneCall, PhoneOff, MessageCircle, Send,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, DollarSign, Pencil, Check, X, MapPin,
  CalendarClock, History, Flame, Circle, AlertCircle, CheckCircle2,
  Plus, GitMerge, ExternalLink, Copy,
} from 'lucide-react'
import type {
  CaseDetail, StageLookup, AgencyLookup, AgentOption, ProductLookup,
  RateClassLookup, PremiumModeLookup, LostReasonLookup, SnoozeReasonLookup,
  PendingRequirementLookup, TouchLog, StatusHistoryEntry, SiblingCase, HouseholdMember,
} from './page'
import { HouseholdCard } from '@/components/HouseholdCard'
import { fmtDate as fmt, fmtEagentNote } from '@/lib/fmt'
import { useNavList } from '@/lib/nav-list'
import { TEMPLATES, UNDERWRITING_SCENARIOS, interpolate, buildMailto } from '@/lib/templates'

// ── Constants ─────────────────────────────────────────────────────────────────

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

const TOBACCO_LABELS: Record<string, string> = {
  none:                 'None',
  cigarettes:           'Cigarettes',
  cigars:               'Cigars',
  vaping:               'Vaping / E-Cig',
  chewing:              'Chewing / Dip',
  nicotine_replacement: 'Nicotine Replacement',
}

// Status grid is data-driven from stage_translations — no hardcoded lists needed

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'Never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function fmtStatus(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function staleBadgeClass(days: number): string {
  if (days < 7)  return 'bg-emerald-900/50 text-emerald-300 border-emerald-800'
  if (days < 21) return 'bg-amber-900/50 text-amber-300 border-amber-800'
  return 'bg-red-900/50 text-red-300 border-red-800'
}

function formatPhone(v: string): string {
  const digits = v.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function statusBadgeClass(st: CaseDetail['stage_translations']): string {
  if (!st) return 'bg-slate-800 text-slate-400 border border-slate-700'
  if (st.is_won)    return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (st.is_lost)   return 'bg-slate-800/70 text-slate-400 border border-slate-700'
  if (st.is_snoozed)return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
  switch (st.tier) {
    case 2:  return 'bg-indigo-900/50 text-indigo-300 border border-indigo-800'
    case 3:  return 'bg-emerald-900/50 text-emerald-300 border border-emerald-800'
    default: return 'bg-slate-800 text-slate-400 border border-slate-700'
  }
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

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  caseData:            CaseDetail
  stages:              StageLookup[]
  agencies:            AgencyLookup[]
  agentsList:          AgentOption[]
  products:            ProductLookup[]
  rateClasses:         RateClassLookup[]
  premiumModes:        PremiumModeLookup[]
  lostReasons:         LostReasonLookup[]
  snoozeReasons:       SnoozeReasonLookup[]
  pendingRequirements: PendingRequirementLookup[]
  touchLog:            TouchLog[]
  statusHistory:       StatusHistoryEntry[]
  siblingCases:        SiblingCase[]
  householdId:         string | null
  householdMembers:    HouseholdMember[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CaseEditClient({
  caseData, stages, agencies, agentsList, products, rateClasses, premiumModes,
  lostReasons, snoozeReasons, pendingRequirements,
  touchLog: initialTouchLog, statusHistory,
  siblingCases: initialSiblings, householdId, householdMembers,
}: Props) {
  const router = useRouter()

  // ── List navigation ────────────────────────────────────────────
  const { prevId, nextId, position, total } = useNavList(caseData.id)

  // ── Email CTAs ─────────────────────────────────────────────────
  const [emailSenderName,     setEmailSenderName]     = useState('')
  const [uwScenario,          setUwScenario]          = useState('')
  const [uwCustomNote,        setUwCustomNote]        = useState('')
  const uwNote = uwScenario === '__custom__' ? uwCustomNote : uwScenario
  const carrierName = caseData.products?.carriers?.short_name ?? ''
  const clientFirstName = caseData.customers?.first_name ?? ''
  const clientEmail = caseData.customers?.email ?? null

  // ── Notes copy ─────────────────────────────────────────────────
  const [copied, setCopied] = useState(false)

  // ── Case edit state ────────────────────────────────────────────
  const [status,       setStatus]       = useState(caseData.internal_status)
  const [followUpDate, setFollowUpDate] = useState(caseData.follow_up_date ?? '')
  const [notes,        setNotes]        = useState(caseData.notes ?? '')
  const [isHotLead,    setIsHotLead]    = useState(caseData.is_hot_lead ?? false)
  const [isImported,   setIsImported]   = useState(caseData.is_imported ?? false)
  const [lostReasonId,   setLostReasonId]   = useState(caseData.lost_reasons?.id ?? '')
  const [snoozeReasonId, setSnoozeReasonId] = useState(caseData.snooze_reasons?.id ?? '')
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  // ── Policy detail state ────────────────────────────────────────
  const [productId,      setProductId]      = useState(caseData.products?.id ?? '')
  const [faceAmount,     setFaceAmount]     = useState(caseData.face_amount?.toString() ?? '')
  const [annualPremium,  setAnnualPremium]  = useState(caseData.annual_premium?.toString() ?? '')
  const [rateClassId,    setRateClassId]    = useState(caseData.rate_classes?.id ?? '')
  const [tableRating,    setTableRating]    = useState(caseData.table_rating?.toString() ?? '')
  const [premiumModeId,  setPremiumModeId]  = useState(caseData.premium_modes?.id ?? '')
  const [policyNumber,   setPolicyNumber]   = useState(caseData.policy_number ?? '')
  const [placedAt,       setPlacedAt]       = useState(
    caseData.placed_at ? caseData.placed_at.split('T')[0] : ''
  )
  const [showDateOverrides, setShowDateOverrides] = useState(false)
  const [submittedAt,    setSubmittedAt]    = useState(
    caseData.submitted_at ? (caseData.submitted_at as string).split('T')[0] : ''
  )
  const [statusEnteredAt, setStatusEnteredAt] = useState(
    caseData.status_entered_at ? caseData.status_entered_at.split('T')[0] : ''
  )
  const [caseCreatedAt,  setCaseCreatedAt]  = useState(
    caseData.created_at ? caseData.created_at.split('T')[0] : ''
  )
  const [policySaving,   setPolicySaving]   = useState(false)
  const [policyMsg,      setPolicyMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  // ── Contact edit state ─────────────────────────────────────────
  const [editingContact,   setEditingContact]   = useState(false)
  const [editingQuoteInfo, setEditingQuoteInfo] = useState(false)
  const [cFirstName,   setCFirstName]   = useState(caseData.customers?.first_name     ?? '')
  const [cLastName,    setCLastName]    = useState(caseData.customers?.last_name      ?? '')
  const [cPhone,       setCPhone]       = useState(caseData.customers?.phone          ?? '')
  const [cEmail,       setCEmail]       = useState(caseData.customers?.email          ?? '')
  const [cStreet,      setCStreet]      = useState('')
  const [cCity,        setCCity]        = useState('')
  const [cState,       setCState]       = useState('')
  const [cZip,         setCZip]         = useState('')
  const [cDob,         setCDob]         = useState(
    caseData.customers?.date_of_birth ? caseData.customers.date_of_birth.split('T')[0] : ''
  )
  const [cMarital,     setCMarital]     = useState(caseData.customers?.marital_status ?? '')
  const [cGender,      setCGender]      = useState(caseData.customers?.gender         ?? '')
  const [cTobacco,     setCTobacco]     = useState(caseData.customers?.tobacco_use    ?? '')
  const [cHeightFt,    setCHeightFt]    = useState(caseData.customers?.height_ft?.toString()  ?? '')
  const [cHeightIn,    setCHeightIn]    = useState(caseData.customers?.height_in?.toString()  ?? '')
  const [cWeight,      setCWeight]      = useState(caseData.customers?.weight_lbs?.toString() ?? '')
  const [cHealthNotes, setCHealthNotes] = useState(caseData.customers?.health_notes   ?? '')
  const [cSpanish,     setCSpanish]     = useState(caseData.customers?.spanish_speaking ?? false)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactMsg,    setContactMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [displayName,   setDisplayName]   = useState(
    caseData.customers ? `${caseData.customers.first_name} ${caseData.customers.last_name}` : 'Unknown'
  )

  // ── Agent / agency edit state ──────────────────────────────────
  const [editingAgent,   setEditingAgent]   = useState(false)
  const [editingAgency,  setEditingAgency]  = useState(false)
  const [displayAgent,   setDisplayAgent]   = useState(
    caseData.agents ? `${caseData.agents.first_name} ${caseData.agents.last_name}` : null
  )
  const [displayAgency,  setDisplayAgency]  = useState(
    caseData.agencies?.display_name ?? caseData.agencies?.name ?? '—'
  )
  const [selectedAgencyId, setSelectedAgencyId] = useState(caseData.agency_id ?? '')
  const [selectedAgentId,  setSelectedAgentId]  = useState(caseData.agent_id  ?? '')
  const [leadSource,       setLeadSource]        = useState(caseData.lead_source ?? '')
  const [agentSaving,  setAgentSaving]  = useState(false)
  const [agentMsg,     setAgentMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [agencySaving, setAgencySaving] = useState(false)
  const [agencyMsg,    setAgencyMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  // Local agents list — starts from server-fetched prop, grows when user adds a new one inline
  const [localAgents,    setLocalAgents]    = useState<AgentOption[]>(agentsList)
  const [addingNewAgent, setAddingNewAgent] = useState(false)
  const [newAgentFirst,  setNewAgentFirst]  = useState('')
  const [newAgentLast,   setNewAgentLast]   = useState('')
  const [newAgentEmail,  setNewAgentEmail]  = useState('')
  const [newAgentSaving, setNewAgentSaving] = useState(false)
  const [newAgentError,  setNewAgentError]  = useState<string | null>(null)

  // ── Touch log state ────────────────────────────────────────────
  const [touches,     setTouches]     = useState(caseData.touches ?? 0)
  const [lastContact, setLastContact] = useState(caseData.last_contact_at)
  const [touchLog,    setTouchLog]    = useState<TouchLog[]>(initialTouchLog)
  const [logOpen,     setLogOpen]     = useState(false)
  const [touchType,   setTouchType]   = useState('call')
  const [touchNote,   setTouchNote]   = useState('')
  const [logging,     setLogging]     = useState(false)
  const [historyOpen, setHistoryOpen] = useState(initialTouchLog.length > 0)

  // ── Requirements state ─────────────────────────────────────────
  type ReqState = 'inactive' | 'outstanding' | 'resolved'
  const [reqState, setReqState] = useState<Record<string, ReqState>>(() => {
    const map: Record<string, ReqState> = {}
    for (const r of caseData.case_pending_requirements) {
      map[r.pending_requirement_id] = r.resolved_at !== null ? 'resolved' : 'outstanding'
    }
    return map
  })
  const [reqDates, setReqDates] = useState<Record<string, { ordered_at: string; scheduled_at: string; completed_at: string }>>(() => {
    const map: Record<string, { ordered_at: string; scheduled_at: string; completed_at: string }> = {}
    for (const r of caseData.case_pending_requirements) {
      map[r.pending_requirement_id] = {
        ordered_at:   r.ordered_at   ?? '',
        scheduled_at: r.scheduled_at ?? '',
        completed_at: r.completed_at ?? '',
      }
    }
    return map
  })
  const [reqUpdating, setReqUpdating] = useState<Record<string, boolean>>({})

  // ── Sibling state ──────────────────────────────────────────────
  const [siblings,     setSiblings]     = useState<SiblingCase[]>(initialSiblings)
  const [addingPolicy, setAddingPolicy] = useState(false)
  const [sibProduct,   setSibProduct]   = useState('')
  const [sibFace,      setSibFace]      = useState('')
  const [sibPremium,   setSibPremium]   = useState('')
  const [sibSaving,    setSibSaving]    = useState(false)
  const [sibError,     setSibError]     = useState<string | null>(null)

  // ── Derived ────────────────────────────────────────────────────
  const tier2Stages = stages.filter(s => s.tier >= 2)
  const selectedStage = tier2Stages.find(s => s.internal_status === status)
  const isWon     = selectedStage?.is_won     ?? false
  const isLost    = selectedStage?.is_lost    ?? false
  const isSnoozed = selectedStage?.is_snoozed ?? false
  const isSubstandard = rateClasses.find(r => r.id === rateClassId)?.name.toLowerCase().includes('substandard') ?? false
  const daysInStatus = daysAgo(caseData.status_entered_at)
  const lastContactDays = daysAgo(lastContact)

  // Active/won stages go in the main grid; lost/snoozed go in the close-out row
  const pipelineStages = tier2Stages.filter(s => s.is_active_case || s.is_won)
  const terminalStages = tier2Stages.filter(s => !s.is_active_case && !s.is_won)

  const reqCount = {
    outstanding: Object.values(reqState).filter(s => s === 'outstanding').length,
    resolved:    Object.values(reqState).filter(s => s === 'resolved').length,
  }

  // ── Handlers ──────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setSaveMsg(null)
    const body: Record<string, unknown> = {
      internal_status: status,
      follow_up_date:  followUpDate || null,
      notes:           notes        || null,
      is_hot_lead:     isHotLead,
      is_imported:     isImported,
      lead_source:     leadSource   || null,
    }
    if (isLost   && lostReasonId)   body.lost_reason_id   = lostReasonId
    if (isSnoozed && snoozeReasonId) body.snooze_reason_id = snoozeReasonId
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json()
        setSaveMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setSaveMsg({ ok: true, text: 'Saved' })
        router.refresh()
        setTimeout(() => setSaveMsg(null), 2500)
      }
    } catch { setSaveMsg({ ok: false, text: 'Network error' }) }
    finally   { setSaving(false) }
  }

  async function handleSavePolicy() {
    setPolicySaving(true); setPolicyMsg(null)
    const body: Record<string, unknown> = {
      product_id:      productId     || null,
      face_amount:     faceAmount    ? parseFloat(faceAmount)    : null,
      annual_premium:  annualPremium ? parseFloat(annualPremium) : null,
      rate_class_id:   rateClassId   || null,
      table_rating:    isSubstandard && tableRating ? parseInt(tableRating) : null,
      premium_mode_id: premiumModeId || null,
      policy_number:   policyNumber  || null,
    }
    if (isWon) body.placed_at = placedAt ? new Date(placedAt).toISOString() : null
    if (showDateOverrides) {
      if (submittedAt)    body.submitted_at     = new Date(submittedAt).toISOString()
      if (statusEnteredAt) body.status_entered_at = new Date(statusEnteredAt).toISOString()
      if (caseCreatedAt)  body.created_at        = new Date(caseCreatedAt).toISOString()
    }
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json()
        setPolicyMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setPolicyMsg({ ok: true, text: 'Saved' })
        setTimeout(() => setPolicyMsg(null), 2500)
      }
    } catch { setPolicyMsg({ ok: false, text: 'Network error' }) }
    finally   { setPolicySaving(false) }
  }

  async function handleSaveContact() {
    setContactSaving(true); setContactMsg(null)
    try {
      const res = await fetch(`/api/customers/${caseData.customer_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name:    cFirstName.trim(),
          last_name:     cLastName.trim(),
          phone:         cPhone.trim()  || null,
          email:         cEmail.trim()  || null,
          street:        cStreet.trim() || null,
          city:          cCity.trim()   || null,
          state:         cState.trim()  || null,
          zip:           cZip.trim()    || null,
          spanish_speaking: cSpanish,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setContactMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setDisplayName(`${cFirstName.trim()} ${cLastName.trim()}`)
        setContactMsg({ ok: true, text: 'Saved' })
        setEditingContact(false)
        router.refresh()
        setTimeout(() => setContactMsg(null), 2000)
      }
    } catch { setContactMsg({ ok: false, text: 'Network error' }) }
    finally   { setContactSaving(false) }
  }

  async function handleSaveQuoteInfo() {
    setContactSaving(true); setContactMsg(null)
    try {
      const res = await fetch(`/api/customers/${caseData.customer_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_of_birth:  cDob       || null,
          marital_status: cMarital   || null,
          gender:         cGender    || null,
          tobacco_use:    cTobacco   || null,
          height_ft:      cHeightFt  ? parseInt(cHeightFt)  : null,
          height_in:      cHeightIn  ? parseInt(cHeightIn)  : null,
          weight_lbs:     cWeight    ? parseInt(cWeight)    : null,
          health_notes:   cHealthNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setContactMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setContactMsg({ ok: true, text: 'Saved' })
        setEditingQuoteInfo(false)
        setTimeout(() => setContactMsg(null), 2000)
      }
    } catch { setContactMsg({ ok: false, text: 'Network error' }) }
    finally   { setContactSaving(false) }
  }

  async function handleSpanishToggle(checked: boolean) {
    setCSpanish(checked)
    if (!caseData.customer_id) return
    await fetch(`/api/customers/${caseData.customer_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spanish_speaking: checked }),
    })
  }

  async function handleSaveAgent() {
    setAgentSaving(true); setAgentMsg(null)
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: selectedAgentId || null }),
      })
      if (!res.ok) { const j = await res.json(); setAgentMsg({ ok: false, text: j.error ?? 'Save failed' }); return }
      const picked = localAgents.find(a => a.id === selectedAgentId)
      setDisplayAgent(picked ? `${picked.first_name} ${picked.last_name}` : null)
      setAgentMsg({ ok: true, text: 'Saved' }); setEditingAgent(false)
      setTimeout(() => setAgentMsg(null), 2000)
    } catch { setAgentMsg({ ok: false, text: 'Network error' }) }
    finally   { setAgentSaving(false) }
  }

  async function handleCreateAgent() {
    if (!newAgentFirst.trim() || !newAgentLast.trim()) {
      setNewAgentError('First and last name are required'); return
    }
    if (!selectedAgencyId) {
      setNewAgentError('Set the agency on this case first, then add an LSP'); return
    }
    setNewAgentSaving(true); setNewAgentError(null)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: newAgentFirst.trim(),
          last_name:  newAgentLast.trim(),
          email:      newAgentEmail.trim() || null,
          agency_id:  selectedAgencyId,
        }),
      })
      if (!res.ok) { const j = await res.json(); setNewAgentError(j.error ?? 'Failed to create'); return }
      const { data } = await res.json()
      const created: AgentOption = { id: data.id, first_name: data.first_name, last_name: data.last_name, email: data.email }
      setLocalAgents(prev => [...prev, created].sort((a, b) => a.first_name.localeCompare(b.first_name)))
      setSelectedAgentId(data.id)
      setAddingNewAgent(false)
      setNewAgentFirst(''); setNewAgentLast(''); setNewAgentEmail('')
    } catch { setNewAgentError('Network error') }
    finally { setNewAgentSaving(false) }
  }

  async function handleSaveAgency() {
    if (!selectedAgencyId) { setAgencyMsg({ ok: false, text: 'Select an agency' }); return }
    setAgencySaving(true); setAgencyMsg(null)
    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_id: selectedAgencyId }),
      })
      if (!res.ok) { const j = await res.json(); setAgencyMsg({ ok: false, text: j.error ?? 'Save failed' }); return }
      const picked = agencies.find(a => a.id === selectedAgencyId)
      if (picked) setDisplayAgency(picked.display_name ?? picked.name)
      setAgencyMsg({ ok: true, text: 'Saved' }); setEditingAgency(false)
      router.refresh(); setTimeout(() => setAgencyMsg(null), 2000)
    } catch { setAgencyMsg({ ok: false, text: 'Network error' }) }
    finally   { setAgencySaving(false) }
  }

  async function handleLogTouch() {
    setLogging(true)
    try {
      const res = await fetch(`/api/cases/${caseData.id}/touch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  async function handleRequirementCycle(reqId: string) {
    const current = reqState[reqId] ?? 'inactive'
    const next: ReqState =
      current === 'inactive'    ? 'outstanding' :
      current === 'outstanding' ? 'resolved'    : 'inactive'

    setReqUpdating(prev => ({ ...prev, [reqId]: true }))
    try {
      let res: Response
      if (next === 'outstanding') {
        res = await fetch(`/api/cases/${caseData.id}/requirements`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_requirement_id: reqId }),
        })
        // initialise date slots if first time
        if (!reqDates[reqId]) {
          setReqDates(prev => ({ ...prev, [reqId]: { ordered_at: '', scheduled_at: '', completed_at: '' } }))
        }
      } else if (next === 'resolved') {
        res = await fetch(`/api/cases/${caseData.id}/requirements`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_requirement_id: reqId, resolved: true }),
        })
      } else {
        res = await fetch(`/api/cases/${caseData.id}/requirements`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_requirement_id: reqId }),
        })
      }
      if (res.ok) setReqState(prev => ({ ...prev, [reqId]: next }))
    } catch { /* silent */ } finally {
      setReqUpdating(prev => ({ ...prev, [reqId]: false }))
    }
  }

  async function handleReqDateChange(reqId: string, field: 'ordered_at' | 'scheduled_at' | 'completed_at', value: string) {
    setReqDates(prev => ({ ...prev, [reqId]: { ...prev[reqId], [field]: value } }))
    await fetch(`/api/cases/${caseData.id}/requirements`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending_requirement_id: reqId, [field]: value || null }),
    })
  }

  async function handleAddPolicy() {
    setSibSaving(true); setSibError(null)
    try {
      const res = await fetch(`/api/cases/${caseData.id}/sibling`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id:     sibProduct  || undefined,
          face_amount:    sibFace     ? parseFloat(sibFace)    : undefined,
          annual_premium: sibPremium  ? parseFloat(sibPremium) : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSibError((err as { error?: string }).error ?? 'Failed to create')
      } else {
        const { data } = await res.json()
        router.push(`/cases/${data.id}`)
      }
    } catch { setSibError('Network error') }
    finally   { setSibSaving(false) }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/cases"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Cases
          </Link>
          <div className="flex items-center gap-3">
            {total > 0 && (
              <div className="flex items-center gap-1">
                <button onClick={() => router.push(`/cases/${prevId}`)} disabled={!prevId}
                  className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-500 tabular-nums w-16 text-center">{position} / {total}</span>
                <button onClick={() => router.push(`/cases/${nextId}`)} disabled={!nextId}
                  className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
            <Link
              href={`/referrals/${caseData.id}`}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <GitMerge className="w-3.5 h-3.5" /> Referral History
            </Link>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {isHotLead && <Flame className="w-5 h-5 text-orange-400 flex-shrink-0" />}
              <h1 className="text-white text-2xl font-semibold">{displayName}</h1>
              {isHotLead && (
                <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-orange-900/50 text-orange-300 border border-orange-800">
                  Hot Lead
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-medium ${statusBadgeClass(caseData.stage_translations)}`}>
                {caseData.stage_translations?.agency_label ?? caseData.internal_status}
              </span>
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${staleBadgeClass(daysInStatus)}`}>
                {daysInStatus}d in status
              </span>
              {caseData.submitted_at && (
                <span className="text-xs text-slate-500">
                  Submitted {fmt(caseData.submitted_at as unknown as string)}
                </span>
              )}
              {isImported && (
                <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-slate-800 text-slate-500 border border-slate-700">
                  Imported — Lead Manager
                </span>
              )}
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
              placeholder="Optional note…"
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none" />
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setLogOpen(false)} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
              <button onClick={handleLogTouch} disabled={logging}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Phone</label>
                  <input
                    type="tel" value={cPhone} placeholder="(555) 555-5555"
                    onChange={e => setCPhone(formatPhone(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                  />
                </div>
                <EditField label="Email" value={cEmail} onChange={setCEmail} type="email" />
                <EditField label="Street Address" value={cStreet} onChange={setCStreet} />
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <EditField label="City" value={cCity} onChange={setCCity} />
                  </div>
                  <EditField label="State" value={cState} onChange={setCState} placeholder="IL" />
                </div>
                <EditField label="ZIP" value={cZip} onChange={setCZip} />
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
                  {cPhone
                    ? <a href={`tel:${cPhone}`} className="text-blue-400 hover:text-blue-300 text-sm transition-colors">{cPhone}</a>
                    : <button onClick={() => setEditingContact(true)} className="text-sm text-slate-600 hover:text-slate-400 italic">No phone — add one</button>}
                </div>
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  {cEmail
                    ? <a href={`mailto:${cEmail}`} className="text-blue-400 hover:text-blue-300 text-sm transition-colors truncate">{cEmail}</a>
                    : <button onClick={() => setEditingContact(true)} className="text-sm text-slate-600 hover:text-slate-400 italic">No email — add one</button>}
                </div>
                <div className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-500 italic">Address on Referral record</span>
                </div>
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
                  <span className="text-slate-500 text-xs">{fmt(caseData.created_at)}</span>
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
                  <p className="text-xs text-slate-500">In current status</p>
                  <div className="flex items-center gap-2">
                    <p className="text-slate-200 text-sm">{daysInStatus}d</p>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${staleBadgeClass(lastContactDays)}`}>
                      last contact {fmtRelative(lastContact)}
                    </span>
                  </div>
                </div>
                {caseData.status_entered_at && (
                  <div>
                    <p className="text-xs text-slate-500">Since</p>
                    <p className="text-slate-400 text-xs">{fmt(caseData.status_entered_at)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3 — LSP / Referring Agent */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-200">LSP / Referring Agent</h2>
              </div>
              <button onClick={() => { setEditingAgent(o => !o); setAgentMsg(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            {editingAgent ? (
              <div className="space-y-3">
                <select value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">— unassigned —</option>
                  {localAgents.map(a => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>

                {/* Inline add-new-LSP form */}
                {!addingNewAgent ? (
                  <button
                    type="button"
                    onClick={() => { setAddingNewAgent(true); setNewAgentError(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add new LSP
                  </button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">New LSP</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">First name</label>
                        <input
                          autoFocus type="text" value={newAgentFirst}
                          onChange={e => setNewAgentFirst(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                          placeholder="Jane"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Last name</label>
                        <input
                          type="text" value={newAgentLast}
                          onChange={e => setNewAgentLast(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                          placeholder="Smith"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Email <span className="text-slate-600">(optional)</span></label>
                      <input
                        type="email" value={newAgentEmail}
                        onChange={e => setNewAgentEmail(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                        placeholder="jane@example.com"
                      />
                    </div>
                    {newAgentError && <p className="text-xs text-red-400">{newAgentError}</p>}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleCreateAgent} disabled={newAgentSaving}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: '#1F3864' }}
                      >
                        <Check className="w-3.5 h-3.5" /> {newAgentSaving ? 'Creating…' : 'Create & Select'}
                      </button>
                      <button
                        onClick={() => { setAddingNewAgent(false); setNewAgentFirst(''); setNewAgentLast(''); setNewAgentEmail(''); setNewAgentError(null) }}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                )}

                {agentMsg && <p className={`text-xs ${agentMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{agentMsg.text}</p>}
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveAgent} disabled={agentSaving || addingNewAgent}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    <Check className="w-3.5 h-3.5" /> {agentSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingAgent(false); setAgentMsg(null); setAddingNewAgent(false) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {displayAgent
                  ? <p className="text-slate-200 text-sm font-medium">{displayAgent}</p>
                  : <button onClick={() => setEditingAgent(true)}
                      className="text-sm text-slate-600 hover:text-slate-400 italic transition-colors">
                      No LSP assigned — assign one
                    </button>}
                {caseData.agents?.email && (
                  <p className="text-xs text-slate-500">{caseData.agents.email}</p>
                )}
                {agentMsg && <p className={`text-xs ${agentMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{agentMsg.text}</p>}
              </div>
            )}
          </div>

          {/* 4 — Agency */}
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
                  {agencies.map(a => (
                    <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
                  ))}
                </select>
                {agencyMsg && <p className={`text-xs ${agencyMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{agencyMsg.text}</p>}
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveAgency} disabled={agencySaving}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    <Check className="w-3.5 h-3.5" /> {agencySaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingAgency(false); setAgencyMsg(null) }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-slate-200 text-sm font-medium">{displayAgency}</p>
            )}
          </div>

          {/* 5 — Household */}
          <HouseholdCard
            currentCustomerId={caseData.customer_id ?? ''}
            currentCaseId={caseData.id}
            householdId={householdId}
            members={householdMembers}
            currentPersonName={displayName}
            agencyId={caseData.agency_id}
          />

          {/* 6 — Status History */}
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

        </div>

        {/* ═══════════════ RIGHT COLUMN ═══════════════ */}
        <div className="md:col-span-2 space-y-5">

          {/* 1 — Edit Case */}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-5 ring-1 ring-slate-700/50">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-200">Edit Case</h2>
            </div>

            {/* Pipeline status — 2×2 card grid */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-3">Status</label>
              <div className="grid grid-cols-2 gap-2">
                {pipelineStages.map(s => (
                  <button
                    key={s.internal_status}
                    type="button"
                    onClick={() => setStatus(s.internal_status)}
                    className={`flex flex-col gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                      status === s.internal_status
                        ? s.is_won
                          ? 'border-emerald-600 bg-emerald-950/40'
                          : 'border-blue-500 bg-blue-950/40'
                        : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <span className={`text-xs font-semibold ${
                      status === s.internal_status
                        ? s.is_won ? 'text-emerald-300' : 'text-blue-300'
                        : 'text-slate-300'
                    }`}>
                      {s.agency_label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Terminal / close-out statuses */}
              {terminalStages.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-slate-600 mb-2">Close case</p>
                  <div className="flex flex-wrap gap-2">
                    {terminalStages.map(s => (
                      <button
                        key={s.internal_status}
                        type="button"
                        onClick={() => setStatus(s.internal_status)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          status === s.internal_status
                            ? s.is_snoozed
                              ? 'border-yellow-700 bg-yellow-950/40 text-yellow-300'
                              : 'border-slate-500 bg-slate-800 text-slate-300'
                            : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                        }`}
                      >
                        {s.agency_label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Lost reason */}
            {isLost && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Lost Reason</label>
                <select value={lostReasonId} onChange={e => setLostReasonId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">— select reason —</option>
                  {lostReasons.map(r => <option key={r.id} value={r.id}>{r.agency_label}</option>)}
                </select>
              </div>
            )}

            {/* Snooze reason */}
            {isSnoozed && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Postpone Reason</label>
                <select value={snoozeReasonId} onChange={e => setSnoozeReasonId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">— select reason —</option>
                  {snoozeReasons.map(r => <option key={r.id} value={r.id}>{r.agency_label}</option>)}
                </select>
              </div>
            )}

            {/* Hot Lead */}
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

            {/* Imported from Lead Manager */}
            <label className={`flex items-start gap-3 rounded-lg border-2 p-3 cursor-pointer transition-all ${
              isImported ? 'border-slate-600 bg-slate-800/40' : 'border-slate-700 hover:border-slate-600'
            }`}>
              <input type="checkbox" checked={isImported} onChange={e => setIsImported(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-slate-400 cursor-pointer" />
              <div>
                <p className={`text-sm font-medium ${isImported ? 'text-slate-300' : 'text-slate-400'}`}>
                  Imported from Lead Manager
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Excludes this case from time-in-pipeline and touch analytics
                </p>
              </div>
            </label>

            {/* Lead Source */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Lead Source</label>
              <select value={leadSource} onChange={e => setLeadSource(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                <option value="">— not set —</option>
                <option value="agency_referral">Agency Referral</option>
                <option value="allstate_web">Allstate.com (A.COM)</option>
                <option value="self_generated">Self-Generated</option>
              </select>
            </div>

            {/* Follow-up date */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5" /> Follow-up Date
              </label>
              <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500" />
              {followUpDate && (
                <button type="button" onClick={() => setFollowUpDate('')}
                  className="mt-1 text-xs text-slate-600 hover:text-slate-400">Clear follow-up</button>
              )}
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Notes
                </label>
                <button
                  onClick={() => { navigator.clipboard.writeText(fmtEagentNote(notes)); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  disabled={!notes.trim()}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-default transition-colors"
                >
                  {copied ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied!</span></> : <><Copy className="w-3 h-3" />Copy for eAgent</>}
                </button>
              </div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5}
                placeholder="Internal notes — underwriting updates, carrier communications, next steps…"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
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

          {/* ── Email CTAs ──────────────────────────────────────────────────── */}

          {/* Underwriting Update */}
          {caseData.internal_status === 'in_underwriting' && (
            <div className="rounded-xl border border-blue-800/40 bg-blue-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-blue-300">Send Underwriting Update</h2>
              </div>
              <p className="text-xs text-slate-400">Keep {clientFirstName} in the loop on where things stand.</p>
              <div className="space-y-1.5">
                {UNDERWRITING_SCENARIOS.map(s => (
                  <button key={s} type="button" onClick={() => { setUwScenario(s); setUwCustomNote('') }}
                    className={`w-full text-left text-xs rounded-lg border px-3 py-2 transition-all ${
                      uwScenario === s
                        ? 'border-blue-500 bg-blue-950/40 text-blue-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}>{s}</button>
                ))}
                <button type="button" onClick={() => setUwScenario('__custom__')}
                  className={`w-full text-left text-xs rounded-lg border px-3 py-2 transition-all ${
                    uwScenario === '__custom__'
                      ? 'border-blue-500 bg-blue-950/40 text-blue-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}>Write my own…</button>
                {uwScenario === '__custom__' && (
                  <textarea value={uwCustomNote} onChange={e => setUwCustomNote(e.target.value)}
                    rows={2} placeholder="Describe the carrier's current request…"
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
                )}
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Your name</label>
                <input value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)}
                  placeholder="Dulce"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
              </div>
              <a href={uwNote.trim() && clientEmail ? buildMailto(
                  clientEmail,
                  TEMPLATES.underwriting_update.subject,
                  interpolate(TEMPLATES.underwriting_update.body, {
                    first_name:       clientFirstName,
                    carrier:          carrierName,
                    underwriting_note: uwNote.trim(),
                    sender_name:      emailSenderName || '{sender_name}',
                  })
                ) : '#'}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  uwNote.trim() && clientEmail
                    ? 'text-white bg-blue-700 hover:bg-blue-600'
                    : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'
                }`}>
                <Mail className="w-3.5 h-3.5" />
                {!clientEmail ? 'No client email on file' : !uwNote.trim() ? 'Select a scenario first' : 'Open in Outlook'}
              </a>
            </div>
          )}

          {/* Approved */}
          {caseData.internal_status === 'approved' && (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-emerald-300">Send Approval Email</h2>
              </div>
              <p className="text-xs text-slate-400">Share the good news with {clientFirstName}.</p>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Your name</label>
                <input value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)}
                  placeholder="Dulce"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
              </div>
              <a href={buildMailto(
                  clientEmail,
                  TEMPLATES.approved.subject,
                  interpolate(TEMPLATES.approved.body, {
                    first_name:  clientFirstName,
                    carrier:     carrierName,
                    sender_name: emailSenderName || '{sender_name}',
                  })
                )}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${clientEmail ? 'text-white bg-emerald-700 hover:bg-emerald-600' : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'}`}>
                <Mail className="w-3.5 h-3.5" />
                {clientEmail ? 'Open in Outlook' : 'No client email on file'}
              </a>
            </div>
          )}

          {/* Policy in Force — from Andy */}
          {caseData.internal_status === 'placed' && (
            <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-emerald-300">Send Policy in Force Email</h2>
              </div>
              <p className="text-xs text-slate-400">
                Let {clientFirstName} know their {carrierName ? `${carrierName} ` : ''}policy is active.
                <span className="text-slate-500"> Sends from Andy.</span>
              </p>
              <a href={buildMailto(
                  clientEmail,
                  TEMPLATES.policy_in_force.subject,
                  interpolate(TEMPLATES.policy_in_force.body, {
                    first_name: clientFirstName,
                    carrier:    carrierName || 'your carrier',
                  })
                )}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${clientEmail ? 'text-white bg-emerald-700 hover:bg-emerald-600' : 'text-slate-500 bg-slate-800 cursor-not-allowed pointer-events-none'}`}>
                <Mail className="w-3.5 h-3.5" />
                {clientEmail ? 'Open in Outlook' : 'No client email on file'}
              </a>
            </div>
          )}

          {/* 2 — Policy Details */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-200">Policy Details</h2>
            </div>

            {/* Product */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">Carrier · Product</label>
              <select value={productId} onChange={e => setProductId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                <option value="">— none —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.carriers?.short_name ? `${p.carriers.short_name} · ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Face amount + annual premium */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Face Amount</label>
                <input type="number" min="0" step="1000" value={faceAmount}
                  onChange={e => setFaceAmount(e.target.value)} placeholder="0"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Annual Premium</label>
                <input type="number" min="0" step="1" value={annualPremium}
                  onChange={e => setAnnualPremium(e.target.value)} placeholder="0"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
              </div>
            </div>

            {/* Rate class + premium mode */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Rate Class</label>
                <select value={rateClassId} onChange={e => { setRateClassId(e.target.value); setTableRating('') }}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">— none —</option>
                  {rateClasses.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Premium Mode</label>
                <select value={premiumModeId} onChange={e => setPremiumModeId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">— none —</option>
                  {premiumModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            {/* Table rating — substandard only */}
            {isSubstandard && (
              <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-4 space-y-3">
                <label className="block text-xs font-medium text-amber-300">Table Rating</label>
                <div className="grid grid-cols-8 gap-1.5">
                  {[1,2,3,4,5,6,7,8].map(n => (
                    <button key={n} type="button"
                      onClick={() => setTableRating(tableRating === n.toString() ? '' : n.toString())}
                      className={`rounded-lg py-2 text-sm font-semibold border transition-all ${
                        tableRating === n.toString()
                          ? 'bg-amber-700 border-amber-600 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-amber-700 hover:text-amber-300'
                      }`}>
                      {n}
                    </button>
                  ))}
                </div>
                {tableRating && (
                  <p className="text-xs text-amber-400/80">
                    Table {tableRating} = {100 + parseInt(tableRating) * 25}% of standard rate
                  </p>
                )}
              </div>
            )}

            {/* Policy number */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">Policy Number</label>
              <input type="text" value={policyNumber} onChange={e => setPolicyNumber(e.target.value)} placeholder="—"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
            </div>

            {/* Date placed — only when placed */}
            {isWon && (
              <div>
                <label className="block text-xs text-slate-500 mb-1">Date Placed</label>
                <input type="date" value={placedAt} onChange={e => setPlacedAt(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                <p className="text-xs text-slate-600 mt-1">Use the carrier's issue date.</p>
              </div>
            )}

            {/* Date overrides — imported cases */}
            <div>
              <button type="button" onClick={() => setShowDateOverrides(o => !o)}
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
                {showDateOverrides ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Date Overrides (imported cases)
              </button>
              {showDateOverrides && (
                <div className="mt-3 space-y-3 rounded-lg border border-slate-700 bg-slate-800/30 p-3">
                  <p className="text-xs text-slate-500">
                    Override timestamps for accuracy on imported records. These save with the button below.
                  </p>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">App Submitted Date</label>
                    <input type="date" value={submittedAt} onChange={e => setSubmittedAt(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Status Set Date</label>
                    <input type="date" value={statusEnteredAt} onChange={e => setStatusEnteredAt(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Case Created Date</label>
                    <input type="date" value={caseCreatedAt} onChange={e => setCaseCreatedAt(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              {policyMsg
                ? <p className={`text-sm ${policyMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{policyMsg.text}</p>
                : <span />}
              <button onClick={handleSavePolicy} disabled={policySaving}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}>
                {policySaving ? 'Saving…' : 'Save Policy Details'}
              </button>
            </div>
          </div>

          {/* 3 — Quote / Underwriting Info */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Quote / Underwriting Info</h2>
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
                    placeholder="Medications, conditions, surgeries…"
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
                </div>
                {contactMsg && (
                  <p className={`text-xs ${contactMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{contactMsg.text}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handleSaveQuoteInfo} disabled={contactSaving}
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
                  <div><p className="text-xs text-slate-500">DOB</p><p className="text-slate-200">{cDob ? fmt(cDob) : '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Gender</p><p className="text-slate-200">{cGender ? cGender.charAt(0).toUpperCase() + cGender.slice(1) : '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Marital</p><p className="text-slate-200">{cMarital ? cMarital.charAt(0).toUpperCase() + cMarital.slice(1) : '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Tobacco</p><p className="text-slate-200">{cTobacco ? (TOBACCO_LABELS[cTobacco] ?? cTobacco) : '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Height</p><p className="text-slate-200">{(cHeightFt || cHeightIn) ? `${cHeightFt || '?'}′ ${cHeightIn || '0'}″` : '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Weight</p><p className="text-slate-200">{cWeight ? `${cWeight} lbs` : '—'}</p></div>
                </div>
                {cHealthNotes ? (
                  <div className="pt-2 border-t border-slate-800">
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

          {/* 4 — Requirements */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Requirements</h2>
              <div className="text-xs">
                {reqCount.outstanding > 0
                  ? <span className="text-amber-400 font-medium">{reqCount.outstanding} outstanding</span>
                  : <span className="text-emerald-400">All clear</span>}
              </div>
            </div>
            <ul className="space-y-1">
              {pendingRequirements.map(req => {
                const state    = reqState[req.id] ?? 'inactive'
                const updating = reqUpdating[req.id] ?? false
                const dates    = reqDates[req.id] ?? { ordered_at: '', scheduled_at: '', completed_at: '' }
                const showDates = req.has_date_fields && state !== 'inactive'

                return (
                  <li key={req.id}>
                    <button
                      onClick={() => handleRequirementCycle(req.id)}
                      disabled={updating}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-all disabled:opacity-50 ${
                        state === 'outstanding'
                          ? 'bg-amber-950/40 hover:bg-amber-950/60'
                          : state === 'resolved'
                          ? 'bg-emerald-950/30 hover:bg-emerald-950/50'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      {state === 'inactive'    && <Circle       className="w-4 h-4 shrink-0 text-slate-600" />}
                      {state === 'outstanding' && <AlertCircle  className="w-4 h-4 shrink-0 text-amber-400" />}
                      {state === 'resolved'    && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
                      <span className={`text-sm ${
                        state === 'outstanding' ? 'text-amber-200 font-medium' :
                        state === 'resolved'    ? 'line-through text-slate-600' :
                        'text-slate-500'
                      }`}>
                        {req.name}
                      </span>
                    </button>

                    {/* Date fields for labs/exam */}
                    {showDates && (
                      <div className="ml-10 mt-1 mb-2 grid grid-cols-3 gap-2">
                        {(['ordered_at', 'scheduled_at', 'completed_at'] as const).map(field => (
                          <div key={field}>
                            <label className="block text-xs text-slate-600 mb-0.5 capitalize">
                              {field === 'ordered_at' ? 'Ordered' : field === 'scheduled_at' ? 'Scheduled' : 'Completed'}
                            </label>
                            <input
                              type="date"
                              value={dates[field]}
                              onChange={e => handleReqDateChange(req.id, field, e.target.value)}
                              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-slate-600 mt-1 px-1">Tap to cycle: inactive → outstanding → resolved</p>
          </div>

          {/* 5 — Also on File */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Also on File</h2>
              <button
                onClick={() => { setAddingPolicy(o => !o); setSibError(null) }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add Policy
              </button>
            </div>

            {addingPolicy && (
              <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">New simultaneous policy</p>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Product</label>
                  <select value={sibProduct} onChange={e => setSibProduct(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500">
                    <option value="">— select product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.carriers?.short_name ? `${p.carriers.short_name} · ${p.name}` : p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Face Amount</label>
                    <input type="number" min="0" step="1000" value={sibFace}
                      onChange={e => setSibFace(e.target.value)} placeholder="500000"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Annual Premium</label>
                    <input type="number" min="0" step="1" value={sibPremium}
                      onChange={e => setSibPremium(e.target.value)} placeholder="1200"
                      className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                  </div>
                </div>
                {sibError && <p className="text-xs text-red-400">{sibError}</p>}
                <div className="flex items-center gap-3">
                  <button onClick={handleAddPolicy} disabled={sibSaving}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1F3864' }}>
                    {sibSaving ? 'Creating…' : 'Create & Open Policy'}
                  </button>
                  <button onClick={() => { setAddingPolicy(false); setSibError(null) }}
                    className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
                </div>
              </div>
            )}

            {siblings.length === 0 && !addingPolicy ? (
              <p className="text-xs text-slate-600 italic">No other policies on file for this client.</p>
            ) : (
              <div className="space-y-2">
                {siblings.map(s => {
                  const cp = s.products
                    ? s.products.carriers?.short_name
                      ? `${s.products.carriers.short_name} · ${s.products.name}`
                      : s.products.name
                    : '—'
                  const badgeCls = s.stage_translations?.is_won
                    ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700'
                    : s.stage_translations?.is_lost
                    ? 'bg-slate-800/70 text-slate-400 border-slate-700'
                    : 'bg-indigo-900/50 text-indigo-300 border-indigo-800'
                  return (
                    <button key={s.id} onClick={() => router.push(`/cases/${s.id}`)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/30 px-3 py-2.5 text-left hover:bg-slate-800/60 transition-colors group">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-300 truncate group-hover:text-white transition-colors">{cp}</p>
                        {s.face_amount && (
                          <p className="text-xs text-slate-500 mt-0.5">{fmtCurrency(s.face_amount)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${badgeCls}`}>
                          {s.stage_translations?.agency_label ?? s.internal_status}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
