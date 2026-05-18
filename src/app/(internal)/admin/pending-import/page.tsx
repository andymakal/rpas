'use client'

import { useRef, useState } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type RowResult = {
  row:     number
  client:  string
  outcome: 'updated' | 'no_case' | 'no_customer' | 'skipped'
  detail:  string
}

type ImportResult = {
  total:        number
  updated:      number
  created:      number
  skipped:      number
  skipped_rows: RowResult[]
}

export default function PendingImportPage() {
  const inputRef              = useRef<HTMLInputElement>(null)
  const [file, setFile]       = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<ImportResult | null>(null)
  const [error, setError]     = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null)
    setResult(null)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)

    const fd = new FormData()
    fd.append('file', file)

    const res  = await fetch('/api/admin/pending-import', { method: 'POST', body: fd })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Import failed')
    } else {
      setResult(json)
    }
    setLoading(false)
  }

  const skippedRows = result?.skipped_rows ?? []

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-white text-2xl font-semibold">Pending Life Import</h1>
          <p className="text-slate-400 text-sm mt-1">
            Upload the Pending Life spreadsheet to bulk-update case statuses, pending
            requirements, face amounts, and premiums for existing cases.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-1">
          <p className="text-slate-400 font-semibold uppercase tracking-wide mb-2">Status mapping</p>
          {[
            ['Quote',       'quoted'],
            ['Application', 'app_submitted'],
            ['Incomplete',  'app_submitted  + pending requirements'],
            ['Pending',     'in_underwriting'],
            ['Approved',    'approved'],
            ['Issued',      'issued'],
            ['Placed',      'placed'],
          ].map(([from, to]) => (
            <div key={from} className="flex items-center gap-2">
              <span className="font-mono text-slate-300 w-24 shrink-0">{from}</span>
              <span className="text-slate-500">→</span>
              <span className="text-slate-400 font-mono">{to}</span>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-slate-500 transition-colors cursor-pointer"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="text-white text-sm font-medium">{file.name}</p>
                <p className="text-slate-500 text-xs mt-1">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
              </div>
            ) : (
              <div>
                <p className="text-slate-300 text-sm font-medium">Click to select file</p>
                <p className="text-slate-500 text-xs mt-1">.xlsx files only</p>
              </div>
            )}
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
          </div>

          <Button
            type="submit"
            disabled={!file || loading}
            className="w-full text-white font-medium"
            style={{ backgroundColor: '#1F3864' }}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing…</>
              : 'Run Import'}
          </Button>
        </form>

        {error && (
          <div className="flex items-start gap-3 bg-red-950 border border-red-800 text-red-300 text-sm p-4 rounded-xl">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <p className="text-white font-semibold">Import Complete</p>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-white">{result.total}</p>
                <p className="text-xs text-slate-400 mt-1">Rows</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{result.updated}</p>
                <p className="text-xs text-slate-400 mt-1">Updated</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-400">{result.created}</p>
                <p className="text-xs text-slate-400 mt-1">Created</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-400">{result.skipped}</p>
                <p className="text-xs text-slate-400 mt-1">Skipped</p>
              </div>
            </div>

            {skippedRows.length > 0 && (
              <div className="bg-amber-950 border border-amber-800 rounded-lg p-4">
                <p className="text-amber-300 text-sm font-semibold mb-2">
                  Skipped rows ({skippedRows.length}) — fix manually
                </p>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {skippedRows.map(r => (
                    <div key={r.row} className="flex items-start gap-3 text-xs">
                      <span className="text-amber-600 font-mono shrink-0">Row {r.row}</span>
                      <span className="text-amber-200 font-medium shrink-0">{r.client}</span>
                      <span className="text-amber-500">{r.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
