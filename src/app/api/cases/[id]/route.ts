import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const ALLOWED_FIELDS = new Set([
  'internal_status',
  'agency_id',
  'agent_id',
  'producer_id',
  'product_id',
  'allstate_policy_number',
  'face_amount',
  'quoted_carrier',
  'quoted_product_type',
  'annual_premium',
  'rate_class_id',
  'premium_mode_id',
  'policy_number',
  'appointment_date',
  'appointment_time',
  'follow_up_date',
  'placed_at',
  'submitted_at',       // manual override for imported cases
  'status_entered_at',  // manual override for imported cases
  'created_at',         // manual override for imported cases
  'notes',
  'lost_reason_id',
  'snooze_reason_id',
  'snooze_until',
  'table_rating',
  'is_hot_lead',
  'is_imported',
  'lead_source',
  'suspected_duplicate_customer_id',  // null to dismiss the duplicate flag
])

// Maps product_types.name (long form) → service_policies.product_type (short form)
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
 * When a case is placed AND a policy_number is recorded, auto-create (or sync)
 * a service_policies row so the policy appears on Customer Cards and is
 * selectable in Policy Reviews. Runs after the case PATCH succeeds.
 *
 * Fires on:
 *   - internal_status → 'placed'
 *   - policy_number / face_amount / annual_premium updates on an already-placed case
 *
 * Both orderings work: place-then-number or number-then-place.
 */
async function promoteCaseToPolicy(
  supabase: ReturnType<typeof createAdminClient>,
  caseId:   string,
  updates:  Record<string, unknown>
): Promise<void> {
  const relevant =
    updates.internal_status === 'placed' ||
    updates.policy_number   !== undefined ||
    updates.face_amount     !== undefined ||
    updates.annual_premium  !== undefined

  if (!relevant) return

  // Fetch case in its post-update state (update already applied to DB)
  const { data: c } = await supabase
    .from('cases')
    .select(`
      internal_status, policy_number, face_amount, annual_premium,
      quoted_carrier, quoted_product_type,
      customer_id, agency_id, agent_id,
      customers!customer_id (first_name, last_name),
      products (carriers (short_name), product_types (name))
    `)
    .eq('id', caseId)
    .single()

  if (!c)                             return
  if (c.internal_status !== 'placed') return
  if (!c.policy_number?.trim())       return
  if (!c.customer_id)                 return

  type ProductRow = { carriers: { short_name: string } | null; product_types: { name: string } | null }
  type CustomerRow = { first_name: string; last_name: string }

  const product  = c.products  as unknown as ProductRow  | null
  const customer = c.customers as unknown as CustomerRow | null

  // Use products table carrier if linked, fall back to the quoted_carrier text field
  const carrier = product?.carriers?.short_name
    ?? (c as unknown as Record<string, unknown>).quoted_carrier as string | null
    ?? 'Unknown'

  if (!customer) return

  const productType = abbrevProductType(product?.product_types?.name ?? null)
    ?? (c as unknown as Record<string, unknown>).quoted_product_type as string | null

  // One service_policy per case (unique index on source_case_id enforces this)
  const { data: existing } = await supabase
    .from('service_policies')
    .select('id')
    .eq('source_case_id', caseId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('service_policies')
      .update({
        policy_number:  c.policy_number,
        face_amount:    c.face_amount    ?? null,
        annual_premium: c.annual_premium ?? null,
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('service_policies').insert({
      source_case_id:     caseId,
      client_name:        `${customer.first_name} ${customer.last_name}`,
      policy_number:      c.policy_number,
      carrier:            carrier,
      product_type:       productType,
      face_amount:        c.face_amount    ?? null,
      annual_premium:     c.annual_premium ?? null,
      insured_first_name: customer.first_name,
      insured_last_name:  customer.last_name,
      customer_id:        c.customer_id,
      agency_id:          (c.agency_id as string | null) ?? null,
      agent_id:           (c.agent_id  as string | null) ?? null,
      coverage_status:    'Active',
      sa_status:          'unknown',
      is_test:            false,
    })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) updates[key] = val
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  if (updates.internal_status !== undefined) {
    const { data: stage, error: stageErr } = await supabase
      .from('stage_translations')
      .select('internal_status')
      .eq('internal_status', updates.internal_status)
      .single()

    if (stageErr || !stage) {
      return Response.json({ error: 'Invalid internal_status' }, { status: 400 })
    }

    // Record status history + notification on placed
    const { data: current } = await supabase
      .from('cases')
      .select('internal_status, face_amount, submitted_at, customer_id')
      .eq('id', id)
      .single()

    if (current && current.internal_status !== updates.internal_status) {
      await supabase.from('case_status_history').insert({
        case_id:     id,
        from_status: current.internal_status,
        to_status:   updates.internal_status as string,
      })
    }

    updates.status_entered_at = new Date().toISOString()

    // Stamp submitted_at the first time a case reaches app_submitted
    if (updates.internal_status === 'app_submitted' && !current?.submitted_at) {
      updates.submitted_at = new Date().toISOString()
    }

    if (updates.internal_status === 'placed' && !updates.placed_at) {
      updates.placed_at = new Date().toISOString()
      let clientName = 'Unknown'
      const customerId = current?.customer_id as string | null
      if (customerId) {
        const { data: custRow } = await supabase
          .from('customers')
          .select('first_name, last_name')
          .eq('id', customerId)
          .single()
        if (custRow) clientName = `${custRow.first_name} ${custRow.last_name}`
      }
      const faceAmt = (updates.face_amount ?? current?.face_amount) as number | null
      await supabase.from('notifications').insert({
        type:  'case_placed',
        title: `Policy placed: ${clientName}`,
        body:  faceAmt
          ? `Face amount: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(faceAmt)}`
          : null,
        link:  `/cases/${id}`,
      })
    }
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('cases')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Case update error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Auto-promote placed case to service_policies (non-blocking — case update already succeeded)
  promoteCaseToPolicy(supabase, id, updates).catch(err =>
    console.error('promote-to-policy error:', err)
  )

  return Response.json({ data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()
  // Child records (case_touches, case_status_history, case_pending_requirements,
  // spiff_records, case_household_members) all have ON DELETE CASCADE.
  // intake_raw.case_id and policy_reviews.resulting_case_id are ON DELETE SET NULL.
  const { error } = await supabase.from('cases').delete().eq('id', id)
  if (error) {
    console.error('Case delete error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ success: true })
}
