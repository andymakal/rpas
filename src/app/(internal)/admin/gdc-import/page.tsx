'use client'

import { useRef, useState } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ImportResult = {
  batch_id: string
  sheet_used: string
  row_count: number
  matched_count: number
  unmatched_count: number
  unrecognized_partners: string[]
}

const CURRENT_YEAR = new Date().getFullYear()

export default function GdcImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile]         = useState<File | null>(null)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<ImportResult | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing]         = useState(false)
  const [clearResult, setClearResult]   = useState<{ deleted: number; year: number } | null>(null)
  const [clearError, setClearError]     = useState<string | null>(null)

  async function handleClear() {
    setClearing(true)
    setClearError(null)
    setClearResult(null)
    const res  = await fetch(`/api/admin/gdc-import?year=${CURRENT_YEAR}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) {
      setClearError((json as { error?: string }).error ?? 'Clear failed')
    } else {
      setClearResult(json as { deleted: number; year: number })
      setClearConfirm(false)
    }
    setClearing(false)
  }

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

    const res = await fetch('/api/admin/gdc-import', { method: 'POST', body: fd })
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
          <h1 className="text-white text-2xl font-semibold">GDC Import</h1>
          <p className="text-slate-400 text-sm mt-1">
            Upload the Allstate compensation report XLSX. The &ldquo;AF NB Policy Details&rdquo; sheet
            will be parsed and matched to agencies by partner number.
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
                <p className="text-slate-500 text-xs mt-1">.xlsx files only</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
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
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Clear year data */}
        <div className="border-t border-slate-800 pt-6 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Danger Zone</p>
          <p className="text-slate-500 text-xs">
            Deletes all GDC records with a process date in {CURRENT_YEAR}. Use this before a full
            re-import to reset everyone&rsquo;s gauge to a clean baseline.
          </p>

          {!clearConfirm ? (
            <button
              onClick={() => { setClearConfirm(true); setClearResult(null); setClearError(null) }}
              className="flex items-center gap-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear all {CURRENT_YEAR} GDC data…
            </button>
          ) : (
            <div className="bg-red-950 border border-red-800 rounded-xl p-4 space-y-3">
              <p className="text-red-300 text-sm font-semibold">
                This will permanently delete all {CURRENT_YEAR} GDC records for every agency.
                Re-import the comp report immediately after.
              </p>
              {clearError && (
                <p className="text-red-400 text-xs">{clearError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleClear}
                  disabled={clearing}
                  className="flex items-center gap-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 transition-colors"
                >
                  {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {clearing ? 'Clearing…' : `Yes, delete all ${CURRENT_YEAR} data`}
                </button>
                <button
                  onClick={() => setClearConfirm(false)}
                  disabled={clearing}
                  className="rounded-lg border border-slate-700 text-slate-400 text-sm px-4 py-2 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {clearResult && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle className="w-4 h-4" />
              Deleted {clearResult.deleted} records for {clearResult.year}. Ready to re-import.
            </div>
          )}
        </div>

        {result && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <p className="text-white font-semibold">Import Complete</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-white">{result.row_count}</p>
                <p className="text-xs text-slate-400 mt-1">Rows parsed</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{result.matched_count}</p>
                <p className="text-xs text-slate-400 mt-1">Matched</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${result.unmatched_count > 0 ? 'bg-yellow-950' : 'bg-slate-800'}`}>
                <p className={`text-2xl font-bold ${result.unmatched_count > 0 ? 'text-yellow-400' : 'text-white'}`}>
                  {result.unmatched_count}
                </p>
                <p className="text-xs text-slate-400 mt-1">Unmatched</p>
              </div>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <p>Sheet: <span className="text-slate-300">{result.sheet_used}</span></p>
              <p>Batch ID: <span className="text-slate-300 font-mono">{result.batch_id}</span></p>
            </div>

            {result.unrecognized_partners.length > 0 && (
              <div className="bg-yellow-950 border border-yellow-800 rounded-lg p-4">
                <p className="text-yellow-300 text-sm font-semibold mb-2">
                  Unrecognized partner numbers ({result.unrecognized_partners.length})
                </p>
                <p className="text-yellow-400/70 text-xs mb-2">
                  These rows were saved but not linked to an agency. Update the partner number in the agencies table to match.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.unrecognized_partners.map(p => (
                    <span key={p} className="font-mono text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">
                      {p}
                    </span>
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
