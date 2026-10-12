import { createClient } from '@/lib/supabase/server'
import { InternalHeader } from '@/components/layout/InternalHeader'
import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import { resolveProducerForUser } from '@/lib/capabilities/resolve'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { personalGreeting } from '@/lib/greeting'

/**
 * Light-theme workflow chrome for Bob's operator-facing pages ONLY.
 *
 * This is the persistent workflow header (collapse toggle, personalized
 * greeting, prominent Mentoring control, sign out) plus the MentoringProvider
 * that backs the Mentoring toggle. It deliberately lives OUTSIDE the shared
 * internal layout so it applies only to the light-theme workflow routes
 * (My Work, My Projects, Projects, Stewardship, Today's Focus) and never bleeds
 * onto Andy's existing dark screens, which keep their original layout.
 *
 * Server component: it resolves the signed-in employee's first name and
 * detected timezone to build the greeting on the actor's own clock, then hands
 * the ready string to the client header. The sidebar collapse state is owned by
 * SidebarCollapseProvider in the shared internal layout, which sits above this.
 */
export async function WorkflowChrome({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let firstName: string | null = null
  if (user) {
    const producer = await resolveProducerForUser(user.id)
    firstName = producer?.first_name ?? null
  }
  const actorTimeZone = await getActorTimeZone()
  const greeting = personalGreeting(firstName, actorTimeZone)

  return (
    <MentoringProvider>
      <InternalHeader greeting={greeting} />
      {children}
    </MentoringProvider>
  )
}
