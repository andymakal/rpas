'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Search, Link2, Unlink, ExternalLink, X, Loader2 } from 'lucide-react'

export type HouseholdMember = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  household_id: string | null
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
  household_id: string | null
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
      const res = await fetch('/api/households/link', {
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
      setHouseholdId(data.household_id)
      setSearching(false)
      setSearchQ('')
      setSearchResults([])
      router.refresh()
    } finally {
      setLinking(null)
    }
  }

  async function handleUnlink(targetCustomerId: string, memberHouseholdId: string) {
    setUnlinking(targetCustomerId); setError(null)
    try {
      const res = await fetch(
        `/api/households/${memberHouseholdId}/members/${targetCustomerId}`,
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
        {!searching && (
          <button
            onClick={() => { setSearching(true); setError(null) }}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <Link2 className="w-3 h-3" /> Link member
          </button>
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
            <p className="text-xs text-slate-500">No customers found matching &quot;{searchQ}&quot;</p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
