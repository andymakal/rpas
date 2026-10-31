import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/policy-import
 *
 * Accepts pre-parsed policy rows from the client (browser parses the Excel,
 * sends only structured JSON — avoids Turbopack dev server body size limits
 * and removes XLSX from the server bundle).
 *
 * Body: {
 *   policies:          PolicyRow[]
 *   file_name:         string
 *   master_sheet:      string | null
 *   sheet_stats:       SheetStat[]
 *   skipped_annuities: number
 *   skipped_no_id:     number
 * }
 */

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
  insured_dob:          string | null   // full date, only when precision is 'exact'
  insured_dob_year:     number | null
  insured_dob_month:    number | null
  insured_dob_precision: 'exact' | 'month_year' | 'year_only' | 'missing'
  insured_state:        string | null
  policy_termination_date: string | null
  owner_phone:          string | null
  owner_dob_approx:     string | null
  writing_agent_name:   string | null
  coverage_status:      string
  sa_status:            'unknown'
  is_test:              false
}

export async function POST(req: NextRequest) {
  // This route is excluded from the proxy matcher (large request bodies), so it
  // must verify the logged-in internal user itself before any service-role work.
  const sessionClient = await createClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    policies:          PolicyRow[]
    file_name:         string
    master_sheet:      string | null
    skipped_annuities: number
    skipped_no_id:     number
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { policies, file_name, skipped_annuities, skipped_no_id } = body

  if (!Array.isArray(policies)) {
    return NextResponse.json({ error: 'policies must be an array' }, { status: 400 })
  }

  // ── Check for existing policies — chunked to avoid URL length limits ─────────
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

  // ── Chunked insert ────────────────────────────────────────────────────────────
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
    file_name,
    total_parsed:      policies.length,
    inserted:          insertedCount,
    already_on_file:   onFile.length,
    skipped_annuities,
    skipped_no_id,
    errors:            errors.length ? errors : undefined,
  })
}
