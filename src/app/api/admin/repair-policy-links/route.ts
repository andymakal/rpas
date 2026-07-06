import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function abbrevProductType(fullName: string | null): string | null {
  if (!fullName) return null
  if (fullName.startsWith('Term'))     return 'Term'
  if (fullName.includes('Variable'))   return 'VUL'
  if (fullName.includes('Indexed'))    return 'IUL'
  if (fullName.includes('Guaranteed')) return 'GUL'
  if (fullName.includes('Universal'))  return 'UL'
  if (fullName.includes('Whole'))      return 'WL'
  if (fullName.includes('Long-Term'))  return 'LTC'
  return null
}

/**
 * POST /api/admin/repair-policy-links
 *
 * Two-pass repair that ensures every placed case with a policy number has a
 * correctly-linked service_policy record on the right customer.
 *
 * Pass 1 — Missing service_policies:
 *   Finds placed cases that have a policy_number but no service_policy with
 *   source_case_id = case.id. For each:
 *     - If a service_policy already exists with that policy_number → link it
 *       (update source_case_id + customer_id + carrier + product_type).
 *     - Otherwise → create a new service_policy.
 *
 * Pass 2 — Mislinked customer_id:
 *   Finds service_policies whose source_case_id is set but whose customer_id
 *   doesn't match the case's customer_id (covers GDC Promote duplicate-customer
 *   scenarios). Corrects customer_id and agency_id from the case.
 *
 * Safe to run multiple times — idempotent.
 */
export async function POST() {
  const supabase = createAdminClient()
  const errors: string[] = []

  // ── Pass 1: placed cases with no service_policy ──────────────────────────

  // Fetch every placed, non-test case that has a policy number and a customer
  const { data: placedCases, error: casesErr } = await supabase
    .from('cases')
    .select(`
      id, customer_id, agency_id, agent_id,
      policy_number, face_amount, annual_premium, placed_at,
      quoted_carrier, quoted_product_type,
      customers!customer_id ( first_name, last_name ),
      products ( carriers ( short_name ), product_types ( name ) )
    `)
    .eq('internal_status', 'placed')
    .eq('is_test', false)
    .not('policy_number', 'is', null)
    .not('customer_id', 'is', null)

  if (casesErr) {
    return NextResponse.json({ error: `Cases fetch failed: ${casesErr.message}` }, { status: 500 })
  }

  // Collect case IDs that already have a service_policy via source_case_id
  const { data: existingLinks } = await supabase
    .from('service_policies')
    .select('source_case_id')
    .not('source_case_id', 'is', null)
    .eq('is_test', false)

  const linkedCaseIds = new Set(
    (existingLinks ?? []).map(r => r.source_case_id as string).filter(Boolean)
  )

  // Only process cases that aren't already linked
  const unlinked = (placedCases ?? []).filter(c => !linkedCaseIds.has(c.id))

  let p1Created = 0
  let p1Linked  = 0

  for (const c of unlinked) {
    try {
      type CustomerRow = { first_name: string; last_name: string }
      type ProductRow  = {
        carriers:      { short_name: string } | null
        product_types: { name: string }       | null
      }
      const customer = c.customers as unknown as CustomerRow | null
      const product  = c.products  as unknown as ProductRow  | null

      if (!customer) continue

      const carrier = product?.carriers?.short_name
        ?? (c as unknown as Record<string, unknown>).quoted_carrier as string | null
        ?? 'Unknown'

      const productType = abbrevProductType(product?.product_types?.name ?? null)
        ?? (c as unknown as Record<string, unknown>).quoted_product_type as string | null

      const policyNumber = c.policy_number as string
      const placedAt     = c.placed_at as string | null

      // Check whether a service_policy with this policy_number already exists
      const { data: existingSp } = await supabase
        .from('service_policies')
        .select('id')
        .eq('policy_number', policyNumber)
        .maybeSingle()

      if (existingSp) {
        // Link the existing record to this case and correct the customer
        const { error: updateErr } = await supabase
          .from('service_policies')
          .update({
            source_case_id: c.id,
            customer_id:    c.customer_id,
            agency_id:      c.agency_id,
            carrier,
            product_type:   productType,
          })
          .eq('id', existingSp.id)

        if (updateErr) {
          errors.push(`Link failed for ${policyNumber}: ${updateErr.message}`)
        } else {
          p1Linked++
        }
      } else {
        // Create a fresh service_policy
        const { error: insertErr } = await supabase
          .from('service_policies')
          .insert({
            source_case_id:     c.id,
            customer_id:        c.customer_id,
            agency_id:          c.agency_id,
            agent_id:           (c.agent_id as string | null) ?? null,
            policy_number:      policyNumber,
            client_name:        `${customer.first_name} ${customer.last_name}`,
            insured_first_name: customer.first_name,
            insured_last_name:  customer.last_name,
            carrier,
            product_type:       productType,
            face_amount:        c.face_amount  ?? null,
            annual_premium:     c.annual_premium ?? null,
            issue_date:         placedAt ? placedAt.substring(0, 10) : null,
            coverage_status:    'Active',
            sa_status:          'unknown',
            is_test:            false,
          })

        if (insertErr) {
          errors.push(`Create failed for ${policyNumber}: ${insertErr.message}`)
        } else {
          p1Created++
        }
      }
    } catch (err) {
      errors.push(`Pass 1 error (case ${c.id}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Pass 2: service_policies with mislinked customer_id ──────────────────

  // Fetch all service_policies that have a source_case_id so we can verify the customer link
  const { data: linkedPolicies, error: spErr } = await supabase
    .from('service_policies')
    .select('id, customer_id, agency_id, source_case_id')
    .not('source_case_id', 'is', null)
    .eq('is_test', false)

  if (spErr) {
    errors.push(`Pass 2 fetch failed: ${spErr.message}`)
  }

  let p2Fixed = 0

  for (const sp of (linkedPolicies ?? [])) {
    try {
      const { data: linkedCase } = await supabase
        .from('cases')
        .select('customer_id, agency_id')
        .eq('id', sp.source_case_id as string)
        .single()

      if (!linkedCase?.customer_id) continue

      const needsCustomerFix = sp.customer_id !== linkedCase.customer_id
      const needsAgencyFix   = sp.agency_id   !== linkedCase.agency_id

      if (needsCustomerFix || needsAgencyFix) {
        const patch: Record<string, unknown> = {}
        if (needsCustomerFix) patch.customer_id = linkedCase.customer_id
        if (needsAgencyFix)   patch.agency_id   = linkedCase.agency_id

        const { error: fixErr } = await supabase
          .from('service_policies')
          .update(patch)
          .eq('id', sp.id)

        if (fixErr) {
          errors.push(`Pass 2 fix failed for sp ${sp.id}: ${fixErr.message}`)
        } else {
          p2Fixed++
        }
      }
    } catch (err) {
      errors.push(`Pass 2 error (sp ${sp.id}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({
    pass1: { created: p1Created, linked: p1Linked },
    pass2: { fixed:   p2Fixed },
    total: p1Created + p1Linked + p2Fixed,
    errors,
  })
}
