import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { TriageClient } from './TriageClient'

export const metadata: Metadata = { title: 'Triage' }
export const dynamic = 'force-dynamic'

export type TriageCase = {
  id: string
  customer_id: string | null
  created_at: string
  is_hot_lead: boolean
  is_owner_referral: boolean
  notes: string | null
  allstate_policy_number: string | null
  touches: number | null
  last_contact_at: string | null
  follow_up_date: string | null
  suspected_duplicate_customer_id: string | null
  missed_count: number       // injected — count of missed_appointment touches
  prior_case_count: number   // injected — other cases for this customer (not this one)
  policy_count: number       // injected — placed policies for this customer
  agencies: { id: string; name: string; display_name: string | null } | null
  customers: {
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
    date_of_birth: string | null
    preferred_language: string | null
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
      customer_id,
      created_at,
      is_hot_lead,
      is_owner_referral,
      notes,
      allstate_policy_number,
      touches,
      last_contact_at,
      follow_up_date,
      suspected_duplicate_customer_id,
      agencies ( id, name, display_name ),
      customers!customer_id ( first_name, last_name, phone, email, date_of_birth, preferred_language ),
      agents ( id, first_name, last_name, email ),
      household_members:case_household_members!case_id ( id, first_name, last_name )
    `)
    .eq('internal_status', 'triage')
    .eq('is_test', false)
    .order('is_hot_lead', { ascending: false })
    .order('created_at', { ascending: true })   // oldest first — FIFO

  const caseIds     = (rawCases ?? []).map(c => c.id)
  const customerIds = [...new Set((rawCases ?? []).map(c => (c as { customer_id?: string | null }).customer_id).filter((x): x is string => Boolean(x)))]

  // Batch queries for relationship context + missed-appointment counts
  const missedCounts:    Record<string, number> = {}
  const priorCaseCounts: Record<string, number> = {}
  const policyCounts:    Record<string, number> = {}

  await Promise.all([
    // Missed-appointment touches
    (async () => {
      if (caseIds.length === 0) return
      const { data } = await supabase.from('case_touches').select('case_id').in('case_id', caseIds).eq('touch_type', 'missed_appointment')
      for (const m of (data ?? [])) {
        const id = (m as { case_id: string }).case_id
        missedCounts[id] = (missedCounts[id] ?? 0) + 1
      }
    })(),

    // Prior cases for the same customers (any status, excluding the current triage cases)
    (async () => {
      if (customerIds.length === 0) return
      const { data } = await supabase.from('cases').select('id, customer_id').in('customer_id', customerIds).eq('is_test', false)
      const triageSet = new Set(caseIds)
      for (const c of (data ?? [])) {
        const row = c as { id: string; customer_id: string }
        if (!triageSet.has(row.id)) priorCaseCounts[row.customer_id] = (priorCaseCounts[row.customer_id] ?? 0) + 1
      }
    })(),

    // Placed policies for the same customers
    (async () => {
      if (customerIds.length === 0) return
      const { data } = await supabase.from('service_policies').select('customer_id').in('customer_id', customerIds).eq('is_test', false)
      for (const p of (data ?? [])) {
        const id = (p as { customer_id: string }).customer_id
        policyCounts[id] = (policyCounts[id] ?? 0) + 1
      }
    })(),
  ])

  const cases = (rawCases ?? []).map(c => {
    const custId = (c as { customer_id?: string | null }).customer_id ?? ''
    return {
      ...c,
      missed_count:    missedCounts[c.id]  ?? 0,
      prior_case_count: priorCaseCounts[custId] ?? 0,
      policy_count:    policyCounts[custId] ?? 0,
    }
  })

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
