import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * DELETE /api/customer-groups/[id]/members/[customerId]
 * Removes a customer from a group.
 * If only one member remains after removal, the group record is dissolved.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> }
) {
  const { id: groupId, customerId } = await params
  const supabase = createAdminClient()

  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('id, customer_group_id')
    .eq('id', customerId)
    .single()

  if (fetchErr || !customer) {
    return Response.json({ error: 'Customer not found' }, { status: 404 })
  }
  if (customer.customer_group_id !== groupId) {
    return Response.json({ error: 'Customer is not in this group' }, { status: 400 })
  }

  const now = new Date().toISOString()

  await supabase
    .from('customers')
    .update({ customer_group_id: null, updated_at: now })
    .eq('id', customerId)

  const { count } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('customer_group_id', groupId)

  // Dissolve the group if 0 or 1 members remain
  if ((count ?? 0) <= 1) {
    await supabase
      .from('customers')
      .update({ customer_group_id: null, updated_at: now })
      .eq('customer_group_id', groupId)
    await supabase.from('customer_groups').delete().eq('id', groupId)
  }

  return Response.json({ ok: true })
}
