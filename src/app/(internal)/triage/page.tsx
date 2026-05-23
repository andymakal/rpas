import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { TriageClient } from './TriageClient'

export const metadata: Metadata = { title: 'Triage Queue' }
export const dynamic = 'force-dynamic'

export type TriageCase = {
  id: string
  created_at: string
  is_hot_lead: boolean
  is_owner_referral: boolean
  notes: string | null
  agencies: { id: string; name: string; display_name: string | null } | null
  customers: {
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
    date_of_birth: string | null
  } | null
  agents: { first_name: string; last_name: string; email: string | null } | null
}

export type ProducerOption = {
  id: string
  first_name: string
  last_name: string
}

export default async function TriagePage() {
  const supabase = createAdminClient()

  const [{ data: cases }, { data: producers }] = await Promise.all([
    supabase
      .from('cases')
      .select(`
        id,
        created_at,
        is_hot_lead,
        is_owner_referral,
        notes,
        agencies ( id, name, display_name ),
        customers ( first_name, last_name, phone, email, date_of_birth ),
        agents ( first_name, last_name, email )
      `)
      .eq('internal_status', 'triage')
      .eq('is_test', false)
      .order('is_hot_lead', { ascending: false })
      .order('created_at', { ascending: true }),   // oldest first — FIFO

    supabase
      .from('producers')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .order('last_name'),
  ])

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">Triage Queue</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Incoming referrals — call, qualify, then set appointment or live transfer
          </p>
        </div>

        <TriageClient
          cases={(cases ?? []) as unknown as TriageCase[]}
          producers={(producers ?? []) as ProducerOption[]}
        />
      </div>
    </div>
  )
}
