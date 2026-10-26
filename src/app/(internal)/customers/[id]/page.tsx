import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateFlags } from '@/lib/reviews/prep'
import { getCustomerOnboarding, type CustomerOnboarding } from '@/lib/stewardship/customer-workflows'
import { researchAgainProjectId } from '@/lib/projects/contact-review'
import { CustomerCardClient } from './CustomerCardClient'

export type { CustomerOnboarding } from '@/lib/stewardship/customer-workflows'

export const dynamic = 'force-dynamic'

export type LinkedReview = {
  id:             string
  review_number:  string | null
  review_type:    string | null
  status:         string
  outcome:        string | null
  scheduled_date: string | null
  assigned_to:    string | null
  service_policies: { policy_number: string; carrier: string } | null
}

export type ProducerOption = { id: string; first_name: string; last_name: string }

export type HouseholdMember = {
  id:         string
  first_name: string
  last_name:  string
  phone:      string | null
  email:      string | null
}

export type CustomerDetail = {
  id:               string
  first_name:       string
  last_name:        string
  phone:            string | null
  email:            string | null
  street:           string | null
  address_line1:    string | null
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
  drive_folder_url: string | null
  fact_finder:          Record<string, unknown> | null
  fact_finder_verified_at: string | null
  fact_finder_verified_by: string | null
  phone_verified_at:    string | null
  email_verified_at:    string | null
  address_verified_at:  string | null
  email_availability:   string | null
  contact_alert:        string | null
  is_deceased:     boolean
  is_former_client: boolean
  is_prospect:     boolean
  is_emoney_client: boolean
}

export type LinkedCase = {
  id:               string
  internal_status:  string
  created_at:       string
  placed_at:        string | null
  face_amount:      number | null
  annual_premium:   number | null
  policy_number:    string | null
  touches:          number | null
  last_contact_at:  string | null
  agencies: { name: string; display_name: string | null } | null
  stage_translations: {
    agency_label:   string
    is_won:         boolean
    is_lost:        boolean
    tier:           number | null
    is_active_case: boolean | null
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

export type TouchHistoryEntry = {
  id:         string
  case_id:    string
  touch_type: string
  notes:      string | null
  touched_at: string
  touched_by: string | null
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
      street, address_line1, city, state, zip,
      date_of_birth, marital_status, gender,
      tobacco_use, preferred_language, health_notes,
      customer_group_id, segment, drive_folder_url,
      fact_finder, fact_finder_verified_at, fact_finder_verified_by,
      phone_verified_at, email_verified_at, address_verified_at,
      email_availability, contact_alert,
      is_deceased, is_former_client, is_prospect, is_emoney_client
    `)
    .eq('id', id)
    .single()

  if (error) {
    // A query error is NOT "customer not found". Surface it as a visible failure
    // (e.g. a schema the running database is missing) instead of a misleading
    // 404, so a real database problem is never mistaken for an absent record.
    throw new Error(`Customer detail failed to load (customers): ${error.message}`)
  }
  if (!customer) notFound()

  // Fetch linked cases (referrals)
  const { data: cases, error: casesError } = await supabase
    .from('cases')
    .select(`
      id, internal_status, created_at, placed_at, face_amount, annual_premium, policy_number,
      touches, last_contact_at,
      agencies ( name, display_name ),
      stage_translations ( agency_label, is_won, is_lost, tier, is_active_case ),
      products ( name, carriers ( short_name ) )
    `)
    .eq('customer_id', id)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  // Fetch linked policies
  const { data: policiesRaw, error: policiesError } = await supabase
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

  // A failed read of cases or policies must be visible, never silently rendered
  // as "no cases" / "no policies". Those sections drive real servicing decisions,
  // so an empty list has to mean genuinely empty, not "the query errored".
  if (casesError) {
    throw new Error(`Customer detail failed to load (cases): ${casesError.message}`)
  }
  if (policiesError) {
    throw new Error(`Customer detail failed to load (policies): ${policiesError.message}`)
  }

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

  const TERMINAL_STATUSES = new Set([
    'surrendered', 'terminated', 'lapsed', 'cancelled', 'matured', 'death claim',
  ])

  // Compute flag counts server-side — terminal policies get 0 (nothing left to review)
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
    flag_count:          TERMINAL_STATUSES.has((p.coverage_status ?? '').toLowerCase())
      ? 0
      : generateFlags(p as unknown as Parameters<typeof generateFlags>[0]).length,
    agencies:        (Array.isArray(p.agencies) ? p.agencies[0] : p.agencies) as { name: string; display_name: string | null } | null,
  }))

  const caseIds = (cases ?? []).map(c => c.id)
  let caseHistory: CaseStatusHistoryEntry[] = []
  let touchHistory: TouchHistoryEntry[] = []

  // Case status history is genuinely case-scoped — only fetch when there are cases.
  if (caseIds.length > 0) {
    const { data: histData, error: histError } = await supabase
      .from('case_status_history')
      .select('id, case_id, from_status, to_status, changed_at')
      .in('case_id', caseIds)
      .order('changed_at', { ascending: false })
    if (histError) {
      throw new Error(`Customer detail failed to load (case history): ${histError.message}`)
    }
    caseHistory = (histData ?? []) as CaseStatusHistoryEntry[]
  }

  // Touch history is the shared communication log. A touch reaches this customer
  // either through one of their cases (case_id) OR directly (customer_id, e.g.
  // 1035 servicing-agent outreach, where the customer often has no case). Gather
  // both and merge, newest first. This runs even with zero cases so customer-
  // level touches are never hidden.
  {
    const orClauses: string[] = [`customer_id.eq.${id}`]
    if (caseIds.length > 0) {
      orClauses.push(`case_id.in.(${caseIds.join(',')})`)
    }
    const { data: touchData, error: touchError } = await supabase
      .from('case_touches')
      .select('id, case_id, touch_type, notes, touched_at, touched_by')
      .or(orClauses.join(','))
      .order('touched_at', { ascending: false })
    // The contact/touch history is a compliance record. If the read errors
    // (for example the running database is missing case_touches.customer_id),
    // surface it rather than showing an empty, falsely-reassuring history.
    if (touchError) {
      throw new Error(`Customer detail failed to load (touch history): ${touchError.message}`)
    }
    touchHistory = (touchData ?? []) as TouchHistoryEntry[]
  }

  // Fetch customer notes (running compliance log)
  const { data: notesRaw, error: notesError } = await supabase
    .from('customer_notes')
    .select('id, section, author_name, body, created_at, case_id, service_request_id, policy_review_id')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })

  if (notesError) {
    throw new Error(`Customer detail failed to load (notes): ${notesError.message}`)
  }
  const notes: CustomerNote[] = (notesRaw ?? []) as CustomerNote[]

  // Fetch household members (others in the same customer_group)
  let householdMembers: HouseholdMember[] = []
  if (customer.customer_group_id) {
    const { data: hhRaw } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, email')
      .eq('customer_group_id', customer.customer_group_id)
      .neq('id', id)
      .eq('is_test', false)
      .order('first_name')
    householdMembers = (hhRaw ?? []) as HouseholdMember[]
  }

  // Fetch service requests, policy reviews, and producers directly by customer_id
  let serviceRequests: LinkedServiceRequest[] = []
  let policyReviews:   LinkedReview[]         = []

  const [srResult, reviewResult, producerResult] = await Promise.all([
    supabase
      .from('service_requests')
      .select('id, sr_number, request_type, workflow_status, date_received, service_policies ( policy_number, client_name )')
      .eq('customer_id', id)
      .order('date_received', { ascending: false })
      .limit(20),
    supabase
      .from('policy_reviews')
      .select('id, review_number, review_type, status, outcome, scheduled_date, assigned_to, service_policies!policy_reviews_policy_id_fkey ( policy_number, carrier )')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('producers')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .order('first_name'),
  ])

  // These three drive servicing, review, and assignment UI. A failed read must
  // be visible, not silently shown as "no service requests / no reviews".
  if (srResult.error) {
    throw new Error(`Customer detail failed to load (service requests): ${srResult.error.message}`)
  }
  if (reviewResult.error) {
    throw new Error(`Customer detail failed to load (policy reviews): ${reviewResult.error.message}`)
  }
  if (producerResult.error) {
    throw new Error(`Customer detail failed to load (producers): ${producerResult.error.message}`)
  }

  serviceRequests = (srResult.data ?? []).map((sr: Record<string, unknown>) => {
    const spRaw = sr.service_policies
    const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as { policy_number: string; client_name: string } | null
    return {
      id:              sr.id as string,
      sr_number:       sr.sr_number as string | null,
      request_type:    sr.request_type as string,
      workflow_status: sr.workflow_status as string,
      date_received:   sr.date_received as string,
      policy_number:   sp?.policy_number ?? null,
      client_name:     sp?.client_name ?? null,
    }
  })

  policyReviews = (reviewResult.data ?? []).map((r: Record<string, unknown>) => {
    const spRaw = r.service_policies
    const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as { policy_number: string; carrier: string } | null
    return {
      id:             r.id as string,
      review_number:  r.review_number as string | null,
      review_type:    r.review_type as string | null,
      status:         r.status as string,
      outcome:        r.outcome as string | null,
      scheduled_date: r.scheduled_date as string | null,
      assigned_to:    r.assigned_to as string | null,
      service_policies: sp,
    }
  })

  // Servicing-agent onboarding summary (active workflow + completed roll-up).
  // Derived live from the stewardship tables + policy sa_status; never fails the
  // page if the read errors.
  let onboarding: CustomerOnboarding = { active: null, completed: null }
  try {
    onboarding = await getCustomerOnboarding(supabase, id)
  } catch {
    onboarding = { active: null, completed: null }
  }

  // Deliberate "research again" entry point: when this customer has been
  // researched-not-found (and so is suppressed from the routine Contact Review
  // list) in an active 1035 project, offer a direct link back into that
  // project's Contact Review task so an employee can look again. Null otherwise.
  let researchAgainPid: string | null = null
  try {
    researchAgainPid = await researchAgainProjectId(supabase, id)
  } catch {
    researchAgainPid = null
  }

  return (
    <CustomerCardClient
      customer={customer as CustomerDetail}
      cases={(cases ?? []) as unknown as LinkedCase[]}
      policies={policies}
      pendingCasePolicies={pendingCasePolicies}
      serviceRequests={serviceRequests}
      policyReviews={policyReviews}
      producers={(producerResult.data ?? []) as ProducerOption[]}
      caseHistory={caseHistory}
      touchHistory={touchHistory}
      initialNotes={notes}
      householdMembers={householdMembers}
      onboarding={onboarding}
      researchAgainProjectId={researchAgainPid}
    />
  )
}
