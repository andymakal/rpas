import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { normalizePhone } from '@/lib/fmt'

/**
 * POST /api/customer-groups/create-and-link
 *
 * Creates a brand-new customer record, links them into the same household
 * group as an existing customer, and opens a triage case for them.
 *
 * Body:
 *   first_name           string  (required)
 *   last_name            string  (required)
 *   phone                string  (optional)
 *   agency_id            string  (optional — falls back to existing customer's agency)
 *   existing_customer_id string  (required — the customer to household-link with)
 *
 * Returns:
 *   { data: { new_customer_id, case_id, customer_group_id } }
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: {
    first_name?: string
    last_name?:  string
    phone?:      string
    agency_id?:  string | null
    existing_customer_id?: string
  } = {}
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { first_name, last_name, phone, agency_id, existing_customer_id } = body

  if (!first_name?.trim() || !last_name?.trim()) {
    return Response.json({ error: 'First and last name are required' }, { status: 400 })
  }
  if (!existing_customer_id) {
    return Response.json({ error: 'existing_customer_id is required' }, { status: 400 })
  }

  // Fetch existing customer to inherit agency and group
  const { data: existing } = await supabase
    .from('customers')
    .select('id, customer_group_id, agency_id')
    .eq('id', existing_customer_id)
    .single()

  if (!existing) {
    return Response.json({ error: 'Existing customer not found' }, { status: 404 })
  }

  const resolvedAgencyId = agency_id ?? existing.agency_id ?? null
  const now = new Date().toISOString()

  // 1. Create the new customer record
  const { data: newCustomer, error: custErr } = await supabase
    .from('customers')
    .insert({
      first_name: first_name.trim(),
      last_name:  last_name.trim(),
      phone:      phone?.trim() ? (normalizePhone(phone) ?? phone.trim()) : null,
      agency_id:  resolvedAgencyId,
      is_test:    false,
    })
    .select('id')
    .single()

  if (custErr || !newCustomer) {
    console.error('create-and-link customer error:', custErr)
    return Response.json({ error: 'Failed to create customer record' }, { status: 500 })
  }

  // 2. Resolve household group — join existing or create new
  let groupId: string

  if (existing.customer_group_id) {
    groupId = existing.customer_group_id
    await supabase
      .from('customers')
      .update({ customer_group_id: groupId, updated_at: now })
      .eq('id', newCustomer.id)
  } else {
    const { data: grp, error: grpErr } = await supabase
      .from('customer_groups')
      .insert({ agency_id: resolvedAgencyId, updated_at: now })
      .select('id')
      .single()
    if (grpErr || !grp) {
      return Response.json({ error: 'Failed to create household group' }, { status: 500 })
    }
    groupId = grp.id
    await supabase
      .from('customers')
      .update({ customer_group_id: groupId, updated_at: now })
      .in('id', [existing_customer_id, newCustomer.id])
  }

  // 3. Phone-based duplicate detection — same logic as the portal submission path.
  //    Flag the case so triage staff can decide whether to merge or proceed.
  let suspectedDuplicateId: string | null = null
  const normalizedPhone = phone?.trim() ? (normalizePhone(phone) ?? null) : null
  if (normalizedPhone) {
    const { data: phoneMatch } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('is_test', false)
      .neq('id', newCustomer.id)
      .limit(1)
      .maybeSingle()
    if (phoneMatch) suspectedDuplicateId = phoneMatch.id
  }

  // 4. Create a triage case for the new customer
  const { data: newCase, error: caseErr } = await supabase
    .from('cases')
    .insert({
      customer_id:                     newCustomer.id,
      agency_id:                       resolvedAgencyId,
      internal_status:                 'triage',
      lead_source:                     'agency_referral',
      suspected_duplicate_customer_id: suspectedDuplicateId,
      is_test:                         false,
    })
    .select('id')
    .single()

  if (caseErr || !newCase) {
    console.error('create-and-link case error:', caseErr)
    return Response.json({ error: 'Customer created but case creation failed' }, { status: 500 })
  }

  return Response.json({
    data: {
      new_customer_id:   newCustomer.id,
      case_id:           newCase.id,
      customer_group_id: groupId,
    },
  })
}
