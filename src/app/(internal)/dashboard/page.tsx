import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'

type RecentCase = {
  id: string
  internal_status: string
  created_at: string
  customers: { first_name: string; last_name: string } | null
  agencies: { name: string } | null
  stage_translations: { agency_label: string; tier: number; is_active_case: boolean; is_won: boolean } | null
}

const TIER_COLORS: Record<number, string> = {
  1: 'text-blue-400',
  2: 'text-indigo-400',
  3: 'text-emerald-400',
}

function getSevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sevenDaysAgo = getSevenDaysAgo()

  const [activeResult, weekResult, recentResult] = await Promise.all([
    supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('is_test', false)
      .not('internal_status', 'in', '(placed,carrier_declined,client_withdrew,snoozed)'),
    supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('is_test', false)
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('cases')
      .select(`
        id,
        internal_status,
        created_at,
        customers ( first_name, last_name ),
        agencies ( name ),
        stage_translations ( agency_label, tier, is_active_case, is_won )
      `)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const activeCount = activeResult.count ?? 0
  const weekCount = weekResult.count ?? 0
  const recentCases = (recentResult.data ?? []) as unknown as RecentCase[]

  return (
    <div className="p-6 space-y-6">

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
            Active Cases
          </p>
          <p className="text-3xl font-bold text-white">{activeCount}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
            New This Week
          </p>
          <p className="text-3xl font-bold text-white">{weekCount}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
            Recent Cases
          </h2>
          <Link
            href="/referrals/new"
            className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>

        {recentCases.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-500 text-sm">No cases yet.</p>
            <Link
              href="/referrals/new"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300"
            >
              <Plus className="w-4 h-4" />
              Log your first case
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentCases.map((c) => {
              const st = c.stage_translations
              const statusColor = st?.is_won
                ? 'text-emerald-400'
                : st?.is_active_case
                  ? (TIER_COLORS[st.tier] ?? 'text-slate-400')
                  : 'text-slate-500'

              return (
                <Link
                  key={c.id}
                  href={`/referrals/${c.id}`}
                  className="block bg-slate-800 rounded-xl px-4 py-3 hover:bg-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {c.customers?.first_name ?? '—'} {c.customers?.last_name ?? ''}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {c.agencies?.name ?? '—'}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold ${statusColor}`}>
                      {st?.agency_label ?? c.internal_status}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
