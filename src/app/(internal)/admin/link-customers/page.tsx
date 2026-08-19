'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Search, Link2, Plus, CheckCircle, ChevronRight, Loader2, X } from 'lucide-react'

const supabase = createClient()

type UnlinkedPolicy = {
  id:            string
  policy_number: string
  client_name:   string
  carrier:       string
  coverage_status: string
}

type CustomerMatch = {
  id:            string
  first_name:    string
  last_name:     string
  phone:         string | null
  date_of_birth: string | null
}

function parseName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function maskDob(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return `DOB ${String(d.getUTCMonth() + 1).padStart(2, '0')}/xx/${d.getUTCFullYear()}`
}

export default function LinkCustomersPage() {
  const [policies,   setPolicies]   = useState<UnlinkedPolicy[]>([])
  const [loading,    setLoading]    = useState(true)
  const [activeId,   setActiveId]   = useState<string | null>(null)
  const [query,      setQuery]      = useState('')
  const [matches,    setMatches]    = useState<CustomerMatch[]>([])
  const [searching,  setSearching]  = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [linked,     setLinked]     = useState<Set<string>>(new Set())
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('service_policies')
        .select('id, policy_number, client_name, carrier, coverage_status')
        .is('customer_id', null)
        .eq('is_test', false)
        .order('client_name')
      setPolicies((data ?? []) as UnlinkedPolicy[])
      setLoading(false)
    }
    load()
  }, [])

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setMatches([]); return }
    setSearching(true)
    try {
      const res  = await fetch(`/api/customers/search?dedup=true&q=${encodeURIComponent(q.trim())}`)
      const json = await res.json()
      setMatches((json.data ?? []) as CustomerMatch[])
    } catch { setMatches([]) }
    finally   { setSearching(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 350)
    return () => clearTimeout(t)
  }, [query, search])

  function openPanel(policy: UnlinkedPolicy) {
    setActiveId(policy.id)
    setError(null)
    setMatches([])
    setQuery(policy.client_name)
    setTimeout(() => search(policy.client_name), 0)
  }

  async function linkTo(policyId: string, customerId: string) {
    setSaving(true); setError(null)
    const { error: err } = await supabase
      .from('service_policies')
      .update({ customer_id: customerId })
      .eq('id', policyId)
    if (err) { setError(err.message); setSaving(false); return }
    setLinked(prev => new Set([...prev, policyId]))
    setActiveId(null)
    setSaving(false)
  }

  async function createAndLink(policyId: string, clientName: string) {
    setSaving(true); setError(null)
    const { first, last } = parseName(clientName)
    const { data: cx, error: cxErr } = await supabase
      .from('customers')
      .insert({ first_name: first, last_name: last })
      .select('id')
      .single()
    if (cxErr || !cx) { setError(cxErr?.message ?? 'Failed to create customer'); setSaving(false); return }
    await linkTo(policyId, cx.id)
  }

  const visible = policies.filter(p => !linked.has(p.id))
  const activePolicy = policies.find(p => p.id === activeId) ?? null

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        <div>
          <h1 className="text-white text-2xl font-semibold">Link Customers to Policies</h1>
          <p className="text-slate-400 text-sm mt-1">
            {loading ? 'Loading…' : `${visible.length} policies with no customer card linked`}
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading unlinked policies…
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-6 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-emerald-300 text-sm font-medium">All policies have a linked customer card.</p>
          </div>
        )}

        <div className="space-y-2">
          {visible.map(policy => (
            <div key={policy.id}>
              <button
                onClick={() => activeId === policy.id ? setActiveId(null) : openPanel(policy)}
                className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-xl border text-left transition-colors ${
                  activeId === policy.id
                    ? 'bg-blue-950/30 border-blue-700/50'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <User className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-200">{policy.client_name}</span>
                  <span className="ml-3 text-xs text-slate-500 font-mono">{policy.policy_number}</span>
                  <span className="ml-2 text-xs text-slate-600">· {policy.carrier}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  policy.coverage_status === 'Active'
                    ? 'bg-emerald-900/40 text-emerald-400'
                    : 'bg-slate-800 text-slate-500'
                }`}>
                  {policy.coverage_status}
                </span>
                <ChevronRight className={`w-4 h-4 text-slate-600 transition-transform ${activeId === policy.id ? 'rotate-90' : ''}`} />
              </button>

              {activeId === policy.id && (
                <div className="mx-1 bg-slate-900/60 border border-slate-800 border-t-0 rounded-b-xl px-5 py-4 space-y-4">

                  {/* Search */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">Search for existing customer</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Name…"
                        className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 animate-spin" />}
                    </div>
                  </div>

                  {/* Results */}
                  {matches.length > 0 && (
                    <div className="space-y-1">
                      {matches.map(m => (
                        <div key={m.id} className="flex items-center justify-between gap-3 bg-slate-800/60 rounded-lg px-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium text-slate-200">{m.first_name} {m.last_name}</p>
                            {(m.phone || m.date_of_birth) && (
                              <p className="text-xs text-slate-500 mt-0.5">
                                {m.phone}{m.phone && m.date_of_birth ? ' · ' : ''}{maskDob(m.date_of_birth)}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => linkTo(policy.id, m.id)}
                            disabled={saving}
                            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 transition-colors"
                          >
                            <Link2 className="w-3 h-3" /> Link
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {matches.length === 0 && !searching && query.trim().length >= 2 && (
                    <p className="text-xs text-slate-500">No existing customers found for "{query}"</p>
                  )}

                  {error && <p className="text-xs text-red-400">{error}</p>}

                  {/* Create new */}
                  <div className="pt-1 border-t border-slate-800 flex items-center justify-between">
                    <p className="text-xs text-slate-600">No match? Create a new customer card.</p>
                    <button
                      onClick={() => createAndLink(policy.id, policy.client_name)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Create &amp; Link "{policy.client_name}"
                    </button>
                  </div>

                  <button onClick={() => setActiveId(null)} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 transition-colors">
                    <X className="w-3 h-3" /> Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
