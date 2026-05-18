import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { AgenciesClient } from './AgenciesClient'

export const metadata: Metadata = { title: 'Agencies' }

export const dynamic = 'force-dynamic'

export type AgencyRow = {
  id:           string
  name:         string
  display_name: string | null
  slug:         string
  is_active:    boolean
  sml_team_id:  string | null
  sml_team:     string | null
}

export type SmlTeamOption = { id: string; code: string; display_name: string }

export default async function AgenciesPage() {
  const supabase = createAdminClient()

  const [{ data: agencies }, { data: teams }] = await Promise.all([
    supabase
      .from('agencies')
      .select('id, name, display_name, slug, is_active, sml_team_id, sml_teams(display_name)')
      .eq('is_test', false)
      .order('name'),
    supabase
      .from('sml_teams')
      .select('id, code, display_name')
      .eq('is_active', true)
      .order('display_name'),
  ])

  const rows: AgencyRow[] = (agencies ?? []).map((a: Record<string, unknown>) => ({
    id:           a.id as string,
    name:         a.name as string,
    display_name: a.display_name as string | null,
    slug:         a.slug as string,
    is_active:    a.is_active as boolean,
    sml_team_id:  a.sml_team_id as string | null,
    sml_team:     (a.sml_teams as { display_name: string } | null)?.display_name ?? null,
  }))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-white text-2xl font-semibold">Agencies</h1>
        <p className="text-slate-400 text-sm mt-1">
          Set the friendly display name shown in case dropdowns, dashboards, and portals.
          The Allstate name is kept for reference.
        </p>
      </div>
      <AgenciesClient agencies={rows} teams={teams ?? []} />
    </div>
  )
}
