import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { SpiffClient } from './SpiffClient'

export const metadata: Metadata = { title: 'SPIFF Ledger' }
export const dynamic = 'force-dynamic'

export type SpiffRow = {
  id: string
  earned_at: string
  paid_at: string | null
  amount: number
  cases: {
    id: string
    customers: { first_name: string; last_name: string } | null
  } | null
  agents: { first_name: string; last_name: string } | null
  agencies: { name: string; display_name: string | null } | null
}

export default async function SpiffPage() {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('spiff_records')
    .select(`
      id, earned_at, paid_at, amount,
      cases ( id, customers ( first_name, last_name ) ),
      agents ( first_name, last_name ),
      agencies ( name, display_name )
    `)
    .order('earned_at', { ascending: false })

  const rows = (data as unknown as SpiffRow[]) ?? []

  const totalEarned    = rows.reduce((s, r) => s + Number(r.amount), 0)
  const totalPaid      = rows.filter(r => r.paid_at).reduce((s, r) => s + Number(r.amount), 0)
  const totalOutstanding = totalEarned - totalPaid

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">SPIFF Ledger</h1>
          <p className="text-slate-400 text-sm mt-1">
            $10 per qualified conversation — tracked per LSP, independent of placement
          </p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Earned',      value: totalEarned,      cls: 'text-white'         },
            { label: 'Paid Out',          value: totalPaid,        cls: 'text-emerald-400'   },
            { label: 'Outstanding',       value: totalOutstanding, cls: 'text-amber-400'     },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400 mb-1">{label}</p>
              <p className={`text-2xl font-semibold ${cls}`}>
                ${value.toFixed(2)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {rows.filter(r => label === 'Outstanding' ? !r.paid_at : label === 'Paid Out' ? !!r.paid_at : true).length} records
              </p>
            </div>
          ))}
        </div>

        <SpiffClient rows={rows} />
      </div>
    </div>
  )
}
