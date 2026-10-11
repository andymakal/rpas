import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { ActorTimeZoneSync } from '@/lib/time/ActorTimeZoneSync'

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
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      {/* Keep the signed-in employee's detected timezone synced into a cookie so
          server surfaces (Daily Direction, future scheduling/queues) render on
          the actor's own clock. Renders nothing. */}
      <ActorTimeZoneSync />
      <Sidebar userEmail={user.email ?? ''} />
      <main style={{ flex: '1 1 0%', minWidth: 0, overflowY: 'auto' }} className="bg-slate-950">{children}</main>
    </div>
  )
}
