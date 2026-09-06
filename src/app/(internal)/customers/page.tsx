import type { Metadata } from 'next'
import CustomersClient from './CustomersClient'

export const metadata: Metadata = { title: 'Customers' }

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
  is_former_client: boolean
  is_prospect: boolean
  source_client_id: string | null
  date_of_birth: string | null
  created_at: string
  policy_count: number
}

export default function CustomersPage() {
  return <CustomersClient />
}
