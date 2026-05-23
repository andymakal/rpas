import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * POST /api/customer-groups/link
 * Links two customers into the same customer group (household unit).
 *
 * Rules:
 * - Neither in a group  → create new group, assign both
 * - One in a group      → assign the other to that group
 * - Both in groups      → merge: move all members of the smaller into the larger
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

  const { data: customers, error: fetchErr } = await supabase
    .from('customers')
    .select('id, customer_group_id, agency_id, first_name, last_name')
    .in('id', [customer_id_a, customer_id_b])

  if (fetchErr || !customers || customers.length < 2) {
    return Response.json({ error: 'One or both customers not found' }, { status: 404 })
  }

  const a = customers.find(c => c.id === customer_id_a)!
  const b = customers.find(c => c.id === customer_id_b)!
  const now = new Date().toISOString()
  let groupId: string

  if (!a.customer_group_id && !b.customer_group_id) {
    const { data: grp, error: grpErr } = await supabase
      .from('customer_groups')
      .insert({ agency_id: a.agency_id ?? b.agency_id ?? null, updated_at: now })
      .select('id')
      .single()
    if (grpErr || !grp) return Response.json({ error: 'Failed to create group' }, { status: 500 })
    groupId = grp.id
    await supabase
      .from('customers')
      .update({ customer_group_id: groupId, updated_at: now })
      .in('id', [customer_id_a, customer_id_b])

  } else if (a.customer_group_id && !b.customer_group_id) {
    groupId = a.customer_group_id
    await supabase
      .from('customers')
      .update({ customer_group_id: groupId, updated_at: now })
      .eq('id', customer_id_b)

  } else if (!a.customer_group_id && b.customer_group_id) {
    groupId = b.customer_group_id
    await supabase
      .from('customers')
      .update({ customer_group_id: groupId, updated_at: now })
      .eq('id', customer_id_a)

  } else {
    // Both in groups — merge B's group into A's
    groupId   = a.customer_group_id!
    const oldId = b.customer_group_id!
    await supabase
      .from('customers')
      .update({ customer_group_id: groupId, updated_at: now })
      .eq('customer_group_id', oldId)
    await supabase.from('customer_groups').delete().eq('id', oldId)
  }

  return Response.json({ data: { customer_group_id: groupId } })
}
