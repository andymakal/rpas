import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateFlags } from '@/lib/reviews/prep'
import type { ReviewFlag } from '@/lib/reviews/prep'
import { PolicyDetailClient } from './PolicyDetailClient'

export const dynamic = 'force-dynamic'

export type HouseholdMember = { id: string; first_name: string; last_name: string }

type LinkedCustomer = { id: string; first_name: string; last_name: string } | null

export type PolicyDetail = {
  id:                   string
  client_name:          string
  policy_number:        string
  carrier:              string
  product_type:         string | null
  product_category:     string | null
  type_data:            Record<string, unknown> | null
  issue_date:           string | null
  term_length:          string | null
  face_amount:          number | null
  death_benefit_amount: number | null
  cash_value_amount:    number | null
  cost_basis:           number | null
  annual_premium:       number | null
  premium_mode:         string | null
  rate_class:           string | null
  riders:               string | null
  insured_first_name:         string | null
  insured_last_name:          string | null
  primary_beneficiary:        string | null
  contingent_beneficiary:     string | null
  coverage_status:      string
  sa_status:            string
  sa_form_sent_at:      string | null
  notes:                string | null
  customer_id:          string | null
  agency_id:            string | null
  // New linking fields
  owner_is_insured:                    boolean
  insured_customer_id:                 string | null
  primary_beneficiary_customer_id:     string | null
  contingent_beneficiary_customer_id:  string | null
  agencies: {
    id:           string
    name:         string
    display_name: string | null
  } | null
  customers: {
    id:              string
    first_name:      string
    last_name:       string
    customer_group_id: string | null
  } | null
  insured_customer:              LinkedCustomer
  primary_beneficiary_customer:  LinkedCustomer
  contingent_beneficiary_customer: LinkedCustomer
}

export type RateClassOption = { id: string; name: string }

export type PolicyReviewRow = {
  id:            string
  review_number: string
  review_type:   string
  status:        string
  assigned_to:   string | null
  created_at:    string
}

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  // Fetch policy
  const { data: policy, error } = await supabase
    .from('service_policies')
    .select(`
      id, client_name, policy_number, carrier, product_type, product_category, type_data,
      issue_date, term_length, face_amount, death_benefit_amount,
      cash_value_amount, cost_basis, annual_premium, premium_mode,
      rate_class, riders, insured_first_name, insured_last_name,
      primary_beneficiary, contingent_beneficiary, coverage_status, sa_status, sa_form_sent_at,
      notes, customer_id, agency_id,
      owner_is_insured, insured_customer_id,
      primary_beneficiary_customer_id, contingent_beneficiary_customer_id,
      agencies ( id, name, display_name ),
      customers!customer_id ( id, first_name, last_name, customer_group_id ),
      insured_customer:customers!insured_customer_id ( id, first_name, last_name ),
      primary_beneficiary_customer:customers!primary_beneficiary_customer_id ( id, first_name, last_name ),
      contingent_beneficiary_customer:customers!contingent_beneficiary_customer_id ( id, first_name, last_name )
    `)
    .eq('id', id)
    .single()

  if (error || !policy) notFound()

  // Fetch household members for the linked customer
  let householdMembers: HouseholdMember[] = []
  const customerGroupId = (policy as unknown as { customers?: { customer_group_id?: string | null } }).customers?.customer_group_id
  if (customerGroupId && policy.customer_id) {
    const { data: hm } = await supabase
      .from('customers')
      .select('id, first_name, last_name')
      .eq('customer_group_id', customerGroupId)
      .neq('id', policy.customer_id)
      .eq('is_test', false)
      .order('last_name')
    householdMembers = (hm ?? []) as HouseholdMember[]
  }

  // Fetch all agencies for dropdown
  const { data: agencies } = await supabase
    .from('agencies')
    .select('id, name, display_name')
    .order('name')

  // Fetch rate classes for dropdown
  const { data: rateClasses } = await supabase
    .from('rate_classes')
    .select('id, name')
    .order('name')

  // Fetch existing reviews for this policy
  const { data: reviews } = await supabase
    .from('policy_reviews')
    .select('id, review_number, review_type, status, assigned_to, created_at')
    .eq('policy_id', id)
    .order('created_at', { ascending: false })

  // Compute flags server-side (no PII leaves server)
  const flags: ReviewFlag[] = generateFlags(policy as Parameters<typeof generateFlags>[0])

  return (
    <PolicyDetailClient
      policy={policy as unknown as PolicyDetail}
      agencies={agencies ?? []}
      rateClasses={(rateClasses ?? []) as RateClassOption[]}
      reviews={(reviews ?? []) as PolicyReviewRow[]}
      flags={flags}
      householdMembers={householdMembers}
    />
  )
}
