import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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
export default async function MyWorkPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  return <MyWorkClient state={state} />
}
