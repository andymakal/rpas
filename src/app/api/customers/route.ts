import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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

function toTitleCase(str: string): string {
  return str.trim().replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const last_name = typeof body.last_name === 'string' ? toTitleCase(body.last_name) : ''
  if (!last_name) return NextResponse.json({ error: 'last_name is required' }, { status: 400 })

  const first_name = typeof body.first_name === 'string' ? toTitleCase(body.first_name) : null
  const phone      = typeof body.phone  === 'string' && body.phone.trim()  ? body.phone.trim()  : null
  const email      = typeof body.email  === 'string' && body.email.trim()  ? body.email.trim().toLowerCase() : null

  const { data, error } = await supabase
    .from('customers')
    .insert({ first_name, last_name, phone, email, is_test: false })
    .select('id, first_name, last_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
