import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { StewardshipClient } from './StewardshipClient'

export const metadata: Metadata = { title: 'Stewardship' }
export const dynamic = 'force-dynamic'

export type AgencyOption = { id: string; name: string }

export default async function StewardshipPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

  const { data: agencies } = await supabase
    .from('agencies')
    .select('id, name, display_name')
    .eq('is_test', false)
    .order('name')

  const agencyOptions: AgencyOption[] = (agencies ?? []).map((a: Record<string, unknown>) => ({
    id: a.id as string,
    name: (a.display_name as string | null) ?? (a.name as string),
  }))

  // Optional project scope: when a project_id is present we render the SAME
  // stewardship screen but scoped to that project. Resolve the project name for
  // the header; an unknown/absent id falls back to the unscoped screen.
  let project: { id: string; name: string } | null = null
  if (projectId) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle()
    if (data) project = { id: data.id as string, name: data.name as string }
  }

  return (
    <div className="min-h-full bg-slate-50 p-8">
      <StewardshipClient agencies={agencyOptions} project={project} />
    </div>
  )
}
