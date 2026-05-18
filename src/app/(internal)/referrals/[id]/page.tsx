import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { ReferralEditClient } from './ReferralEditClient'

export const dynamic = 'force-dynamic'

export type ReferralDetail = {
  id: string
  internal_status: string
  created_at: string
  status_entered_at: string | null
  appointment_date: string | null
  notes: string | null
  touches: number | null
  last_contact_at: string | null
  spiff_earned: boolean
  spiff_earned_at: string | null
  is_owner_referral: boolean
  customers: {
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
  } | null
  agencies: { name: string; display_name: string | null; contact_email: string | null } | null
  agents: { first_name: string; last_name: string; email: string | null } | null
  stage_translations: {
    agency_label: string
    tier: number
    is_active_case: boolean
    is_won: boolean
    is_lost: boolean
  } | null
}

export type Tier1Stage = { id: string; internal_status: string; agency_label: string }
export type TouchLog   = { id: string; touch_type: string; notes: string | null; touched_at: string }

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

  const [{ data: caseData, error }, { data: stages }, { data: touchLog }] = await Promise.all([
    supabase
      .from('cases')
      .select(`
        id, internal_status, created_at, status_entered_at, appointment_date,
        notes, touches, last_contact_at, spiff_earned, spiff_earned_at, is_owner_referral,
        customers ( first_name, last_name, phone, email ),
        agencies ( name, display_name, contact_email ),
        agents ( first_name, last_name, email ),
        stage_translations ( agency_label, tier, is_active_case, is_won, is_lost )
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('stage_translations')
      .select('id, internal_status, agency_label')
      .eq('tier', 1)
      .order('stage_order'),
    supabase
      .from('case_touches')
      .select('id, touch_type, notes, touched_at')
      .eq('case_id', id)
      .order('touched_at', { ascending: false }),
  ])

  if (error || !caseData) notFound()

  return (
    <ReferralEditClient
      referral={caseData as unknown as ReferralDetail}
      stages={(stages as unknown as Tier1Stage[]) ?? []}
      touchLog={(touchLog as unknown as TouchLog[]) ?? []}
    />
  )
}
