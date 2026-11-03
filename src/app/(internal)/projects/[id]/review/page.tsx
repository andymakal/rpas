import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPermanentPolicyReviewTypeName } from '@/lib/projects/workflows'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
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
  searchParams,
}: {
  params: Promise<{ id: string }>
  // Optional deep link: ?customer_id= opens directly on that customer's task,
  // used to open Operations Preparation for a customer the moment their
  // servicing access is confirmed (the Servicing Access screen routes here).
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { id } = await params
  const { customer_id: initialCustomerId } = await searchParams
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('projects')
    .select('id, name, status, project_types ( name )')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  const { project_types, ...rest } = data as typeof data & { project_types: { name: string } | null }
  const project = { ...rest, project_type: project_types?.name ?? '' }

  // Guard the surface the same way the detail page gates it: only Permanent
  // Policy Review projects (the type formerly named "1035 Exchange") reach the
  // working interface, and an archived project takes no new activity.
  const isReviewType = isPermanentPolicyReviewTypeName(project.project_type)
  const isArchived = project.status === 'archived'
  if (!isReviewType || isArchived) notFound()

  return (
    <WorkflowPage
      heading={
        <WorkflowPageHeader
          title={project.name}
          secondary="Permanent Policy Review · Steps 2 & 3"
          back={
            <>
              <WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>
              <WorkflowBackLink href={`/projects/${project.id}`} tone="muted" withArrow={false}>
                Back to project
              </WorkflowBackLink>
            </>
          }
        />
      }
    >
      <Review1035Client projectId={project.id} initialCustomerId={initialCustomerId ?? null} />
    </WorkflowPage>
  )
}
