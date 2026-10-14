import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { getMyWork } from '@/lib/my-work/composition'
import type { MyWorkState } from '@/lib/my-work/types'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { MyWorkClient } from './MyWorkClient'

export const metadata: Metadata = { title: 'My Work' }
export const dynamic = 'force-dynamic'

/**
 * MY WORK — the signed-in employee's actionable work, organized BY ACTIVITY
 * across the shared Stewardship board and the 1035 project.
 *
 * The server composition (getMyWork) reads existing records only (no task
 * database), groups each business activity once, resolves the employee's
 * capability eligibility, their claims, and Today's Focus, and lets the GoRules
 * ZEN decision assign each activity's priority band. The client renders the
 * ready state and lets an eligible worker claim/release shared items.
 *
 * The actor's detected timezone drives the date-only "due today" judgment for
 * promised callbacks, so each employee sees their own day.
 */
export default async function MyWorkPage({
  searchParams,
}: {
  // Optional deep-link pre-selection: "Work Project" on My Projects opens My
  // Work with that project already selected in the Project filter. Both filters
  // are otherwise chosen in the client; only the project pre-select is seeded
  // from the URL so the deep link survives a reload.
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: initialProjectId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Gate the service-role composition behind the established internal-admin
  // check: My Work reads the shared board and the 1035 workflow through the
  // service-role client (bypassing RLS), so an authenticated-but-not-internal
  // user (e.g. an agency portal user) must never reach it. requireInternalAdmin
  // returns ok only for internal admins; agency/portal users are sent to login.
  const auth = await requireInternalAdmin()
  if (!auth.ok) redirect('/login')

  const actorTimeZone = await getActorTimeZone()

  let state: MyWorkState
  try {
    state = await getMyWork({ authUserId: user.id, actorTimeZone })
  } catch (err) {
    console.error('MY WORK composition failed:', err)
    // Degrade gracefully: an empty, quiet state rather than a broken page.
    state = {
      employeeName: null,
      noProfile: false,
      activities: [],
      focusNotes: [],
      quiet: true,
    }
  }

  return <MyWorkClient state={state} initialProjectId={initialProjectId ?? null} />
}
