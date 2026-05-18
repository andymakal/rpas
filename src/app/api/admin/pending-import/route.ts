import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'

// Maps spreadsheet Status values to internal_status codes
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
  // "Lastname, Firstname" or "Lastname-Compound, Firstname"
  const parts = raw.trim().split(',')
  if (parts.length < 2) return null
  return {
    last:  parts[0].trim(),
    first: parts[1].trim(),
  }
}

function normalizeAgentName(raw: string): string {
  // "Lastname, Firstname - STATE" → "lastname firstname"
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
  row:     number
  client:  string
  outcome: 'updated' | 'no_case' | 'no_customer' | 'skipped'
  detail:  string
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

  // Pre-load all lookup data in parallel
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

  const customerMap = new Map<string, string>()
  for (const c of customers ?? []) {
    const key = `${c.last_name.toLowerCase().trim()}|${c.first_name.toLowerCase().trim()}`
    customerMap.set(key, c.id)
  }

  const agencyMap = new Map<string, string>()
  for (const a of agencies ?? []) {
    const displayNorm = normalizeAgentName(a.display_name ?? a.name)
    agencyMap.set(displayNorm, a.id)
    // Also index by slug words for broader matching
    const slugNorm = (a.slug ?? '').replace(/-/g, ' ')
    agencyMap.set(slugNorm, a.id)
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
  let noCustomer = 0
  let noCase = 0
  let skipped = 0

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    const clientRaw = String(row['Client Name'] ?? '').trim()
    if (!clientRaw || clientRaw === 'Client Name') continue

    const name = parseName(clientRaw)
    if (!name) {
      skipped++
      results.push({ row: i + 4, client: clientRaw, outcome: 'skipped', detail: 'Could not parse name' })
      continue
    }

    const customerKey = `${name.last.toLowerCase()}|${name.first.toLowerCase()}`
    const customerId = customerMap.get(customerKey)

    if (!customerId) {
      noCustomer++
      results.push({ row: i + 4, client: clientRaw, outcome: 'no_customer', detail: 'Customer not found in database' })
      continue
    }

    // Find case for this customer — prefer most recent non-placed case
    const { data: cases } = await supabase
      .from('cases')
      .select('id, internal_status, agency_id')
      .eq('customer_id', customerId)
      .eq('is_test', false)
      .order('created_at', { ascending: false })

    if (!cases || cases.length === 0) {
      noCase++
      results.push({ row: i + 4, client: clientRaw, outcome: 'no_case', detail: 'No case found for this customer' })
      continue
    }

    // Pick best matching case: prefer one not already placed/lost/snoozed
    const targetCase = cases.find(c =>
      c.internal_status !== 'placed' &&
      c.internal_status !== 'carrier_declined' &&
      c.internal_status !== 'client_withdrew'
    ) ?? cases[0]

    const statusRaw = String(row['Status'] ?? '').trim().toLowerCase()
    const internalStatus = STATUS_MAP[statusRaw] ?? 'app_submitted'

    // Resolve agency from agent name
    const agentRaw = String(row['Agent'] ?? '').trim()
    const agentNorm = normalizeAgentName(agentRaw)
    let agencyId: string | null = agencyMap.get(agentNorm) ?? null

    // Fallback: match on last name only
    if (!agencyId && agentNorm) {
      const lastName = agentNorm.split(',')[0]?.trim() ?? agentNorm.split(' ')[0]
      for (const [key, id] of agencyMap) {
        if (key.startsWith(lastName) || key.includes(lastName)) {
          agencyId = id
          break
        }
      }
    }

    // Resolve product
    const productRaw = String(row['Product'] ?? '').trim().toLowerCase()
    const productId = productMap.get(productRaw) ?? null

    // Build update
    const updates: Record<string, unknown> = {
      internal_status:   internalStatus,
      status_entered_at: new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    }

    if (agencyId && !targetCase.agency_id) updates.agency_id = agencyId
    if (productId)                           updates.product_id = productId
    if (row['Face Amount'])                  updates.face_amount = Number(row['Face Amount'])
    if (row['Target Premium'])               updates.annual_premium = Number(row['Target Premium'])

    const account = String(row['Account'] ?? '').trim()
    if (account) updates.policy_number = account

    const notes = String(row['Notes'] ?? '').trim()
    if (notes) updates.notes = notes

    if (internalStatus === 'placed') updates.placed_at = new Date().toISOString()

    await supabase.from('cases').update(updates).eq('id', targetCase.id)

    // Add pending requirement if present
    const reqRaw = String(row['Requirements Needed'] ?? '').trim().toLowerCase()
    if (reqRaw) {
      const reqId = requirementMap.get(reqRaw)
      if (reqId) {
        await supabase
          .from('case_pending_requirements')
          .upsert(
            { case_id: targetCase.id, pending_requirement_id: reqId, resolved_at: null },
            { onConflict: 'case_id,pending_requirement_id' }
          )
      }
    }

    updated++
    results.push({
      row:     i + 4,
      client:  clientRaw,
      outcome: 'updated',
      detail:  `→ ${internalStatus}${agencyId ? '' : ' (agency unmatched)'}`,
    })
  }

  return Response.json({
    total:       raw.length,
    updated,
    no_customer: noCustomer,
    no_case:     noCase,
    skipped,
    rows:        results,
  })
}
