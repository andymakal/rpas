import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { TriageClient } from './TriageClient'

export const metadata: Metadata = { title: 'Triage' }
export const dynamic = 'force-dynamic'

export type TriageCase = {
  id: string
  created_at: string
  is_hot_lead: boolean
  is_owner_referral: boolean
  notes: string | null
  touches: number | null
  last_contact_at: string | null
  missed_count: number          // injected in page — count of missed_appointment touches
  agencies: { id: string; name: string; display_name: string | null } | null
  customers: {
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
    date_of_birth: string | null
  } | null
  agents: { id: string; first_name: string; last_name: string; email: string | null } | null
  household_members: { id: string; first_name: string; last_name: string }[]
}

export default async function TriagePage() {
  const supabase = createAdminClient()

  const { data: rawCases } = await supabase
    .from('cases')
    .select(`
      id,
      created_at,
      is_hot_lead,
      is_owner_referral,
      notes,
      touches,
      last_contact_at,
      agencies ( id, name, display_name ),
      customers!customer_id ( first_name, last_name, phone, email, date_of_birth ),
      agents ( id, first_name, last_name, email ),
      case_household_members ( id, first_name, last_name )
    `)
    .eq('internal_status', 'triage')
    .eq('is_test', false)
    .order('is_hot_lead', { ascending: false })
    .order('created_at', { ascending: true })   // oldest first — FIFO

  // Fetch missed-appointment touch counts for all triage cases in one query
  const caseIds = (rawCases ?? []).map(c => c.id)
  const missedCounts: Record<string, number> = {}
  if (caseIds.length > 0) {
    const { data: misses } = await supabase
      .from('case_touches')
      .select('case_id')
      .in('case_id', caseIds)
      .eq('touch_type', 'missed_appointment')
    for (const m of (misses ?? [])) {
      missedCounts[m.case_id] = (missedCounts[m.case_id] ?? 0) + 1
    }
  }

  const cases = (rawCases ?? []).map(c => ({
    ...c,
    missed_count: missedCounts[c.id] ?? 0,
  }))

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">Triage Queue</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Incoming referrals — call, qualify, then set appointment or live transfer
          </p>
        </div>

        <TriageClient cases={(cases ?? []) as unknown as TriageCase[]} />
      </div>
    </div>
  )
}
