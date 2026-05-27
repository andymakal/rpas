'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Phone, Mail, MapPin, User,
  Shield, CheckCircle, ShieldOff, FileQuestion, Send,
  AlertTriangle, ChevronRight, Search, X,
  FolderKanban, Wrench, Link2,
} from 'lucide-react'
import type {
  CustomerDetail, LinkedCase, LinkedPolicy, LinkedServiceRequest,
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
  cases,
  policies: initialPolicies,
  serviceRequests,
}: {
  customer:        CustomerDetail
  cases:           LinkedCase[]
  policies:        LinkedPolicy[]
  serviceRequests: LinkedServiceRequest[]
}) {
  const router = useRouter()
  const [policies,    setPolicies]    = useState<LinkedPolicy[]>(initialPolicies)
  const [policySearch, setPolicySearch] = useState('')
  const [policyResults, setPolicyResults] = useState<PolicySearchResult[]>([])
  const [searchingPolicies, setSearchingPolicies] = useState(false)
  const [showPolicyDrop, setShowPolicyDrop] = useState(false)
  const [linking, setLinking]   = useState(false)
  const [linkErr, setLinkErr]   = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const dropRef   = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) setShowPolicyDrop(false)
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
        id:              p.id,
        policy_number:   p.policy_number,
        client_name:     p.client_name,
        carrier:         p.carrier,
        product_type:    p.product_type,
        face_amount:     p.face_amount,
        annual_premium:  null,
        coverage_status: 'active',
        sa_status:       'unknown',
        sa_form_sent_at: null,
        flag_count:      0,
        agencies:        null,
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

  const fullName = `${customer.first_name} ${customer.last_name}`

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

        {/* Customer header */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-lg shrink-0"
                style={{ backgroundColor: '#1F3864' }}
              >
                {customer.first_name[0]}{customer.last_name[0]}
              </div>
              <div>
                <h1 className="text-white text-xl font-semibold">{fullName}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-1.5">
                  {customer.phone && (
                    <a href={`tel:${customer.phone}`} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
                      <Phone className="w-3.5 h-3.5" /> {customer.phone}
                    </a>
                  )}
                  {customer.email && (
                    <a href={`mailto:${customer.email}`} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
                      <Mail className="w-3.5 h-3.5" /> {customer.email}
                    </a>
                  )}
                  {(customer.city || customer.state) && (
                    <span className="flex items-center gap-1 text-sm text-slate-500">
                      <MapPin className="w-3.5 h-3.5" />
                      {[customer.city, customer.state].filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick stats */}
            <div className="flex gap-3 text-center">
              <div className="bg-slate-800 rounded-lg px-4 py-2">
                <p className="text-white font-semibold text-lg leading-none">{cases.length}</p>
                <p className="text-slate-500 text-xs mt-0.5">Cases</p>
              </div>
              <div className="bg-slate-800 rounded-lg px-4 py-2">
                <p className="text-white font-semibold text-lg leading-none">{policies.length}</p>
                <p className="text-slate-500 text-xs mt-0.5">Policies</p>
              </div>
              <div className="bg-slate-800 rounded-lg px-4 py-2">
                <p className="text-white font-semibold text-lg leading-none">{serviceRequests.length}</p>
                <p className="text-slate-500 text-xs mt-0.5">Service Reqs</p>
              </div>
            </div>
          </div>

          {/* Customer detail row */}
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-800 text-xs text-slate-500">
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
            {customer.spanish_speaking && (
              <span className="text-sky-400">Spanish speaking</span>
            )}
            {customer.health_notes && (
              <span>Health: <span className="text-slate-300">{customer.health_notes}</span></span>
            )}
          </div>
        </div>

        {/* Policies */}
        <Section
          title="Policies"
          icon={Shield}
          count={policies.length}
          action={
            <span className="text-xs text-slate-500">
              {policies.filter(p => p.sa_status === 'confirmed').length} confirmed SA
            </span>
          }
        >
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

          {/* Policy list */}
          {policies.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-500 text-sm">
              No policies linked — use the search above
            </div>
          ) : (
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
                  <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
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
                      <Link
                        href={`/policies/${p.id}`}
                        className="flex items-center justify-end text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Cases */}
        <Section title="Cases" icon={FolderKanban} count={cases.length}>
          {cases.length === 0 ? (
            <div className="px-5 py-6 text-center text-slate-500 text-sm">No cases</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800/60">
                  <th className="text-left px-5 py-2.5 font-medium">Agency</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Face Amt</th>
                  <th className="text-left px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {cases.map(c => (
                  <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 text-slate-300 text-sm">
                      {c.agencies?.display_name ?? c.agencies?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <CaseStatusBadge st={c.stage_translations} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 text-sm">{fmt(c.face_amount)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/referrals/${c.id}`}
                        className="flex items-center justify-end text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

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

      </div>
    </div>
  )
}
