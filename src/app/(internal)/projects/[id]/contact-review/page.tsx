import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPermanentPolicyReviewTypeName } from '@/lib/projects/workflows'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import { ContactReviewClient } from '../ContactReviewClient'

export const metadata: Metadata = { title: 'Contact Research' }

export const dynamic = 'force-dynamic'

/**
 * Contact Research — the single consolidated contact-finding surface for a
 * project: complete customer contact information missing from the import,
 * covering both customers missing one method and customers missing both (the No
 * Usable Contact Information exception). It reuses the shared research interface
 * (same light-theme workflow look as Stewardship) and writes only to the
 * customer record; it never starts stewardship work or creates new records.
 *
 * Gated exactly like the 1035 working interface: only an active (non-archived)
 * 1035 project reaches it. The whole (internal) route group is already gated to
 * internal staff, and the contact-review API routes additionally enforce
 * requireInternalAdmin. The route path stays /contact-review for stability; the
 * surface is named Contact Research.
 */
export default async function ProjectContactReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { id } = await params
  const { customer_id } = await searchParams
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('projects')
    .select('id, name, status, project_types ( name )')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  const { project_types, ...rest } = data as typeof data & { project_types: { name: string } | null }
  const project = { ...rest, project_type: project_types?.name ?? '' }

  const isReviewType = isPermanentPolicyReviewTypeName(project.project_type)
  const isArchived = project.status === 'archived'
  if (!isReviewType || isArchived) notFound()

  return (
    <WorkflowPage
      heading={
        // "Contact Research" is the page title. The project scope is preserved
        // through the project id passed to the client below; it is deliberately
        // not shown in the heading.
        <WorkflowPageHeader
          title="Contact Research"
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      }
    >
      <ContactReviewClient projectId={project.id} initialCustomerId={customer_id ?? null} />
    </WorkflowPage>
  )
}
