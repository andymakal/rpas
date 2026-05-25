'use client'

import { useRef, useState } from 'react'
import {
  FileSpreadsheet,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  X,
  Table,
  SkipForward,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── API response types ────────────────────────────────────────────────────────

type SheetStat = {
  name:       string
  rows:       number
  parsed:     number
  annuities:  number
  no_id:      number
}

type PreviewResponse = {
  preview:           true
  file_name:         string
  master_sheet:      string | null
  sheets_processed:  number
  sheet_stats:       SheetStat[]
  total_parsed:      number
  skipped_annuities: number
  skipped_no_id:     number
  already_on_file:   number
  to_insert:         number
}

type ImportResponse = {
  preview:           false
  file_name:         string
  total_parsed:      number
  inserted:          number
  already_on_file:   number
  skipped_annuities: number
  skipped_no_id:     number
  errors?:           string[]
}

type Phase = 'upload' | 'preview' | 'importing' | 'done'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US').format(n)
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  color = 'slate',
}: {
  label: string
  value: number
  color?: 'slate' | 'green' | 'amber' | 'sky' | 'red'
}) {
  const colors = {
    slate: 'bg-slate-800 text-white',
    green: 'bg-green-900/60 text-green-300',
    amber: 'bg-amber-900/60 text-amber-300',
    sky:   'bg-sky-900/60   text-sky-300',
    red:   'bg-red-900/60   text-red-300',
  }
  return (
    <div className={`rounded-xl p-4 text-center ${colors[color]}`}>
      <p className="text-2xl font-bold">{fmt(value)}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PolicyImportPage() {
  const inputRef   = useRef<HTMLInputElement>(null)

  const [file,      setFile]      = useState<File | null>(null)
  const [phase,     setPhase]     = useState<Phase>('upload')
  const [preview,   setPreview]   = useState<PreviewResponse | null>(null)
  const [result,    setResult]    = useState<ImportResponse  | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [dragging,  setDragging]  = useState(false)

  // ── File selection ──────────────────────────────────────────────────────────

  function pickFile(f: File | null) {
    if (!f) return
    setFile(f)
    setPreview(null)
    setResult(null)
    setError(null)
    setPhase('upload')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0] ?? null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0] ?? null
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) pickFile(f)
    else setError('Only .xlsx or .xls files are accepted')
  }

  // ── Phase 1: Preview ───────────────────────────────────────────────────────

  async function handlePreview() {
    if (!file) return
    setError(null)

    const fd = new FormData()
    fd.append('file', file)

    const res  = await fetch('/api/admin/policy-import?preview=true', { method: 'POST', body: fd })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Could not parse file')
      return
    }

    setPreview(json as PreviewResponse)
    setPhase('preview')
  }

  // ── Phase 2: Import ────────────────────────────────────────────────────────

  async function handleImport() {
    if (!file || !preview) return
    setPhase('importing')
    setError(null)

    const fd = new FormData()
    fd.append('file', file)

    const res  = await fetch('/api/admin/policy-import', { method: 'POST', body: fd })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Import failed')
      setPhase('preview')
      return
    }

    setResult(json as ImportResponse)
    setPhase('done')
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    setPhase('upload')
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <FileSpreadsheet className="w-6 h-6 text-slate-400" />
            <h1 className="text-white text-2xl font-semibold">Policy Import</h1>
          </div>
          <p className="text-slate-400 text-sm">
            Upload the 2024 Consolidated Books Excel. FA/MVA annuities are automatically
            skipped. Policies already on file are detected and excluded from the insert.
          </p>
        </div>

        {/* ── UPLOAD phase ─────────────────────────────────────────────────── */}
        {(phase === 'upload') && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragging
                  ? 'border-blue-500 bg-blue-950/20'
                  : 'border-slate-700 hover:border-slate-500'
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true)  }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="w-9 h-9 text-slate-500 mx-auto mb-3" />
              {file ? (
                <div>
                  <p className="text-white text-sm font-medium">{file.name}</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {(file.size / 1024).toFixed(0)} KB · Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-300 text-sm font-medium">
                    Drop file here or click to browse
                  </p>
                  <p className="text-slate-500 text-xs mt-1">.xlsx or .xls files only</p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <Button
              disabled={!file}
              onClick={handlePreview}
              className="w-full text-white font-medium"
              style={{ backgroundColor: '#1F3864' }}
            >
              <ChevronRight className="w-4 h-4 mr-2" />
              Parse File
            </Button>
          </div>
        )}

        {/* ── PREVIEW phase ────────────────────────────────────────────────── */}
        {phase === 'preview' && preview && (
          <div className="space-y-5">
            {/* File badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-300 text-sm">
                <FileSpreadsheet className="w-4 h-4 text-slate-500" />
                <span className="font-medium">{preview.file_name}</span>
                {preview.master_sheet && (
                  <span className="text-xs bg-sky-900/60 text-sky-300 px-2 py-0.5 rounded-full">
                    Master sheet: {preview.master_sheet}
                  </span>
                )}
              </div>
              <button
                onClick={reset}
                className="text-slate-500 hover:text-slate-300 transition-colors"
                title="Choose a different file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Summary chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatChip label="Policies parsed"    value={preview.total_parsed}      color="slate" />
              <StatChip label="Will import"        value={preview.to_insert}         color="green" />
              <StatChip label="Already on file"    value={preview.already_on_file}   color="sky"   />
              <StatChip label="Annuities skipped"  value={preview.skipped_annuities} color="amber" />
            </div>
            {preview.skipped_no_id > 0 && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <SkipForward className="w-3.5 h-3.5" />
                {fmt(preview.skipped_no_id)} row{preview.skipped_no_id !== 1 ? 's' : ''} skipped — no policy ID
              </p>
            )}

            {/* Sheet breakdown */}
            {preview.sheet_stats.length > 1 && (
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
                  <Table className="w-4 h-4 text-slate-500" />
                  <p className="text-slate-300 text-sm font-medium">
                    Sheets processed ({preview.sheets_processed})
                  </p>
                </div>
                <div className="divide-y divide-slate-800">
                  {preview.sheet_stats.map(s => (
                    <div key={s.name} className="grid grid-cols-5 px-4 py-2.5 text-sm items-center">
                      <span className="col-span-2 text-slate-300 truncate font-medium">{s.name}</span>
                      <span className="text-slate-400 text-right">{fmt(s.rows)} rows</span>
                      <span className="text-green-400 text-right">{fmt(s.parsed)} parsed</span>
                      <span className="text-amber-400 text-right">
                        {s.annuities > 0 ? `${fmt(s.annuities)} ann.` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Zero-import guard */}
            {preview.to_insert === 0 && (
              <div className="flex items-start gap-3 bg-sky-950 border border-sky-800 text-sky-300 text-sm p-4 rounded-xl">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                All {fmt(preview.total_parsed)} policies from this file are already on file — nothing to import.
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={reset}
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                disabled={preview.to_insert === 0}
                onClick={handleImport}
                className="flex-1 text-white font-medium"
                style={{ backgroundColor: preview.to_insert > 0 ? '#1F3864' : undefined }}
              >
                Confirm — Import {fmt(preview.to_insert)} {preview.to_insert === 1 ? 'Policy' : 'Policies'}
              </Button>
            </div>
          </div>
        )}

        {/* ── IMPORTING phase ───────────────────────────────────────────────── */}
        {phase === 'importing' && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
            <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" />
            <p className="text-white text-sm font-medium">Importing policies…</p>
            <p className="text-slate-500 text-xs mt-1">This may take a moment for large files.</p>
          </div>
        )}

        {/* ── DONE phase ────────────────────────────────────────────────────── */}
        {phase === 'done' && result && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <p className="text-white font-semibold text-lg">Import Complete</p>
            </div>

            {/* Result chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatChip label="Inserted"        value={result.inserted}          color="green" />
              <StatChip label="Already on file" value={result.already_on_file}   color="sky"   />
              <StatChip label="Annuities"       value={result.skipped_annuities} color="amber" />
              <StatChip label="No ID skipped"   value={result.skipped_no_id}     color="slate" />
            </div>

            {/* Chunk errors (rare) */}
            {result.errors && result.errors.length > 0 && (
              <div className="bg-red-950 border border-red-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <p className="text-red-300 text-sm font-semibold">
                    {result.errors.length} chunk error{result.errors.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ul className="space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-red-400/80 text-xs font-mono">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs text-slate-500">
              File: <span className="text-slate-300">{result.file_name}</span>
            </div>

            <Button
              onClick={reset}
              variant="outline"
              className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Import Another File
            </Button>
          </div>
        )}

        {/* ── Error banner (shown in any phase) ───────────────────────────── */}
        {error && (
          <div className="flex items-start gap-3 bg-red-950 border border-red-800 text-red-300 text-sm p-4 rounded-xl">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

      </div>
    </div>
  )
}
