import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-slate-950 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-white text-3xl font-semibold">
            Right Path Agency System
          </h1>
          <p className="text-slate-400 mt-1">
            Welcome back — dashboard coming soon.
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-slate-400 text-sm">
            Signed in as:{' '}
            <span className="text-white">{user.email}</span>
          </p>
        </div>
      </div>
    </div>
  )
}