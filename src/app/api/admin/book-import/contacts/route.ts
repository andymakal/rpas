import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ContactRow = {
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
  segment:           string | null
}

function normalizePhone(v: string | null): string | null {
  if (!v) return null
  const digits = v.replace(/\D/g, '').slice(-10)
  return digits.length === 10 ? digits : null
}

function normalizeLastName(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

function birthYear(dob: string | null): number | null {
  if (!dob) return null
  const y = parseInt(dob.slice(0, 4), 10)
  return isNaN(y) ? null : y
}

export async function POST(req: NextRequest) {
  let body: { contacts: ContactRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { contacts } = body
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return NextResponse.json({ error: 'contacts must be a non-empty array' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Load all existing customers for matching (last_name, birth_year, phone, email, source_client_id)
  const { data: existing } = await supabase
    .from('customers')
    .select('id, last_name, date_of_birth, phone, email, source_client_id, segment')
    .eq('is_test', false)

  // Build lookup maps — each map value is the customer id
  const byClientId   = new Map<string, string>()  // source_client_id → id
  const byNameYear   = new Map<string, string>()  // last_name_lower+birth_year → id
  const byPhone      = new Map<string, string>()  // normalized 10-digit phone → id
  const byEmail      = new Map<string, string>()  // email_lower → id

  for (const c of existing ?? []) {
    if (c.source_client_id) byClientId.set(c.source_client_id, c.id)

    const nameLower = normalizeLastName(c.last_name ?? '')
    const yr        = birthYear(c.date_of_birth)
    if (nameLower && yr) byNameYear.set(`${nameLower}|${yr}`, c.id)

    const ph = normalizePhone(c.phone)
    if (ph) byPhone.set(ph, c.id)

    if (c.email) byEmail.set(c.email.toLowerCase().trim(), c.id)
  }

  const toInsert: Record<string, unknown>[] = []
  const toUpdate: { id: string; patch: Record<string, unknown> }[] = []
  let skipped = 0

  for (const row of contacts) {
    if (!row.last_name || !row.source_client_id) { skipped++; continue }

    // 1. Already matched from a prior import run
    let existingId = byClientId.get(row.source_client_id) ?? null

    // 2. Last name + birth year
    if (!existingId) {
      const nameLower = normalizeLastName(row.last_name)
      const yr        = birthYear(row.date_of_birth)
      if (nameLower && yr) existingId = byNameYear.get(`${nameLower}|${yr}`) ?? null
    }

    // 3. Phone
    if (!existingId) {
      const ph = normalizePhone(row.phone)
      if (ph) existingId = byPhone.get(ph) ?? null
    }

    // 4. Email
    if (!existingId && row.email) {
      existingId = byEmail.get(row.email.toLowerCase().trim()) ?? null
    }

    if (existingId) {
      // Update flags on the matched customer — don't overwrite name/address
      const ex = (existing ?? []).find(c => c.id === existingId)
      const patch: Record<string, unknown> = {}
      if (!ex?.source_client_id) patch.source_client_id = row.source_client_id
      if (row.is_emoney_client)  patch.is_emoney_client = true
      if (row.is_deceased)       patch.is_deceased       = true
      // Only set segment if currently null
      if (!ex?.segment && row.segment) patch.segment = row.segment

      if (Object.keys(patch).length > 0) {
        toUpdate.push({ id: existingId, patch })
      } else {
        toUpdate.push({ id: existingId, patch: {} }) // still count as matched
      }
    } else {
      toInsert.push({
        first_name:        row.first_name || null,
        last_name:         row.last_name,
        street:            row.street,
        city:              row.city,
        state:             row.state,
        zip:               row.zip,
        phone:             row.phone,
        email:             row.email,
        date_of_birth:     row.date_of_birth,
        source_client_id:  row.source_client_id,
        is_deceased:       row.is_deceased,
        is_emoney_client:  row.is_emoney_client,
        segment:           row.segment,
        is_test:           false,
      })
    }
  }

  const errors: string[] = []
  let created = 0
  const CHUNK = 200

  // Batch insert new customers
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase.from('customers').insert(toInsert.slice(i, i + CHUNK))
    if (error) {
      errors.push(`Contacts insert rows ${i + 1}–${i + CHUNK}: ${error.message}`)
    } else {
      created += toInsert.slice(i, i + CHUNK).length
    }
  }

  // Apply updates (only rows with actual changes)
  const realUpdates = toUpdate.filter(u => Object.keys(u.patch).length > 0)
  for (const { id, patch } of realUpdates) {
    const { error } = await supabase.from('customers').update(patch).eq('id', id)
    if (error) errors.push(`Update customer ${id}: ${error.message}`)
  }

  return NextResponse.json({
    created,
    matched: toUpdate.length,
    skipped,
    errors:  errors.length ? errors : undefined,
  })
}
