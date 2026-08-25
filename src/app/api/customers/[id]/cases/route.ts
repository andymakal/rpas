import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * GET /api/customers/[id]/cases
 * Returns all referral-tier cases for a customer (for case-level merge UI).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params
  const supabase = createAdminClient()

  const { data: cases, error } = await supabase
    .from('cases')
    .select('id, created_at, internal_status, agency_id, agencies ( name, display_name )')
    .eq('customer_id', customerId)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Fetch touch counts separately
  const ids = (cases ?? []).map(c => c.id)
  const { data: touches } = ids.length
    ? await supabase.from('case_touches').select('case_id').in('case_id', ids)
    : { data: [] }
  const touchMap = new Map<string, number>()
  for (const t of (touches ?? [])) {
    touchMap.set(t.case_id, (touchMap.get(t.case_id) ?? 0) + 1)
  }

  type RawAgency = { name: string; display_name: string | null } | null
  type RawCase   = { id: string; created_at: string; internal_status: string; agencies: unknown }
  const data = (cases ?? []).map((c: RawCase) => {
    const ag = c.agencies as RawAgency
    return {
      id:              c.id,
      created_at:      c.created_at,
      internal_status: c.internal_status,
      agency_name:     ag?.display_name ?? ag?.name ?? 'Unknown agency',
      touch_count:     touchMap.get(c.id) ?? 0,
    }
  })

  return Response.json({ data })
}
