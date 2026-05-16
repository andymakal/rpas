import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'

type StageTranslation = {
  agency_label: string
  tier: number
  is_active_case: boolean
}

type CaseRow = {
  id: string
  internal_status: string
  created_at: string
  agencies: { name: string } | null
  customers: { first_name: string; last_name: string; phone: string } | null
  agents: { first_name: string; last_name: string } | null
  stage_translations: StageTranslation | null
}

const TIER_BADGE: Record<number, string> = {
  1: 'bg-blue-900/50 text-blue-300 border border-blue-800',
  2: 'bg-indigo-900/50 text-indigo-300 border border-indigo-800',
  3: 'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
}

function StatusBadge({ translation, internal_status }: { translation: StageTranslation | null; internal_status: string }) {
  if (internal_status === 'placed') {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-700">
        {translation?.agency_label ?? 'Placed'}
      </span>
    )
  }
  if (translation?.is_active_case === false) {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-slate-800/50 text-slate-500 border border-slate-700">
        {translation?.agency_label ?? internal_status}
      </span>
    )
  }
  const tierCls = TIER_BADGE[translation?.tier ?? 1] ?? TIER_BADGE[1]
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tierCls}`}>
      {translation?.agency_label ?? internal_status}
    </span>
  )
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

  const { data: cases } = await supabase
    .from('cases')
    .select(`
      id,
      internal_status,
      created_at,
      agencies ( name ),
      customers ( first_name, last_name, phone ),
      agents ( first_name, last_name ),
      stage_translations ( agency_label, tier, is_active_case )
    `)
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (cases as unknown as CaseRow[]) ?? []
  const activeCount = rows.filter(r => r.stage_translations?.is_active_case === true).length

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-semibold">Cases</h1>
            <p className="text-slate-400 text-sm mt-0.5">{activeCount} active · {rows.length} shown</p>
          </div>
          <Link
            href="/referrals/new"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" /> Log Case
          </Link>
        </div>

        {params.success && (
          <div className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-300">
            Case logged successfully.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-base font-medium text-slate-400">No cases yet</p>
              <p className="mt-1 text-sm text-slate-500">Log your first case to get started.</p>
              <Link
                href="/referrals/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: '#1F3864' }}
              >
                <Plus className="w-4 h-4" /> Log First Case
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {['Contact', 'Agency', 'Agent', 'Status', 'Date In'].map(h => (
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
                      <p className="font-medium text-white">
                        {r.customers?.first_name ?? '—'} {r.customers?.last_name ?? ''}
                      </p>
                      <p className="text-xs text-slate-500">{r.customers?.phone ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{r.agencies?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {r.agents ? `${r.agents.first_name} ${r.agents.last_name}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge translation={r.stage_translations} internal_status={r.internal_status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
