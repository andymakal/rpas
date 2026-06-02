import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { ReviewPrepClient } from './ReviewPrepClient'

export const dynamic = 'force-dynamic'

export type ReviewDetail = {
  id: string
  review_number: string | null
  review_type: string | null
  assigned_to: string | null
  status: string
  outcome: string | null
  tobacco_asked: boolean
  still_using_tobacco: boolean | null
  tobacco_product: string | null
  primary_beneficiary_confirmed: string | null
  call_completed_at: string | null
  prep_notes: string | null
  pdf_url: string | null
  resulting_case_id: string | null
  created_at: string
  updated_at: string
  service_policies: {
    id: string
    client_name: string
    policy_number: string
    carrier: string
    product_type: string | null
    issue_date: string | null
    term_length: string | null
    face_amount: number | null
    death_benefit_amount: number | null
    cash_value_amount: number | null
    cost_basis: number | null
    annual_premium: number | null
    premium_mode: string | null
    rate_class: string | null
    riders: string | null
    insured_first_name: string | null
    insured_last_name: string | null
    primary_beneficiary: string | null
    sa_status: string
    agencies: { id: string; name: string; display_name: string | null } | null
    agents: { id: string; first_name: string; last_name: string } | null
  } | null
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('policy_reviews')
    .select('review_number, service_policies(client_name)')
    .eq('id', id)
    .single()
  const r    = data as { review_number: string | null; service_policies: { client_name: string } | null } | null
  const name = r?.service_policies?.client_name ?? 'Policy Review'
  return { title: r?.review_number ? `${r.review_number} — ${name}` : name }
}

export default async function ReviewPrepPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createAdminClient()

  const { data: review } = await supabase
    .from('policy_reviews')
    .select(`
      id, review_number, review_type, assigned_to, status, outcome,
      tobacco_asked, still_using_tobacco, tobacco_product,
      primary_beneficiary_confirmed, call_completed_at,
      prep_notes, pdf_url, resulting_case_id,
      created_at, updated_at,
      service_policies (
        id, client_name, policy_number, carrier, product_type,
        issue_date, term_length, face_amount, death_benefit_amount,
        cash_value_amount, cost_basis, annual_premium, premium_mode,
        rate_class, riders, insured_first_name, insured_last_name,
        primary_beneficiary, sa_status,
        agencies ( id, name, display_name ),
        agents ( id, first_name, last_name )
      )
    `)
    .eq('id', id)
    .single()

  if (!review) notFound()

  const { data: producers } = await supabase
    .from('producers')
    .select('id, first_name, last_name')
    .eq('is_active', true)
    .order('first_name')

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <ReviewPrepClient
          review={review as unknown as ReviewDetail}
          producers={(producers ?? []) as { id: string; first_name: string; last_name: string }[]}
        />
      </div>
    </div>
  )
}
