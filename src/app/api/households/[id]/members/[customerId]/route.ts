import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * DELETE /api/households/[id]/members/[customerId]
 * Removes a customer from a household.
 * If only one member remains after removal, the household record is cleaned up.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> }
) {
  const { id: householdId, customerId } = await params
  const supabase = createAdminClient()

  // Verify the customer is actually in this household
  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('id, household_id')
    .eq('id', customerId)
    .single()

  if (fetchErr || !customer) {
    return Response.json({ error: 'Customer not found' }, { status: 404 })
  }
  if (customer.household_id !== householdId) {
    return Response.json({ error: 'Customer is not in this household' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Remove from household
  await supabase
    .from('customers')
    .update({ household_id: null, updated_at: now })
    .eq('id', customerId)

  // Count remaining members
  const { count } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)

  // If 0 or 1 members remain, dissolve the household entirely
  if ((count ?? 0) <= 1) {
    await supabase
      .from('customers')
      .update({ household_id: null, updated_at: now })
      .eq('household_id', householdId)
    await supabase.from('households').delete().eq('id', householdId)
  }

  return Response.json({ ok: true })
}
