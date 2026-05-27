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
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar userEmail={user.email ?? ''} />
      <main className="flex-1 overflow-y-auto bg-slate-950">{children}</main>
    </div>
  )
}
