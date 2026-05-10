import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'

type RecentReferral = {
  id: string
  client_first_name: string
  client_last_name: string
  referral_type: string
  status: string
  intake_timestamp: string
  agencies: { agency_name: string }[] | null
}

const STATUS_COLORS: Record<string, string> = {
  working:              'text-blue-400',
  attempting_contact:   'text-blue-400',
  appt_set:             'text-emerald-400',
  appt_kept:            'text-emerald-400',
  appt_missed:          'text-yellow-400',
  quoted:               'text-purple-400',
  app_submitted:        'text-indigo-400',
  pending_underwriting: 'text-indigo-400',
  placed:               'text-emerald-400',
  not_interested:       'text-slate-500',
  declined:             'text-red-400',
  lost:                 'text-slate-500',
}

const STATUS_LABELS: Record<string, string> = {
  working:              'Working',
  attempting_contact:   'Attempting Contact',
  appt_set:             'Appt Set',
  appt_kept:            'Appt Kept',
  appt_missed:          'Appt Missed',
  quoted:               'Quoted',
  app_submitted:        'App Submitted',
  pending_underwriting: 'Pending UW',
  placed:               'Placed',
  not_interested:       'Not Interested',
  declined:             'Declined',
  lost:                 'Lost',
}

const TYPE_LABELS: Record<string, string> = {
  mortgage_protection: 'Mortgage Protection',
  life_review:         'Life Review',
  financial_planning:  'Financial Planning',
  business_owner:      'Business Owner',
  umbrella_flagged:    'Umbrella Flagged',
  wanderer_review:     'Wanderer Review',
  '1035_exchange':     '1035 Exchange',
  tobacco_rerate:      'Tobacco Rerate',
  term_expiry:         'Term Expiry',
  annuity_review:      'Annuity Review',
  uit_rollover:        'UIT Rollover',
  general:             'General',
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
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .gte('intake_timestamp', sevenDaysAgo),
    supabase
      .from('referrals')
      .select(`
        id,
        client_first_name,
        client_last_name,
        referral_type,
        status,
        intake_timestamp,
        agencies ( agency_name )
      `)
      .order('intake_timestamp', { ascending: false })
      .limit(10),
  ])

  const activeCount = activeResult.count ?? 0
  const weekCount = weekResult.count ?? 0
  const recentReferrals = (recentResult.data ?? []) as unknown as RecentReferral[]

  return (
    <div className="p-6 space-y-6">

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
            Active Referrals
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

      {/* Recent Referrals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
            Recent Referrals
          </h2>
          <Link
            href="/referrals/new"
            className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </Link>
        </div>

        {recentReferrals.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-500 text-sm">No referrals yet.</p>
            <Link
              href="/referrals/new"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300"
            >
              <Plus className="w-4 h-4" />
              Add your first referral
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentReferrals.map((r) => (
              <Link
                key={r.id}
                href={`/referrals/${r.id}`}
                className="block bg-slate-800 rounded-xl px-4 py-3 hover:bg-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {r.client_first_name} {r.client_last_name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {r.agencies?.[0]?.agency_name ?? '—'} · {TYPE_LABELS[r.referral_type] ?? r.referral_type}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold ${STATUS_COLORS[r.status] ?? 'text-slate-400'}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}