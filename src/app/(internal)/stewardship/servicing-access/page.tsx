import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkflowPage, WorkflowHeader } from '@/components/workflow'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { ServicingAccessClient } from './ServicingAccessClient'

export const metadata: Metadata = { title: 'Servicing Access' }
export const dynamic = 'force-dynamic'

/**
 * Servicing Access — the direct working surface for the stage between Outreach
 * and Operations Preparation. Clicking the activity in My Work lands straight on
 * the first eligible customer whose signed servicing-agent authorization is in
 * hand (no intermediate customer-list screen), and a customer search lets an
 * employee open a specific customer the moment a signed authorization arrives.
 *
 * The business behavior is the EXISTING stewardship task driven into its
 * servicing-access flow (save the signed form, prepare the carrier email, send +
 * confirm, seven-day carrier follow-up, per-policy carrier confirmation), so
 * every business rule is reused unchanged. Confirming servicing access opens the
 * customer in Operations Preparation automatically via the existing handoff.
 *
 * The whole (internal) route group is gated to internal staff; the stewardship
 * API routes additionally enforce requireInternalAdmin and the capability/claim
 * gate, so the opened population equals exactly what My Work counted.
 */
export default async function ServicingAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  const supabase = createAdminClient()

  // Optional project scope: when present, scope the session to that project's
  // servicing-access population exactly as the board population view does.
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

      <WorkflowHeader primary="Servicing Access" />

      <ServicingAccessClient
        projectId={project?.id ?? null}
        actorTimeZone={actorTimeZone}
      />
    </WorkflowPage>
  )
}
