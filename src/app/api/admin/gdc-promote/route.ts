import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
}

function parseInsuredName(raw: string): { first: string; last: string } {
  const s = raw.trim()
  if (s.includes(',')) {
    // "SMITH, JOHN" or "SMITH, JOHN A"
    const [rawLast, rawRest] = s.split(',', 2)
    const first = rawRest.trim().split(/\s+/)[0] ?? ''
    return { last: toTitleCase(rawLast.trim()), first: toTitleCase(first) }
  }
  // "JOHN SMITH" or "JOHN A SMITH"
  const parts = s.split(/\s+/)
  if (parts.length === 1) return { first: '', last: toTitleCase(parts[0]) }
  return {
    first: toTitleCase(parts[0]),
    last:  toTitleCase(parts[parts.length - 1]),
  }
}

function parseCarrier(product: string | null): string {
  if (!product) return 'Allstate Life'
  const p = product.toUpperCase()
  if (p.includes('LINCOLN'))           return 'Lincoln Financial'
  if (p.includes('JOHN HANCOCK'))      return 'John Hancock'
  if (p.includes('COREBRIDGE'))        return 'Corebridge Financial'
  if (p.includes('PRUDENTIAL'))        return 'Prudential'
  if (p.includes('PROTECTIVE'))        return 'Protective Life'
  if (p.includes('BANNER'))            return 'Banner Life'
  if (p.includes('PACIFIC LIFE'))      return 'Pacific Life'
  if (p.includes('AMERICAN GENERAL'))  return 'American General'
  if (p.includes('FORESTERS'))         return 'Foresters Financial'
  if (p.includes('SAMMONS'))           return 'Sammons Financial'
  if (p.startsWith('EQU ') || p.includes('EQUITABLE')) return 'Equitable'
  return 'Allstate Life'
}

function parseProductType(product: string | null): string | null {
  if (!product) return null
  const p = product.toUpperCase()
  if (p.includes('INDEXED UNIVERSAL') || p.includes('IUL')) return 'IUL'
  if (p.includes('VARIABLE UNIVERSAL') || p.includes('VUL')) return 'VUL'
  if (p.includes('UNIVERSAL LIFE') || /\bUL\b/.test(p))     return 'UL'
  if (p.includes('WHOLE LIFE') || /\bWL\b/.test(p))         return 'WL'
  if (p.includes('TERM'))                                    return 'Term'
  if (
    p.includes('ANNUIT') || p.includes('INDEX-LINKED') || p.includes('FIXED INDEXED') ||
    /\bVA\b/.test(p) || p.startsWith('EQU ')
  ) return 'Annuity'
  return null
}

export async function POST() {
  const supabase  = createAdminClient()
  const year      = new Date().getFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd   = `${year}-12-31`

  // New-business-only GDC records for the year: policy_count = 1 means Allstate counted it
  // as an app. Renewals, MF trails, and chargebacks all have policy_count = 0 or -1.
  const { data: gdcRows, error: gdcErr } = await supabase
    .from('gdc_records')
    .select('policy_number, insured_name, product, app_date, process_date, agency_id')
    .gte('process_date', yearStart)
    .lte('process_date', yearEnd)
    .eq('policy_count', 1)
    .not('agency_id', 'is', null)
    .not('policy_number', 'is', null)

  if (gdcErr) return NextResponse.json({ error: gdcErr.message }, { status: 500 })

  // Deduplicate by policy_number — one entry per policy
  const seenPolicies = new Set<string>()
  const unique = (gdcRows ?? []).filter(r => {
    if (!r.policy_number || seenPolicies.has(r.policy_number)) return false
    seenPolicies.add(r.policy_number)
    return true
  })

  if (unique.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, customers_created: 0, errors: [] })
  }

  // Which policy numbers already have a case?
  const policyNumbers = unique.map(r => r.policy_number as string)
  const { data: existingCases } = await supabase
    .from('cases')
    .select('id, policy_number')
    .in('policy_number', policyNumbers)

  const existingPolicies = new Set(
    (existingCases ?? []).map(c => c.policy_number).filter(Boolean)
  )
  const existingCaseIdByPolicy = new Map(
    (existingCases ?? []).map(c => [c.policy_number as string, c.id as string])
  )

  let created = 0
  let skipped = 0
  let customersCreated = 0
  const errors: string[] = []

  for (const row of unique) {
    const policyNumber = row.policy_number as string

    if (existingPolicies.has(policyNumber)) {
      // Case exists — still correct the carrier/product_type on any linked service_policy
      const { data: existingSp } = await supabase
        .from('service_policies')
        .select('id')
        .eq('policy_number', policyNumber)
        .maybeSingle()
      if (existingSp) {
        await supabase
          .from('service_policies')
          .update({
            carrier:      parseCarrier(row.product),
            product_type: parseProductType(row.product),
            source_case_id: existingCaseIdByPolicy.get(policyNumber) ?? null,
          })
          .eq('id', existingSp.id)
      }
      skipped++
      continue
    }

    try {
      const { first, last } = parseInsuredName(row.insured_name ?? '')
      const agencyId        = row.agency_id as string
      const placedAt        = (row.process_date ?? row.app_date) as string | null

      // Match existing customer within the same agency by name
      let customerId: string | null = null
      if (last) {
        const { data: match } = await supabase
          .from('customers')
          .select('id')
          .eq('agency_id', agencyId)
          .ilike('last_name', last)
          .ilike('first_name', first || '%')
          .limit(1)
          .maybeSingle()
        customerId = match?.id ?? null
      }

      // Create customer if no match
      if (!customerId) {
        const { data: newCust, error: custErr } = await supabase
          .from('customers')
          .insert({
            agency_id:       agencyId,
            first_name:      first || 'Unknown',
            last_name:       last  || 'Unknown',
            is_test:         false,
          })
          .select('id')
          .single()

        if (custErr || !newCust) {
          errors.push(`Customer create failed for "${row.insured_name}": ${custErr?.message}`)
          continue
        }
        customerId = newCust.id
        customersCreated++
      }

      // Create placed case
      const { data: newCase, error: caseErr } = await supabase
        .from('cases')
        .insert({
          customer_id:     customerId,
          agency_id:       agencyId,
          internal_status: 'placed',
          placed_at:       placedAt,
          policy_number:   policyNumber,
          lead_source:     'agency_referral',
          is_test:         false,
        })
        .select('id')
        .single()

      if (caseErr || !newCase) {
        errors.push(`Case create failed for policy ${policyNumber}: ${caseErr?.message}`)
        continue
      }

      // Create or link service_policies record.
      // If a legacy service_policy already exists for this policy_number (e.g. from
      // a CSV import), update it in place rather than inserting a duplicate.
      const clientName = [first, last].filter(Boolean).join(' ') || row.insured_name || 'Unknown'
      const { data: existingSp } = await supabase
        .from('service_policies')
        .select('id')
        .eq('policy_number', policyNumber)
        .maybeSingle()

      if (existingSp) {
        const { error: spErr } = await supabase
          .from('service_policies')
          .update({
            source_case_id: newCase.id,
            customer_id:    customerId,
            agency_id:      agencyId,
            carrier:        parseCarrier(row.product),
            product_type:   parseProductType(row.product),
          })
          .eq('id', existingSp.id)
        if (spErr) errors.push(`Service policy link failed for ${policyNumber}: ${spErr.message}`)
      } else {
        const { error: spErr } = await supabase
          .from('service_policies')
          .insert({
            customer_id:    customerId,
            agency_id:      agencyId,
            source_case_id: newCase.id,
            policy_number:  policyNumber,
            client_name:    clientName,
            carrier:        parseCarrier(row.product),
            product_type:   parseProductType(row.product),
            issue_date:     placedAt,
            coverage_status: 'active',
            sa_status:      'unknown',
            is_test:        false,
          })
        if (spErr) errors.push(`Service policy create failed for ${policyNumber}: ${spErr.message}`)
      }

      created++
    } catch (err) {
      errors.push(`Unexpected error for ${row.policy_number}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({ created, skipped, customers_created: customersCreated, errors })
}
