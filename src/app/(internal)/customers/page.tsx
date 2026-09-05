import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import CustomersClient from './CustomersClient'

export const metadata: Metadata = { title: 'Customers' }

export const dynamic = 'force-dynamic'

export type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string
  phone: string | null
  email: string | null
  city: string | null
  state: string | null
  segment: string | null
  is_emoney_client: boolean
  is_deceased: boolean
  source_client_id: string | null
  date_of_birth: string | null
  created_at: string
  policy_count: number
}

export default async function CustomersPage() {
  const supabase = createAdminClient()

  // Paginate to bypass Supabase's server-side max_rows cap (default 1000)
  const PAGE = 1000
  const allData: Record<string, unknown>[] = []
  let from = 0
  let fetchError: { message: string } | null = null

  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, email, city, state, segment, is_emoney_client, is_deceased, source_client_id, date_of_birth, created_at, service_policies(count)')
      .eq('is_test', false)
      .order('last_name')
      .order('first_name')
      .range(from, from + PAGE - 1)

    if (error) { fetchError = error; break }
    if (!data || data.length === 0) break
    allData.push(...(data as Record<string, unknown>[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  if (fetchError) {
    console.error('Customers fetch error:', fetchError)
    return (
      <div className="p-6 text-red-400">
        Failed to load customers: {fetchError.message}
      </div>
    )
  }

  const customers = allData.map(c => {
    const sp = c.service_policies as { count: number }[] | null
    return { ...(c as CustomerRow), policy_count: sp?.[0]?.count ?? 0 }
  })

  return <CustomersClient customers={customers} />
}
