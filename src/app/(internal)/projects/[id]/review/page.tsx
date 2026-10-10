import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowHeader } from '@/components/workflow'
import { Review1035Client } from '../Review1035Client'

export const metadata: Metadata = { title: 'Work Project' }

export const dynamic = 'force-dynamic'

/**
 * 1035 working interface (Steps 2 / 3) as a standalone surface.
 *
 * Reached from a project's "Work Project" action. This is the same
 * Review1035Client that previously lived inside the project detail page; it is
 * mounted here on its own route so the project overview stays uncluttered while
 * the operational workflow (Stewardship servicing access, policy documents, and
 * Bob's determinations) keeps all of its behaviour and business rules intact.
 *
 * The whole (internal) route group is gated to internal staff; the review-1035
 * API routes additionally enforce requireInternalAdmin. Only the 1035 project
 * type uses this workflow — other types never link here.
 */
export default async function ProjectReviewPage({
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

  // Guard the surface the same way the detail page gates it: only 1035 projects
  // reach the working interface, and an archived project takes no new activity.
  const is1035 = /1035/.test(project.project_type)
  const isArchived = project.status === 'archived'
  if (!is1035 || isArchived) notFound()

  return (
    <WorkflowPage>
      <Link
        href={`/projects/${project.id}`}
        className="-ml-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-supporting transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to project
      </Link>

      <WorkflowHeader primary={project.name} secondary="1035 Exchange Review · Steps 2 & 3" />

      <Review1035Client projectId={project.id} />
    </WorkflowPage>
  )
}
