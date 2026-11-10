import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import { UnableToCallClient } from './UnableToCallClient'

export const metadata: Metadata = { title: 'Find Missing Phone Numbers' }
export const dynamic = 'force-dynamic'

/**
 * People We Can't Call — the outreach surface for active customers with no
 * usable phone. PLACEHOLDER: it currently lists the population so the work is
 * visible; the recover-a-phone guided branch and the email/postal workflow are
 * the next build (see UnableToCallClient for the intended flow). Sibling of
 * "Make the Calls That Are Due" under Outreach.
 */
export default async function UnableToCallPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

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
    <WorkflowPage
      heading={
        <WorkflowPageHeader
          title="Find Missing Phone Numbers"
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      }
    >
      <UnableToCallClient projectId={project?.id ?? null} />
    </WorkflowPage>
  )
}
