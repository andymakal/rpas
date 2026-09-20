import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { FinancialReviewClient } from './FinancialReviewClient'

export const dynamic = 'force-dynamic'

export type ParsedContract = {
  contract_number: string | null
  carrier: string
  product_name: string | null
  annuity_type: string | null
  owner: string
  joint_owner: string | null
  insured: string | null
  account_type: string | null
  issue_date: string | null
  valuation_date: string | null
  account_value: number | null
  surrender_value: number | null
  initial_premium: number | null
  total_premiums_paid: number | null
  cost_basis: number | null
  surrender_period: string | null
  surrender_schedule: { year: number; charge_pct: number }[]
  current_surrender_charge_pct: number | null
  current_surrender_charge_amt: number | null
  free_withdrawal_pct: number | null
  income_benefit: {
    rider_name: string | null
    benefit_base: number | null
    guaranteed_rollup_rate: number | null
    withdrawal_pct: number | null
    annual_income: number | null
    income_start_date: string | null
    income_status: string | null
  } | null
  notes: string | null
}

export type UploadedDocument = {
  filename: string
  uploaded_at: string
  mode: 'statement' | 'info' | 'url'
  url?: string
}

export type FinancialReviewDetail = {
  id: string
  review_number: string | null
  status: string
  contracts: ParsedContract[]
  documents: UploadedDocument[]
  recommendation_notes: string | null
  created_at: string
  updated_at: string | null
  customer_id: string | null
  customers: {
    id: string
    first_name: string
    last_name: string
    city: string | null
    state: string | null
    phone: string | null
    email: string | null
    date_of_birth: string | null
    customer_group_id: string | null
  } | null
}

export type RpasPolicy = {
  id: string
  client_name: string
  policy_number: string
  carrier: string
  product_type: string | null
  product_category: string | null
  face_amount: number | null
  cash_value_amount: number | null
  annual_premium: number | null
  sa_status: string
}

export type HouseholdMember = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('financial_reviews')
    .select('review_number, customers(first_name, last_name)')
    .eq('id', id)
    .single()
  const d = data as { review_number: string | null; customers: { first_name: string; last_name: string } | null } | null
  const name = d?.customers ? `${d.customers.first_name} ${d.customers.last_name}` : 'Financial Review'
  return { title: `${d?.review_number ?? 'Review'} — ${name}` }
}

export default async function FinancialReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: review, error } = await supabase
    .from('financial_reviews')
    .select(`
      id, review_number, status, contracts, documents, recommendation_notes, created_at, updated_at,
      customer_id,
      customers ( id, first_name, last_name, city, state, phone, email, date_of_birth, customer_group_id )
    `)
    .eq('id', id)
    .single()

  if (error || !review) notFound()

  const rd = review as unknown as FinancialReviewDetail
  const customerId = rd.customer_id
  const householdId = rd.customers?.customer_group_id ?? null

  // Fetch RPAS context in parallel
  const [{ data: policies }, { data: householdRaw }] = await Promise.all([
    customerId
      ? supabase
          .from('service_policies')
          .select('id, client_name, policy_number, carrier, product_type, product_category, face_amount, cash_value_amount, annual_premium, sa_status')
          .eq('customer_id', customerId)
          .eq('is_test', false)
          .order('created_at', { ascending: false })
      : { data: [] },
    householdId
      ? supabase
          .from('customers')
          .select('id, first_name, last_name, phone')
          .eq('customer_group_id', householdId)
          .neq('id', customerId ?? '')
          .eq('is_test', false)
      : { data: [] },
  ])

  return (
    <FinancialReviewClient
      review={rd}
      rpasId={id}
      policies={(policies as unknown as RpasPolicy[]) ?? []}
      householdMembers={(householdRaw as unknown as HouseholdMember[]) ?? []}
    />
  )
}
