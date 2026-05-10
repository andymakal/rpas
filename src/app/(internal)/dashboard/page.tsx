import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'

type RecentReferral = {
  id: string
  contact_first_name: string
  contact_last_name: string
  referral_type: string
  status: string
  intake_timestamp: string
  agencies: { name: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  Working: 'text-blue-400',
  'Appt Set': 'text-emerald-400',
  'Appt Missed': 'text-yellow-400',
  Quoted: 'text-purple-400',
  'App Submitted': 'text-indigo-400',
  Placed: 'text-emerald-400',
  'Not Interested': 'text-slate-500',
  'LSP Contact Needed': 'text-orange-400',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [activeResult, weekResult, recentResult] = await Promise.all([
    supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("Not Interested","Placed")'),
    supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .gte('intake_timestamp', sevenDaysAgo),
    supabase
      .from('referrals')
      .select(
        `id, contact_first_name, contact_last_name, referral_type, status, intake_timestamp, agencies ( name )`
      )
      .order('intake_timestamp', { ascending: false })
      .limit(8),
  ])

  const activeCount = activeResult.count ?? 0
  const weekCount = weekResult.count ?? 0
  const recent = (recentResult.data as unknown as RecentReferral[]) ?? []

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-white text-2xl font-semibold">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-0.5">{today}</p>
          </div>
          <Link
            href="/referrals/new"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" />
            Log Referral
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Active Referrals</p>
            <p className="mt-1 text-3xl font-semibold text-white">{activeCount}</p>
            <p className="mt-1 text-xs text-slate-500">in pipeline</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">New This Week</p>
            <p className="mt-1 text-3xl font-semibold text-white">{weekCount}</p>
            <p className="mt-1 text-xs text-slate-500">last 7 days</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <h2 className="text-sm font-medium text-white">Recent Referrals</h2>
            <Link href="/referrals" className="text-xs text-slate-400 hover:text-slate-200">
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">No referrals yet.</p>
              <Link
                href="/referrals/new"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                Log your first referral
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {recent.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-800/20 transition-colors"
                >
                  <div>
                    <p className="text-sm text-white">
                      {r.contact_first_name} {r.contact_last_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.agencies?.name ?? '—'} · {r.referral_type}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-medium ${STATUS_COLORS[r.status] ?? 'text-slate-400'}`}>
                      {r.status}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {new Date(r.intake_timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
