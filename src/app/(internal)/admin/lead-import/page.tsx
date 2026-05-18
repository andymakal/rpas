'use client'

import { useRef, useState } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ImportResult = {
  batch_id:           string
  total_rows:         number
  customers_created:  number
  cases_created:      number
  skipped_manual:     number
  skipped_duplicate:  number
  unmatched_agencies: string[]
  errors:             string[]
}

export default function LeadImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile]       = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<ImportResult | null>(null)
  const [error, setError]     = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
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

    const res  = await fetch('/api/admin/lead-import', { method: 'POST', body: fd })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Import failed')
    } else {
      setResult(json)
    }
    setLoading(false)
  }

  return (
    <div className="p-8">
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-white text-2xl font-semibold">Lead Manager Import</h1>
          <p className="text-slate-400 text-sm mt-1">
            Upload the CSV exported from Lead Manager. Folder tags are used to set
            each case status. Rows tagged as service requests or policy reviews are
            flagged for manual entry.
          </p>
        </div>

        {/* Folder mapping reference */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-slate-400 shrink-0" />
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Folder → Status Mapping
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {[
              ['Working',              'Working on first contact'],
              ['Appt Set',            'Working on appointment'],
              ['Appt Missed',         'Back to agency to re-warm'],
              ['*LSP Contact Needed', 'Back to agency to re-warm'],
              ['Quoted',              'Working on application'],
              ['App Submitted',       'App in progress'],
              ['Placed',              'Policy placed'],
              ['Not Interested',      'Closed — client declined'],
            ].map(([folder, label]) => (
              <div key={folder} className="flex items-center gap-2">
                <span className="font-mono text-slate-300 shrink-0">{folder}</span>
                <span className="text-slate-500">→</span>
                <span className="text-slate-400">{label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 pt-1 border-t border-slate-800">
            Rows tagged <span className="text-slate-400">#Service Request</span> or{' '}
            <span className="text-slate-400">#Policy Review</span> are saved for manual entry and not converted to cases.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center
              hover:border-slate-500 transition-colors cursor-pointer"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="text-white text-sm font-medium">{file.name}</p>
                <p className="text-slate-500 text-xs mt-1">
                  {(file.size / 1024).toFixed(0)} KB · Click to change
                </p>
              </div>
            ) : (
              <div>
                <p className="text-slate-300 text-sm font-medium">Click to select file</p>
                <p className="text-slate-500 text-xs mt-1">.csv files only</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <Button
            type="submit"
            disabled={!file || loading}
            className="w-full text-white font-medium"
            style={{ backgroundColor: '#1F3864' }}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
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

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-white">{result.total_rows}</p>
                <p className="text-xs text-slate-400 mt-1">Rows</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{result.cases_created}</p>
                <p className="text-xs text-slate-400 mt-1">Cases created</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-400">{result.customers_created}</p>
                <p className="text-xs text-slate-400 mt-1">New customers</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {result.skipped_manual > 0 && (
                <div className="bg-amber-950 border border-amber-800 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-400">{result.skipped_manual}</p>
                  <p className="text-xs text-amber-500 mt-1">Manual entry needed</p>
                </div>
              )}
              {result.skipped_duplicate > 0 && (
                <div className="bg-slate-800 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-400">{result.skipped_duplicate}</p>
                  <p className="text-xs text-slate-500 mt-1">Already imported</p>
                </div>
              )}
            </div>

            <div className="text-xs text-slate-500">
              <p>Batch ID: <span className="text-slate-300 font-mono">{result.batch_id}</span></p>
            </div>

            {result.unmatched_agencies.length > 0 && (
              <div className="bg-yellow-950 border border-yellow-800 rounded-lg p-4">
                <p className="text-yellow-300 text-sm font-semibold mb-1">
                  Unmatched agencies ({result.unmatched_agencies.length})
                </p>
                <p className="text-yellow-400/70 text-xs mb-2">
                  These agency names did not match any record. Cases were still created with no agency link — assign them manually.
                </p>
                <div className="space-y-1">
                  {result.unmatched_agencies.map(name => (
                    <p key={name} className="text-xs text-yellow-200 font-mono">{name}</p>
                  ))}
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-red-950 border border-red-800 rounded-lg p-4">
                <p className="text-red-300 text-sm font-semibold mb-2">
                  Row errors ({result.errors.length})
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-300 font-mono">{e}</p>
                  ))}
                </div>
              </div>
            )}

            {result.skipped_manual > 0 && (
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-300 font-semibold mb-1">Next step</p>
                <p className="text-xs text-slate-400">
                  {result.skipped_manual} row{result.skipped_manual !== 1 ? 's were' : ' was'} saved
                  to the intake queue as service requests or policy reviews. Enter them manually
                  under the relevant client record once carrier and policy details are confirmed.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
