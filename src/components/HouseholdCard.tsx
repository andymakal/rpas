'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Search, Link2, Unlink, ExternalLink, X, Loader2, UserPlus } from 'lucide-react'

export type HouseholdMember = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  customer_group_id: string | null
  latest_case: {
    id: string
    internal_status: string
    agency_label: string | null
    is_won: boolean
    is_lost: boolean
    is_referral: boolean  // tier === 1
  } | null
}

type SearchResult = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  customer_group_id: string | null
  cases: {
    id: string
    internal_status: string
    stage_translations: { agency_label: string; is_won: boolean; is_lost: boolean } | null
  }[]
}

type Props = {
  currentCustomerId: string
  currentCaseId: string
  householdId: string | null
  members: HouseholdMember[]          // other household members (not current person)
  currentPersonName: string
  agencyId: string | null
}

function statusBadgeClass(m: { is_won: boolean; is_lost: boolean }): string {
  if (m.is_won)  return 'bg-emerald-900/60 text-emerald-300 border-emerald-700'
  if (m.is_lost) return 'bg-slate-800/70 text-slate-400 border-slate-700'
  return 'bg-blue-900/50 text-blue-300 border-blue-800'
}

export function HouseholdCard({
  currentCustomerId,
  householdId: initialHouseholdId,
  members: initialMembers,
  currentPersonName,
  agencyId,
}: Props) {
  const router = useRouter()

  const [householdId,  setHouseholdId]  = useState(initialHouseholdId)
  const [members,      setMembers]      = useState<HouseholdMember[]>(initialMembers)
  const [searching,    setSearching]    = useState(false)
  const [searchQ,      setSearchQ]      = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [linking,      setLinking]      = useState<string | null>(null)   // customer id being linked
  const [unlinking,    setUnlinking]    = useState<string | null>(null)   // customer id being unlinked
  const [error,        setError]        = useState<string | null>(null)
  const [creating,     setCreating]     = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [newFirst,     setNewFirst]     = useState('')
  const [newLast,      setNewLast]      = useState('')
  const [newPhone,     setNewPhone]     = useState('')

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    setSearchLoading(true)
    try {
      const params = new URLSearchParams({ q, exclude: currentCustomerId })
      if (agencyId) params.set('agency_id', agencyId)
      const res = await fetch(`/api/customers/search?${params}`)
      const { data } = await res.json()
      setSearchResults(data ?? [])
    } finally {
      setSearchLoading(false)
    }
  }, [currentCustomerId, agencyId])

  async function handleLink(targetCustomerId: string) {
    setLinking(targetCustomerId); setError(null)
    try {
      const res = await fetch('/api/customer-groups/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id_a: currentCustomerId,
          customer_id_b: targetCustomerId,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to link')
        return
      }
      const { data } = await res.json()
      setHouseholdId(data.customer_group_id)

      // Immediately add the linked person to the members list so it shows
      // without waiting for a full page reload. router.refresh() will sync
      // any stale data in the background.
      const found = searchResults.find(r => r.id === targetCustomerId)
      if (found) {
        const lc = found.cases?.[0] ?? null
        setMembers(prev => [...prev, {
          id:               found.id,
          first_name:       found.first_name,
          last_name:        found.last_name,
          phone:            found.phone,
          customer_group_id: data.customer_group_id,
          latest_case: lc ? {
            id:               lc.id,
            internal_status:  lc.internal_status,
            agency_label:     lc.stage_translations?.agency_label ?? null,
            is_won:           lc.stage_translations?.is_won  ?? false,
            is_lost:          lc.stage_translations?.is_lost ?? false,
            is_referral:      false,
          } : null,
        }])
      }

      setSearching(false)
      setSearchQ('')
      setSearchResults([])
      router.refresh()
    } finally {
      setLinking(null)
    }
  }

  async function handleCreate() {
    if (!newFirst.trim() || !newLast.trim()) return
    setCreateLoading(true); setError(null)
    try {
      const res = await fetch('/api/customer-groups/create-and-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name:           newFirst.trim(),
          last_name:            newLast.trim(),
          phone:                newPhone.trim() || undefined,
          agency_id:            agencyId,
          existing_customer_id: currentCustomerId,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create'); return }

      const { new_customer_id, case_id, customer_group_id } = json.data
      setHouseholdId(customer_group_id)
      setMembers(prev => [...prev, {
        id:                new_customer_id,
        first_name:        newFirst.trim(),
        last_name:         newLast.trim(),
        phone:             newPhone.trim() || null,
        customer_group_id: customer_group_id,
        latest_case: {
          id:              case_id,
          internal_status: 'triage',
          agency_label:    'Triage',
          is_won:          false,
          is_lost:         false,
          is_referral:     false,
        },
      }])
      setCreating(false)
      setNewFirst(''); setNewLast(''); setNewPhone('')
      router.refresh()
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleUnlink(targetCustomerId: string, memberHouseholdId: string) {
    setUnlinking(targetCustomerId); setError(null)
    try {
      const res = await fetch(
        `/api/customer-groups/${memberHouseholdId}/members/${targetCustomerId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to unlink')
        return
      }
      setMembers(prev => prev.filter(m => m.id !== targetCustomerId))
      // If we removed the last member, dissolve the household on this side too
      if (members.length <= 1) setHouseholdId(null)
      router.refresh()
    } finally {
      setUnlinking(null)
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Household
        </h2>
        {!searching && !creating && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setCreating(true); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <UserPlus className="w-3 h-3" /> New member
            </button>
            <button
              onClick={() => { setSearching(true); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Link2 className="w-3 h-3" /> Link member
            </button>
          </div>
        )}
      </div>

      {/* Current person */}
      <div className="flex items-center gap-2 py-1 border-b border-slate-800 pb-3">
        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
          <span className="text-xs text-slate-300 font-medium">
            {currentPersonName.charAt(0).toUpperCase()}
          </span>
        </div>
        <span className="text-sm text-slate-200 font-medium">{currentPersonName}</span>
        <span className="text-xs text-slate-600 ml-auto">this record</span>
      </div>

      {/* Other household members */}
      {members.length > 0 ? (
        <div className="space-y-2">
          {members.map(m => {
            const lc = m.latest_case
            const caseUrl = lc
              ? (lc.is_referral ? `/referrals/${lc.id}` : `/cases/${lc.id}`)
              : null
            return (
              <div key={m.id} className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs text-slate-300 font-medium">
                    {m.first_name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 font-medium truncate">
                    {m.first_name} {m.last_name}
                  </p>
                  {m.phone && (
                    <p className="text-xs text-slate-500 truncate">{m.phone}</p>
                  )}
                </div>
                {lc && (
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border flex-shrink-0 ${statusBadgeClass(lc)}`}>
                    {lc.agency_label ?? lc.internal_status.replace(/_/g, ' ')}
                  </span>
                )}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {caseUrl && (
                    <a
                      href={caseUrl}
                      className="p-1 text-slate-600 hover:text-slate-300 transition-colors"
                      title="Open record"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => handleUnlink(m.id, householdId!)}
                    disabled={unlinking === m.id}
                    className="p-1 text-slate-700 hover:text-red-400 transition-colors disabled:opacity-40"
                    title="Remove from household"
                  >
                    {unlinking === m.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Unlink className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        !searching && (
          <p className="text-xs text-slate-600 italic">
            No other household members linked.
          </p>
        )
      )}

      {/* Search panel */}
      {searching && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={searchQ}
                onChange={e => {
                  setSearchQ(e.target.value)
                  doSearch(e.target.value)
                }}
                placeholder="Search by last name…"
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
              />
            </div>
            <button
              onClick={() => { setSearching(false); setSearchQ(''); setSearchResults([]) }}
              className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {searchLoading && (
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching…
            </p>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {searchResults.map(r => {
                const latestCase = r.cases?.[0]
                return (
                  <button
                    key={r.id}
                    onClick={() => handleLink(r.id)}
                    disabled={!!linking}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/30 px-3 py-2.5 text-left hover:bg-slate-800/70 transition-colors disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-medium">
                        {r.first_name} {r.last_name}
                      </p>
                      {r.phone && <p className="text-xs text-slate-500">{r.phone}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {latestCase?.stage_translations && (
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${statusBadgeClass(latestCase.stage_translations)}`}>
                          {latestCase.stage_translations.agency_label}
                        </span>
                      )}
                      {linking === r.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        : <Link2 className="w-3.5 h-3.5 text-slate-500" />
                      }
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {!searchLoading && searchQ.length >= 2 && searchResults.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">No customers found matching &quot;{searchQ}&quot;</p>
              <button
                onClick={() => {
                  setSearching(false); setSearchQ(''); setSearchResults([])
                  setNewLast(searchQ.trim()); setCreating(true); setError(null)
                }}
                className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <UserPlus className="w-3 h-3" /> Create a new customer record instead
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create new member panel */}
      {creating && (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-slate-500">Creates a new customer record and links them to this household. A triage case will open for them automatically.</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">First name *</label>
              <input
                autoFocus
                type="text"
                value={newFirst}
                onChange={e => setNewFirst(e.target.value)}
                placeholder="First"
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Last name *</label>
              <input
                type="text"
                value={newLast}
                onChange={e => setNewLast(e.target.value)}
                placeholder="Last"
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Phone</label>
            <input
              type="tel"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              placeholder="(555) 000-0000"
              className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={createLoading || !newFirst.trim() || !newLast.trim()}
              className="flex-1 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
            >
              {createLoading ? 'Creating…' : 'Create & link'}
            </button>
            <button
              onClick={() => { setCreating(false); setNewFirst(''); setNewLast(''); setNewPhone('') }}
              className="py-2 px-3 rounded-lg text-xs text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
