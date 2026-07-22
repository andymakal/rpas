'use client'

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Phone, Mail, MapPin, User,
  Shield, CheckCircle, ShieldOff, FileQuestion, Send,
  AlertTriangle, ChevronRight, Search, X, Trash2,
  FolderKanban, Wrench, Link2, History, Compass, ChevronDown, ChevronUp,
  Pencil, Check, MessageSquare, Clipboard,
} from 'lucide-react'
import type {
  CustomerDetail, LinkedCase, LinkedPolicy, LinkedServiceRequest,
  CaseStatusHistoryEntry, CustomerNote,
} from './page'
import { fmtDate } from '@/lib/fmt'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

/** Display DOB as MM/xx/YYYY — never expose the day */
function maskDob(iso: string | null): string {
  if (!iso) return '—'
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}/xx/${yyyy}`
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-slate-500 text-xs">—</span>
  const colors: Record<string, string> = {
    Term: 'bg-blue-900/40 text-blue-300',
    UL:   'bg-purple-900/40 text-purple-300',
    VUL:  'bg-purple-900/40 text-purple-300',
    WL:   'bg-teal-900/40 text-teal-300',
    PERM: 'bg-teal-900/40 text-teal-300',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[type] ?? 'bg-slate-700 text-slate-300'}`}>
      {type}
    </span>
  )
}

function SaBadge({ saStatus, formSentAt }: { saStatus: string; formSentAt: string | null }) {
  if (saStatus === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded-full">
        <CheckCircle className="w-3 h-3" /> SA
      </span>
    )
  }
  if (saStatus === 'not_on_file') {
    if (formSentAt) {
      return (
        <span className="inline-flex items-center gap-1 text-xs bg-sky-900/50 text-sky-300 px-1.5 py-0.5 rounded-full">
          <Send className="w-3 h-3" /> Form Sent
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded-full">
        <ShieldOff className="w-3 h-3" /> Not SA
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full">
      <FileQuestion className="w-3 h-3" /> ?
    </span>
  )
}

function CaseStatusBadge({ st }: { st: LinkedCase['stage_translations'] }) {
  if (!st) return <span className="text-slate-500 text-xs">—</span>
  const color = st.is_won   ? 'bg-green-900/40 text-green-300'
               : st.is_lost ? 'bg-red-900/40 text-red-300'
               : 'bg-blue-900/40 text-blue-300'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
      {st.agency_label}
    </span>
  )
}

const STATUS_LABELS: Record<string, string> = {
  triage:          'Triage',
  active_referral: 'Active Referral',
  quote_provided:  'Quote Provided',
  app_submitted:   'App Submitted',
  in_underwriting: 'In Underwriting',
  placed:          'Placed',
  not_interested:  'Not Interested',
  lost:            'Lost',
}

function fmtStatus(s: string | null): string {
  if (!s) return '—'
  return STATUS_LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function statusDotColor(s: string): string {
  if (s === 'placed')                        return 'bg-green-500 border-green-700'
  if (s === 'not_interested' || s === 'lost') return 'bg-red-500 border-red-700'
  if (s === 'triage')                        return 'bg-slate-600 border-slate-500'
  return 'bg-blue-500 border-blue-700'
}

function abbrevProduct(name: string | null | undefined): string | null {
  if (!name) return null
  if (name.startsWith('Term'))     return 'Term'
  if (name.includes('Variable'))   return 'VUL'
  if (name.includes('Indexed'))    return 'IUL'
  if (name.includes('Guaranteed')) return 'GUL'
  if (name.includes('Universal'))  return 'UL'
  if (name.includes('Whole'))      return 'WL'
  return null
}

const TOUCH_TYPE_LABELS: Record<string, string> = {
  call:               'Call',
  voicemail:          'Voicemail',
  text:               'Text',
  email:              'Email',
  missed_appointment: 'Missed Appt.',
}

function SrStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open:        'bg-amber-900/40 text-amber-300',
    in_progress: 'bg-blue-900/40 text-blue-300',
    resolved:    'bg-green-900/40 text-green-300',
    closed:      'bg-slate-700 text-slate-400',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[status] ?? 'bg-slate-700 text-slate-300'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ── Segmentation ─────────────────────────────────────────────────────────────

const SEGMENTS = [
  {
    value:   'wanderer',
    label:   'Wanderer',
    desc:    'Legacy policy — service only',
    badge:   'bg-slate-700/80 text-slate-300 border-slate-600',
    btn:     'border-slate-600 hover:border-slate-400 text-slate-300',
  },
  {
    value:   'explorer',
    label:   'Explorer',
    desc:    'Life insurance client',
    badge:   'bg-blue-900/50 text-blue-300 border-blue-800',
    btn:     'border-blue-800 hover:border-blue-500 text-blue-300',
  },
  {
    value:   'pathfinder',
    label:   'Pathfinder',
    desc:    'Financial client — under $100K',
    badge:   'bg-emerald-900/50 text-emerald-300 border-emerald-800',
    btn:     'border-emerald-800 hover:border-emerald-500 text-emerald-300',
  },
  {
    value:   'voyageur',
    label:   'Voyageur',
    desc:    'Financial client — $100K – $500K',
    badge:   'bg-amber-900/50 text-amber-300 border-amber-800',
    btn:     'border-amber-800 hover:border-amber-500 text-amber-300',
  },
  {
    value:   'trailblazer',
    label:   'Trailblazer',
    desc:    'Financial client — $500K+',
    badge:   'bg-orange-900/50 text-orange-300 border-orange-800',
    btn:     'border-orange-800 hover:border-orange-500 text-orange-300',
  },
] as const

function SegmentBadge({ segment }: { segment: string | null }) {
  const s = SEGMENTS.find(x => x.value === segment)
  if (!s) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 border border-dashed border-slate-700 rounded-full px-2.5 py-0.5">
        <Compass className="w-3 h-3" /> Unassigned
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs border rounded-full px-2.5 py-0.5 font-medium ${s.badge}`}>
      <Compass className="w-3 h-3" /> {s.label}
    </span>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, icon: Icon, count, children, action }: {
  title:    string
  icon:     React.ElementType
  count?:   number
  children: React.ReactNode
  action?:  React.ReactNode
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-300">{title}</span>
          {count != null && (
            <span className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

const CARRIERS = [
  'Allstate Life', 'American General', 'Banner Life', 'Corebridge Financial',
  'Equitable', 'Everlake Assurance', 'Everlake Life', 'Foresters Financial',
  'Gerber Life', 'John Hancock', 'Lincoln Benefit Life', 'Lincoln Financial',
  'Pacific Life', 'Protective Life', 'Prudential', 'Sammons Financial', 'Other',
]

const POLICY_TYPES = ['Term', 'UL', 'VUL', 'WL', 'IUL', 'GUL', 'LTC', 'Annuity', 'FA', 'MVA', 'Other']

type PolicySearchResult = {
  id:           string
  policy_number: string
  client_name:   string
  carrier:       string
  product_type:  string | null
  face_amount:   number | null
  customer_id:   string | null
}

// ── Main component ────────────────────────────────────────────────────────────

export function CustomerCardClient({
  customer,
  cases: initialCases,
  policies: initialPolicies,
  pendingCasePolicies,
  serviceRequests,
  caseHistory,
  initialNotes,
}: {
  customer:             CustomerDetail
  cases:                LinkedCase[]
  policies:             LinkedPolicy[]
  pendingCasePolicies:  LinkedCase[]
  serviceRequests:      LinkedServiceRequest[]
  caseHistory:          CaseStatusHistoryEntry[]
  initialNotes:         CustomerNote[]
}) {
  const router = useRouter()
  const [cases,       setCases]       = useState<LinkedCase[]>(initialCases)
  const [policies,    setPolicies]    = useState<LinkedPolicy[]>(initialPolicies)
  const [policySearch, setPolicySearch] = useState('')
  const [policyResults, setPolicyResults] = useState<PolicySearchResult[]>([])
  const [searchingPolicies, setSearchingPolicies] = useState(false)
  const [showPolicyDrop, setShowPolicyDrop] = useState(false)
  const [linking, setLinking]   = useState(false)
  const [linkErr, setLinkErr]   = useState<string | null>(null)
  const [confirmDeleteCase, setConfirmDeleteCase] = useState<string | null>(null)
  const [deletingCase,      setDeletingCase]      = useState(false)
  const [caseDeleteErr,     setCaseDeleteErr]     = useState<string | null>(null)

  const [expandedTouches, setExpandedTouches] = useState<Set<string>>(new Set())
  const [touchLogCache,   setTouchLogCache]   = useState<Map<string, { touch_type: string; touched_at: string }[]>>(new Map())
  const [touchLogLoading, setTouchLogLoading] = useState<Set<string>>(new Set())

  const [addingPolicy,    setAddingPolicy]    = useState(false)
  const [newCarrier,      setNewCarrier]      = useState('')
  const [newPolicyNum,    setNewPolicyNum]    = useState('')
  const [newProductType,  setNewProductType]  = useState('')
  const [newFaceAmount,   setNewFaceAmount]   = useState('')
  const [newPremium,      setNewPremium]      = useState('')
  const [newIssueDate,    setNewIssueDate]    = useState('')
  const [addPolicySaving, setAddPolicySaving] = useState(false)
  const [addPolicyErr,    setAddPolicyErr]    = useState<string | null>(null)

  const [editingPolicyId,  setEditingPolicyId]  = useState<string | null>(null)
  const [editPolCarrier,   setEditPolCarrier]   = useState('')
  const [editPolNumber,    setEditPolNumber]    = useState('')
  const [editPolType,      setEditPolType]      = useState('')
  const [editPolFace,      setEditPolFace]      = useState('')
  const [editPolPremium,   setEditPolPremium]   = useState('')
  const [editPolStatus,    setEditPolStatus]    = useState('')
  const [editPolBene,      setEditPolBene]      = useState('')
  const [editPolSaving,    setEditPolSaving]    = useState(false)
  const [editPolErr,       setEditPolErr]       = useState<string | null>(null)

  const [segment,        setSegment]        = useState<string | null>(customer.segment)
  const [editingSegment, setEditingSegment] = useState(false)
  const [segmentSaving,  setSegmentSaving]  = useState(false)

  // Notes
  const [notes,        setNotes]        = useState<CustomerNote[]>(initialNotes)
  const [noteSection,  setNoteSection]  = useState<'triage' | 'producer' | 'underwriting'>('triage')
  const [noteBody,     setNoteBody]     = useState('')
  const [notePosting,  setNotePosting]  = useState(false)
  const [noteErr,      setNoteErr]      = useState<string | null>(null)
  const [noteCopied,   setNoteCopied]   = useState(false)

  const [displayFirst, setDisplayFirst] = useState(customer.first_name)
  const [displayLast,  setDisplayLast]  = useState(customer.last_name)

  const [editingContact,  setEditingContact]  = useState(false)
  const [editFirst,       setEditFirst]       = useState(customer.first_name)
  const [editLast,        setEditLast]        = useState(customer.last_name)
  const [editPhone,       setEditPhone]       = useState(customer.phone ?? '')
  const [editEmail,       setEditEmail]       = useState(customer.email ?? '')
  const [editStreet,      setEditStreet]      = useState(customer.street ?? '')
  const [editCity,        setEditCity]        = useState(customer.city ?? '')
  const [editState,       setEditState]       = useState(customer.state ?? '')
  const [editZip,         setEditZip]         = useState(customer.zip ?? '')
  const [editDob,         setEditDob]         = useState(customer.date_of_birth ?? '')
  const [editGender,      setEditGender]      = useState(customer.gender ?? '')
  const [editMarital,     setEditMarital]     = useState(customer.marital_status ?? '')
  const [editTobacco,     setEditTobacco]     = useState(customer.tobacco_use ?? 'none')
  const [editLanguage,    setEditLanguage]    = useState(customer.preferred_language ?? 'en')
  const [editHealthNotes, setEditHealthNotes] = useState(customer.health_notes ?? '')
  const [contactSaving,   setContactSaving]   = useState(false)
  const [contactMsg,      setContactMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  const segmentRef = useRef<HTMLDivElement>(null)
  const searchRef  = useRef<HTMLInputElement>(null)
  const dropRef   = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) setShowPolicyDrop(false)
      if (segmentRef.current && !segmentRef.current.contains(e.target as Node)) {
        setEditingSegment(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const searchPolicies = useCallback(async (q: string) => {
    if (q.length < 2) { setPolicyResults([]); return }
    setSearchingPolicies(true)
    try {
      const res  = await fetch(`/api/service-policies/search?q=${encodeURIComponent(q)}&unlinked_only=false`)
      const json = await res.json()
      // Filter out already-linked policies
      const linked = new Set(policies.map(p => p.id))
      setPolicyResults((json.data ?? []).filter((r: PolicySearchResult) => !linked.has(r.id)))
      setShowPolicyDrop(true)
    } catch {
      // silent
    } finally {
      setSearchingPolicies(false)
    }
  }, [policies])

  useEffect(() => {
    const t = setTimeout(() => searchPolicies(policySearch), 300)
    return () => clearTimeout(t)
  }, [policySearch, searchPolicies])

  async function handleLinkPolicy(p: PolicySearchResult) {
    setLinking(true)
    setLinkErr(null)
    setShowPolicyDrop(false)
    try {
      const res  = await fetch(`/api/service-policies/${p.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customer_id: customer.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Link failed')

      // Optimistically add to local list
      const newPolicy: LinkedPolicy = {
        id:                  p.id,
        policy_number:       p.policy_number,
        client_name:         p.client_name,
        carrier:             p.carrier,
        product_type:        p.product_type,
        face_amount:         p.face_amount,
        annual_premium:      null,
        coverage_status:     'active',
        sa_status:           'unknown',
        sa_form_sent_at:     null,
        primary_beneficiary: null,
        flag_count:          0,
        agencies:            null,
      }
      setPolicies(prev => [newPolicy, ...prev])
      setPolicySearch('')
      router.refresh()
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : 'Link failed')
    } finally {
      setLinking(false)
    }
  }

  async function toggleTouchLog(caseId: string) {
    if (expandedTouches.has(caseId)) {
      setExpandedTouches(prev => { const n = new Set(prev); n.delete(caseId); return n })
      return
    }
    setExpandedTouches(prev => new Set([...prev, caseId]))
    if (touchLogCache.has(caseId)) return
    setTouchLogLoading(prev => new Set([...prev, caseId]))
    try {
      const res  = await fetch(`/api/cases/${caseId}/touch`)
      const json = await res.json() as { data?: { touch_type: string; touched_at: string }[] }
      setTouchLogCache(prev => new Map([...prev, [caseId, json.data ?? []]]))
    } catch {
      setTouchLogCache(prev => new Map([...prev, [caseId, []]]))
    } finally {
      setTouchLogLoading(prev => { const n = new Set(prev); n.delete(caseId); return n })
    }
  }

  async function handleDeleteCase(caseId: string) {
    setDeletingCase(true); setCaseDeleteErr(null)
    try {
      const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json()
        setCaseDeleteErr(j.error ?? 'Delete failed')
        setConfirmDeleteCase(null)
        return
      }
      setCases(prev => prev.filter(c => c.id !== caseId))
      setConfirmDeleteCase(null)
      router.refresh()
    } finally {
      setDeletingCase(false)
    }
  }

  async function handleAddPolicy() {
    if (!newCarrier || !newPolicyNum.trim()) {
      setAddPolicyErr('Carrier and policy number are required')
      return
    }
    setAddPolicySaving(true); setAddPolicyErr(null)
    try {
      const res = await fetch('/api/service-policies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          customer_id:    customer.id,
          client_name:    `${displayFirst} ${displayLast}`,
          policy_number:  newPolicyNum.trim(),
          carrier:        newCarrier,
          product_type:   newProductType  || null,
          face_amount:    newFaceAmount   ? parseFloat(newFaceAmount)   : null,
          annual_premium: newPremium      ? parseFloat(newPremium)      : null,
          issue_date:     newIssueDate    || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setAddPolicyErr(json.error ?? 'Failed to add policy'); return }

      const p = json.data
      setPolicies(prev => [{
        id:                  p.id,
        policy_number:       p.policy_number,
        client_name:         p.client_name,
        carrier:             p.carrier,
        product_type:        p.product_type,
        face_amount:         p.face_amount,
        annual_premium:      p.annual_premium,
        coverage_status:     p.coverage_status,
        sa_status:           p.sa_status,
        sa_form_sent_at:     null,
        primary_beneficiary: p.primary_beneficiary ?? null,
        flag_count:          0,
        agencies:            null,
      }, ...prev])

      // Reset form
      setNewCarrier(''); setNewPolicyNum(''); setNewProductType('')
      setNewFaceAmount(''); setNewPremium(''); setNewIssueDate('')
      setAddingPolicy(false)
    } catch { setAddPolicyErr('Network error') }
    finally   { setAddPolicySaving(false) }
  }

  function startEditPolicy(p: LinkedPolicy) {
    setEditingPolicyId(p.id)
    setEditPolCarrier(p.carrier ?? '')
    setEditPolNumber(p.policy_number ?? '')
    setEditPolType(p.product_type ?? '')
    setEditPolFace(p.face_amount  != null ? String(p.face_amount)  : '')
    setEditPolPremium(p.annual_premium != null ? String(p.annual_premium) : '')
    setEditPolStatus(p.coverage_status ?? 'active')
    setEditPolBene(p.primary_beneficiary ?? '')
    setEditPolErr(null)
  }

  async function handleSaveEditPolicy(policyId: string) {
    if (!editPolCarrier.trim() || !editPolNumber.trim()) {
      setEditPolErr('Carrier and policy number are required')
      return
    }
    setEditPolSaving(true); setEditPolErr(null)
    try {
      const res = await fetch(`/api/service-policies/${policyId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          carrier:             editPolCarrier.trim(),
          policy_number:       editPolNumber.trim(),
          product_type:        editPolType    || null,
          face_amount:         editPolFace    ? parseFloat(editPolFace)    : null,
          annual_premium:      editPolPremium ? parseFloat(editPolPremium) : null,
          coverage_status:     editPolStatus  || 'active',
          primary_beneficiary: editPolBene.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setEditPolErr(json.error ?? 'Save failed'); return }
      setPolicies(prev => prev.map(p => p.id === policyId ? {
        ...p,
        carrier:             json.data.carrier,
        policy_number:       json.data.policy_number,
        product_type:        json.data.product_type,
        face_amount:         json.data.face_amount,
        annual_premium:      json.data.annual_premium,
        coverage_status:     json.data.coverage_status,
        primary_beneficiary: json.data.primary_beneficiary ?? null,
      } : p))
      setEditingPolicyId(null)
      router.refresh()
    } catch { setEditPolErr('Network error') }
    finally { setEditPolSaving(false) }
  }

  async function handleSegmentChange(newSegment: string | null) {
    setSegmentSaving(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ segment: newSegment }),
      })
      if (res.ok) { setSegment(newSegment); setEditingSegment(false) }
    } finally {
      setSegmentSaving(false)
    }
  }

  async function handlePostNote() {
    if (!noteBody.trim()) { setNoteErr('Note cannot be empty'); return }
    setNotePosting(true); setNoteErr(null)
    try {
      const res = await fetch(`/api/customers/${customer.id}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ section: noteSection, body: noteBody.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setNoteErr(json.error ?? 'Failed to post note'); return }
      setNotes(prev => [json.data as CustomerNote, ...prev])
      setNoteBody('')
    } catch { setNoteErr('Network error') }
    finally { setNotePosting(false) }
  }

  function handleCopyToEAgent() {
    const customerName = `${customer.first_name} ${customer.last_name}`
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    const sorted = [...notes].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const lines = sorted.map(n => {
      const dt = new Date(n.created_at)
      const dateStr = dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      return `[${dateStr} ${timeStr}] ${n.section.toUpperCase()} — ${n.author_name}\n${n.body}`
    })
    const text = `NOTES — ${customerName}\nGenerated: ${today}\n\n${lines.join('\n\n')}`
    navigator.clipboard.writeText(text).then(() => {
      setNoteCopied(true)
      setTimeout(() => setNoteCopied(false), 2000)
    })
  }

  async function handleSaveContact() {
    setContactSaving(true); setContactMsg(null)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          first_name:      editFirst.trim(),
          last_name:       editLast.trim(),
          phone:           editPhone.trim()  || null,
          email:           editEmail.trim()  || null,
          street:          editStreet.trim() || null,
          city:            editCity.trim()   || null,
          state:           editState.trim()  || null,
          zip:             editZip.trim()    || null,
          date_of_birth:   editDob           || null,
          gender:          editGender        || null,
          marital_status:  editMarital       || null,
          tobacco_use:       editTobacco || 'none',
          preferred_language: editLanguage || 'en',
          health_notes:      editHealthNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setContactMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setDisplayFirst(editFirst.trim() || customer.first_name)
        setDisplayLast(editLast.trim()   || customer.last_name)
        setContactMsg({ ok: true, text: 'Saved' })
        setEditingContact(false)
        router.refresh()
        setTimeout(() => setContactMsg(null), 2000)
      }
    } catch { setContactMsg({ ok: false, text: 'Network error' }) }
    finally   { setContactSaving(false) }
  }

  const inputCls = 'w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600'

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Back */}
        <Link
          href="/referrals"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        {/* Customer header — CRM contact card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5">
            <div className="flex items-start gap-4">

              {/* Avatar */}
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl shrink-0"
                style={{ backgroundColor: '#1F3864' }}
              >
                {displayFirst[0]}{displayLast[0]}
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-white text-xl font-semibold leading-tight">
                      {displayFirst} {displayLast}
                    </h1>

                    {/* Segment badge + editor */}
                    <div ref={segmentRef} className="relative mt-1.5">
                      <button
                        onClick={() => setEditingSegment(o => !o)}
                        disabled={segmentSaving}
                        className="inline-flex items-center gap-1.5 focus:outline-none disabled:opacity-50"
                      >
                        <SegmentBadge segment={segment} />
                        <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${editingSegment ? 'rotate-180' : ''}`} />
                      </button>
                      {editingSegment && (
                        <div className="absolute left-0 top-full mt-1.5 z-20 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-2 min-w-64">
                          <p className="text-xs text-slate-500 px-2 pb-2 font-medium uppercase tracking-wide">Assign tier</p>
                          <div className="space-y-1">
                            {SEGMENTS.map(s => (
                              <button
                                key={s.value}
                                onClick={() => handleSegmentChange(s.value)}
                                disabled={segmentSaving}
                                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                                  segment === s.value
                                    ? s.btn + ' bg-slate-700/60'
                                    : 'border-transparent hover:bg-slate-700/50 text-slate-300'
                                }`}
                              >
                                <span className="text-sm font-medium">{s.label}</span>
                                <span className="text-xs text-slate-500">{s.desc}</span>
                              </button>
                            ))}
                            {segment && (
                              <button
                                onClick={() => handleSegmentChange(null)}
                                disabled={segmentSaving}
                                className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-400 hover:bg-slate-700/30 transition-colors disabled:opacity-50"
                              >
                                Clear assignment
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Edit contact button */}
                  {!editingContact && (
                    <button
                      onClick={() => setEditingContact(true)}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5 transition-colors shrink-0"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>

                {/* Contact info — read mode */}
                {!editingContact && (
                  <div className="mt-4 space-y-2">
                    <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                      {customer.phone && (
                        <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors">
                          <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" /> {customer.phone}
                        </a>
                      )}
                      {customer.email && (
                        <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors">
                          <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" /> {customer.email}
                        </a>
                      )}
                    </div>
                    {(customer.street || customer.city || customer.state) && (
                      <div className="flex items-start gap-1.5 text-sm text-slate-400">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                        <span>
                          {customer.street && <>{customer.street}<br /></>}
                          {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
                      {customer.date_of_birth && (
                        <span>DOB: <span className="text-slate-300 font-mono">{maskDob(customer.date_of_birth)}</span></span>
                      )}
                      {customer.gender && (
                        <span>Gender: <span className="text-slate-300">{customer.gender}</span></span>
                      )}
                      {customer.marital_status && (
                        <span>Marital: <span className="text-slate-300 capitalize">{customer.marital_status}</span></span>
                      )}
                      {customer.tobacco_use && customer.tobacco_use !== 'none' && (
                        <span className="text-amber-400">Tobacco: {customer.tobacco_use}</span>
                      )}
                      {customer.preferred_language && customer.preferred_language !== 'en' && (
                        <span className="text-violet-400">
                          {({es:'Spanish',zh:'Chinese',ru:'Russian',vi:'Vietnamese',other:'Other lang'} as Record<string,string>)[customer.preferred_language] ?? customer.preferred_language}
                        </span>
                      )}
                      {customer.health_notes && (
                        <span>Health: <span className="text-slate-300">{customer.health_notes}</span></span>
                      )}
                    </div>
                  </div>
                )}

                {/* Contact edit form */}
                {editingContact && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">First name</label>
                        <input value={editFirst} onChange={e => setEditFirst(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Last name</label>
                        <input value={editLast} onChange={e => setEditLast(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Phone</label>
                        <input value={editPhone} onChange={e => setEditPhone(e.target.value)} type="tel" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Email</label>
                        <input value={editEmail} onChange={e => setEditEmail(e.target.value)} type="email" className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Street address</label>
                      <input value={editStreet} onChange={e => setEditStreet(e.target.value)} className={inputCls} />
                    </div>
                    <div className="grid grid-cols-6 gap-3">
                      <div className="col-span-3">
                        <label className="block text-xs text-slate-500 mb-1">City</label>
                        <input value={editCity} onChange={e => setEditCity(e.target.value)} className={inputCls} />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs text-slate-500 mb-1">State</label>
                        <input value={editState} onChange={e => setEditState(e.target.value)} maxLength={2} className={inputCls} />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-500 mb-1">ZIP</label>
                        <input value={editZip} onChange={e => setEditZip(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Date of birth</label>
                        <input value={editDob} onChange={e => setEditDob(e.target.value)} type="date" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Gender</label>
                        <select value={editGender} onChange={e => setEditGender(e.target.value)} className={inputCls}>
                          <option value="">—</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Non-binary">Non-binary</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Marital status</label>
                        <select value={editMarital} onChange={e => setEditMarital(e.target.value)} className={inputCls}>
                          <option value="">—</option>
                          <option value="single">Single</option>
                          <option value="married">Married</option>
                          <option value="divorced">Divorced</option>
                          <option value="widowed">Widowed</option>
                          <option value="separated">Separated</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Tobacco use</label>
                        <select value={editTobacco} onChange={e => setEditTobacco(e.target.value)} className={inputCls}>
                          <option value="none">None</option>
                          <option value="cigarettes">Cigarettes</option>
                          <option value="cigars">Cigars</option>
                          <option value="vaping">Vaping / E-Cig</option>
                          <option value="chewing">Chewing / Dip</option>
                          <option value="nicotine_replacement">Nicotine Replacement</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Health notes</label>
                        <input value={editHealthNotes} onChange={e => setEditHealthNotes(e.target.value)} className={inputCls} placeholder="Conditions, medications…" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Preferred language</label>
                      <select value={editLanguage} onChange={e => setEditLanguage(e.target.value)} className={inputCls}>
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
                      <button
                        onClick={handleSaveContact}
                        disabled={contactSaving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        {contactSaving ? '…' : <><Check className="w-3.5 h-3.5" /> Save</>}
                      </button>
                      <button
                        onClick={() => { setEditingContact(false); setContactMsg(null) }}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="border-t border-slate-800 px-5 py-3 flex items-center gap-5 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-white font-semibold">{cases.length}</span>
              <span className="text-slate-500 text-xs">{cases.length === 1 ? 'Case' : 'Cases'}</span>
            </div>
            <div className="w-px h-3 bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-white font-semibold">{policies.length}</span>
              <span className="text-slate-500 text-xs">Policies</span>
            </div>
            <div className="w-px h-3 bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-white font-semibold">{serviceRequests.length}</span>
              <span className="text-slate-500 text-xs">{serviceRequests.length === 1 ? 'Service Request' : 'Service Requests'}</span>
            </div>
            {policies.filter(p => p.sa_status === 'confirmed').length > 0 && (
              <>
                <div className="w-px h-3 bg-slate-800" />
                <span className="text-xs text-slate-500">
                  <span className="text-emerald-400 font-medium">{policies.filter(p => p.sa_status === 'confirmed').length}</span> SA confirmed
                </span>
              </>
            )}
          </div>
        </div>

        {/* Policies */}
        <Section
          title="Policies"
          icon={Shield}
          count={policies.length}
          action={
            <div className="flex items-center gap-3">
              {policies.filter(p => p.sa_status === 'confirmed').length > 0 && (
                <span className="text-xs text-slate-500">
                  {policies.filter(p => p.sa_status === 'confirmed').length} confirmed SA
                </span>
              )}
              <button
                onClick={() => { setAddingPolicy(o => !o); setAddPolicyErr(null) }}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md px-2 py-1 transition-colors"
              >
                {addingPolicy ? <X className="w-3 h-3" /> : '+'} {addingPolicy ? 'Cancel' : 'Add policy'}
              </button>
            </div>
          }
        >
          {/* Add policy form */}
          {addingPolicy && (
            <div className="px-5 py-4 border-b border-slate-800/60 space-y-3 bg-slate-800/20">
              <p className="text-xs font-medium text-slate-400">New policy</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Carrier <span className="text-red-500">*</span></label>
                  <select value={newCarrier} onChange={e => setNewCarrier(e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Policy number <span className="text-red-500">*</span></label>
                  <input value={newPolicyNum} onChange={e => setNewPolicyNum(e.target.value)} placeholder="e.g. LF-123456" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Product type</label>
                  <select value={newProductType} onChange={e => setNewProductType(e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Face amount</label>
                  <input value={newFaceAmount} onChange={e => setNewFaceAmount(e.target.value)} type="number" min="0" step="1000" placeholder="e.g. 500000" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Annual premium</label>
                  <input value={newPremium} onChange={e => setNewPremium(e.target.value)} type="number" min="0" step="1" placeholder="e.g. 1200" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Issue date</label>
                  <input value={newIssueDate} onChange={e => setNewIssueDate(e.target.value)} type="date" className={inputCls} />
                </div>
              </div>
              {addPolicyErr && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {addPolicyErr}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAddPolicy}
                  disabled={addPolicySaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {addPolicySaving ? '…' : <><Check className="w-3.5 h-3.5" /> Add policy</>}
                </button>
                <button onClick={() => { setAddingPolicy(false); setAddPolicyErr(null) }} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Link policy search */}
          <div className="px-5 py-3 border-b border-slate-800/60">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              <input
                ref={searchRef}
                value={policySearch}
                onChange={e => { setPolicySearch(e.target.value); setShowPolicyDrop(true) }}
                onFocus={() => policyResults.length && setShowPolicyDrop(true)}
                placeholder="Link a policy — search by policy # or client name…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
              {searchingPolicies && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs animate-pulse">…</span>
              )}
              {/* Dropdown */}
              {showPolicyDrop && policyResults.length > 0 && (
                <div
                  ref={dropRef}
                  className="absolute z-20 top-full mt-1 left-0 right-0 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden"
                >
                  {policyResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleLinkPolicy(p)}
                      disabled={linking}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0 disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-sm text-slate-200 font-medium">{p.client_name}</span>
                          <span className="text-xs text-slate-500 ml-2 font-mono">{p.policy_number}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.product_type && (
                            <span className="text-xs text-slate-400">{p.product_type}</span>
                          )}
                          {p.face_amount && (
                            <span className="text-xs text-slate-400">{fmt(p.face_amount)}</span>
                          )}
                          {p.customer_id && (
                            <span className="text-xs text-amber-400 flex items-center gap-0.5">
                              <Link2 className="w-3 h-3" /> linked
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-slate-500">{p.carrier}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {linkErr && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {linkErr}
                <button onClick={() => setLinkErr(null)} className="ml-1"><X className="w-3 h-3" /></button>
              </p>
            )}
          </div>

          {/* Placed cases with no policy record yet */}
          {pendingCasePolicies.length > 0 && (
            <div className="border-b border-slate-800/60">
              <div className="px-5 py-2 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="text-xs text-amber-400 font-medium">Policy number needed</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-800/40">
                  {pendingCasePolicies.map(c => {
                    const carrier = c.products?.carriers?.short_name ?? '—'
                    const ptype   = abbrevProduct(c.products?.name)
                    return (
                      <tr key={c.id} className="bg-amber-950/10 hover:bg-amber-950/20 transition-colors">
                        <td className="px-5 py-3">
                          <p className="text-slate-300 text-sm font-medium">{carrier}</p>
                          <p className="text-slate-500 text-xs">
                            {c.agencies?.display_name ?? c.agencies?.name ?? '—'}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 text-xs">—</td>
                        <td className="px-4 py-3">
                          {ptype
                            ? <TypeBadge type={ptype} />
                            : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-200 text-sm font-medium">
                          {fmt(c.face_amount)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded-full">
                            Placed — no policy #
                          </span>
                        </td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3">
                          <Link
                            href={`/cases/${c.id}`}
                            className="flex items-center justify-end text-amber-600 hover:text-amber-400 transition-colors"
                            title="Open case to add policy number"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Policy list */}
          {policies.length === 0 && pendingCasePolicies.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-500 text-sm">
              No policies linked — use the search above
            </div>
          ) : policies.length === 0 ? null : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800/60">
                  <th className="text-left px-5 py-2.5 font-medium">Client</th>
                  <th className="text-left px-4 py-2.5 font-medium">Policy #</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-right px-4 py-2.5 font-medium">Face Amt</th>
                  <th className="text-left px-4 py-2.5 font-medium">SA</th>
                  <th className="text-left px-4 py-2.5 font-medium">Flags</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {policies.map(p => (
                  <Fragment key={p.id}>
                    <tr className={`transition-colors ${editingPolicyId === p.id ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'}`}>
                      <td className="px-5 py-3">
                        <p className="text-white font-medium text-sm truncate max-w-36">{p.client_name}</p>
                        <p className="text-slate-500 text-xs">{p.carrier}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 text-xs">{p.policy_number}</td>
                      <td className="px-4 py-3"><TypeBadge type={p.product_type} /></td>
                      <td className="px-4 py-3 text-right text-slate-200 text-sm font-medium">{fmt(p.face_amount)}</td>
                      <td className="px-4 py-3">
                        <SaBadge saStatus={p.sa_status} formSentAt={p.sa_form_sent_at} />
                      </td>
                      <td className="px-4 py-3">
                        {p.flag_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                            <AlertTriangle className="w-3 h-3" /> {p.flag_count}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => editingPolicyId === p.id ? setEditingPolicyId(null) : startEditPolicy(p)}
                            className={`p-0.5 transition-colors ${editingPolicyId === p.id ? 'text-blue-400' : 'text-slate-600 hover:text-slate-300'}`}
                            title="Edit policy"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <Link
                            href={`/policies/${p.id}`}
                            className="flex items-center text-slate-600 hover:text-slate-300 transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {editingPolicyId === p.id && (
                      <tr>
                        <td colSpan={7} className="px-5 py-4 border-t border-slate-700/50 bg-slate-800/30">
                          <p className="text-xs font-medium text-slate-400 mb-3">Edit policy</p>
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Carrier <span className="text-red-500">*</span></label>
                                <select value={editPolCarrier} onChange={e => setEditPolCarrier(e.target.value)} className={inputCls}>
                                  <option value="">Select…</option>
                                  {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Policy number <span className="text-red-500">*</span></label>
                                <input value={editPolNumber} onChange={e => setEditPolNumber(e.target.value)} className={inputCls} />
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-3">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Product type</label>
                                <select value={editPolType} onChange={e => setEditPolType(e.target.value)} className={inputCls}>
                                  <option value="">—</option>
                                  {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Face amount</label>
                                <input value={editPolFace} onChange={e => setEditPolFace(e.target.value)} type="number" min="0" step="1000" className={inputCls} />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Annual premium</label>
                                <input value={editPolPremium} onChange={e => setEditPolPremium(e.target.value)} type="number" min="0" step="1" className={inputCls} />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Coverage status</label>
                                <select value={editPolStatus} onChange={e => setEditPolStatus(e.target.value)} className={inputCls}>
                                  <option value="active">Active</option>
                                  <option value="lapsed">Lapsed</option>
                                  <option value="surrendered">Surrendered</option>
                                  <option value="terminated">Terminated</option>
                                  <option value="matured">Matured</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">Primary beneficiary</label>
                              <input value={editPolBene} onChange={e => setEditPolBene(e.target.value)} className={inputCls} placeholder="Full name" />
                            </div>
                            {editPolErr && (
                              <p className="text-xs text-red-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> {editPolErr}
                              </p>
                            )}
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => handleSaveEditPolicy(p.id)}
                                disabled={editPolSaving}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50 transition-colors"
                              >
                                {editPolSaving ? '…' : <><Check className="w-3.5 h-3.5" /> Save</>}
                              </button>
                              <button
                                onClick={() => { setEditingPolicyId(null); setEditPolErr(null) }}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Cases */}
        <Section title="Cases" icon={FolderKanban} count={cases.length}>
          {caseDeleteErr && (
            <div className="px-5 py-2 border-b border-slate-800/60">
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {caseDeleteErr}
                <button onClick={() => setCaseDeleteErr(null)} className="ml-1"><X className="w-3 h-3" /></button>
              </p>
            </div>
          )}
          {cases.length === 0 ? (
            <div className="px-5 py-6 text-center text-slate-500 text-sm">No cases</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800/60">
                  <th className="text-left px-5 py-2.5 font-medium">Agency · Carrier</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Policy #</th>
                  <th className="text-right px-4 py-2.5 font-medium">Face Amt</th>
                  <th className="text-left px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {cases.map(c => {
                  const carrier      = c.products?.carriers?.short_name ?? c.products?.name ?? null
                  const dateLabel    = c.placed_at
                    ? `Placed ${fmtDate(c.placed_at)}`
                    : `Created ${fmtDate(c.created_at)}`
                  const touchExpanded = expandedTouches.has(c.id)
                  const touchLoading  = touchLogLoading.has(c.id)
                  const touchLog      = touchLogCache.get(c.id) ?? []
                  const touchCount    = c.touches ?? 0
                  return (
                  <Fragment key={c.id}>
                  <tr className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-slate-300 text-sm">{c.agencies?.display_name ?? c.agencies?.name ?? '—'}</p>
                      {carrier && <p className="text-slate-500 text-xs mt-0.5">{carrier}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <CaseStatusBadge st={c.stage_translations} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">
                      {c.policy_number ?? <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 text-sm">{fmt(c.face_amount)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      <p>{dateLabel}</p>
                      {c.last_contact_at && (
                        <p className="text-slate-600 mt-0.5">
                          Contact {fmtDate(c.last_contact_at)}
                          {touchCount > 0 && <span className="ml-1">· {touchCount}×</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {confirmDeleteCase === c.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-400">Delete?</span>
                          <button
                            onClick={() => handleDeleteCase(c.id)}
                            disabled={deletingCase}
                            className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                          >
                            {deletingCase ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteCase(null)}
                            className="text-xs text-slate-500 hover:text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-0.5">
                          {touchCount > 0 && (
                            <button
                              onClick={() => toggleTouchLog(c.id)}
                              className="p-0.5 text-slate-600 hover:text-slate-300 transition-colors"
                              title="Touch log"
                            >
                              {touchExpanded
                                ? <ChevronUp className="w-3.5 h-3.5" />
                                : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <Link
                            href={`/referrals/${c.id}`}
                            className="p-0.5 text-slate-600 hover:text-slate-300 transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                          {cases.length >= 2 && (
                            <button
                              onClick={() => setConfirmDeleteCase(c.id)}
                              className="p-0.5 text-slate-700 hover:text-red-400 transition-colors"
                              title="Delete duplicate case"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {touchExpanded && (
                    <tr className="bg-slate-800/30">
                      <td colSpan={6} className="px-5 py-3">
                        {touchLoading ? (
                          <p className="text-xs text-slate-500">Loading…</p>
                        ) : touchLog.length === 0 ? (
                          <p className="text-xs text-slate-600 italic">No touches logged.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {touchLog.map((t, i) => (
                              <div key={i} className="flex items-center gap-4 text-xs">
                                <span className="font-medium text-slate-400 w-24 shrink-0">
                                  {TOUCH_TYPE_LABELS[t.touch_type] ?? t.touch_type}
                                </span>
                                <span className="text-slate-500">
                                  {new Date(t.touched_at).toLocaleString('en-US', {
                                    month: 'short', day: 'numeric',
                                    hour: 'numeric', minute: '2-digit',
                                  })}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </Section>

        {/* Case History */}
        {(caseHistory.length > 0 || cases.length > 0) && (
          <Section
            title="Case History"
            icon={History}
            count={caseHistory.length}
          >
            {caseHistory.length === 0 ? (
              <div className="px-5 py-6 text-center text-slate-500 text-sm">
                No status transitions recorded yet
              </div>
            ) : (
              <div className="px-5 py-4">
                <div className="relative">
                  <div className="absolute left-2 top-2.5 bottom-2.5 w-px bg-slate-800" />
                  <div className="space-y-4">
                    {caseHistory.map(entry => {
                      const linkedCase = cases.find(c => c.id === entry.case_id)
                      const agencyName = linkedCase?.agencies?.display_name ?? linkedCase?.agencies?.name
                      return (
                        <div key={entry.id} className="relative flex gap-3.5">
                          <div className={`relative z-10 mt-1 w-4 h-4 rounded-full border-2 shrink-0 ${statusDotColor(entry.to_status)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-slate-500">{fmtDate(entry.changed_at)}</span>
                              {agencyName && (
                                <Link
                                  href={`/referrals/${entry.case_id}`}
                                  className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
                                >
                                  {agencyName}
                                </Link>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {entry.from_status && (
                                <>
                                  <span className="text-xs text-slate-500">{fmtStatus(entry.from_status)}</span>
                                  <span className="text-slate-600 text-xs">→</span>
                                </>
                              )}
                              <span className="text-sm font-medium text-slate-200">{fmtStatus(entry.to_status)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Service requests */}
        {serviceRequests.length > 0 && (
          <Section title="Service Requests" icon={Wrench} count={serviceRequests.length}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800/60">
                  <th className="text-left px-5 py-2.5 font-medium">SR #</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Policy</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {serviceRequests.map(sr => (
                  <tr key={sr.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 font-mono text-slate-300 text-xs">
                      {sr.sr_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-sm capitalize">
                      {sr.request_type.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                      {sr.policy_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <SrStatusBadge status={sr.workflow_status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(sr.date_received)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/service/${sr.id}`}
                        className="flex items-center justify-end text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* No linked data fallback */}
        {policies.length === 0 && cases.length === 0 && serviceRequests.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-10 text-center">
            <User className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No linked data yet — use the search above to link policies</p>
          </div>
        )}

        {/* Notes */}
        <Section
          title="Notes"
          icon={MessageSquare}
          count={notes.length}
          action={
            notes.length > 0 ? (
              <button
                onClick={handleCopyToEAgent}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              >
                <Clipboard className="w-3.5 h-3.5" />
                {noteCopied ? 'Copied!' : 'Copy to eAgent'}
              </button>
            ) : undefined
          }
        >
          {/* Compose */}
          <div className="px-5 py-4 border-b border-slate-800/60 space-y-3">
            <div className="flex gap-2">
              {(['triage', 'producer', 'underwriting'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setNoteSection(s)}
                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors capitalize ${
                    noteSection === s
                      ? s === 'triage'       ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                      : s === 'producer'     ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      :                        'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea
              value={noteBody}
              onChange={e => setNoteBody(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePostNote() }}
              rows={3}
              placeholder="Add a note… (Cmd+Enter to post)"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600 resize-none"
            />
            {noteErr && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {noteErr}
              </p>
            )}
            <button
              onClick={handlePostNote}
              disabled={notePosting || !noteBody.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-40 transition-colors"
            >
              {notePosting ? '…' : <><Send className="w-3.5 h-3.5" /> Post note</>}
            </button>
          </div>

          {/* Feed */}
          {notes.length === 0 ? (
            <div className="px-5 py-6 text-center text-slate-600 text-sm">No notes yet</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {notes.map(n => {
                const dt = new Date(n.created_at)
                const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                const sectionStyle =
                  n.section === 'triage'       ? { border: 'border-l-blue-500',    badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30' }
                  : n.section === 'producer'   ? { border: 'border-l-emerald-500', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' }
                  :                              { border: 'border-l-amber-500',   badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30' }
                return (
                  <div key={n.id} className={`px-5 py-4 border-l-4 ${sectionStyle.border}`}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border capitalize ${sectionStyle.badge}`}>
                        {n.section}
                      </span>
                      <span className="text-xs font-medium text-slate-300">{n.author_name}</span>
                      <span suppressHydrationWarning className="text-xs text-slate-600">{dateStr} · {timeStr}</span>
                      {n.case_id && (
                        <a href={`/cases/${n.case_id}`} className="inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700 transition-colors">
                          via Case
                        </a>
                      )}
                      {n.service_request_id && (
                        <a href={`/service/${n.service_request_id}`} className="inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700 transition-colors">
                          via Service Request
                        </a>
                      )}
                      {n.policy_review_id && (
                        <a href={`/reviews/${n.policy_review_id}`} className="inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700 transition-colors">
                          via Review
                        </a>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{n.body}</p>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}
