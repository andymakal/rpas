import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { PopulationBuilderClient } from './PopulationBuilderClient'

export const metadata: Metadata = { title: 'Build Population' }

export const dynamic = 'force-dynamic'

/**
 * Administrative Project Population Builder page.
 *
 * The whole (internal) route group is already gated to internal staff by
 * proxy.ts + the layout; the population API routes additionally enforce
 * requireInternalAdmin. This screen is the faceted filter builder used right
 * after creating a project and from a project's "Add Population" action. It is
 * NOT the worker/capture screen.
 */
export default async function PopulationBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('projects')
    .select('id, name, status, project_types ( name )')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  const { project_types, ...rest } = data as typeof data & { project_types: { name: string } | null }
  const project = { ...rest, project_type: project_types?.name ?? '' }

  // How many customers are already in the project (for context + "already in"
  // messaging after a run).
  const { count: existingCount } = await supabase
    .from('project_customers')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)

  return (
    <div className="min-h-full bg-slate-50">
      <PopulationBuilderClient
        projectId={project.id}
        projectName={project.name}
        projectType={project.project_type}
        existingCustomerCount={existingCount ?? 0}
      />
    </div>
  )
}
