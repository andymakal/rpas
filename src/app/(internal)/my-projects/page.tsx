import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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

  let state: MyProjectsState
  try {
    state = await getMyProjects(user.id)
  } catch (err) {
    console.error('MY PROJECTS composition failed:', err)
    state = { employeeName: null, noProfile: false, projects: [] }
  }

  return <MyProjectsClient state={state} />
}
