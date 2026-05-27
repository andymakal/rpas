import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'

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
      <Sidebar userEmail={user.email ?? ''} />
      <main style={{ flex: '1 1 0%', minWidth: 0, overflowY: 'auto' }} className="bg-slate-950">{children}</main>
    </div>
  )
}
