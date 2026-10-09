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

  // Build source_client_id → customer map. We pull the owner's identifying
  // fields too (name, exact DOB, state) so new policies can apply the
  // owner-as-insured rule: a book-import account never identifies a separate
  // insured, so the linked customer (the owner) IS the insured.
  const clientIds = [...new Set(accounts.map(a => a.source_client_id).filter(Boolean))]
  const clientMap = new Map<string, string>()
  const ownerMap  = new Map<string, {
    first_name: string | null
    last_name: string | null
    date_of_birth: string | null
    state: string | null
  }>()

  for (let i = 0; i < clientIds.length; i += LOOKUP_CHUNK) {
    const { data } = await supabase
      .from('customers')
      .select('id, source_client_id, first_name, last_name, date_of_birth, state')
      .in('source_client_id', clientIds.slice(i, i + LOOKUP_CHUNK))
    for (const r of data ?? []) {
      if (r.source_client_id) {
        clientMap.set(r.source_client_id, r.id)
        ownerMap.set(r.source_client_id, {
          first_name: r.first_name ?? null,
          last_name: r.last_name ?? null,
          date_of_birth: r.date_of_birth ?? null,
          state: r.state ?? null,
        })
      }
    }
  }

  // Build the insured_* columns for a new policy from its owner/customer, per
  // the owner-as-insured rule. Book-import accounts carry no explicit insured,
  // so the owner is the insured. DOB is stored at the precision actually known:
  // customers hold either a full date ('exact') or nothing ('missing') — no day
  // is ever invented. A 2-letter state is passed through; anything else drops.
  function insuredFromOwner(sourceClientId: string): Record<string, unknown> {
    const owner = ownerMap.get(sourceClientId)
    if (!owner) {
      return { insured_dob_precision: 'missing' }
    }
    const dob = owner.date_of_birth // 'YYYY-MM-DD' or null
    let insuredDob: string | null = null
    let year: number | null = null
    let month: number | null = null
    let precision: 'exact' | 'missing' = 'missing'
    const m = dob?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) {
      insuredDob = dob
      year  = Number(m[1])
      month = Number(m[2])
      precision = 'exact'
    }
    const stUp = (owner.state ?? '').toUpperCase()
    const insuredState = /^[A-Z]{2}$/.test(stUp) ? stUp : null
    return {
      insured_first_name:    owner.first_name,
      insured_last_name:     owner.last_name,
      insured_dob:           insuredDob,
      insured_dob_year:      year,
      insured_dob_month:     month,
      insured_dob_precision: precision,
      insured_state:         insuredState,
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
      // Owner-as-insured: the linked customer is the insured for this account.
      ...insuredFromOwner(row.source_client_id),
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
