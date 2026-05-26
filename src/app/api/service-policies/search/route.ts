import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * GET /api/service-policies/search?q=&unlinked_only=true
 *
 * Search service_policies by policy_number or client_name.
 * Used by the Customer Card to find and link policies.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q            = searchParams.get('q')?.trim() ?? ''
  const unlinkedOnly = searchParams.get('unlinked_only') === 'true'

  if (q.length < 2) {
    return Response.json({ data: [] })
  }

  const supabase = createAdminClient()

  let query = supabase
    .from('service_policies')
    .select('id, policy_number, client_name, carrier, product_type, face_amount, customer_id')
    .eq('is_test', false)
    .or(`policy_number.ilike.%${q}%,client_name.ilike.%${q}%`)
    .order('face_amount', { ascending: false, nullsFirst: false })
    .limit(10)

  if (unlinkedOnly) {
    query = query.is('customer_id', null)
  }

  const { data, error } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: data ?? [] })
}
