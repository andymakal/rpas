import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { getMyProjects, type MyProjectsState } from '@/lib/my-work/projects'
import { MyProjectsClient } from './MyProjectsClient'

export const metadata: Metadata = { title: 'My Projects' }
export const dynamic = 'force-dynamic'

/**
 * MY PROJECTS — the projects the signed-in employee participates in, shown even
 * when nothing currently needs their attention. Each card preserves visibility
 * into progress, the responsible people, and the current bottleneck, and keeps
 * participation / ownership / escalation distinct.
 */
export default async function MyProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // My Projects reads participation, escalation, and the derived 1035 workflow
  // through the service-role client, so gate it behind the established
  // internal-admin check before any such read. Agency/portal users never reach it.
  const auth = await requireInternalAdmin()
  if (!auth.ok) redirect('/login')

  // A composition failure here (e.g. the running database is missing the
  // projects/workflow schema) must be VISIBLE, not silently rendered as an
  // employee with zero projects. Let it propagate to the internal error
  // boundary so a real database fault is never disguised as "no projects".
  // Genuinely-empty participation is still represented inside MyProjectsState
  // (projects: []), distinct from this error path.
  const state: MyProjectsState = await getMyProjects(user.id)

  return <MyProjectsClient state={state} />
}
