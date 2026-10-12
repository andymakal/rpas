import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { ActorTimeZoneSync } from '@/lib/time/ActorTimeZoneSync'
import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'

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

  return (
    // MentoringProvider wraps the whole internal shell so the persistent
    // Mentoring toggle in the Sidebar and any page's coaching notes share one
    // source of truth. It is the only app-wide client provider.
    <MentoringProvider>
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {/* Keep the signed-in employee's detected timezone synced into a cookie so
            server surfaces (Daily Direction, future scheduling/queues) render on
            the actor's own clock. Renders nothing. */}
        <ActorTimeZoneSync />
        <Sidebar userEmail={user.email ?? ''} />
        <main style={{ flex: '1 1 0%', minWidth: 0, overflowY: 'auto' }} className="bg-slate-950">{children}</main>
      </div>
    </MentoringProvider>
  )
}
