'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, Search, X, FileText, ArrowLeft, Loader2 } from 'lucide-react'

type CustomerHit = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  city: string | null
  state: string | null
  customer_group_id: string | null
}

export function NewFinancialReviewClient() {
  const router = useRouter()

  const [customerQuery, setCustomerQuery]     = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerHit[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(null)
  const [searching, setSearching]             = useState(false)

  const [pdfFile, setPdfFile]   = useState<File | null>(null)
  const [factFile, setFactFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState<'pdf' | 'fact' | null>(null)

  const [parsing,  setParsing]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const pdfInput  = useRef<HTMLInputElement>(null)
  const factInput = useRef<HTMLInputElement>(null)

  const searchCustomers = useCallback(async (q: string) => {
    if (q.length < 2) { setCustomerResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setCustomerResults(json.data ?? [])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleCustomerInput = (val: string) => {
    setCustomerQuery(val)
    searchCustomers(val)
  }

  const pickCustomer = (c: CustomerHit) => {
    setSelectedCustomer(c)
    setCustomerQuery('')
    setCustomerResults([])
  }

  const handleDrop = (zone: 'pdf' | 'fact') => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') {
      zone === 'pdf' ? setPdfFile(file) : setFactFile(file)
    }
  }

  async function handleSubmit() {
    if (!pdfFile) { setError('Please upload a carrier statement PDF.'); return }
    setError(null)
    setParsing(true)

    // Step 1: parse the statement PDF
    const formData = new FormData()
    formData.append('pdf', pdfFile)

    let parsedData: unknown = { contracts: [] }
    try {
      const res = await fetch('/api/financial-review/parse', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Parse failed')
      parsedData = json.data
    } catch (err) {
      setParsing(false)
      setError(err instanceof Error ? err.message : 'Failed to parse PDF')
      return
    }

    // Step 2: also parse the fact sheet if provided
    let factData: unknown = null
    if (factFile) {
      const ffForm = new FormData()
      ffForm.append('pdf', factFile)
      try {
        const res = await fetch('/api/financial-review/parse', { method: 'POST', body: ffForm })
        const json = await res.json()
        if (res.ok) factData = json.data
      } catch {
        // fact sheet parse failure is non-fatal
      }
    }

    setParsing(false)
    setSaving(true)

    // Merge fact sheet data into contracts if available
    const parsed = parsedData as { contracts?: unknown[]; document_summary?: string; account_holder?: string }
    const contracts = parsed.contracts ?? []

    // If fact sheet parsed, attach its data as supplemental info on the first contract
    if (factData && contracts.length > 0) {
      const fc = factData as { contracts?: unknown[] }
      if (fc.contracts?.length) {
        const factContracts = fc.contracts as Record<string, unknown>[]
        const mainContracts = contracts as Record<string, unknown>[]
        // Merge first fact contract into first main contract (supplement missing fields)
        const fact = factContracts[0]
        const main = mainContracts[0]
        for (const key of Object.keys(fact)) {
          if (main[key] == null && fact[key] != null) main[key] = fact[key]
        }
      }
    }

    // Step 3: save the review record
    try {
      const res = await fetch('/api/financial-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer?.id ?? null,
          contracts,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      router.push(`/financial-review/${json.data.id}`)
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : 'Failed to save review')
    }
  }

  const loading = parsing || saving

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/financial-review" className="text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-white text-2xl font-semibold">New Financial Review</h1>
          <p className="text-slate-400 text-sm mt-0.5">Upload a carrier statement to extract contract data</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Customer picker */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Client (optional)</label>
          {selectedCustomer ? (
            <div className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <div>
                <p className="text-white font-medium">{selectedCustomer.first_name} {selectedCustomer.last_name}</p>
                {(selectedCustomer.city || selectedCustomer.state) && (
                  <p className="text-slate-400 text-sm">
                    {[selectedCustomer.city, selectedCustomer.state].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                {searching ? (
                  <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 text-slate-500" />
                )}
              </div>
              <input
                type="text"
                value={customerQuery}
                onChange={e => handleCustomerInput(e.target.value)}
                placeholder="Search by name..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
              />
              {customerResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                  {customerResults.map(c => (
                    <button
                      key={c.id}
                      onClick={() => pickCustomer(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-700 transition-colors"
                    >
                      <p className="text-white text-sm">{c.first_name} {c.last_name}</p>
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

        {/* Carrier statement upload */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Carrier Statement <span className="text-red-400">*</span>
          </label>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver('pdf') }}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop('pdf')}
            onClick={() => pdfInput.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver === 'pdf'
                ? 'border-blue-500 bg-blue-500/10'
                : pdfFile
                ? 'border-green-700 bg-green-900/10'
                : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
            }`}
          >
            <input
              ref={pdfInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => e.target.files?.[0] && setPdfFile(e.target.files[0])}
            />
            {pdfFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-5 h-5 text-green-400" />
                <span className="text-green-300 text-sm font-medium">{pdfFile.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); setPdfFile(null) }}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div>
                <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">Drop a PDF or click to browse</p>
                <p className="text-slate-600 text-xs mt-1">Annual carrier statement</p>
              </div>
            )}
          </div>
        </div>

        {/* Fact sheet upload (optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Fact Sheet <span className="text-slate-500 text-xs font-normal">(optional)</span>
          </label>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver('fact') }}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop('fact')}
            onClick={() => factInput.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragOver === 'fact'
                ? 'border-blue-500 bg-blue-500/10'
                : factFile
                ? 'border-green-700 bg-green-900/10'
                : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
            }`}
          >
            <input
              ref={factInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => e.target.files?.[0] && setFactFile(e.target.files[0])}
            />
            {factFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-5 h-5 text-green-400" />
                <span className="text-green-300 text-sm font-medium">{factFile.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); setFactFile(null) }}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div>
                <Upload className="w-6 h-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-slate-500 text-sm">Carrier fact sheet or product summary</p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={loading || !pdfFile}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {parsing ? 'Analyzing PDF...' : saving ? 'Saving...' : 'Analyze & Create Review'}
          </button>
          <Link
            href="/financial-review"
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
