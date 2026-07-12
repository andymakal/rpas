import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { ServiceRequestClient } from './ServiceRequestClient'

export const dynamic = 'force-dynamic'

export type ServiceRequestDetail = {
  id: string
  sr_number: string | null
  request_type: string
  workflow_status: string
  date_received: string
  date_resolved: string | null
  notes: string | null
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
    annual_premium: number | null
    premium_mode: string | null
    rate_class: string | null
    sa_status: string
    notes: string | null
    agency_id: string | null
    agent_id: string | null
    customer_id: string | null
    agencies: { id: string; name: string; display_name: string | null } | null
    agents: { id: string; first_name: string; last_name: string } | null
  } | null
}

export type AgencyOption = { id: string; name: string; display_name: string | null }
export type AgentOption  = { id: string; first_name: string; last_name: string; agency_id: string | null }
export type SRNote = {
  id:          string
  section:     'triage' | 'producer' | 'underwriting'
  author_name: string
  body:        string
  created_at:  string
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('service_requests')
    .select('sr_number, service_policies(client_name)')
    .eq('id', id)
    .single()
  const sr   = data as { sr_number: string | null; service_policies: { client_name: string } | null } | null
  const name = sr?.service_policies?.client_name ?? 'Service Request'
  return { title: sr?.sr_number ? `${sr.sr_number} — ${name}` : name }
}

export default async function ServiceRequestPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createAdminClient()

  const [{ data: sr }, { data: agencies }, { data: agents }] = await Promise.all([
    supabase
      .from('service_requests')
      .select(`
        id, sr_number, request_type, workflow_status,
        date_received, date_resolved, notes, created_at, updated_at,
        service_policies (
          id, client_name, policy_number, carrier, product_type,
          issue_date, term_length, face_amount, annual_premium,
          premium_mode, rate_class, sa_status, notes,
          agency_id, agent_id, customer_id,
          agencies ( id, name, display_name ),
          agents ( id, first_name, last_name )
        )
      `)
      .eq('id', id)
      .single(),
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

  if (!sr) notFound()

  // Fetch SR notes
  const { data: notesRaw } = await supabase
    .from('customer_notes')
    .select('id, section, author_name, body, created_at')
    .eq('service_request_id', id)
    .order('created_at', { ascending: false })
  const srNotes: SRNote[] = (notesRaw ?? []) as SRNote[]

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <ServiceRequestClient
          sr={(sr as unknown as ServiceRequestDetail)}
          agencies={(agencies as AgencyOption[]) ?? []}
          agents={(agents as AgentOption[]) ?? []}
          initialNotes={srNotes}
        />
      </div>
    </div>
  )
}
