import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { CallsDueClient } from './CallsDueClient'

export const metadata: Metadata = { title: 'Make the Calls That Are Due' }
export const dynamic = 'force-dynamic'

/**
 * Make the Calls That Are Due: the ONE calling list. Everybody owed a call
 * appears here, whatever the reason: a first call, a cadence retry whose
 * business day has arrived, or a promised callback that has come due. A customer
 * leaves the list only when someone records an attempt (which puts them back on
 * hold for the next business-day cadence date). Customers on hold, future
 * callbacks, and customers who still need an introductory email are not on it.
 *
 * Clicking the activity in My Work lands straight on the first customer, guides
 * the call on a single page, records the interaction once, applies the
 * established transition and follow-up scheduling, and advances automatically.
 * The business behavior is the EXISTING stewardship task driven into its guided
 * call flow.
 *
 * The whole (internal) route group is gated to internal staff; the stewardship
 * API routes additionally enforce requireInternalAdmin and the capability/claim
 * gate, so the opened list equals exactly what My Work counted.
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
        // is deliberately not shown in the heading, matching the other working screens.
        <WorkflowPageHeader
          title="Make the Calls That Are Due"
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      }
    >
      <CallsDueClient
        population="calls-due"
        projectId={project?.id ?? null}
        actorTimeZone={actorTimeZone}
      />
    </WorkflowPage>
  )
}
