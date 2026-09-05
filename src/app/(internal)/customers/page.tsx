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
}

export default async function CustomersPage() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, phone, email, city, state, segment, is_emoney_client, is_deceased, source_client_id, date_of_birth, created_at')
    .eq('is_test', false)
    .order('last_name')
    .order('first_name')

  if (error) {
    console.error('Customers fetch error:', error)
    return (
      <div className="p-6 text-red-400">
        Failed to load customers: {error.message}
      </div>
    )
  }

  return <CustomersClient customers={data ?? []} />
}
