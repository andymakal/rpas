import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import { VerifyServicingAgentClient } from './VerifyServicingAgentClient'

export const metadata: Metadata = { title: 'Verify Servicing Agent' }

export const dynamic = 'force-dynamic'

/**
 * Verify Servicing Agent — step 1 of servicing-agent capture.
 *
 * Reached from a project's "Verify Servicing Agent" action. Lists the project's
 * Everlake-eligible policies and lets an operator record, per policy, whether we
 * are the servicing agent (checked against the Everlake Agent Portal). This is
 * the gate before capture outreach: a policy verified as not-on-file becomes
 * capture work; a confirmed one needs no capture.
 *
 * Gated to internal staff by the (internal) route group; the API route
 * additionally enforces requireInternalAdmin. An archived project takes no new
 * activity.
 */
export default async function VerifyServicingAgentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  if (data.status === 'archived') notFound()

  return (
    <WorkflowPage
      heading={
        // "Verify Servicing Agent" is the page title. The project scope is
        // preserved through the project id passed to the client; like Contact
        // Research, it is deliberately not shown in the heading, and the back
        // link returns to My Work (this is a My Work activity, not a project
        // sub-page).
        <WorkflowPageHeader
          title="Verify Servicing Agent"
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      }
    >
      <VerifyServicingAgentClient projectId={id} />
    </WorkflowPage>
  )
}
