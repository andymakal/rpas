import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/admin'

// Full state name → 2-letter abbreviation
const STATE_ABBR: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
}

function stateAbbr(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 2) return trimmed.toUpperCase()       // already an abbr
  return STATE_ABBR[trimmed] ?? null
}

function firstPhone(...candidates: string[]): string | null {
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    }
    if (digits.length === 11 && digits[0] === '1') {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
    }
  }
  return null
}

// Folder tag → internal_status, checked in priority order (most-advanced first)
const FOLDER_STATUS_PRIORITY: [string, string][] = [
  ['placed',              'placed'],
  ['not interested',      'client_withdrew'],
  ['app submitted',       'app_submitted'],
  ['quoted',              'quoted'],
  ['appt set',            'appointment_set'],
  ['appt missed',         'appointment_missed'],
  ['*lsp contact needed', 'appointment_missed'],
  ['working',             'lsp_contact_needed'],
]

function parseFolders(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean)
}

function statusFromFolders(folders: string[]): string {
  const lower = folders.map(f => f.toLowerCase())
  for (const [tag, status] of FOLDER_STATUS_PRIORITY) {
    if (lower.some(f => f === tag)) return status
  }
  return 'lsp_contact_needed'
}

function isManualEntry(folders: string[]): boolean {
  const lower = folders.map(f => f.toLowerCase())
  return lower.some(f =>
    f.includes('service request') || f.includes('policy review')
  )
}

function leadSourceFromFolders(folders: string[]): 'agency_referral' | 'allstate_web' {
  const lower = folders.map(f => f.toLowerCase())
  if (lower.some(f => f.includes('a.com') || f === 'acom lead')) return 'allstate_web'
  return 'agency_referral'
}

function normalizeAgencyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(agency|inc|llc|corp|company|co|the|ins|financial|services|group)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buffer = await file.arrayBuffer()
  const text   = Buffer.from(buffer).toString('utf-8')

  const workbook = XLSX.read(text, { type: 'string' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })

  if (rows.length === 0) {
    return NextResponse.json({ error: 'CSV appears to be empty or could not be parsed' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: agencies } = await supabase
    .from('agencies')
    .select('id, name, slug')
    .eq('is_active', true)

  const agencyByNorm = new Map<string, string>()
  for (const a of agencies ?? []) {
    agencyByNorm.set(normalizeAgencyName(a.name), a.id)
  }

  function matchAgency(csvName: string): string | null {
    const norm = normalizeAgencyName(csvName)
    if (agencyByNorm.has(norm)) return agencyByNorm.get(norm)!

    // If name looks like "Last, First" (Lead Manager format), try "First Last" too
    if (csvName.includes(',')) {
      const [last, first] = csvName.split(',').map(s => s.trim())
      const flipped = normalizeAgencyName(`${first} ${last}`)
      if (agencyByNorm.has(flipped)) return agencyByNorm.get(flipped)!
      for (const [key, id] of agencyByNorm.entries()) {
        if (key.includes(flipped) || flipped.includes(key)) return id
      }
    }

    if (norm.length >= 4) {
      for (const [key, id] of agencyByNorm.entries()) {
        if (key.includes(norm) || norm.includes(key)) return id
      }
    }
    return null
  }

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({ import_type: 'lead_manager', filename: file.name, row_count: rows.length })
    .select('id')
    .single()

  if (batchError || !batch) {
    return NextResponse.json({ error: 'Failed to create import batch' }, { status: 500 })
  }

  let casesCreated     = 0
  let customersCreated = 0
  let customersUpdated = 0
  let skippedManual    = 0
  let skippedDuplicate = 0
  const unmatchedAgencies = new Set<string>()
  const errors: string[] = []

  const customerCache = new Map<string, string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]

    try {
      const firstName  = String(row['First Name']             ?? '').trim()
      const lastName   = String(row['Last Name']              ?? '').trim()
      const agencyName = String(row['Agency Name']            ?? '').trim()
      const lspName    = String(row['Referring LSP Name']     ?? '').trim()
      const policyNum  = String(row['Policy Number']          ?? '').trim() || null
      const foldersRaw = String(row['Folders']                ?? '').trim()
      const leadUrl    = String(row['URL']                    ?? '').trim() || null

      // Contact fields — new in this export
      const phone  = firstPhone(
        String(row['Home Phone']  ?? ''),
        String(row['Cell Phone']  ?? ''),
        String(row['Work Phone']  ?? ''),
      )
      const email  = String(row['Primary Email Address'] ?? '').trim().toLowerCase() || null
      const street = String(row['Address 1']             ?? '').trim() || null
      const city   = String(row['City']                  ?? '').trim() || null
      const state  = stateAbbr(String(row['State/Province'] ?? ''))
      const zip    = String(row['Zip Code']              ?? '').trim() || null

      if (!firstName && !lastName) continue

      // Idempotency: skip rows already imported via their Lead Manager URL
      if (leadUrl) {
        const { count } = await supabase
          .from('intake_raw')
          .select('id', { count: 'exact', head: true })
          .eq('source', 'csv_import')
          .contains('raw_data', { URL: leadUrl })

        if ((count ?? 0) > 0) {
          skippedDuplicate++
          continue
        }
      }

      const folders = parseFolders(foldersRaw)

      if (isManualEntry(folders)) {
        skippedManual++
        await supabase.from('intake_raw').insert({
          source:   'csv_import',
          raw_data: { ...row, _batch_id: batch.id, _reason: 'manual_entry_required' },
        })
        continue
      }

      const agencyId = agencyName ? matchAgency(agencyName) : null
      if (!agencyId && agencyName) unmatchedAgencies.add(agencyName)

      const cacheKey = `${agencyId ?? ''}:${firstName.toLowerCase()}:${lastName.toLowerCase()}`
      let customerId = customerCache.get(cacheKey) ?? null

      if (!customerId) {
        let query = supabase
          .from('customers')
          .select('id, phone, email, street')
          .ilike('first_name', firstName)
          .ilike('last_name',  lastName)

        query = agencyId
          ? query.eq('agency_id', agencyId)
          : query.is('agency_id', null)

        const { data: existing } = await query.maybeSingle()

        if (existing) {
          customerId = existing.id

          // Back-fill contact info on existing customers if they're missing it
          const contactUpdate: Record<string, unknown> = {}
          if (!existing.phone  && phone)  contactUpdate.phone  = phone
          if (!existing.email  && email)  contactUpdate.email  = email
          if (!existing.street && street) {
            contactUpdate.street = street
            if (city)  contactUpdate.city  = city
            if (state) contactUpdate.state = state
            if (zip)   contactUpdate.zip   = zip
          }

          if (Object.keys(contactUpdate).length > 0) {
            await supabase.from('customers').update(contactUpdate).eq('id', existing.id)
            customersUpdated++
          }
        } else {
          const { data: newCust, error: custErr } = await supabase
            .from('customers')
            .insert({
              first_name: firstName,
              last_name:  lastName,
              agency_id:  agencyId,
              phone,
              email,
              street,
              city,
              state,
              zip,
            })
            .select('id')
            .single()

          if (custErr || !newCust) {
            errors.push(`Row ${i + 2}: could not create customer ${firstName} ${lastName} — ${custErr?.message}`)
            continue
          }

          customerId = newCust.id
          customersCreated++
        }

        customerCache.set(cacheKey, customerId as string)
      }

      if (!customerId) continue

      const internalStatus = statusFromFolders(folders)
      const leadSource     = leadSourceFromFolders(folders)
      const notes          = lspName ? `Referring LSP: ${lspName}` : null

      const { error: caseErr } = await supabase.from('cases').insert({
        agency_id:       agencyId,
        customer_id:     customerId,
        internal_status: internalStatus,
        lead_source:     leadSource,
        policy_number:   policyNum,
        notes,
      })

      if (caseErr) {
        errors.push(`Row ${i + 2}: could not create case for ${firstName} ${lastName} — ${caseErr.message}`)
        continue
      }

      casesCreated++

      await supabase.from('intake_raw').insert({
        agency_id:    agencyId,
        source:       'csv_import',
        raw_data:     { ...row, _batch_id: batch.id },
        processed_at: new Date().toISOString(),
      })
    } catch (err) {
      errors.push(`Row ${i + 2}: unexpected error — ${String(err)}`)
    }
  }

  await supabase
    .from('import_batches')
    .update({
      matched_count:   casesCreated,
      unmatched_count: unmatchedAgencies.size + skippedManual,
      notes: skippedManual > 0
        ? `${skippedManual} rows flagged for manual entry (service requests / policy reviews)`
        : null,
    })
    .eq('id', batch.id)

  // Single summary notification for the whole import
  if (casesCreated > 0 || errors.length > 0) {
    const parts = [`${casesCreated} case${casesCreated !== 1 ? 's' : ''} created`]
    if (customersCreated > 0) parts.push(`${customersCreated} new customer${customersCreated !== 1 ? 's' : ''}`)
    if (unmatchedAgencies.size > 0) parts.push(`${unmatchedAgencies.size} unmatched agenc${unmatchedAgencies.size !== 1 ? 'ies' : 'y'}`)
    if (errors.length > 0) parts.push(`${errors.length} error${errors.length !== 1 ? 's' : ''}`)

    await supabase.from('notifications').insert({
      type:  'lead_import',
      title: `Lead import: ${file.name}`,
      body:  parts.join(' · '),
      link:  '/admin/lead-import',
    })
  }

  return NextResponse.json({
    batch_id:           batch.id,
    total_rows:         rows.length,
    customers_created:  customersCreated,
    customers_updated:  customersUpdated,
    cases_created:      casesCreated,
    skipped_manual:     skippedManual,
    skipped_duplicate:  skippedDuplicate,
    unmatched_agencies: Array.from(unmatchedAgencies).sort(),
    errors,
  })
}
