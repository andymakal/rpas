import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { ActorTimeZoneSync } from '@/lib/time/ActorTimeZoneSync'
import { SidebarCollapseProvider } from '@/components/layout/SidebarCollapseProvider'

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Shared internal shell: navy sidebar + a scrolling page body. The light-theme
  // workflow chrome (the MentoringProvider) is NOT applied here — it is opted
  // into per route by Bob's light-theme pages via WorkflowChrome, so Andy's
  // existing dark screens keep their original layout.
  //
  // SidebarCollapseProvider still holds the shared collapse state. The old
  // header collapse button was removed, so no control currently flips it and
  // the sidebar stays expanded; the provider is kept because the sidebar still
  // reads the state and it remains behavior-neutral for Andy's routes.
  return (
    <SidebarCollapseProvider>
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {/* Keep the signed-in employee's detected timezone synced into a cookie so
            server surfaces (Daily Direction, future scheduling/queues) render on
            the actor's own clock. Renders nothing. */}
        <ActorTimeZoneSync />
        <Sidebar userEmail={user.email ?? ''} />
        <main style={{ flex: '1 1 0%', minWidth: 0, overflowY: 'auto' }} className="bg-slate-950">{children}</main>
      </div>
    </SidebarCollapseProvider>
  )
}
