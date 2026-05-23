import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * GET /api/customers/search?q=...&agency_id=...&exclude=...
 * Search customers by name for the household link flow.
 * Returns up to 10 matches.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q         = searchParams.get('q')?.trim() ?? ''
  const agencyId  = searchParams.get('agency_id') ?? ''
  const excludeId = searchParams.get('exclude') ?? ''

  if (q.length < 2) {
    return Response.json({ data: [] })
  }

  const supabase = createAdminClient()

  let query = supabase
    .from('customers')
    .select(`
      id, first_name, last_name, phone, household_id,
      cases ( id, internal_status, stage_translations ( agency_label, is_won, is_lost ) )
    `)
    .eq('is_test', false)
    .ilike('last_name', `%${q}%`)
    .order('last_name')
    .order('first_name')
    .limit(10)

  if (agencyId) query = query.eq('agency_id', agencyId)
  if (excludeId) query = query.neq('id', excludeId)

  const { data, error } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: data ?? [] })
}
