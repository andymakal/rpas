import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { IntroductoryEmailsClient } from './IntroductoryEmailsClient'

export const metadata: Metadata = { title: 'Send Introductory Emails' }
export const dynamic = 'force-dynamic'

/**
 * Send Introductory Emails — the direct working surface for the first-touch
 * introductory-email population of the shared Stewardship board. It mirrors the
 * Contact Research working-screen pattern: clicking the activity in My Work
 * lands straight on the first eligible customer (no intermediate list), and
 * confirming a send advances automatically to the next eligible customer.
 *
 * The business behavior is unchanged — it reuses the SAME stewardship task
 * (ServicingFormDelivery: filled authorization PDF, mailto prepared email,
 * manual attach, the postal alternative, send confirmation, outreach history
 * and follow-up scheduling, claims, and the shared Customer Contact card). This
 * route only changes the SHAPE of the session from browse-a-list to a fast,
 * continuous open/send/confirm/next pass over exactly the customers this
 * employee is eligible to act on.
 *
 * The whole (internal) route group is gated to internal staff; the stewardship
 * API routes additionally enforce requireInternalAdmin and the capability/claim
 * gate, so the opened population equals exactly what My Work counted.
 */
export default async function IntroductoryEmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

  // Optional project scope: when present, scope the session to that project's
  // introductory-email population exactly as the board population view does.
  // The project id is carried through to the population fetch; an unknown id
  // simply yields an empty population (nothing to work).
  let project: { id: string; name: string } | null = null
  if (projectId) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle()
    if (data) project = { id: data.id as string, name: data.name as string }
  }

  // The signed-in employee's detected timezone, used to judge date-only
  // callback due on the actor's calendar for the population ordering (same as
  // the board).
  const actorTimeZone = await getActorTimeZone()

  return (
    <WorkflowPage
      heading={
        // "Send Introductory Emails" is the page title. The project scope, when
        // set, is preserved through the project id passed to the client; it is
        // deliberately not shown in the heading, matching Contact Research.
        <WorkflowPageHeader
          title="Send Introductory Emails"
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      }
    >
      <IntroductoryEmailsClient
        projectId={project?.id ?? null}
        actorTimeZone={actorTimeZone}
      />
    </WorkflowPage>
  )
}
