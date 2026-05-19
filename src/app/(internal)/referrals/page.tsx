import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ReferralsClient } from './ReferralsClient'

export const metadata: Metadata = { title: 'Referrals' }

export type StageTranslation = {
  agency_label: string
  tier: number
  is_active_case: boolean
}

export type CaseRow = {
  id: string
  internal_status: string
  created_at: string
  status_entered_at: string | null
  last_contact_at: string | null
  follow_up_date: string | null
  touches: number | null
  is_owner_referral: boolean
  agencies: { name: string; display_name: string | null } | null
  customers: { first_name: string; last_name: string; phone: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: StageTranslation | null
}

export const dynamic = 'force-dynamic'

export default async function ReferralsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: cases } = await supabase
    .from('cases')
    .select(`
      id,
      internal_status,
      created_at,
      status_entered_at,
      last_contact_at,
      follow_up_date,
      touches,
      is_owner_referral,
      agencies ( name, display_name ),
      customers ( first_name, last_name, phone ),
      agents ( first_name, last_name ),
      stage_translations ( agency_label, tier, is_active_case )
    `)
    .eq('is_test', false)
    .in('internal_status', [
      'lsp_contact_needed',
      'appointment_set',
      'appointment_missed',
      'appointment_kept',
      'quoted',
      'carrier_declined',
      'client_withdrew',
      'snoozed',
    ])
    .order('created_at', { ascending: false })

  const rows = (cases as unknown as CaseRow[]) ?? []

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-semibold">Referrals</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Tier 1 pipeline — leads from agency partners
            </p>
          </div>
          <Link
            href="/referrals/new"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" /> Log Referral
          </Link>
        </div>

        <ReferralsClient rows={rows} />
      </div>
    </div>
  )
}
