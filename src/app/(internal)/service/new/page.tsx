import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewServiceRequestClient } from './NewServiceRequestClient'

export const metadata: Metadata = { title: 'New Service Request' }
export const dynamic = 'force-dynamic'

export type AgencyOption = { id: string; name: string; display_name: string | null }
export type AgentOption  = { id: string; first_name: string; last_name: string; agency_id: string | null }

export default async function NewServiceRequestPage() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createAdminClient()

  const [{ data: agencies }, { data: agents }] = await Promise.all([
    supabase
      .from('agencies')
      .select('id, name, display_name')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('agents')
      .select('id, first_name, last_name, agency_id')
      .order('first_name'),
  ])

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">New Service Request</h1>
          <p className="text-slate-400 text-sm mt-0.5">Log a policy service request and capture policy details</p>
        </div>
        <NewServiceRequestClient
          agencies={(agencies as AgencyOption[]) ?? []}
          agents={(agents as AgentOption[]) ?? []}
        />
      </div>
    </div>
  )
}
