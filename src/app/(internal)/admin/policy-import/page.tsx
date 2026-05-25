'use client'

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  FileSpreadsheet, Upload, CheckCircle, AlertCircle,
  Loader2, ChevronRight, X, Table, SkipForward,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── Shared types ──────────────────────────────────────────────────────────────

type PolicyRow = {
  policy_number:        string
  client_name:          string
  carrier:              string
  product_type:         string | null
  issue_date:           string | null
  face_amount:          number | null
  death_benefit_amount: number | null
  cash_value_amount:    number | null
  annual_premium:       number | null
  rate_class:           string | null
  riders:               string | null
  insured_first_name:   string | null
  insured_last_name:    string | null
  owner_phone:          string | null
  owner_dob_approx:     string | null
  writing_agent_name:   string | null
  coverage_status:      string
  sa_status:            'unknown'
  is_test:              false
}

type SheetStat = {
  name: string; rows: number; parsed: number; annuities: number; no_id: number
}

type ParseResult = {
  policies:      PolicyRow[]
  sheetStats:    SheetStat[]
  masterName:    string | null
  totalAnnuities: number
  totalNoId:     number
}

// ── Parsers (run client-side) ─────────────────────────────────────────────────

function parseCurrency(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).replace(/\s/g, '')
  if (!s || s === '-') return null
  const isNeg = s.startsWith('(') && s.endsWith(')')
  const clean = s.replace(/[($,)]/g, '')
  const n = parseFloat(clean)
  return isNaN(n) ? null : isNeg ? -n : n
}

function parseIsoDate(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return v.toISOString().split('T')[0]
  }
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  if (!isNaN(n) && n > 1000 && n < 100000) {
    const d = XLSX.SSF.parse_date_code(n)
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
  }
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function parseDob(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s.includes('xx') || s.includes('XX')) return s || null
  if (v instanceof Date && !isNaN(v.getTime())) {
    const mm   = String(v.getMonth() + 1).padStart(2, '0')
    const yyyy = v.getFullYear()
    return `${mm}/xx/${yyyy}`
  }
  if (s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    const parts = s.split('/')
    return `${parts[0].padStart(2,'0')}/xx/${parts[2]}`
  }
  return s || null
}

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

function col(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row && row[key] != null && row[key] !== '') return row[key]
  }
  const lowerKeys = keys.map(k => k.toLowerCase())
  for (const [k, v] of Object.entries(row)) {
    if (lowerKeys.includes(k.toLowerCase()) && v != null && v !== '') return v
  }
  return null
}

const PRODUCT_MAP: Record<string, string> = {
  'TERM':'Term','TERM LIFE':'Term','TERM LIFE INSURANCE':'Term',
  'UL':'UL','UNIVERSAL LIFE':'UL','UNIVERSAL':'UL',
  'VUL':'VUL','VARIABLE UNIVERSAL LIFE':'VUL','VARIABLE UL':'VUL',
  'WL':'WL','WHOLE LIFE':'WL','WHOLE':'WL',
  'PERM':'PERM','PERMANENT':'PERM','PERMANENT LIFE':'PERM',
  'FA':'FA','FIXED ANNUITY':'FA','ANNUITY':'FA',
  'MVA':'MVA','MARKET VALUE':'MVA',
}
const ANNUITY_CODES = new Set(['FA','MVA'])

function normalizeProductType(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return PRODUCT_MAP[s.toUpperCase()] ?? s
}

function parseRow(row: Record<string, unknown>): PolicyRow | null {
  const rawId = col(row,
    'PolicyId','Policy Id','PolicyID','Policy_Id','POLICYID','Policy Number','PolicyNumber',
  )
  const policyNumber = rawId != null ? String(rawId).trim() : null
  if (!policyNumber) return null

  const productTypeCd = normalizeProductType(
    col(row,'MarketingProductTypeCd','ProductTypeCd','Product Type Cd','ProductType','Product_Type_Cd'),
  )
  if (productTypeCd && ANNUITY_CODES.has(productTypeCd)) return null

  const ownerFirst = str(col(row,'OwnerFirstName','Owner First Name','FirstName','First Name','OwnerFirst'))
  const ownerLast  = str(col(row,'OwnerLastName','Owner Last Name','LastName','Last Name','OwnerLast'))
  const clientName = [ownerFirst, ownerLast].filter(Boolean).join(' ') || 'Unknown'

  const carrierRaw = str(col(row,'Carrier','CarrierName','Carrier Name','Company'))
  const carrier    = carrierRaw ?? 'Lincoln Benefit Life'

  const coverageRaw    = str(col(row,'CoverageStatusCd','CoverageStatus','Coverage Status','Status','PolicyStatus'))
  const coverageStatus = coverageRaw ?? 'Active'

  return {
    policy_number:        policyNumber,
    client_name:          clientName,
    carrier,
    product_type:         productTypeCd,
    issue_date:           parseIsoDate(col(row,'IssueDt','IssueDate','Issue Date','Issue_Date','PolicyDate')),
    face_amount:          parseCurrency(col(row,'FaceValueAmt','FaceValue','Face Amount','Face_Amount','FaceAmt')),
    death_benefit_amount: parseCurrency(col(row,'DeathBenefitAmt','DeathBenefit','Death Benefit','Death_Benefit')),
    cash_value_amount:    parseCurrency(col(row,'CashValueAmt','CashValue','Cash Value','Cash_Value','ApproxValue','Approx Value')),
    annual_premium:       parseCurrency(col(row,'AnnualPremiumAmt','AnnualPremium','Annual Premium','Premium')),
    rate_class:           str(col(row,'UnderwritingClassCd','RateClass','Rate Class','Underwriting Class','UnderwritingClass')),
    riders:               str(col(row,'Rider','Riders','RiderCd','Rider Cd')),
    insured_first_name:   str(col(row,'InsuredFirstName','Insured First Name','InsuredFirst')),
    insured_last_name:    str(col(row,'InsuredLastName','Insured Last Name','InsuredLast')),
    owner_phone:          str(col(row,'OwnerPhoneNumber','PhoneNumber','Phone Number','Phone','OwnerPhone')),
    owner_dob_approx:     parseDob(col(row,'OwnerDateOfBirth','DateOfBirth','DOB','Owner DOB','OwnerDOB')),
    writing_agent_name:   str(col(row,'WritingAgentFullName','WritingAgent','Writing Agent','AgentName')),
    coverage_status:      coverageStatus,
    sa_status:            'unknown',
    is_test:              false,
  }
}

// ── Client-side Excel parsing ─────────────────────────────────────────────────

function parseWorkbook(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data     = e.target?.result
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })

        const masterName      = workbook.SheetNames.find(n => /master/i.test(n)) ?? null
        const sheetsToProcess = masterName ? [masterName] : workbook.SheetNames

        const policyMap  = new Map<string, PolicyRow>()
        const sheetStats: SheetStat[] = []
        let totalAnnuities = 0
        let totalNoId      = 0

        for (const sheetName of sheetsToProcess) {
          const sheet = workbook.Sheets[sheetName]
          if (!sheet) continue

          const rawRows = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet, { defval: null, raw: false })
          const rawDates = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet, { defval: null, raw: true })

          let parsed = 0, annuities = 0, noId = 0

          for (let i = 0; i < rawRows.length; i++) {
            const row = { ...rawRows[i], ...rawDates[i] }

            // Determine skip reason before calling parseRow
            const rawId = col(row,
              'PolicyId','Policy Id','PolicyID','Policy_Id','POLICYID','Policy Number','PolicyNumber',
            )
            if (!rawId || String(rawId).trim() === '') { noId++; totalNoId++; continue }

            const prodRaw = normalizeProductType(
              col(row,'MarketingProductTypeCd','ProductTypeCd','Product Type Cd','ProductType','Product_Type_Cd'),
            )
            if (prodRaw && ANNUITY_CODES.has(prodRaw)) { annuities++; totalAnnuities++; continue }

            const parsedRow = parseRow(row)
            if (!parsedRow) { noId++; totalNoId++; continue }

            policyMap.set(parsedRow.policy_number, parsedRow)
            parsed++
          }

          sheetStats.push({ name: sheetName, rows: rawRows.length, parsed, annuities, no_id: noId })
        }

        resolve({
          policies:       Array.from(policyMap.values()),
          sheetStats,
          masterName,
          totalAnnuities,
          totalNoId,
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsArrayBuffer(file)
  })
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) { return new Intl.NumberFormat('en-US').format(n) }

function StatChip({ label, value, color = 'slate' }: {
  label: string; value: number; color?: 'slate'|'green'|'amber'|'sky'
}) {
  const colors = {
    slate: 'bg-slate-800 text-white',
    green: 'bg-green-900/60 text-green-300',
    amber: 'bg-amber-900/60 text-amber-300',
    sky:   'bg-sky-900/60 text-sky-300',
  }
  return (
    <div className={`rounded-xl p-4 text-center ${colors[color]}`}>
      <p className="text-2xl font-bold">{fmt(value)}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Phase = 'upload' | 'preview' | 'importing' | 'done'

type ImportResult = {
  inserted: number; already_on_file: number
  skipped_annuities: number; skipped_no_id: number
  errors?: string[]
}

export default function PolicyImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)

  const [file,       setFile]       = useState<File | null>(null)
  const [phase,      setPhase]      = useState<Phase>('upload')
  const [parsed,     setParsed]     = useState<ParseResult | null>(null)
  const [result,     setResult]     = useState<ImportResult | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [dragging,   setDragging]   = useState(false)
  const [previewing, setPreviewing] = useState(false)

  function pickFile(f: File | null) {
    if (!f) return
    setFile(f); setParsed(null); setResult(null); setError(null); setPhase('upload')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0] ?? null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files?.[0] ?? null
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) pickFile(f)
    else setError('Only .xlsx or .xls files are accepted')
  }

  // Phase 1: parse in the browser — no upload, no server call
  async function handlePreview() {
    if (!file) return
    setError(null); setPreviewing(true)
    try {
      const result = await parseWorkbook(file)
      setParsed(result)
      setPhase('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse file')
    } finally {
      setPreviewing(false)
    }
  }

  // Phase 2: send parsed JSON rows to server — no file upload
  async function handleImport() {
    if (!parsed || !file) return
    setPhase('importing'); setError(null)
    try {
      const res  = await fetch('/api/admin/policy-import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          policies:          parsed.policies,
          file_name:         file.name,
          master_sheet:      parsed.masterName,
          sheet_stats:       parsed.sheetStats,
          skipped_annuities: parsed.totalAnnuities,
          skipped_no_id:     parsed.totalNoId,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? `Server error ${res.status}`); setPhase('preview'); return }
      setResult(json as ImportResult)
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
      setPhase('preview')
    }
  }

  function reset() {
    setFile(null); setParsed(null); setResult(null); setError(null); setPhase('upload')
    if (inputRef.current) inputRef.current.value = ''
  }

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
            Upload the 2024 Consolidated Books Excel. The file is parsed locally in your
            browser — only the structured data is sent to the server. FA/MVA annuities
            are skipped automatically.
          </p>
        </div>

        {/* ── UPLOAD ─────────────────────────────────────────────────────────── */}
        {phase === 'upload' && (
          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragging ? 'border-blue-500 bg-blue-950/20' : 'border-slate-700 hover:border-slate-500'
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="w-9 h-9 text-slate-500 mx-auto mb-3" />
              {file ? (
                <div>
                  <p className="text-white text-sm font-medium">{file.name}</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {(file.size / 1024 / 1024).toFixed(1)} MB · Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-300 text-sm font-medium">Drop file here or click to browse</p>
                  <p className="text-slate-500 text-xs mt-1">.xlsx or .xls files only</p>
                </div>
              )}
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
            </div>

            <Button
              disabled={!file || previewing}
              onClick={handlePreview}
              className="w-full text-white font-medium"
              style={{ backgroundColor: '#1F3864' }}
            >
              {previewing
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Parsing file…</>
                : <><ChevronRight className="w-4 h-4 mr-2" />Parse File</>
              }
            </Button>
          </div>
        )}

        {/* ── PREVIEW ────────────────────────────────────────────────────────── */}
        {phase === 'preview' && parsed && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-300 text-sm">
                <FileSpreadsheet className="w-4 h-4 text-slate-500" />
                <span className="font-medium">{file?.name}</span>
                {parsed.masterName && (
                  <span className="text-xs bg-sky-900/60 text-sky-300 px-2 py-0.5 rounded-full">
                    Master: {parsed.masterName}
                  </span>
                )}
              </div>
              <button onClick={reset} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatChip label="Policies parsed"   value={parsed.policies.length}  color="slate" />
              <StatChip label="Will import"       value={parsed.policies.length}  color="green" />
              <StatChip label="Annuities skipped" value={parsed.totalAnnuities}   color="amber" />
            </div>

            {parsed.totalNoId > 0 && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <SkipForward className="w-3.5 h-3.5" />
                {fmt(parsed.totalNoId)} row{parsed.totalNoId !== 1 ? 's' : ''} skipped — no policy ID
              </p>
            )}

            <p className="text-xs text-slate-500">
              Policies already on file will be detected and skipped automatically when you confirm.
            </p>

            {parsed.sheetStats.length > 1 && (
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
                  <Table className="w-4 h-4 text-slate-500" />
                  <p className="text-slate-300 text-sm font-medium">
                    Sheets processed ({parsed.sheetStats.length})
                  </p>
                </div>
                <div className="divide-y divide-slate-800">
                  {parsed.sheetStats.map(s => (
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

            <div className="flex gap-3">
              <Button variant="outline" onClick={reset}
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800">
                Cancel
              </Button>
              <Button onClick={handleImport}
                className="flex-1 text-white font-medium"
                style={{ backgroundColor: '#1F3864' }}>
                Confirm — Import {fmt(parsed.policies.length)}{' '}
                {parsed.policies.length === 1 ? 'Policy' : 'Policies'}
              </Button>
            </div>
          </div>
        )}

        {/* ── IMPORTING ──────────────────────────────────────────────────────── */}
        {phase === 'importing' && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
            <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" />
            <p className="text-white text-sm font-medium">Importing policies…</p>
            <p className="text-slate-500 text-xs mt-1">This may take a moment.</p>
          </div>
        )}

        {/* ── DONE ───────────────────────────────────────────────────────────── */}
        {phase === 'done' && result && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <p className="text-white font-semibold text-lg">Import Complete</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatChip label="Inserted"        value={result.inserted}          color="green" />
              <StatChip label="Already on file" value={result.already_on_file}   color="sky"   />
              <StatChip label="Annuities"       value={result.skipped_annuities} color="amber" />
              <StatChip label="No ID skipped"   value={result.skipped_no_id}     color="slate" />
            </div>
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
            <Button onClick={reset} variant="outline"
              className="w-full border-slate-700 text-slate-300 hover:bg-slate-800">
              Import Another File
            </Button>
          </div>
        )}

        {/* Error banner */}
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
