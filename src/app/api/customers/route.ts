import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createAdminClient()

  const PAGE = 1000
  const allData: Record<string, unknown>[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, email, city, state, segment, is_emoney_client, is_deceased, is_former_client, is_prospect, source_client_id, date_of_birth, created_at, service_policies(count)')
      .eq('is_test', false)
      .order('last_name')
      .order('first_name')
      .range(from, from + PAGE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    allData.push(...(data as Record<string, unknown>[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  const customers = allData.map(c => {
    const sp = c.service_policies as { count: number }[] | null
    const { service_policies: _, ...rest } = c
    return { ...rest, policy_count: sp?.[0]?.count ?? 0 }
  })

  return NextResponse.json(customers)
}
