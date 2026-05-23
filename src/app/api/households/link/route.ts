import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * POST /api/households/link
 * Links two customers into the same household.
 *
 * Rules:
 * - Neither in a household → create new household, assign both
 * - One in a household    → assign the other to that household
 * - Both in households    → merge: move all members of the smaller into the larger
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: { customer_id_a?: string; customer_id_b?: string } = {}
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { customer_id_a, customer_id_b } = body
  if (!customer_id_a || !customer_id_b) {
    return Response.json({ error: 'customer_id_a and customer_id_b are required' }, { status: 400 })
  }
  if (customer_id_a === customer_id_b) {
    return Response.json({ error: 'Cannot link a customer to themselves' }, { status: 400 })
  }

  // Fetch both customers
  const { data: customers, error: fetchErr } = await supabase
    .from('customers')
    .select('id, household_id, agency_id, first_name, last_name')
    .in('id', [customer_id_a, customer_id_b])

  if (fetchErr || !customers || customers.length < 2) {
    return Response.json({ error: 'One or both customers not found' }, { status: 404 })
  }

  const a = customers.find(c => c.id === customer_id_a)!
  const b = customers.find(c => c.id === customer_id_b)!

  const now = new Date().toISOString()
  let householdId: string

  if (!a.household_id && !b.household_id) {
    // Neither has a household — create one
    const { data: hh, error: hhErr } = await supabase
      .from('households')
      .insert({ agency_id: a.agency_id ?? b.agency_id ?? null, updated_at: now })
      .select('id')
      .single()
    if (hhErr || !hh) return Response.json({ error: 'Failed to create household' }, { status: 500 })
    householdId = hh.id
    await supabase
      .from('customers')
      .update({ household_id: householdId, updated_at: now })
      .in('id', [customer_id_a, customer_id_b])

  } else if (a.household_id && !b.household_id) {
    // A has a household, B does not
    householdId = a.household_id
    await supabase
      .from('customers')
      .update({ household_id: householdId, updated_at: now })
      .eq('id', customer_id_b)

  } else if (!a.household_id && b.household_id) {
    // B has a household, A does not
    householdId = b.household_id
    await supabase
      .from('customers')
      .update({ household_id: householdId, updated_at: now })
      .eq('id', customer_id_a)

  } else {
    // Both already in households — merge B's household into A's
    householdId = a.household_id!
    const oldId  = b.household_id!
    await supabase
      .from('customers')
      .update({ household_id: householdId, updated_at: now })
      .eq('household_id', oldId)
    // Clean up the now-empty household
    await supabase.from('households').delete().eq('id', oldId)
  }

  return Response.json({ data: { household_id: householdId } })
}
