import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDailyDirection } from '@/lib/daily-direction/stewardship'
import type { DailyDirectionState } from '@/lib/daily-direction/types'
import { DailyDirectionBriefing } from '@/components/workflow/daily-direction'
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

  // Daily Direction Assistant: a read-only, GoRules-powered recommendation of
  // what deserves attention next on the shared Stewardship board. It never
  // writes stewardship state and never gates the board, so a failure degrades
  // gracefully to no briefing rather than breaking the page. The project-scoped
  // view keeps the Assistant on the unscoped board for now (the composition
  // reads the full open board); scoping it to a project is a later slice.
  let dailyDirection: DailyDirectionState | null = null
  if (!project) {
    try {
      dailyDirection = await getDailyDirection()
    } catch (err) {
      console.error('Daily Direction briefing failed:', err)
    }
  }

  return (
    <div className="min-h-full bg-slate-50 p-8">
      {dailyDirection && (
        <div className="mx-auto mb-6 w-full max-w-[var(--ds-page-width-standard,72rem)]">
          <DailyDirectionBriefing state={dailyDirection} />
        </div>
      )}
      <StewardshipClient agencies={agencyOptions} project={project} />
    </div>
  )
}
