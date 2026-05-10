import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'

const STATUS_STYLES: Record<string, string> = {
  working:              'bg-blue-900/50 text-blue-300 border border-blue-800',
  attempting_contact:   'bg-blue-900/30 text-blue-400 border border-blue-900',
  contacted:            'bg-sky-900/50 text-sky-300 border border-sky-800',
  appt_set:             'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
  appt_kept:            'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
  appointment_set:      'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
  appt_missed:          'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  quoted:               'bg-purple-900/50 text-purple-300 border border-purple-800',
  app_submitted:        'bg-indigo-900/50 text-indigo-300 border border-indigo-800',
  pending_underwriting: 'bg-indigo-900/30 text-indigo-400 border border-indigo-900',
  placed:               'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
  not_interested:       'bg-slate-800/50 text-slate-500 border border-slate-700',
  declined:             'bg-red-950/50 text-red-400 border border-red-900',
  lost:                 'bg-slate-800/50 text-slate-500 border border-slate-700',
}

const STATUS_LABELS: Record<string, string> = {
  working:              'Working',
  attempting_contact:   'Attempting Contact',
  contacted:            'Contacted',
  appt_set:             'Appt Set',
  appt_kept:            'Appt Kept',
  appointment_set:      'Appt Set',
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

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-800 text-slate-400 border border-slate-700'
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

type ReferralRow = {
  id: string
  client_first_name: string
  client_last_name: string
  client_phone: string
  referral_type: string
  status: string
  intake_timestamp: string
  agencies: { agency_name: string } | null
  lsps: { first_name: string; last_name: string } | null
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams

  const { data: referrals } = await supabase
    .from('referrals')
    .select(`
      id,
      client_first_name,
      client_last_name,
      client_phone,
      referral_type,
      status,
      intake_timestamp,
      agencies ( agency_name ),
      lsps ( first_name, last_name )
    `)
    .order('intake_timestamp', { ascending: false })
    .limit(50)

  const rows = (referrals as unknown as ReferralRow[]) ?? []
  const activeCount = rows.filter(
    r => !['not_interested', 'placed', 'declined', 'lost'].includes(r.status)
  ).length

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-semibold">Referrals</h1>
            <p className="text-slate-400 text-sm mt-0.5">{activeCount} active · {rows.length} shown</p>
          </div>
          <Link
            href="/referrals/new"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" /> Log Referral
          </Link>
        </div>

        {params.success && (
          <div className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-300">
            Referral logged successfully.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-base font-medium text-slate-400">No referrals yet</p>
              <p className="mt-1 text-sm text-slate-500">Log your first referral to get started.</p>
              <Link
                href="/referrals/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: '#1F3864' }}
              >
                <Plus className="w-4 h-4" /> Log First Referral
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {['Contact', 'Agency', 'LSP', 'Type', 'Status', 'Date In'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`transition-colors hover:bg-slate-800/30 ${i < rows.length - 1 ? 'border-b border-slate-800/50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{r.client_first_name} {r.client_last_name}</p>
                      <p className="text-xs text-slate-500">{r.client_phone}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{r.agencies?.agency_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {r.lsps ? `${r.lsps.first_name} ${r.lsps.last_name}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{TYPE_LABELS[r.referral_type] ?? r.referral_type}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(r.intake_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}