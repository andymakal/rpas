'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Search, X, ArrowLeft, Loader2, Check, AlertCircle, MailPlus } from 'lucide-react'
import {
  servicingAgentEmailMessage,
  servicingAgentEmailSubject,
  MAX_CONTRACTS,
} from '@/lib/servicing-agent-form-shared'

export type SacCustomer = {
  id:         string
  first_name: string | null
  last_name:  string | null
  email:      string | null
  phone:      string | null
  city:       string | null
  state:      string | null
}

export type SacContract = {
  id:              string
  policy_number:   string
  carrier:         string | null
  product_type:    string | null
  coverage_status: string | null
  insured_name:    string | null
}

type CustomerHit = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  city?: string | null
  state?: string | null
}

function fullName(c: { first_name: string | null; last_name: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
}

export function ServicingAgentChangeClient({
  initialCustomer,
  initialContracts,
}: {
  initialCustomer: SacCustomer | null
  initialContracts: SacContract[]
}) {
  // ── Customer selection ─────────────────────────────────────────────────
  const [customer, setCustomer]     = useState<SacCustomer | null>(initialCustomer)
  const [contracts, setContracts]   = useState<SacContract[]>(initialContracts)
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<CustomerHit[]>([])
  const [searching, setSearching]   = useState(false)
  const [loadingContracts, setLoadingContracts] = useState(false)

  // ── Selection + editable values ────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialContracts.map(c => c.id)),
  )
  const [ownerName, setOwnerName]   = useState(initialCustomer ? fullName(initialCustomer) : '')
  // Extra / corrected contract numbers the operator types in by hand.
  const [extraContracts, setExtraContracts] = useState('')

  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const searchCustomers = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setResults(json.data ?? [])
    } finally {
      setSearching(false)
    }
  }, [])

  const loadContracts = useCallback(async (customerId: string) => {
    setLoadingContracts(true)
    try {
      const res = await fetch(`/api/servicing-agent-change/contracts?customer_id=${customerId}`)
      const json = await res.json()
      const list: SacContract[] = json.data ?? []
      setContracts(list)
      setSelectedIds(new Set(list.map(c => c.id)))
    } finally {
      setLoadingContracts(false)
    }
  }, [])

  const pickCustomer = (c: CustomerHit) => {
    const picked: SacCustomer = {
      id: c.id, first_name: c.first_name, last_name: c.last_name,
      email: null, phone: c.phone, city: c.city ?? null, state: c.state ?? null,
    }
    setCustomer(picked)
    setOwnerName(fullName(picked))
    setQuery('')
    setResults([])
    setError(null)
    loadContracts(c.id)
  }

  const clearCustomer = () => {
    setCustomer(null)
    setContracts([])
    setSelectedIds(new Set())
    setOwnerName('')
    setExtraContracts('')
    setError(null)
  }

  const toggleContract = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Final ordered list of contract numbers: selected policies (in list order)
  // followed by any hand-typed extras. Deduped, capped at the form's capacity.
  const selectedNumbers = contracts
    .filter(c => selectedIds.has(c.id))
    .map(c => c.policy_number.trim())
    .filter(Boolean)
  const extraNumbers = extraContracts
    .split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  const allNumbers = Array.from(new Set([...selectedNumbers, ...extraNumbers]))
  const overCapacity = allNumbers.length > MAX_CONTRACTS
  const usableNumbers = allNumbers.slice(0, MAX_CONTRACTS)

  const canGenerate = Boolean(customer) && ownerName.trim().length > 0 && usableNumbers.length > 0

  async function generate() {
    if (!canGenerate || !customer) return
    setError(null)
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      params.set('customer_id', customer.id)
      params.set('owner_name', ownerName.trim())
      params.set('contracts', usableNumbers.join(','))

      const res = await fetch(`/api/servicing-agent-change?${params.toString()}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Could not generate the PDF.')
      }
      // 1. Download the completed PDF; it stays in Downloads to attach manually.
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safe = ownerName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
      a.download = `servicing-agent-change-${safe || 'form'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      // 2. Open a prepared email in the default mail client (Outlook) with the
      //    subject and body prefilled. The owner attaches the downloaded PDF.
      const to = customer.email ?? ''
      const mailto =
        `mailto:${encodeURIComponent(to)}` +
        `?subject=${encodeURIComponent(servicingAgentEmailSubject())}` +
        `&body=${encodeURIComponent(servicingAgentEmailMessage(ownerName || 'there'))}`
      window.location.href = mailto
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the PDF.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/customers" className="text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-white text-2xl font-semibold">Servicing Agent Change</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Everlake (Allstate) ALL2018-4 — select a customer and contracts, then generate the form
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Step 1: Customer */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Customer</label>
          {customer ? (
            <div className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <div>
                <p className="text-white font-medium">{fullName(customer) || 'Unnamed customer'}</p>
                {(customer.city || customer.state) && (
                  <p className="text-slate-400 text-sm">
                    {[customer.city, customer.state].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
              <button onClick={clearCustomer} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                {searching
                  ? <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                  : <Search className="w-4 h-4 text-slate-500" />}
              </div>
              <input
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); searchCustomers(e.target.value) }}
                placeholder="Search by name or phone..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
              />
              {results.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                  {results.map(c => (
                    <button
                      key={c.id}
                      onClick={() => pickCustomer(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-700 transition-colors"
                    >
                      <p className="text-white text-sm">{fullName(c) || 'Unnamed customer'}</p>
                      {(c.city || c.state) && (
                        <p className="text-slate-400 text-xs">{[c.city, c.state].filter(Boolean).join(', ')}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Contracts */}
        {customer && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Contracts <span className="text-slate-500 text-xs font-normal">(select the ones to list on the form)</span>
            </label>
            {loadingContracts ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading contracts...
              </div>
            ) : contracts.length === 0 ? (
              <p className="text-slate-500 text-sm px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                No contracts on file for this customer. Add contract numbers below.
              </p>
            ) : (
              <div className="space-y-1.5">
                {contracts.map(c => {
                  const checked = selectedIds.has(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleContract(c.id)}
                      className={`w-full flex items-center gap-3 text-left px-4 py-2.5 rounded-lg border transition-colors ${
                        checked
                          ? 'bg-blue-500/10 border-blue-500/60'
                          : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <span className={`flex items-center justify-center w-4 h-4 rounded border ${
                        checked ? 'bg-blue-500 border-blue-500' : 'border-slate-500'
                      }`}>
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="flex-1">
                        <span className="text-white text-sm font-medium">{c.policy_number}</span>
                        <span className="text-slate-400 text-xs ml-2">
                          {[c.carrier, c.product_type, c.coverage_status].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Corrections / additional contract numbers */}
            <div className="mt-3">
              <label className="block text-xs text-slate-400 mb-1">
                Additional or corrected contract numbers (comma or line separated)
              </label>
              <textarea
                value={extraContracts}
                onChange={e => setExtraContracts(e.target.value)}
                rows={2}
                placeholder="e.g. LB1234567, AN9988776"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}

        {/* Step 3: Requester name (editable for corrections) */}
        {customer && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Printed name of requester (contract owner)
            </label>
            <input
              type="text"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              placeholder="Contract owner full name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-slate-500 text-xs mt-1">
              Agent info and the Contract Owner box are already filled on the form. Signature and date are left blank for the owner to sign.
            </p>
          </div>
        )}

        {/* Capacity + selection summary */}
        {customer && (
          <div className="text-xs text-slate-400">
            {usableNumbers.length} contract{usableNumbers.length === 1 ? '' : 's'} will be placed on the form.
            {overCapacity && (
              <span className="text-amber-400 ml-1">
                The form holds {MAX_CONTRACTS}; the first {MAX_CONTRACTS} will be used.
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/60 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action */}
        {customer && (
          <div className="pt-2">
            <button
              onClick={generate}
              disabled={!canGenerate || generating}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailPlus className="w-4 h-4" />}
              Generate PDF &amp; Email
            </button>
            <p className="text-slate-500 text-xs mt-2">
              Downloads the completed PDF and opens a prepared email. Attach the downloaded PDF from your Downloads folder before sending.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
