import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { AgencyPortal, type Case } from '@/components/portal/AgencyPortal'

export default async function PortalPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = createAdminClient()

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, name, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!agency) notFound()

  const { data: cases } = await supabase
    .from('cases')
    .select(`
      id,
      internal_status,
      created_at,
      customers ( first_name, last_name ),
      agents ( first_name, last_name ),
      stage_translations ( agency_label, tier, is_active_case, is_won, is_lost )
    `)
    .eq('agency_id', agency.id)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  return (
    <AgencyPortal
      agency={{ name: agency.name, slug: agency.slug }}
      cases={(cases ?? []) as unknown as Case[]}
    />
  )
}
