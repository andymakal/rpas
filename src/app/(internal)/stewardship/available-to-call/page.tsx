import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowHeader } from '@/components/workflow'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { AvailableToCallClient } from './AvailableToCallClient'

export const metadata: Metadata = { title: 'Call Reachable Customers' }
export const dynamic = 'force-dynamic'

/**
 * Call Reachable Customers — the direct working surface for the Available to
 * Call population of the shared Stewardship board. It mirrors the Send
 * Introductory Emails / Contact Research working-screen pattern: clicking the
 * activity in My Work lands straight on the first available customer (no
 * intermediate list and no separate Assistant panel), guides the call on a
 * single page (Reached / Didn't Reach), records the interaction once, applies
 * the established transition and follow-up scheduling, and advances
 * automatically to the next available customer.
 *
 * The business behavior is the EXISTING stewardship task (reused, not
 * reimplemented) driven into its guided call flow: the same record-attempt
 * grouping, outcome vocabulary, callback persistence, follow-up scheduling,
 * shared Customer Contact card, and authorization-form process. This route only
 * changes the SHAPE of the session from browse-a-list to a continuous
 * open/call/record/next pass over exactly the customers this employee is
 * eligible to call.
 *
 * The whole (internal) route group is gated to internal staff; the stewardship
 * API routes additionally enforce requireInternalAdmin and the capability/claim
 * gate, so the opened population equals exactly what My Work counted.
 */
export default async function AvailableToCallPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

  // Optional project scope: when present, scope the session to that project's
  // Available to Call population exactly as the board population view does. The
  // project id is carried through to the population fetch; an unknown id simply
  // yields an empty population (nothing to work).
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
    <WorkflowPage>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link
          href="/my-work"
          className="-ml-1 inline-flex items-center gap-1.5 text-base font-medium text-brand-hover transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to My Work
        </Link>
      </div>

      {/* "Call Reachable Customers" is the page title. The project scope, when
          set, is preserved through the project id passed to the client; it is
          deliberately not shown in the heading, matching Contact Research and
          Send Introductory Emails. */}
      <WorkflowHeader primary="Call Reachable Customers" />

      <AvailableToCallClient
        projectId={project?.id ?? null}
        actorTimeZone={actorTimeZone}
      />
    </WorkflowPage>
  )
}
