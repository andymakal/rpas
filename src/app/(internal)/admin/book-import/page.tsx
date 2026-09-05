'use client'

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  FileSpreadsheet, Upload, CheckCircle, AlertCircle,
  Loader2, ChevronRight, X, Users, Briefcase,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── Types ────────────────────────────────────────────────────────────────────

export type ContactRow = {
  source_client_id:  string
  first_name:        string
  last_name:         string
  street:            string | null
  city:              string | null
  state:             string | null
  zip:               string | null
  phone:             string | null
  email:             string | null
  date_of_birth:     string | null
  referring_partner: string | null
  is_deceased:       boolean
  is_emoney_client:  boolean
  has_financial:     boolean
  has_life:          boolean
  total_aum:         number | null
  has_qualified:     boolean
  segment:           string | null
}

export type AccountRow = {
  source_client_id:   string
  client_name:        string
  source_carrier_raw: string
  carrier:            string
  policy_number:      string
  product_name:       string | null
  product_type:       string | null
  product_category:   'life' | 'annuity' | 'mutual_fund'
  plan_type:          string | null
  issue_date:         string | null
  account_value:      number | null
  coverage_status:    string
}

type ParseResult = {
  contacts:     ContactRow[]
  accounts:     AccountRow[]
  skippedContacts: number
  skippedAccounts: number
  segmentCounts: Record<string, number>
  categoryCounts: Record<string, number>
}

type ContactsResult = {
  created:  number
  matched:  number
  skipped:  number
  errors?:  string[]
}

type AccountsResult = {
  inserted:         number
  relinked:         number
  already_on_file:  number
  unmatched_client: number
  errors?:          string[]
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

const PLAN_MAP: Record<string, string> = {
  'IRA': 'ira', 'TRADITIONAL IRA': 'ira', 'SELECT ADVANTAGE IRA': 'ira',
  'IRA - REGULAR': 'ira', 'IRRL': 'ira', 'IRAB': 'ira', 'IRA REGULAR': 'ira',
  'ROLLOVER TRADITIONAL IRA': 'ira', 'I': 'ira', 'INHERITED IRA BCO': 'ira', 'IS': 'ira',
  'ROTH': 'roth', 'ROTH IRA': 'roth', 'ROTH IRA ': 'roth',
  'SELECT ADVANTAGE ROTH IRA': 'roth', 'RTHB': 'roth',
  'NQ': 'nq', 'NON-QUALIFIED': 'nq', 'INDIVIDUAL (NON-QUALIFIED)': 'nq',
  'NON QUALIFIED': 'nq', 'INDIVIDUAL': 'nq', 'NON-QUALIFIED ': 'nq',
  'SIMPLE IRA': 'simple_ira', 'SMPL': 'simple_ira',
  'SELECT ADVANTAGE SIMPLE IRA': 'simple_ira', 'SIMPLE IRA - NON-DFI': 'simple_ira',
  'SEP IRA': 'sep_ira', 'SELECT ADVANTAGE SEP IRA': 'sep_ira',
  'UTMA': 'utma', 'UTMA/UGMA': 'utma', 'CUSTODIAL (UTMA/UGMA)': 'utma',
  '529 COLLEGE SAVINGS': '529', 'COV': '529',
  'TODI': 'joint', 'TRANSFER ON DEATH': 'joint', 'J': 'joint',
  'JOINT TENANT': 'joint', 'JOINT': 'joint', 'TIC': 'joint', 'TST/TA': 'joint',
  '401(K)': 'other', 'IRAB ': 'ira',
}

function normalizePlanType(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return PLAN_MAP[s.toUpperCase()] ?? PLAN_MAP[s.toUpperCase().trim()] ?? 'other'
}

const ANNUITY_PRODUCT_TYPES = new Set([
  'Annuity', 'Variable Annuity', 'Fixed Annuity', 'Indexed Annuity',
  'Fixed Index Annuity', 'Variable/Structured Annuity',
])
const LIFE_PRODUCT_TYPES = new Set(['Life Insurance', 'Variable Life'])
const FUND_PRODUCT_TYPES = new Set(['Mutual Fund', 'Mutual Fund/Retirement Plan', 'Brokerage'])

const ANNUITY_CARRIER_KEYWORDS = ['ANNUITY', 'NATIONWIDE LIFE & ANNUITY', 'JACKSON NATIONAL']

function productCategory(
  productType: string | null,
  carrierRaw: string,
): 'life' | 'annuity' | 'mutual_fund' {
  if (productType && LIFE_PRODUCT_TYPES.has(productType))   return 'life'
  if (productType && ANNUITY_PRODUCT_TYPES.has(productType)) return 'annuity'
  if (productType && FUND_PRODUCT_TYPES.has(productType))   return 'mutual_fund'
  if (carrierRaw.startsWith('LIFE Book')) return 'life'
  const cu = carrierRaw.toUpperCase()
  if (ANNUITY_CARRIER_KEYWORDS.some(k => cu.includes(k))) return 'annuity'
  return 'mutual_fund'
}

// Carrier display name — strip "LIFE Book — " and "FIS Broker-Dealer — " prefixes
function normalizeCarrier(raw: string): string {
  return raw
    .replace(/^LIFE Book\s*[—–-]+\s*/i, '')
    .replace(/^FIS Broker-Dealer\s*[—–-]+\s*/i, '')
    .replace(/\s*[—–-]+\s*code inferred.*$/i, '')
    .trim()
}

function computeSegment(row: {
  has_financial: boolean; has_life: boolean; total_aum: number | null
}): string | null {
  if (row.has_financial) {
    const aum = row.total_aum ?? 0
    if (aum >= 500_000) return 'trailblazer'
    if (aum >= 100_000) return 'voyageur'
    return 'pathfinder'
  }
  if (row.has_life) return 'explorer'
  return null
}

function parseIso(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return v.toISOString().split('T')[0]
  }
  const s = String(v).trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

// ── Client-side workbook parsing ─────────────────────────────────────────────

function parseWorkbook(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array', cellDates: true })

        // ── Contacts ──────────────────────────────────────────────────────────
        const contactSheet = wb.Sheets['Contacts']
        if (!contactSheet) throw new Error('No "Contacts" sheet found — is this the RPAS Book Consolidation file?')

        const rawContacts = XLSX.utils.sheet_to_json<Record<string, unknown>>(contactSheet, { defval: null })
        const contacts: ContactRow[] = []
        let skippedContacts = 0
        const segmentCounts: Record<string, number> = {}

        for (const r of rawContacts) {
          const lastName  = str(r['Last Name'])
          const firstName = str(r['First Name'])
          const clientId  = str(r['Client ID'])
          if (!clientId || !lastName) { skippedContacts++; continue }

          const hasFinancial = String(r['Has Financial Account'] ?? '').trim().toUpperCase() === 'Y'
          const hasLife      = String(r['Has Life Insurance Policy'] ?? '').trim().toUpperCase() === 'Y'
          const totalAum     = r['Total AUM'] != null ? Number(r['Total AUM']) : null
          const seg          = computeSegment({ has_financial: hasFinancial, has_life: hasLife, total_aum: totalAum })
          const key          = seg ?? 'unassigned'
          segmentCounts[key] = (segmentCounts[key] ?? 0) + 1

          contacts.push({
            source_client_id:  clientId,
            first_name:        firstName ?? '',
            last_name:         lastName,
            street:            str(r['Street']),
            city:              str(r['City']),
            state:             str(r['State']),
            zip:               str(r['Zip']),
            phone:             str(r['Phone']),
            email:             str(r['Email']),
            date_of_birth:     parseIso(r['Known DOB']),
            referring_partner: str(r['Referring P&C Agent Partner']),
            is_deceased:       String(r['CRM Deceased Flag'] ?? '').trim().toUpperCase() === 'YES',
            is_emoney_client:  String(r['Allstate My Money (eMoney Advisor)'] ?? '').trim().toUpperCase() === 'YES',
            has_financial:     hasFinancial,
            has_life:          hasLife,
            total_aum:         totalAum,
            has_qualified:     String(r['Has Qualified Assets'] ?? '').trim().toUpperCase() === 'Y',
            segment:           seg,
          })
        }

        // ── Accounts ──────────────────────────────────────────────────────────
        const accountSheet = wb.Sheets['Accounts']
        if (!accountSheet) throw new Error('No "Accounts" sheet found.')

        const rawAccounts = XLSX.utils.sheet_to_json<Record<string, unknown>>(accountSheet, { defval: null })
        const accountMap  = new Map<string, AccountRow>()
        let skippedAccounts = 0
        const categoryCounts: Record<string, number> = {}

        for (const r of rawAccounts) {
          const contractNum = str(r['Account/Contract #'])
          const clientId    = str(r['Client ID'])
          if (!contractNum || !clientId) { skippedAccounts++; continue }

          const carrierRaw   = str(r['Source / Carrier']) ?? 'Unknown'
          const productType  = str(r['Product Type'])
          const cat          = productCategory(productType, carrierRaw)
          categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1

          accountMap.set(contractNum, {
            source_client_id:   clientId,
            client_name:        str(r['Client Name']) ?? '',
            source_carrier_raw: carrierRaw,
            carrier:            normalizeCarrier(carrierRaw),
            policy_number:      contractNum,
            product_name:       str(r['Product Name']),
            product_type:       productType,
            product_category:   cat,
            plan_type:          normalizePlanType(r['Tax/Plan Type']),
            issue_date:         parseIso(r['Issue/Effective Date']),
            account_value:      r['Account Value'] != null ? Number(r['Account Value']) : null,
            coverage_status:    str(r['Status']) ?? 'Active',
          })
        }

        resolve({
          contacts,
          accounts:        Array.from(accountMap.values()),
          skippedContacts,
          skippedAccounts,
          segmentCounts,
          categoryCounts,
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

function StatChip({ label, value, sub, color = 'slate' }: {
  label: string; value: number; sub?: string; color?: 'slate' | 'green' | 'amber' | 'sky' | 'indigo' | 'violet'
}) {
  const colors = {
    slate:  'bg-slate-800 text-white',
    green:  'bg-green-900/60 text-green-300',
    amber:  'bg-amber-900/60 text-amber-300',
    sky:    'bg-sky-900/60 text-sky-300',
    indigo: 'bg-indigo-900/60 text-indigo-300',
    violet: 'bg-violet-900/60 text-violet-300',
  }
  return (
    <div className={`rounded-xl p-4 text-center ${colors[color]}`}>
      <p className="text-2xl font-bold">{fmt(value)}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  )
}

const SEGMENT_LABELS: Record<string, string> = {
  trailblazer: 'Trailblazer ($500K+)',
  voyageur:    'Voyageur ($100K–$500K)',
  pathfinder:  'Pathfinder (under $100K)',
  explorer:    'Explorer (life only)',
  unassigned:  'Unassigned',
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Phase =
  | 'upload'
  | 'preview'
  | 'importing-contacts'
  | 'contacts-done'
  | 'importing-accounts'
  | 'done'

export default function BookImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)

  const [file,       setFile]       = useState<File | null>(null)
  const [phase,      setPhase]      = useState<Phase>('upload')
  const [parsed,     setParsed]     = useState<ParseResult | null>(null)
  const [parsing,    setParsing]    = useState(false)
  const [contactsResult, setContactsResult] = useState<ContactsResult | null>(null)
  const [accountsResult, setAccountsResult] = useState<AccountsResult | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [dragging,   setDragging]   = useState(false)

  function pickFile(f: File | null) {
    if (!f) return
    setFile(f); setParsed(null); setContactsResult(null); setAccountsResult(null)
    setError(null); setPhase('upload')
  }

  async function handlePreview() {
    if (!file) return
    setError(null); setParsing(true)
    try {
      const result = await parseWorkbook(file)
      setParsed(result)
      setPhase('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse file')
    } finally {
      setParsing(false)
    }
  }

  async function handleImportContacts() {
    if (!parsed) return
    setPhase('importing-contacts'); setError(null)
    try {
      const res  = await fetch('/api/admin/book-import/contacts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contacts: parsed.contacts }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? `Server error ${res.status}`); setPhase('preview'); return }
      setContactsResult(json as ContactsResult)
      setPhase('contacts-done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
      setPhase('preview')
    }
  }

  async function handleImportAccounts() {
    if (!parsed) return
    setPhase('importing-accounts'); setError(null)
    try {
      const res  = await fetch('/api/admin/book-import/accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accounts: parsed.accounts }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? `Server error ${res.status}`); setPhase('contacts-done'); return }
      setAccountsResult(json as AccountsResult)
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
      setPhase('contacts-done')
    }
  }

  function reset() {
    setFile(null); setParsed(null); setContactsResult(null); setAccountsResult(null)
    setError(null); setPhase('upload')
    if (inputRef.current) inputRef.current.value = ''
  }

  const busy = phase === 'importing-contacts' || phase === 'importing-accounts' || parsing

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Briefcase className="w-6 h-6 text-slate-400" />
            <h1 className="text-white text-2xl font-semibold">Book of Business Import</h1>
          </div>
          <p className="text-slate-400 text-sm">
            Upload the RPAS Book Consolidation file. Contacts are matched to existing customer
            cards before creating new ones. Accounts deduplicate by contract number.
            Run Contacts first, then Accounts.
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
              onDrop={e => {
                e.preventDefault(); setDragging(false)
                const f = e.dataTransfer.files?.[0] ?? null
                if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) pickFile(f)
                else setError('Only .xlsx or .xls files are accepted')
              }}
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
                  <p className="text-slate-500 text-xs mt-1">RPAS_Book_Consolidation.xlsx</p>
                </div>
              )}
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => pickFile(e.target.files?.[0] ?? null)} />
            </div>

            <Button
              disabled={!file || parsing}
              onClick={handlePreview}
              className="w-full text-white font-medium"
              style={{ backgroundColor: '#1F3864' }}
            >
              {parsing
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
              </div>
              <button onClick={reset} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Contacts preview */}
            <div className="rounded-xl border border-slate-800 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                <p className="text-white font-semibold text-sm">Step 1 — Contacts</p>
                <span className="text-xs text-slate-500">({fmt(parsed.contacts.length)} records)</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatChip label="Total contacts"  value={parsed.contacts.length}    color="slate" />
                <StatChip label="eMoney clients"  value={parsed.contacts.filter(c => c.is_emoney_client).length} color="sky" />
                <StatChip label="Deceased flag"   value={parsed.contacts.filter(c => c.is_deceased).length}     color="amber" />
              </div>
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 text-xs">
                {Object.entries(parsed.segmentCounts)
                  .sort(([,a],[,b]) => b - a)
                  .map(([seg, count]) => (
                    <div key={seg} className="flex justify-between px-3 py-2">
                      <span className="text-slate-400">{SEGMENT_LABELS[seg] ?? seg}</span>
                      <span className="text-white font-medium">{fmt(count)}</span>
                    </div>
                  ))
                }
              </div>
              <p className="text-xs text-slate-500">
                Existing customers are matched by last name + DOB, then phone, then email.
                Matched records update eMoney and deceased flags only — names and addresses are not overwritten.
              </p>
              <Button
                onClick={handleImportContacts}
                className="w-full text-white font-medium"
                style={{ backgroundColor: '#1F3864' }}
              >
                <ChevronRight className="w-4 h-4 mr-2" />
                Import {fmt(parsed.contacts.length)} Contacts
              </Button>
            </div>

            {/* Accounts preview (locked until contacts done) */}
            <div className="rounded-xl border border-slate-800 p-5 space-y-4 opacity-40">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-slate-400" />
                <p className="text-white font-semibold text-sm">Step 2 — Accounts</p>
                <span className="text-xs text-slate-500">({fmt(parsed.accounts.length)} records · unlocks after Step 1)</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatChip label="Life policies"  value={parsed.categoryCounts['life'] ?? 0}         color="slate"  />
                <StatChip label="Annuities"      value={parsed.categoryCounts['annuity'] ?? 0}      color="indigo" />
                <StatChip label="Mutual funds"   value={parsed.categoryCounts['mutual_fund'] ?? 0}  color="green"  />
              </div>
            </div>
          </div>
        )}

        {/* ── IMPORTING CONTACTS ─────────────────────────────────────────────── */}
        {phase === 'importing-contacts' && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
            <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" />
            <p className="text-white text-sm font-medium">Importing contacts…</p>
            <p className="text-slate-500 text-xs mt-1">Matching against existing customer cards.</p>
          </div>
        )}

        {/* ── CONTACTS DONE — ready for accounts ────────────────────────────── */}
        {(phase === 'contacts-done' || phase === 'importing-accounts') && contactsResult && parsed && (
          <div className="space-y-5">

            {/* Contacts result */}
            <div className="rounded-xl border border-slate-800 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <p className="text-white font-semibold text-sm">Step 1 — Contacts complete</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatChip label="Created"        value={contactsResult.created}  color="green" />
                <StatChip label="Matched (updated)" value={contactsResult.matched} color="sky"   />
                <StatChip label="Skipped"        value={contactsResult.skipped}  color="slate" />
              </div>
            </div>

            {/* Accounts import */}
            {phase === 'contacts-done' && (
              <div className="rounded-xl border border-slate-800 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-slate-400" />
                  <p className="text-white font-semibold text-sm">Step 2 — Accounts</p>
                  <span className="text-xs text-slate-500">({fmt(parsed.accounts.length)} records)</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatChip label="Life policies" value={parsed.categoryCounts['life'] ?? 0}        color="slate"  />
                  <StatChip label="Annuities"     value={parsed.categoryCounts['annuity'] ?? 0}     color="indigo" />
                  <StatChip label="Mutual funds"  value={parsed.categoryCounts['mutual_fund'] ?? 0} color="green"  />
                </div>
                <p className="text-xs text-slate-500">
                  Existing policies (by contract number) are skipped. Accounts are linked to
                  customers imported in Step 1.
                </p>
                <Button
                  onClick={handleImportAccounts}
                  className="w-full text-white font-medium"
                  style={{ backgroundColor: '#1F3864' }}
                >
                  <ChevronRight className="w-4 h-4 mr-2" />
                  Import {fmt(parsed.accounts.length)} Accounts
                </Button>
              </div>
            )}

            {phase === 'importing-accounts' && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
                <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" />
                <p className="text-white text-sm font-medium">Importing accounts…</p>
                <p className="text-slate-500 text-xs mt-1">Deduplicating by contract number.</p>
              </div>
            )}
          </div>
        )}

        {/* ── DONE ───────────────────────────────────────────────────────────── */}
        {phase === 'done' && contactsResult && accountsResult && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <p className="text-white font-semibold text-lg">Import Complete</p>
            </div>

            <div className="rounded-xl border border-slate-800 p-5 space-y-3">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Contacts</p>
              <div className="grid grid-cols-3 gap-3">
                <StatChip label="Created"           value={contactsResult.created}  color="green" />
                <StatChip label="Matched"           value={contactsResult.matched}  color="sky"   />
                <StatChip label="Skipped"           value={contactsResult.skipped}  color="slate" />
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 p-5 space-y-3">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Accounts</p>
              <div className="grid grid-cols-2 gap-3">
                <StatChip label="Inserted"          value={accountsResult.inserted}         color="green"  />
                <StatChip label="Relinked"          value={accountsResult.relinked}         color="violet" />
                <StatChip label="Already on file"   value={accountsResult.already_on_file}  color="sky"    />
                <StatChip label="No client match"   value={accountsResult.unmatched_client} color="amber"  />
              </div>
              {accountsResult.relinked > 0 && (
                <p className="text-xs text-violet-400/80">
                  {accountsResult.relinked.toLocaleString()} existing Everlake/LBL policies linked to customer cards.
                </p>
              )}
              {accountsResult.unmatched_client > 0 && (
                <p className="text-xs text-amber-400/80">
                  Unmatched accounts have no customer card — re-run after resolving contacts.
                </p>
              )}
            </div>

            {(contactsResult.errors?.length || accountsResult.errors?.length) ? (
              <div className="bg-red-950 border border-red-800 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <p className="text-red-300 text-sm font-semibold">Errors</p>
                </div>
                {[...(contactsResult.errors ?? []), ...(accountsResult.errors ?? [])].map((e, i) => (
                  <p key={i} className="text-red-400/80 text-xs font-mono">{e}</p>
                ))}
              </div>
            ) : null}

            <Button onClick={reset} variant="outline"
              className="w-full border-slate-700 text-slate-300 hover:bg-slate-800">
              Import Another File
            </Button>
          </div>
        )}

        {/* Error banner */}
        {error && !busy && (
          <div className="flex items-start gap-3 bg-red-950 border border-red-800 text-red-300 text-sm p-4 rounded-xl">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

      </div>
    </div>
  )
}
