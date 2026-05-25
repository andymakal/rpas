import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/policy-import?preview=true   → parse only, no DB writes
 * POST /api/admin/policy-import                → parse + insert
 *
 * Handles the 2024 Consolidated Books Excel:
 *   - 37 agent sheets + optional master sheet
 *   - If a "Master" sheet exists, process only that (avoids agent-sheet duplication)
 *   - Otherwise process all sheets, dedup by PolicyId (string — never cast to int)
 *   - Skips FA / MVA annuities (out of scope)
 *   - Currency fields: strips $, commas, spaces; handles parenthetical negatives
 *   - DOB: stored as-is (MM/xx/YYYY — already masked in the source)
 */

// ── Type for a parsed, ready-to-insert row ────────────────────────────────────
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

// ── Parsers ───────────────────────────────────────────────────────────────────

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
  // Try numeric serial (Excel date serial)
  const n = Number(s)
  if (!isNaN(n) && n > 1000 && n < 100000) {
    const d = XLSX.SSF.parse_date_code(n)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function parseDob(v: unknown): string | null {
  if (v == null) return null
  // If it's already a masked string like "04/xx/1985", return as-is
  const s = String(v).trim()
  if (s.includes('xx') || s.includes('XX')) return s || null
  // If it came through as a real Date (XLSX parsed a full date), re-mask it
  if (v instanceof Date && !isNaN(v.getTime())) {
    const mm   = String(v.getMonth() + 1).padStart(2, '0')
    const yyyy = v.getFullYear()
    return `${mm}/xx/${yyyy}`
  }
  // String date — mask the day
  if (s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    const parts = s.split('/')
    return `${parts[0].padStart(2, '0')}/xx/${parts[2]}`
  }
  return s || null
}

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

// Case-insensitive column lookup — tries exact match then case-insensitive
function col(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row && row[key] != null && row[key] !== '') return row[key]
  }
  // Fallback: case-insensitive scan
  const lowerKeys = keys.map(k => k.toLowerCase())
  for (const [k, v] of Object.entries(row)) {
    if (lowerKeys.includes(k.toLowerCase()) && v != null && v !== '') return v
  }
  return null
}

// ── Product type normalization ─────────────────────────────────────────────────
const PRODUCT_MAP: Record<string, string> = {
  'TERM': 'Term', 'TERM LIFE': 'Term', 'TERM LIFE INSURANCE': 'Term',
  'UL': 'UL', 'UNIVERSAL LIFE': 'UL', 'UNIVERSAL': 'UL',
  'VUL': 'VUL', 'VARIABLE UNIVERSAL LIFE': 'VUL', 'VARIABLE UL': 'VUL',
  'WL': 'WL', 'WHOLE LIFE': 'WL', 'WHOLE': 'WL',
  'PERM': 'PERM', 'PERMANENT': 'PERM', 'PERMANENT LIFE': 'PERM',
  'FA': 'FA', 'FIXED ANNUITY': 'FA', 'ANNUITY': 'FA',
  'MVA': 'MVA', 'MARKET VALUE': 'MVA',
}
const ANNUITY_CODES = new Set(['FA', 'MVA'])

function normalizeProductType(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  const upper = s.toUpperCase()
  return PRODUCT_MAP[upper] ?? s
}

// ── Row parser ────────────────────────────────────────────────────────────────

type SkipReason = 'no_policy_id' | 'annuity' | null

function parseRow(row: Record<string, unknown>): { row: PolicyRow | null; skipReason: SkipReason } {
  // PolicyId — ALWAYS treat as string, never cast to number
  const rawId = col(
    row,
    'PolicyId', 'Policy Id', 'PolicyID', 'Policy_Id', 'POLICYID', 'Policy Number', 'PolicyNumber',
  )
  const policyNumber = rawId != null ? String(rawId).trim() : null
  if (!policyNumber) return { row: null, skipReason: 'no_policy_id' }

  const productTypeCd = normalizeProductType(
    col(row, 'MarketingProductTypeCd', 'ProductTypeCd', 'Product Type Cd', 'ProductType', 'Product_Type_Cd'),
  )
  if (productTypeCd && ANNUITY_CODES.has(productTypeCd)) {
    return { row: null, skipReason: 'annuity' }
  }

  const ownerFirst = str(col(row, 'OwnerFirstName', 'Owner First Name', 'FirstName', 'First Name', 'OwnerFirst'))
  const ownerLast  = str(col(row, 'OwnerLastName', 'Owner Last Name', 'LastName', 'Last Name', 'OwnerLast'))
  const clientName = [ownerFirst, ownerLast].filter(Boolean).join(' ') || 'Unknown'

  // Carrier — look for a column; default to Lincoln Benefit Life (this is the LBL book)
  const carrierRaw = str(col(row, 'Carrier', 'CarrierName', 'Carrier Name', 'Company'))
  const carrier    = carrierRaw ?? 'Lincoln Benefit Life'

  const coverageRaw = str(col(row, 'CoverageStatusCd', 'CoverageStatus', 'Coverage Status', 'Status', 'PolicyStatus'))
  const coverageStatus = coverageRaw ?? 'Active'

  return {
    row: {
      policy_number:        policyNumber,
      client_name:          clientName,
      carrier,
      product_type:         productTypeCd,
      issue_date:           parseIsoDate(col(row, 'IssueDt', 'IssueDate', 'Issue Date', 'Issue_Date', 'PolicyDate')),
      face_amount:          parseCurrency(col(row, 'FaceValueAmt', 'FaceValue', 'Face Amount', 'Face_Amount', 'FaceAmt')),
      death_benefit_amount: parseCurrency(col(row, 'DeathBenefitAmt', 'DeathBenefit', 'Death Benefit', 'Death_Benefit')),
      cash_value_amount:    parseCurrency(col(row, 'CashValueAmt', 'CashValue', 'Cash Value', 'Cash_Value', 'ApproxValue', 'Approx Value')),
      annual_premium:       parseCurrency(col(row, 'AnnualPremiumAmt', 'AnnualPremium', 'Annual Premium', 'Premium')),
      rate_class:           str(col(row, 'UnderwritingClassCd', 'RateClass', 'Rate Class', 'Underwriting Class', 'UnderwritingClass')),
      riders:               str(col(row, 'Rider', 'Riders', 'RiderCd', 'Rider Cd')),
      insured_first_name:   str(col(row, 'InsuredFirstName', 'Insured First Name', 'InsuredFirst')),
      insured_last_name:    str(col(row, 'InsuredLastName', 'Insured Last Name', 'InsuredLast')),
      owner_phone:          str(col(row, 'OwnerPhoneNumber', 'PhoneNumber', 'Phone Number', 'Phone', 'OwnerPhone')),
      owner_dob_approx:     parseDob(col(row, 'OwnerDateOfBirth', 'DateOfBirth', 'DOB', 'Owner DOB', 'OwnerDOB')),
      writing_agent_name:   str(col(row, 'WritingAgentFullName', 'WritingAgent', 'Writing Agent', 'AgentName')),
      coverage_status:      coverageStatus,
      sa_status:            'unknown',
      is_test:              false,
    },
    skipReason: null,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const url     = new URL(req.url)
  const preview = url.searchParams.get('preview') === 'true'

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  let workbook: XLSX.WorkBook
  try {
    const buffer = await file.arrayBuffer()
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch {
    return NextResponse.json({ error: 'Could not read Excel file — make sure it is a valid .xlsx' }, { status: 400 })
  }

  // ── Sheet selection ─────────────────────────────────────────────────────────
  // Master sheet = single source of truth (all agents combined, no duplication).
  // If no master found, process every sheet and dedupe by PolicyId.
  const masterName     = workbook.SheetNames.find(n => /master/i.test(n))
  const sheetsToProcess = masterName ? [masterName] : workbook.SheetNames

  // ── Parse all sheets, dedup by policy_number ────────────────────────────────
  const policyMap  = new Map<string, PolicyRow>()    // policy_number → row (last write wins)
  const sheetStats: { name: string; rows: number; parsed: number; annuities: number; no_id: number }[] = []

  let totalAnnuities = 0
  let totalNoId      = 0

  for (const sheetName of sheetsToProcess) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,   // let XLSX format dates before we get them
    })

    // Re-read with cellDates for date columns
    const rawRowsDates = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    })

    let parsed    = 0
    let annuities = 0
    let noId      = 0

    for (let i = 0; i < rawRows.length; i++) {
      // Merge string-formatted row with date-parsed row for date fields
      const row = { ...rawRows[i], ...rawRowsDates[i] }
      const { row: parsedRow, skipReason } = parseRow(row)

      if (!parsedRow) {
        if (skipReason === 'annuity')      { annuities++; totalAnnuities++ }
        else if (skipReason === 'no_policy_id') { noId++;  totalNoId++     }
        continue
      }

      policyMap.set(parsedRow.policy_number, parsedRow)
      parsed++
    }

    sheetStats.push({ name: sheetName, rows: rawRows.length, parsed, annuities, no_id: noId })
  }

  const policies = Array.from(policyMap.values())

  // ── Preview mode — parse only, no DB access ─────────────────────────────────
  // Skipping the existence check here keeps preview fast (file parsing only).
  // The duplicate check runs at import time when it actually matters.
  if (preview) {
    return NextResponse.json({
      preview:           true,
      file_name:         file.name,
      master_sheet:      masterName ?? null,
      sheets_processed:  sheetsToProcess.length,
      sheet_stats:       sheetStats,
      total_parsed:      policies.length,
      skipped_annuities: totalAnnuities,
      skipped_no_id:     totalNoId,
      already_on_file:   null,   // not checked at preview time
      to_insert:         policies.length,
    })
  }

  // ── Import mode — check existing then insert ─────────────────────────────────
  const supabase     = createAdminClient()
  const existingSet  = new Set<string>()
  const LOOKUP_CHUNK = 500

  const allNumbers = policies.map(p => p.policy_number)
  for (let i = 0; i < allNumbers.length; i += LOOKUP_CHUNK) {
    const chunk = allNumbers.slice(i, i + LOOKUP_CHUNK)
    const { data } = await supabase
      .from('service_policies')
      .select('policy_number')
      .in('policy_number', chunk)
    for (const r of data ?? []) existingSet.add(r.policy_number)
  }

  const toInsert = policies.filter(p => !existingSet.has(p.policy_number))
  const onFile   = policies.filter(p =>  existingSet.has(p.policy_number))

  const INSERT_CHUNK = 200
  let   insertedCount = 0
  const errors: string[] = []

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK)
    const { error } = await supabase.from('service_policies').insert(chunk)
    if (error) {
      console.error(`Policy import chunk ${Math.floor(i / INSERT_CHUNK) + 1} error:`, error)
      errors.push(`Rows ${i + 1}–${i + chunk.length}: ${error.message}`)
    } else {
      insertedCount += chunk.length
    }
  }

  return NextResponse.json({
    preview:           false,
    file_name:         file.name,
    total_parsed:      policies.length,
    inserted:          insertedCount,
    already_on_file:   onFile.length,
    skipped_annuities: totalAnnuities,
    skipped_no_id:     totalNoId,
    errors:            errors.length ? errors : undefined,
  })
}
