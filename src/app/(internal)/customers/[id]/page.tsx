import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateFlags } from '@/lib/reviews/prep'
import { CustomerCardClient } from './CustomerCardClient'

export const dynamic = 'force-dynamic'

export type CustomerDetail = {
  id:               string
  first_name:       string
  last_name:        string
  phone:            string | null
  email:            string | null
  street:           string | null
  city:             string | null
  state:            string | null
  zip:              string | null
  date_of_birth:    string | null   // stored, displayed masked (MM/xx/YYYY)
  marital_status:   string | null
  gender:           string | null
  tobacco_use:      string | null
  preferred_language: string | null
  health_notes:     string | null
  customer_group_id: string | null
  segment:          string | null
}

export type LinkedCase = {
  id:              string
  internal_status: string
  created_at:      string
  placed_at:       string | null
  face_amount:     number | null
  annual_premium:  number | null
  policy_number:   string | null
  agencies: { name: string; display_name: string | null } | null
  stage_translations: {
    agency_label: string
    is_won:       boolean
    is_lost:      boolean
  } | null
  products: {
    name: string
    carriers: { short_name: string } | null
  } | null
}

export type LinkedPolicy = {
  id:                  string
  policy_number:       string
  client_name:         string
  carrier:             string
  product_type:        string | null
  face_amount:         number | null
  annual_premium:      number | null
  coverage_status:     string
  sa_status:           string
  sa_form_sent_at:     string | null
  primary_beneficiary: string | null
  flag_count:          number
  agencies: { name: string; display_name: string | null } | null
}

export type LinkedServiceRequest = {
  id:              string
  sr_number:       string | null
  request_type:    string
  workflow_status: string
  date_received:   string
  policy_number:   string | null
  client_name:     string | null
}

export type CaseStatusHistoryEntry = {
  id:          string
  case_id:     string
  from_status: string | null
  to_status:   string
  changed_at:  string
}

export type CustomerNote = {
  id:                  string
  section:             'triage' | 'producer' | 'underwriting'
  author_name:         string
  body:                string
  created_at:          string
  case_id:             string | null
  service_request_id:  string | null
  policy_review_id:    string | null
}

export default async function CustomerCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  // Fetch customer
  const { data: customer, error } = await supabase
    .from('customers')
    .select(`
      id, first_name, last_name, phone, email,
      street, city, state, zip,
      date_of_birth, marital_status, gender,
      tobacco_use, preferred_language, health_notes,
      customer_group_id, segment
    `)
    .eq('id', id)
    .single()

  if (error || !customer) notFound()

  // Fetch linked cases (referrals)
  const { data: cases } = await supabase
    .from('cases')
    .select(`
      id, internal_status, created_at, placed_at, face_amount, annual_premium, policy_number,
      agencies ( name, display_name ),
      stage_translations ( agency_label, is_won, is_lost ),
      products ( name, carriers ( short_name ) )
    `)
    .eq('customer_id', id)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  // Fetch linked policies
  const { data: policiesRaw } = await supabase
    .from('service_policies')
    .select(`
      id, policy_number, client_name, carrier, product_type,
      face_amount, death_benefit_amount, annual_premium, cash_value_amount, cost_basis,
      premium_mode, issue_date, term_length, rate_class, riders,
      insured_first_name, insured_last_name, primary_beneficiary,
      coverage_status, sa_status, sa_form_sent_at, source_case_id,
      agencies ( name, display_name )
    `)
    .eq('customer_id', id)
    .eq('is_test', false)
    .order('face_amount', { ascending: false, nullsFirst: false })

  // Placed cases that don't have a service_policies record yet —
  // shown in the Policies section as pending entries so the user knows to add the policy number.
  const policiedCaseIds = new Set(
    (policiesRaw ?? [])
      .map(p => (p as { source_case_id?: string | null }).source_case_id)
      .filter((x): x is string => Boolean(x))
  )
  const pendingCasePolicies = ((cases ?? []) as unknown as LinkedCase[])
    .filter(c =>
      (c.internal_status === 'placed' || Boolean(c.placed_at)) &&
      !policiedCaseIds.has(c.id)
    )

  // Compute flag counts server-side
  const policies: LinkedPolicy[] = (policiesRaw ?? []).map(p => ({
    id:              p.id,
    policy_number:   p.policy_number,
    client_name:     p.client_name,
    carrier:         p.carrier,
    product_type:    p.product_type,
    face_amount:         p.face_amount,
    annual_premium:      p.annual_premium,
    coverage_status:     p.coverage_status,
    sa_status:           p.sa_status,
    sa_form_sent_at:     p.sa_form_sent_at,
    primary_beneficiary: (p as unknown as Record<string, unknown>).primary_beneficiary as string | null ?? null,
    flag_count:          generateFlags(p as unknown as Parameters<typeof generateFlags>[0]).length,
    agencies:        (Array.isArray(p.agencies) ? p.agencies[0] : p.agencies) as { name: string; display_name: string | null } | null,
  }))

  // Fetch case status history for all linked cases
  const caseIds = (cases ?? []).map(c => c.id)
  let caseHistory: CaseStatusHistoryEntry[] = []
  if (caseIds.length > 0) {
    const { data: histRaw } = await supabase
      .from('case_status_history')
      .select('id, case_id, from_status, to_status, changed_at')
      .in('case_id', caseIds)
      .order('changed_at', { ascending: false })
    caseHistory = (histRaw ?? []) as CaseStatusHistoryEntry[]
  }

  // Fetch customer notes (running compliance log)
  const { data: notesRaw } = await supabase
    .from('customer_notes')
    .select('id, section, author_name, body, created_at, case_id, service_request_id, policy_review_id')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })

  const notes: CustomerNote[] = (notesRaw ?? []) as CustomerNote[]

  // Fetch service requests via linked policy IDs
  const policyIds = (policiesRaw ?? []).map(p => p.id)
  let serviceRequests: LinkedServiceRequest[] = []

  if (policyIds.length > 0) {
    const { data: srRaw } = await supabase
      .from('service_requests')
      .select(`
        id, sr_number, request_type, workflow_status, date_received,
        service_policies ( policy_number, client_name )
      `)
      .in('policy_id', policyIds)
      .order('date_received', { ascending: false })
      .limit(20)

    serviceRequests = (srRaw ?? []).map(sr => {
      const spRaw = sr.service_policies
      const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as { policy_number: string; client_name: string } | null
      return {
        id:              sr.id,
        sr_number:       sr.sr_number,
        request_type:    sr.request_type,
        workflow_status: sr.workflow_status,
        date_received:   sr.date_received,
        policy_number:   sp?.policy_number ?? null,
        client_name:     sp?.client_name ?? null,
      }
    })
  }

  return (
    <CustomerCardClient
      customer={customer as CustomerDetail}
      cases={(cases ?? []) as unknown as LinkedCase[]}
      policies={policies}
      pendingCasePolicies={pendingCasePolicies}
      serviceRequests={serviceRequests}
      caseHistory={caseHistory}
      initialNotes={notes}
    />
  )
}
