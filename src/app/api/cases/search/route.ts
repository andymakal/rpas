import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return Response.json({ data: [] })

  const supabase = createAdminClient()

  // Search placed cases by policy number
  const policyPromise = supabase
    .from('cases')
    .select('id, policy_number, placed_at, customers!customer_id ( first_name, last_name ), products ( name, carriers ( short_name ) )')
    .not('placed_at', 'is', null)
    .eq('is_test', false)
    .ilike('policy_number', `%${q}%`)
    .limit(8)

  // Search by customer name: first find matching customer ids, then fetch their cases
  const custPromise = supabase
    .from('customers')
    .select('id')
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
    .limit(20)

  const [policyRes, custRes] = await Promise.all([policyPromise, custPromise])

  const rows: unknown[] = [...(policyRes.data ?? [])]
  const seen = new Set((policyRes.data ?? []).map((r: { id: string }) => r.id))

  if (custRes.data && custRes.data.length > 0) {
    const custIds = custRes.data.map(c => c.id)
    const { data: byCust } = await supabase
      .from('cases')
      .select('id, policy_number, placed_at, customers!customer_id ( first_name, last_name ), products ( name, carriers ( short_name ) )')
      .not('placed_at', 'is', null)
      .eq('is_test', false)
      .in('customer_id', custIds)
      .limit(8)
    for (const r of byCust ?? []) {
      if (!seen.has((r as { id: string }).id)) {
        rows.push(r)
        seen.add((r as { id: string }).id)
      }
    }
  }

  return Response.json({ data: rows.slice(0, 10) })
}
