import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { AgenciesClient } from './AgenciesClient'

export const metadata: Metadata = { title: 'Agencies' }

export const dynamic = 'force-dynamic'

export type AgencyRow = {
  id:             string
  name:           string
  display_name:   string | null
  slug:           string
  is_active:      boolean
  sml_team_id:    string | null
  sml_team:       string | null
  agent_number:   string | null
  contact_phone:  string | null
  contact_email:  string | null
  contact_street: string | null
  contact_city:   string | null
  contact_state:  string | null
  contact_zip:      string | null
  portal_pin:       string | null
  parent_agency_id: string | null
}

export type SmlTeamOption = { id: string; code: string; display_name: string }

export default async function AgenciesPage() {
  const supabase = createAdminClient()

  const [{ data: agencies }, { data: teams }] = await Promise.all([
    supabase
      .from('agencies')
      .select('id, name, display_name, slug, is_active, sml_team_id, sml_teams(display_name), agent_number, contact_phone, contact_email, contact_street, contact_city, contact_state, contact_zip, portal_pin, parent_agency_id')
      .eq('is_test', false)
      .order('name'),
    supabase
      .from('sml_teams')
      .select('id, code, display_name')
      .eq('is_active', true)
      .order('display_name'),
  ])

  const rows: AgencyRow[] = (agencies ?? []).map((a: Record<string, unknown>) => ({
    id:             a.id as string,
    name:           a.name as string,
    display_name:   a.display_name as string | null,
    slug:           a.slug as string,
    is_active:      a.is_active as boolean,
    sml_team_id:    a.sml_team_id as string | null,
    sml_team:       (a.sml_teams as { display_name: string } | null)?.display_name ?? null,
    agent_number:   a.agent_number as string | null,
    contact_phone:  a.contact_phone as string | null,
    contact_email:  a.contact_email as string | null,
    contact_street: a.contact_street as string | null,
    contact_city:   a.contact_city as string | null,
    contact_state:  a.contact_state as string | null,
    contact_zip:    a.contact_zip as string | null,
    portal_pin:       a.portal_pin as string | null,
    parent_agency_id: a.parent_agency_id as string | null,
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
