import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(req: NextRequest) {
  const year = req.nextUrl.searchParams.get('year') ?? String(new Date().getFullYear())
  if (!/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from('gdc_records')
    .delete({ count: 'exact' })
    .gte('process_date', `${year}-01-01`)
    .lte('process_date', `${year}-12-31`)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: count ?? 0, year })
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheetName =
    workbook.SheetNames.find(n => n.toLowerCase().includes('nb policy')) ??
    workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  // Rows 1-6 are report metadata; row 7 is the header row (0-based index 6)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 6 })

  if (rows.length === 0) {
    return NextResponse.json({ error: `Sheet "${sheetName}" is empty or could not be parsed` }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: agencies } = await supabase
    .from('agencies')
    .select('id, slug, allstate_partner_number')
    .not('allstate_partner_number', 'is', null)

  // Map full partner number (A0C4775) → agency_id
  const partnerMap = new Map<string, string>()
  for (const a of agencies ?? []) {
    if (a.allstate_partner_number) partnerMap.set(a.allstate_partner_number, a.id)
  }

  // House Account rows have no real partner number — route them to the
  // Andy Makal solo agency (same as partner 0096A4)
  const houseAccountAgencyId =
    agencies?.find(a => a.slug === 'makal-andy-solo')?.id ?? null

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      import_type: 'compensation',
      filename: file.name,
      row_count: rows.length,
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return NextResponse.json({ error: 'Failed to create import batch' }, { status: 500 })
  }

  const records = []
  const unrecognized = new Set<string>()

  for (const row of rows) {
    const rawPartner = String(row['Primary Partner Number'] ?? '').trim()
    if (!rawPartner) continue

    // "House Account" rows have no real writing agent — Allstate represents them
    // as the literal text "House Account" or the code 0096CC in the partner field.
    // Both route to the Andy Makal solo agency.
    const isHouseAccount =
      rawPartner.toLowerCase() === 'house account' ||
      rawPartner === '0096CC'

    // DASH report drops the leading "A"; restore it for matching
    const fullPartner = isHouseAccount ? 'A0C4775' : 'A' + rawPartner
    const agencyId = isHouseAccount
      ? (houseAccountAgencyId ?? partnerMap.get('A0C4775') ?? null)
      : (partnerMap.get(fullPartner) ?? null)
    if (!agencyId) unrecognized.add(rawPartner)

    function parseDate(raw: unknown): string | null {
      if (raw instanceof Date) return raw.toISOString().split('T')[0]
      if (typeof raw === 'string' && raw.trim()) return raw.trim()
      return null
    }

    const credit = Number(row['Production Credit'] ?? 0)
    if (isNaN(credit)) continue

    records.push({
      import_batch_id: batch.id,
      agency_id:               agencyId,
      policy_number:           String(row['Policy Number']  ?? '').trim() || null,
      insured_name:            String(row['Insured Name']   ?? '').trim() || null,
      product:                 String(row['Product']        ?? '').trim() || null,
      production_credit:       credit,
      app_date:                parseDate(row['App Date']),
      process_date:            parseDate(row['Issued Credit Release Date']),
      allstate_partner_number: fullPartner,
      raw_row:                 row,
    })
  }

  const matchedCount   = records.filter(r => r.agency_id !== null).length
  const unmatchedCount = records.filter(r => r.agency_id === null).length

  // Deduplicate: delete existing gdc_records for each affected agency within
  // the date range covered by this import so re-importing is idempotent.
  const agencyDateRanges = new Map<string, { min: string; max: string }>()
  for (const r of records) {
    if (!r.agency_id || !r.process_date) continue
    const cur = agencyDateRanges.get(r.agency_id)
    if (!cur) {
      agencyDateRanges.set(r.agency_id, { min: r.process_date, max: r.process_date })
    } else {
      if (r.process_date < cur.min) cur.min = r.process_date
      if (r.process_date > cur.max) cur.max = r.process_date
    }
  }
  for (const [agencyId, { min, max }] of agencyDateRanges) {
    await supabase
      .from('gdc_records')
      .delete()
      .eq('agency_id', agencyId)
      .gte('process_date', min)
      .lte('process_date', max)
  }

  const CHUNK = 200
  for (let i = 0; i < records.length; i += CHUNK) {
    const { error } = await supabase.from('gdc_records').insert(records.slice(i, i + CHUNK))
    if (error) {
      console.error('gdc_records insert error:', error)
      return NextResponse.json({ error: 'Failed to insert GDC records' }, { status: 500 })
    }
  }

  await supabase
    .from('import_batches')
    .update({ matched_count: matchedCount, unmatched_count: unmatchedCount })
    .eq('id', batch.id)

  return NextResponse.json({
    batch_id:             batch.id,
    sheet_used:           sheetName,
    row_count:            rows.length,
    matched_count:        matchedCount,
    unmatched_count:      unmatchedCount,
    unrecognized_partners: Array.from(unrecognized).sort(),
  })
}
