import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectsClient } from './ProjectsClient'

export const metadata: Metadata = { title: 'Projects' }

export const dynamic = 'force-dynamic'

export type ProjectStatus = 'active' | 'completed' | 'archived'

export type ProjectRow = {
  id:              string
  name:            string
  project_type:    string
  description:     string | null
  status:          ProjectStatus
  created_at:      string
  completed_at:    string | null
  archived_at:     string | null
  // The state an archived project will return to on restore ('active' |
  // 'completed'); null unless archived.
  previous_status: 'active' | 'completed' | null
}

export default async function ProjectsPage() {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('projects')
    .select('id, name, description, status, created_at, completed_at, archived_at, previous_status, project_types ( name )')
    .order('created_at', { ascending: false })

  // Flatten the project_types embed to a plain project_type name so the list
  // rows and detail links stay simple.
  const projects: ProjectRow[] = (data ?? []).map(p => {
    const { project_types, ...rest } = p as typeof p & { project_types: { name: string } | null }
    return { ...rest, project_type: project_types?.name ?? '' } as ProjectRow
  })

  const current   = projects.filter(p => p.status === 'active')
  const completed = projects.filter(p => p.status === 'completed')
  const archived  = projects.filter(p => p.status === 'archived')

  // The shared WorkflowPage (inside ProjectsClient) owns the light workflow
  // surface, font, and gutter, so this page does not paint its own wrapper.
  return <ProjectsClient current={current} completed={completed} archived={archived} />
}
