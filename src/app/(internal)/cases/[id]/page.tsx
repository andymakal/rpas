import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import CaseEditClient from './CaseEditClient'

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
  const name = c ? `${c.first_name} ${c.last_name}` : 'Case Detail'
  return { title: name }
}

export const dynamic = 'force-dynamic'

export type CaseDetail = {
  id: string
  internal_status: string
  created_at: string
  status_entered_at: string | null
  updated_at: string | null
  policy_number: string | null
  face_amount: number | null
  annual_premium: number | null
  lead_source: string | null
  notes: string | null
  appointment_date: string | null
  touches: number | null
  last_contact_at: string | null
  placed_at: string | null
  agency_id: string | null
  customer_id: string | null
  agent_id: string | null
  customers: {
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
    date_of_birth: string | null
  } | null
  agencies: { id: string; name: string; display_name: string | null; slug: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: {
    agency_label: string
    tier: number
    is_active_case: boolean
    is_won: boolean
    is_lost: boolean
    is_snoozed: boolean
  } | null
  products: {
    id: string
    name: string
    carriers: { id: string; short_name: string } | null
  } | null
  rate_classes: { id: string; name: string } | null
  premium_modes: { id: string; name: string } | null
  lost_reasons: { id: string; agency_label: string } | null
  snooze_reasons: { id: string; agency_label: string } | null
  case_pending_requirements: {
    id: string
    pending_requirement_id: string
    resolved_at: string | null
    pending_requirements: { name: string } | null
  }[]
}

export type StageLookup = { id: string; internal_status: string; agency_label: string; tier: number }
export type AgencyLookup = { id: string; name: string; display_name: string | null }
export type ProductLookup = { id: string; name: string; carrier_id: string | null; carriers: { short_name: string } | null }
export type RateClassLookup = { id: string; name: string }
export type PremiumModeLookup = { id: string; name: string }
export type LostReasonLookup = { id: string; agency_label: string }
export type SnoozeReasonLookup = { id: string; agency_label: string }
export type PendingRequirementLookup = { id: string; name: string; sort_order: number }

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: caseData, error: caseError },
    { data: stages },
    { data: agencies },
    { data: products },
    { data: rateClasses },
    { data: premiumModes },
    { data: lostReasons },
    { data: snoozeReasons },
    { data: pendingRequirements },
  ] = await Promise.all([
    supabase
      .from('cases')
      .select(`
        id, internal_status, created_at, status_entered_at, updated_at,
        policy_number, face_amount, annual_premium, lead_source, notes,
        appointment_date, touches, last_contact_at, placed_at,
        agency_id, customer_id, agent_id,
        customers ( first_name, last_name, email, phone, date_of_birth ),
        agencies ( id, name, display_name, slug ),
        agents ( first_name, last_name ),
        stage_translations ( agency_label, tier, is_active_case, is_won, is_lost, is_snoozed ),
        products ( id, name, carriers ( id, short_name ) ),
        rate_classes ( id, name ),
        premium_modes ( id, name ),
        lost_reasons ( id, agency_label ),
        snooze_reasons ( id, agency_label ),
        case_pending_requirements ( id, pending_requirement_id, resolved_at, pending_requirements ( name ) )
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('stage_translations')
      .select('id, internal_status, agency_label, tier')
      .order('tier')
      .order('stage_order'),
    supabase
      .from('agencies')
      .select('id, name, display_name')
      .eq('is_active', true)
      .eq('is_test', false)
      .order('name'),
    supabase
      .from('products')
      .select('id, name, carrier_id, carriers ( short_name )')
      .order('name'),
    supabase
      .from('rate_classes')
      .select('id, name')
      .order('sort_order'),
    supabase
      .from('premium_modes')
      .select('id, name')
      .order('sort_order'),
    supabase
      .from('lost_reasons')
      .select('id, agency_label')
      .order('sort_order'),
    supabase
      .from('snooze_reasons')
      .select('id, agency_label')
      .order('sort_order'),
    supabase
      .from('pending_requirements')
      .select('id, name, sort_order')
      .order('sort_order'),
  ])

  if (caseError || !caseData) {
    notFound()
  }

  return (
    <CaseEditClient
      caseData={caseData as unknown as CaseDetail}
      stages={(stages as unknown as StageLookup[]) ?? []}
      agencies={(agencies as unknown as AgencyLookup[]) ?? []}
      products={(products as unknown as ProductLookup[]) ?? []}
      rateClasses={(rateClasses as unknown as RateClassLookup[]) ?? []}
      premiumModes={(premiumModes as unknown as PremiumModeLookup[]) ?? []}
      lostReasons={(lostReasons as unknown as LostReasonLookup[]) ?? []}
      snoozeReasons={(snoozeReasons as unknown as SnoozeReasonLookup[]) ?? []}
      pendingRequirements={(pendingRequirements as unknown as PendingRequirementLookup[]) ?? []}
    />
  )
}
