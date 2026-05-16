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

  const year = new Date().getFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd   = `${year}-12-31`

  const [casesResult, gdcResult, appResult] = await Promise.all([
    supabase
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
      .order('created_at', { ascending: false }),

    supabase
      .from('gdc_records')
      .select('production_credit')
      .eq('agency_id', agency.id)
      .gte('process_date', yearStart)
      .lte('process_date', yearEnd),

    supabase
      .from('gdc_records')
      .select('policy_number')
      .eq('agency_id', agency.id)
      .gte('process_date', yearStart)
      .lte('process_date', yearEnd)
      .gt('production_credit', 0),
  ])

  const gdcYtd = (gdcResult.data ?? []).reduce(
    (sum, r) => sum + Number(r.production_credit ?? 0), 0
  )
  const appCount = new Set(
    (appResult.data ?? []).map(r => r.policy_number).filter(Boolean)
  ).size

  return (
    <AgencyPortal
      agency={{ name: agency.name, slug: agency.slug }}
      cases={(casesResult.data ?? []) as unknown as Case[]}
      gdcYtd={gdcYtd}
      appCount={appCount}
    />
  )
}
