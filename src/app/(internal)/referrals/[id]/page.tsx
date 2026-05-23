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
  annual_premium: number | null
  policy_number: string | null
  notes: string | null
  touches: number | null
  last_contact_at: string | null
  spiff_earned: boolean
  spiff_earned_at: string | null
  is_hot_lead: boolean
  is_owner_referral: boolean
  lead_source: string | null
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

export type Tier1Stage   = { id: string; internal_status: string; agency_label: string }
export type TouchLog     = { id: string; touch_type: string; notes: string | null; touched_at: string }
export type AgentOption  = { id: string; first_name: string; last_name: string; email: string | null }
export type AgencyOption = { id: string; name: string; display_name: string | null }

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
      follow_up_date, face_amount, annual_premium, policy_number,
      notes, touches, last_contact_at, spiff_earned, spiff_earned_at, is_hot_lead, is_owner_referral, lead_source,
      customers ( first_name, last_name, phone, email, street, city, state, zip, date_of_birth, marital_status, gender, tobacco_use, height_ft, height_in, weight_lbs, health_notes, spanish_speaking ),
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

  const [{ data: stages }, { data: touchLog }, { data: agentsList }, { data: agenciesList }, { data: statusHistory }] = await Promise.all([
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
  ])

  return (
    <ReferralEditClient
      referral={cd}
      stages={(stages as unknown as Tier1Stage[]) ?? []}
      touchLog={(touchLog as unknown as TouchLog[]) ?? []}
      agentsList={(agentsList as unknown as AgentOption[]) ?? []}
      agenciesList={(agenciesList as unknown as AgencyOption[]) ?? []}
      statusHistory={(statusHistory as unknown as StatusHistoryEntry[]) ?? []}
    />
  )
}
