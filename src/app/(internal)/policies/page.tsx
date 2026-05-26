import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { PoliciesClient } from './PoliciesClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Policies' }

export type PolicyListRow = {
  id:               string
  client_name:      string
  policy_number:    string
  carrier:          string
  product_type:     string | null
  face_amount:      number | null
  annual_premium:   number | null
  cash_value_amount: number | null
  issue_date:       string | null
  term_length:      string | null
  rate_class:       string | null
  coverage_status:  string
  sa_status:        string
  sa_form_sent_at:  string | null
  customer_id:      string | null
  agency_id:        string | null
  agencies:         { name: string; display_name: string | null } | null
  customers:        { first_name: string; last_name: string } | null
}

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sa?: string; type?: string }>
}) {
  const { q, sa, type } = await searchParams
  const supabase = createAdminClient()

  let query = supabase
    .from('service_policies')
    .select(`
      id, client_name, policy_number, carrier, product_type,
      face_amount, annual_premium, cash_value_amount,
      issue_date, term_length, rate_class,
      coverage_status, sa_status, sa_form_sent_at,
      customer_id, agency_id,
      agencies ( name, display_name ),
      customers ( first_name, last_name )
    `)
    .eq('is_test', false)
    .order('face_amount', { ascending: false, nullsFirst: false })
    .limit(300)

  if (q?.trim()) {
    // search by name or policy number
    query = query.or(
      `client_name.ilike.%${q.trim()}%,policy_number.ilike.%${q.trim()}%`
    )
  }
  if (sa)   query = query.eq('sa_status', sa)
  if (type) query = query.eq('product_type', type)

  const { data, error } = await query

  if (error) console.error('Policies fetch error:', error)

  return (
    <PoliciesClient
      rows={(data as unknown as PolicyListRow[]) ?? []}
      activeQ={q ?? ''}
      activeSa={sa ?? ''}
      activeType={type ?? ''}
    />
  )
}
