import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'

const STATUS_MAP: Record<string, string> = {
  'quote':       'quoted',
  'application': 'app_submitted',
  'incomplete':  'app_submitted',
  'pending':     'in_underwriting',
  'approved':    'approved',
  'issued':      'issued',
  'placed':      'placed',
}

function parseName(raw: string): { first: string; last: string } | null {
  if (!raw?.trim()) return null
  // Handle "Lastname, Firstname" — split on first comma only
  const idx = raw.indexOf(',')
  if (idx === -1) return null
  return {
    last:  raw.slice(0, idx).trim(),
    first: raw.slice(idx + 1).trim().split(' ')[0], // take first word only ("and child" etc.)
  }
}

function normalizeAgentName(raw: string): string {
  return raw
    .replace(/\s*-\s*(PA|NJ|VA|AL|RI|CT|NH|KS|MO)\s*$/i, '')
    .replace(',', '')
    .toLowerCase()
    .trim()
}

type SheetRow = {
  'Client Name'?:         string
  'Account'?:             string
  'Agent'?:               string
  'Status'?:              string
  'Company'?:             string
  'Product'?:             string
  'Face Amount'?:         number
  'Target Premium'?:      number
  'Requirements Needed'?: string
  'Notes'?:               string
  'Date Submitted'?:      string | number
}

type RowResult = {
  row:      number
  client:   string
  outcome:  'updated' | 'created' | 'skipped'
  detail:   string
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: null, range: 2 })

  const [
    { data: customers },
    { data: agencies },
    { data: requirements },
    { data: products },
  ] = await Promise.all([
    supabase.from('customers').select('id, first_name, last_name'),
    supabase.from('agencies').select('id, name, display_name, slug'),
    supabase.from('pending_requirements').select('id, name'),
    supabase.from('products').select('id, name'),
  ])

  // Customer lookup — key: "last|first"
  const customerMap = new Map<string, string>()
  for (const c of customers ?? []) {
    const key = `${c.last_name.toLowerCase().trim()}|${c.first_name.toLowerCase().trim()}`
    customerMap.set(key, c.id)
  }

  // Agency lookup — normalized display name and slug
  const agencyMap = new Map<string, string>()
  for (const a of agencies ?? []) {
    agencyMap.set(normalizeAgentName(a.display_name ?? a.name), a.id)
    agencyMap.set((a.slug ?? '').replace(/-/g, ' '), a.id)
  }

  const requirementMap = new Map<string, string>()
  for (const r of requirements ?? []) {
    requirementMap.set(r.name.toLowerCase().trim(), r.id)
  }

  const productMap = new Map<string, string>()
  for (const p of products ?? []) {
    productMap.set(p.name.toLowerCase().trim(), p.id)
  }

  const results: RowResult[] = []
  let updated = 0
  let created = 0
  let skipped = 0

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    const clientRaw = String(row['Client Name'] ?? '').trim()
    if (!clientRaw || clientRaw === 'Client Name') continue

    const name = parseName(clientRaw)
    if (!name) {
      skipped++
      results.push({ row: i + 4, client: clientRaw, outcome: 'skipped', detail: 'Could not parse name — fix manually' })
      continue
    }

    // Resolve agency
    const agentRaw = String(row['Agent'] ?? '').trim()
    const agentNorm = normalizeAgentName(agentRaw)
    let agencyId: string | null = agencyMap.get(agentNorm) ?? null
    if (!agencyId && agentNorm) {
      const lastName = agentNorm.split(' ')[0]
      for (const [key, id] of agencyMap) {
        if (lastName.length >= 4 && key.startsWith(lastName)) { agencyId = id; break }
      }
    }

    // Resolve product
    const productRaw = String(row['Product'] ?? '').trim().toLowerCase()
    const productId = productMap.get(productRaw) ?? null

    const statusRaw = String(row['Status'] ?? '').trim().toLowerCase()
    const internalStatus = STATUS_MAP[statusRaw] ?? 'app_submitted'

    const account     = String(row['Account'] ?? '').trim() || null
    const notes       = String(row['Notes'] ?? '').trim() || null
    const faceAmount  = row['Face Amount']   ? Number(row['Face Amount'])   : null
    const premium     = row['Target Premium'] ? Number(row['Target Premium']) : null
    const reqRaw      = String(row['Requirements Needed'] ?? '').trim()

    // ── Find or create customer ──────────────────────────────────────────────
    const customerKey = `${name.last.toLowerCase()}|${name.first.toLowerCase()}`
    let customerId = customerMap.get(customerKey) ?? null

    if (!customerId) {
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert({
          first_name: name.first,
          last_name:  name.last,
          agency_id:  agencyId,
        })
        .select('id')
        .single()

      if (newCustomer) {
        customerId = newCustomer.id
        customerMap.set(customerKey, newCustomer.id)
      }
    }

    if (!customerId) {
      skipped++
      results.push({ row: i + 4, client: clientRaw, outcome: 'skipped', detail: 'Could not create customer' })
      continue
    }

    // ── Find or create case ──────────────────────────────────────────────────
    const { data: cases } = await supabase
      .from('cases')
      .select('id, internal_status, agency_id')
      .eq('customer_id', customerId)
      .eq('is_test', false)
      .order('created_at', { ascending: false })

    const caseFields: Record<string, unknown> = {
      internal_status:   internalStatus,
      status_entered_at: new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    }
    if (productId)   caseFields.product_id    = productId
    if (faceAmount)  caseFields.face_amount   = faceAmount
    if (premium)     caseFields.annual_premium = premium
    if (account)     caseFields.policy_number = account
    if (notes)       caseFields.notes         = notes
    if (internalStatus === 'placed') caseFields.placed_at = new Date().toISOString()

    let caseId: string

    const existingCase = cases?.find(c =>
      c.internal_status !== 'placed' &&
      c.internal_status !== 'carrier_declined' &&
      c.internal_status !== 'client_withdrew'
    ) ?? cases?.[0]

    if (existingCase) {
      if (agencyId && !existingCase.agency_id) caseFields.agency_id = agencyId
      await supabase.from('cases').update(caseFields).eq('id', existingCase.id)
      caseId = existingCase.id
      updated++
      results.push({
        row: i + 4, client: clientRaw, outcome: 'updated',
        detail: `→ ${internalStatus}${agencyId ? '' : ' (agency unmatched)'}`,
      })
    } else {
      // Create a brand new case
      if (agencyId) caseFields.agency_id = agencyId
      caseFields.customer_id  = customerId
      caseFields.lead_source  = 'agency_referral'
      caseFields.is_test      = false
      caseFields.created_at   = new Date().toISOString()

      const { data: newCase } = await supabase
        .from('cases')
        .insert(caseFields)
        .select('id')
        .single()

      if (!newCase) {
        skipped++
        results.push({ row: i + 4, client: clientRaw, outcome: 'skipped', detail: 'Could not create case' })
        continue
      }
      caseId = newCase.id
      created++
      results.push({
        row: i + 4, client: clientRaw, outcome: 'created',
        detail: `→ ${internalStatus}${agencyId ? '' : ' (agency unmatched)'}`,
      })
    }

    // ── Attach pending requirement ────────────────────────────────────────────
    if (reqRaw) {
      const reqId = requirementMap.get(reqRaw.toLowerCase())
      if (reqId) {
        await supabase
          .from('case_pending_requirements')
          .upsert(
            { case_id: caseId, pending_requirement_id: reqId, resolved_at: null },
            { onConflict: 'case_id,pending_requirement_id' }
          )
      }
    }
  }

  const skippedRows = results.filter(r => r.outcome === 'skipped')

  return Response.json({
    total:   raw.length,
    updated,
    created,
    skipped,
    skipped_rows: skippedRows,
  })
}
