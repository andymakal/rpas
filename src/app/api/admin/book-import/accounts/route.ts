import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AccountRow = {
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

export async function POST(req: NextRequest) {
  let body: { accounts: AccountRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { accounts } = body
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json({ error: 'accounts must be a non-empty array' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Dedup: check which policy_numbers already exist
  const allNumbers   = accounts.map(a => a.policy_number)
  const existingSet  = new Set<string>()
  const LOOKUP_CHUNK = 500

  for (let i = 0; i < allNumbers.length; i += LOOKUP_CHUNK) {
    const { data } = await supabase
      .from('service_policies')
      .select('policy_number')
      .in('policy_number', allNumbers.slice(i, i + LOOKUP_CHUNK))
    for (const r of data ?? []) existingSet.add(r.policy_number)
  }

  // Build source_client_id → customer_id map
  const clientIds = [...new Set(accounts.map(a => a.source_client_id).filter(Boolean))]
  const clientMap = new Map<string, string>()

  for (let i = 0; i < clientIds.length; i += LOOKUP_CHUNK) {
    const { data } = await supabase
      .from('customers')
      .select('id, source_client_id')
      .in('source_client_id', clientIds.slice(i, i + LOOKUP_CHUNK))
    for (const r of data ?? []) {
      if (r.source_client_id) clientMap.set(r.source_client_id, r.id)
    }
  }

  const toInsert:  Record<string, unknown>[] = []
  // already_on_file rows that have a known customer → relink customer_id
  // grouped by customer_id so we can batch: one UPDATE per customer, not per policy
  const relinkMap  = new Map<string, string[]>()  // customer_id → policy_numbers[]
  let   alreadyOnFile   = 0
  let   unmatchedClient = 0

  for (const row of accounts) {
    const customerId = clientMap.get(row.source_client_id) ?? null

    if (existingSet.has(row.policy_number)) {
      if (customerId) {
        const arr = relinkMap.get(customerId) ?? []
        arr.push(row.policy_number)
        relinkMap.set(customerId, arr)
      } else {
        alreadyOnFile++
      }
      continue
    }

    if (!customerId) { unmatchedClient++; continue }

    toInsert.push({
      customer_id:        customerId,
      client_name:        row.client_name || null,
      carrier:            row.carrier,
      source_carrier_raw: row.source_carrier_raw,
      policy_number:      row.policy_number,
      product_type:       row.product_type || null,
      product_category:   row.product_category,
      plan_type:          row.plan_type,
      issue_date:         row.issue_date,
      account_value:      row.account_value,
      coverage_status:    row.coverage_status || 'Active',
      sa_status:          'unknown',
      is_test:            false,
    })
  }

  const errors: string[] = []
  let   inserted = 0
  const CHUNK    = 200

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase.from('service_policies').insert(toInsert.slice(i, i + CHUNK))
    if (error) {
      errors.push(`Accounts insert rows ${i + 1}–${i + CHUNK}: ${error.message}`)
    } else {
      inserted += toInsert.slice(i, i + CHUNK).length
    }
  }

  // Relink existing policies to their correct customer — one UPDATE per customer,
  // processing in chunks if a single customer has many policies
  let relinked = 0
  for (const [customerId, policyNumbers] of relinkMap) {
    for (let i = 0; i < policyNumbers.length; i += CHUNK) {
      const chunk = policyNumbers.slice(i, i + CHUNK)
      const { error } = await supabase
        .from('service_policies')
        .update({ customer_id: customerId })
        .in('policy_number', chunk)
      if (error) {
        errors.push(`Relink customer ${customerId}: ${error.message}`)
      } else {
        relinked += chunk.length
      }
    }
  }

  return NextResponse.json({
    inserted,
    relinked,
    already_on_file:  alreadyOnFile,
    unmatched_client: unmatchedClient,
    errors: errors.length ? errors : undefined,
  })
}
