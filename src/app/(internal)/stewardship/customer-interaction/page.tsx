import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage } from '@/components/workflow'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { CustomerInteractionClient } from './CustomerInteractionClient'

export const metadata: Metadata = { title: 'Customer Interaction' }
export const dynamic = 'force-dynamic'

/**
 * Customer Interaction — the direct working surface for the step between routine
 * calling/outreach and Servicing Access. Clicking the activity in My Work lands
 * straight on the first customer who has genuinely engaged (responded by email,
 * phone, or text, or been reached on a call) but has NOT yet returned the signed
 * authorization, and a customer search lets an employee open a specific customer
 * the moment a response comes in.
 *
 * The business behavior is the EXISTING stewardship task driven into its guided
 * conversation flow (record incoming responses, outgoing replies, conversation
 * notes, and follow-up commitments), so every rule is reused unchanged. When the
 * signed authorization arrives the customer moves on to the existing Servicing
 * Access workflow automatically; an incomplete form keeps them here until it is
 * resolved. An explicit refusal stops outreach (reversible via reopen).
 *
 * The whole (internal) route group is gated to internal staff; the stewardship
 * API routes additionally enforce requireInternalAdmin and the capability/claim
 * gate, so the opened population equals exactly what My Work counted.
 */
export default async function CustomerInteractionPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

  // Optional project scope: when present, scope the session to that project's
  // customer-interaction population exactly as the board population view does.
  let project: { id: string; name: string } | null = null
  if (projectId) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle()
    if (data) project = { id: data.id as string, name: data.name as string }
  }

  const actorTimeZone = await getActorTimeZone()

  return (
    <WorkflowPage
      heading={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link
            href="/my-work"
            className="-ml-1 inline-flex items-center gap-1.5 text-base font-medium text-brand-hover transition-colors hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to My Work
          </Link>
        </div>
      }
    >
      <CustomerInteractionClient
        projectId={project?.id ?? null}
        actorTimeZone={actorTimeZone}
      />
    </WorkflowPage>
  )
}
