import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { AgencyPortal } from '@/components/portal/AgencyPortal'

export default async function PortalPage({
  params,
}: {
  params: { slug: string }
}) {
  const supabase = createAdminClient()

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, agency_name, principal_first_name, principal_last_name, allstate_agent_id, slug')
    .eq('slug', params.slug)
    .eq('is_active', true)
    .single()

  if (!agency) notFound()

  const { data: referrals } = await supabase
    .from('referrals')
    .select('id, client_first_name, client_last_name, referral_type, status, intake_timestamp, lsp_name')
    .eq('agency_id', agency.id)
    .order('intake_timestamp', { ascending: false })

  return (
    <AgencyPortal
      agency={{
        name: `${agency.principal_first_name} ${agency.principal_last_name}`,
        agentId: agency.allstate_agent_id ?? '',
        slug: agency.slug ?? '',
      }}
      referrals={referrals ?? []}
    />
  )
}