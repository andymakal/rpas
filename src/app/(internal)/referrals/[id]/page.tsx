import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { ReferralEditClient } from './ReferralEditClient'

export const dynamic = 'force-dynamic'

export type StatusHistoryEntry = {
  id: string
  from_status: string | null
  to_status: string
  changed_at: string
}

export type ReferralDetail = {
  id: string
  customer_id: string
  agent_id: string | null
  agency_id: string
  internal_status: string
  created_at: string
  status_entered_at: string | null
  appointment_date: string | null
  follow_up_date: string | null
  face_amount: number | null
  quoted_carrier: string | null
  quoted_product_type: string | null
  annual_premium: number | null
  policy_number: string | null
  notes: string | null
  touches: number | null
  last_contact_at: string | null
  spiff_earned: boolean
  spiff_earned_at: string | null
  is_hot_lead: boolean
  is_owner_referral: boolean
  producer_id: string | null
  lead_source: string | null
  household_members: {
    id: string
    first_name: string
    last_name: string
    date_of_birth: string | null
    gender: string | null
    tobacco_use: string | null
    height_ft: number | null
    height_in: number | null
    weight_lbs: number | null
    health_notes: string | null
    quoted_carrier: string | null
    quoted_product_type: string | null
    face_amount: number | null
    linked_case_id: string | null
  }[]
  customers: {
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
    date_of_birth: string | null
    marital_status: string | null
    gender: string | null
    tobacco_use: string | null
    height_ft: number | null
    height_in: number | null
    weight_lbs: number | null
    health_notes: string | null
    spanish_speaking: boolean
  } | null
  agencies: { name: string; display_name: string | null; contact_email: string | null } | null
  agents: { id: string; first_name: string; last_name: string; email: string | null } | null
  stage_translations: {
    agency_label: string
    tier: number
    is_active_case: boolean
    is_won: boolean
    is_lost: boolean
  } | null
}

export type Tier1Stage    = { id: string; internal_status: string; agency_label: string }
export type TouchLog      = { id: string; touch_type: string; notes: string | null; touched_at: string }
export type HouseholdMember = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  customer_group_id: string | null
  latest_case: {
    id: string
    internal_status: string
    agency_label: string | null
    is_won: boolean
    is_lost: boolean
    is_referral: boolean
  } | null
}
export type AgentOption   = { id: string; first_name: string; last_name: string; email: string | null }
export type AgencyOption  = { id: string; name: string; display_name: string | null }
export type ProducerOption = { id: string; first_name: string; last_name: string }
export type SuspectedDuplicate = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  agency_name: string | null
  case_count: number
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('cases')
    .select('customers(first_name, last_name)')
    .eq('id', id)
    .single()
  const c = (data as { customers: { first_name: string; last_name: string } | null } | null)?.customers
  return { title: c ? `${c.first_name} ${c.last_name}` : 'Referral' }
}

export default async function ReferralDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  // Fetch case first so we have agency_id for the agents query
  const { data: caseData, error } = await supabase
    .from('cases')
    .select(`
      id, customer_id, agent_id, agency_id,
      internal_status, created_at, status_entered_at, appointment_date,
      follow_up_date, face_amount, quoted_carrier, quoted_product_type, annual_premium, policy_number,
      case_household_members!case_id ( id, first_name, last_name, date_of_birth, gender, tobacco_use, height_ft, height_in, weight_lbs, health_notes, quoted_carrier, quoted_product_type, face_amount, linked_case_id ),
      notes, touches, last_contact_at, spiff_earned, spiff_earned_at, is_hot_lead, is_owner_referral, producer_id, lead_source, suspected_duplicate_customer_id,
      customers!customer_id ( first_name, last_name, phone, email, street, city, state, zip, date_of_birth, marital_status, gender, tobacco_use, height_ft, height_in, weight_lbs, health_notes, spanish_speaking, customer_group_id ),
      agencies ( name, display_name, contact_email ),
      agents ( id, first_name, last_name, email ),
      stage_translations ( agency_label, tier, is_active_case, is_won, is_lost )
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error('Referral fetch error:', error)
    return (
      <div className="p-8 text-red-400 text-sm">
        Failed to load referral: {(error as { message?: string }).message ?? JSON.stringify(error)}
      </div>
    )
  }
  if (!caseData) notFound()

  const cd = caseData as unknown as ReferralDetail

  const householdId        = (cd.customers as unknown as { customer_group_id: string | null } | null)?.customer_group_id ?? null
  const suspectedDupId     = (cd as unknown as { suspected_duplicate_customer_id: string | null }).suspected_duplicate_customer_id ?? null

  const [{ data: stages }, { data: touchLog }, { data: agentsList }, { data: agenciesList }, { data: statusHistory }, { data: producersList }, { data: householdMembers }, dupResult] = await Promise.all([
    supabase
      .from('stage_translations')
      .select('id, internal_status, agency_label')
      .in('tier', [1, 2])
      .order('tier')
      .order('stage_order'),
    supabase
      .from('case_touches')
      .select('id, touch_type, notes, touched_at')
      .eq('case_id', id)
      .order('touched_at', { ascending: false }),
    supabase
      .from('agents')
      .select('id, first_name, last_name, email')
      .eq('agency_id', cd.agency_id)
      .order('first_name'),
    supabase
      .from('agencies')
      .select('id, name, display_name')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('case_status_history')
      .select('id, from_status, to_status, changed_at')
      .eq('case_id', id)
      .order('changed_at', { ascending: false }),
    supabase
      .from('producers')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .order('first_name'),
    householdId
      ? supabase
          .from('customers')
          .select('id, first_name, last_name, phone, customer_group_id, cases ( id, internal_status, stage_translations ( agency_label, tier, is_won, is_lost ) )')
          .eq('customer_group_id', householdId)
          .neq('id', cd.customer_id)
          .eq('is_test', false)
      : Promise.resolve({ data: [] }),
    suspectedDupId
      ? supabase
          .from('customers')
          .select('id, first_name, last_name, phone, agencies ( name, display_name )')
          .eq('id', suspectedDupId)
          .single()
      : Promise.resolve({ data: null }),
  ])

  // Shape suspected duplicate
  type RawDup = { id: string; first_name: string; last_name: string; phone: string | null; agencies: { name: string; display_name: string | null } | null }
  const rawDup = dupResult?.data as unknown as RawDup | null
  let suspectedDuplicate: SuspectedDuplicate | null = null
  if (rawDup) {
    const { count: dupCaseCount } = await supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', rawDup.id)
      .eq('is_test', false)
    suspectedDuplicate = {
      id:          rawDup.id,
      first_name:  rawDup.first_name,
      last_name:   rawDup.last_name,
      phone:       rawDup.phone,
      agency_name: rawDup.agencies?.display_name ?? rawDup.agencies?.name ?? null,
      case_count:  dupCaseCount ?? 0,
    }
  }

  // Shape household members for the card
  type RawMember = {
    id: string; first_name: string; last_name: string; phone: string | null; customer_group_id: string | null
    cases: { id: string; internal_status: string; stage_translations: { agency_label: string; tier: number; is_won: boolean; is_lost: boolean } | null }[]
  }
  const shapedMembers: HouseholdMember[] = ((householdMembers ?? []) as unknown as RawMember[]).map(m => {
    const latestCase = m.cases?.[0] ?? null
    return {
      id: m.id, first_name: m.first_name, last_name: m.last_name,
      phone: m.phone, customer_group_id: m.customer_group_id,
      latest_case: latestCase ? {
        id: latestCase.id,
        internal_status: latestCase.internal_status,
        agency_label: latestCase.stage_translations?.agency_label ?? null,
        is_won:  latestCase.stage_translations?.is_won  ?? false,
        is_lost: latestCase.stage_translations?.is_lost ?? false,
        is_referral: (latestCase.stage_translations?.tier ?? 1) === 1,
      } : null,
    }
  })

  return (
    <ReferralEditClient
      referral={cd}
      stages={(stages as unknown as Tier1Stage[]) ?? []}
      touchLog={(touchLog as unknown as TouchLog[]) ?? []}
      agentsList={(agentsList as unknown as AgentOption[]) ?? []}
      agenciesList={(agenciesList as unknown as AgencyOption[]) ?? []}
      statusHistory={(statusHistory as unknown as StatusHistoryEntry[]) ?? []}
      producersList={(producersList as unknown as ProducerOption[]) ?? []}
      householdId={householdId}
      householdMembers={shapedMembers}
      suspectedDuplicate={suspectedDuplicate}
    />
  )
}
