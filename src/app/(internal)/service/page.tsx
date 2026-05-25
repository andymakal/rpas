import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ServiceClient } from './ServiceClient'

export const metadata: Metadata = { title: 'Service' }
export const dynamic = 'force-dynamic'

export type ServiceRow = {
  id: string
  sr_number: string | null
  request_type: string
  workflow_status: string
  date_received: string
  date_resolved: string | null
  notes: string | null
  created_at: string
  service_policies: {
    id: string
    client_name: string
    policy_number: string
    carrier: string
    sa_status: string
    face_amount: number | null
    agencies: { name: string; display_name: string | null } | null
    agents: { first_name: string; last_name: string } | null
  } | null
}

export default async function ServicePage() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('service_requests')
    .select(`
      id,
      sr_number,
      request_type,
      workflow_status,
      date_received,
      date_resolved,
      notes,
      created_at,
      service_policies (
        id,
        client_name,
        policy_number,
        carrier,
        sa_status,
        face_amount,
        agencies ( name, display_name ),
        agents ( first_name, last_name )
      )
    `)
    .order('created_at', { ascending: false })

  const rows = (data as unknown as ServiceRow[]) ?? []

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-semibold">Service</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Legacy policy service requests — LBL / Everlake
            </p>
          </div>
          <Link
            href="/service/new"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" /> New Request
          </Link>
        </div>

        <ServiceClient rows={rows} />
      </div>
    </div>
  )
}
