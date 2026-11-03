import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { AvailableToCallClient } from '../available-to-call/AvailableToCallClient'

export const metadata: Metadata = { title: 'Make the Calls That Are Due' }
export const dynamic = 'force-dynamic'

/**
 * Make the Calls That Are Due — the direct working surface for the Calls Due
 * population of the shared Stewardship board (customers whose promised callback
 * or automatic retry is due now).
 *
 * It reuses the SAME guided calling workbench as Call Other Reachable Customers
 * (AvailableToCallClient), driven with population="calls-due". There is no
 * intermediate Calls Due customer list: clicking the activity in My Work lands
 * straight on the first due customer, guides the call on a single page, records
 * the interaction once, applies the established transition and follow-up
 * scheduling, and advances automatically to the next DUE customer. When no due
 * calls remain, the completion state offers continuing with ordinary available
 * calls or returning to My Work.
 *
 * The business behavior is the EXISTING stewardship task driven into its guided
 * call flow: the same record-attempt grouping, outcome vocabulary, callback
 * persistence, follow-up scheduling, shared Customer Contact card, and
 * authorization-form process. The due and available activities differ only in
 * which customers are fetched — not in the call flow, the follow-up timing, or
 * any workflow. This is one calling workflow, not two.
 *
 * The whole (internal) route group is gated to internal staff; the stewardship
 * API routes additionally enforce requireInternalAdmin and the capability/claim
 * gate, so the opened population equals exactly what My Work counted.
 */
export default async function CallsDuePage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

  // Optional project scope: when present, scope the session to that project's
  // Calls Due population exactly as the board population view does. The project
  // id is carried through to the population fetch; an unknown id simply yields
  // an empty population (nothing due to work).
  let project: { id: string; name: string } | null = null
  if (projectId) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle()
    if (data) project = { id: data.id as string, name: data.name as string }
  }

  // The signed-in employee's detected timezone, used to judge date-only callback
  // due on the actor's calendar for the population ordering (same as the board).
  const actorTimeZone = await getActorTimeZone()

  return (
    <WorkflowPage
      heading={
        // "Make the Calls That Are Due" is the page title. The project scope,
        // when set, is preserved through the project id passed to the client; it
        // is deliberately not shown in the heading, matching Call Other Reachable
        // Customers.
        <WorkflowPageHeader
          title="Make the Calls That Are Due"
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      }
    >
      <AvailableToCallClient
        population="calls-due"
        projectId={project?.id ?? null}
        actorTimeZone={actorTimeZone}
      />
    </WorkflowPage>
  )
}
