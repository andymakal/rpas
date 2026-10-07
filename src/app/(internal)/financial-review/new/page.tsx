import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { NewFinancialReviewClient } from './NewFinancialReviewClient'

export const metadata: Metadata = { title: 'New Financial Review' }

export default async function NewFinancialReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { customer_id } = await searchParams

  let initialCustomer: { id: string; first_name: string; last_name: string; phone: string | null; city: string | null; state: string | null; customer_group_id: string | null } | null = null

  if (customer_id) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, city, state, customer_group_id')
      .eq('id', customer_id)
      .single()
    initialCustomer = data ?? null
  }

  return <NewFinancialReviewClient initialCustomer={initialCustomer} />
}
