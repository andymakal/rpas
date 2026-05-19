import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import CasesClient from './CasesClient'

export const metadata: Metadata = { title: 'Cases' }

export const dynamic = 'force-dynamic'

export type CaseRow = {
  id: string
  internal_status: string
  created_at: string
  status_entered_at: string | null
  policy_number: string | null
  face_amount: number | null
  annual_premium: number | null
  lead_source: string | null
  notes: string | null
  customers: { first_name: string; last_name: string } | null
  agencies: { name: string; display_name: string | null; slug: string } | null
  stage_translations: {
    agency_label: string
    tier: number
    is_active_case: boolean
    is_won: boolean
    is_lost: boolean
    is_snoozed: boolean
  } | null
  products: {
    name: string
    carriers: { short_name: string } | null
  } | null
}

export default async function CasesPage() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('cases')
    .select(`
      id, internal_status, created_at, status_entered_at, policy_number,
      face_amount, annual_premium, lead_source, notes,
      customers ( first_name, last_name ),
      agencies ( name, display_name, slug ),
      stage_translations ( agency_label, tier, is_active_case, is_won, is_lost, is_snoozed ),
      products ( name, carriers ( short_name ) )
    `)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Cases fetch error:', error)
    return (
      <div className="p-8">
        <p className="text-red-400">Failed to load cases: {error.message}</p>
      </div>
    )
  }

  const cases = (data as unknown as CaseRow[]) ?? []

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">Cases</h1>
          <p className="text-slate-400 text-sm mt-0.5">Tier 2+ pipeline — cases in commitment &amp; execution</p>
        </div>
        <CasesClient cases={cases} />
      </div>
    </div>
  )
}
