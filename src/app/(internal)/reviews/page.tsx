import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReviewsClient } from './ReviewsClient'

export const metadata: Metadata = { title: 'Policy Reviews' }
export const dynamic = 'force-dynamic'

export type ReviewListRow = {
  id: string
  review_number: string | null
  review_type: string | null
  assigned_to: string | null
  status: string
  outcome: string | null
  tobacco_asked: boolean
  created_at: string
  call_completed_at: string | null
  service_policies: {
    id: string
    client_name: string
    policy_number: string
    carrier: string
    product_type: string | null
    rate_class: string | null
    face_amount: number | null
    annual_premium: number | null
    issue_date: string | null
    term_length: string | null
    sa_status: string
  } | null
}

export default async function ReviewsPage() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createAdminClient()

  const { data: reviews } = await supabase
    .from('policy_reviews')
    .select(`
      id, review_number, review_type, assigned_to, status, outcome,
      tobacco_asked, created_at, call_completed_at,
      service_policies (
        id, client_name, policy_number, carrier, product_type,
        rate_class, face_amount, annual_premium, issue_date, term_length, sa_status
      )
    `)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-white text-2xl font-semibold">Policy Reviews</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              5-minute proactive review call queue — prep, call, log
            </p>
          </div>
        </div>
        <ReviewsClient reviews={(reviews as unknown as ReviewListRow[]) ?? []} />
      </div>
    </div>
  )
}
