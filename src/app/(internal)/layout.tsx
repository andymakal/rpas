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
  // workflow chrome (the persistent Mentoring header and its provider) is NOT
  // applied here — it is opted into per route by Bob's light-theme pages via
  // WorkflowChrome, so Andy's existing dark screens keep their original layout.
  //
  // SidebarCollapseProvider holds the one collapse state shared by Bob's header
  // button and the sidebar. It is behavior-neutral for Andy: his routes render
  // no collapse control, and the sidebar only honors the collapsed state on
  // Bob's workflow routes, so the default-expanded sidebar is unchanged there.
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
