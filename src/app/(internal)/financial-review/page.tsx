import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Financial Reviews' }
export const dynamic = 'force-dynamic'

type ReviewRow = {
  id: string
  review_number: string | null
  status: string
  created_at: string
  customers: { id: string; first_name: string; last_name: string; city: string | null; state: string | null } | null
  contracts: unknown[]
}

const STATUS_LABELS: Record<string, string> = {
  draft:    'Draft',
  ready:    'Ready',
  delivered:'Delivered',
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-700 text-slate-300',
  ready:     'bg-blue-900/40 text-blue-300',
  delivered: 'bg-green-900/40 text-green-300',
}

export default async function FinancialReviewListPage() {
  const supabase = createAdminClient()

  const { data: reviews } = await supabase
    .from('financial_reviews')
    .select(`
      id, review_number, status, created_at, contracts,
      customers ( id, first_name, last_name, city, state )
    `)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  const rows = (reviews ?? []) as unknown as ReviewRow[]

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-white text-2xl font-semibold">Financial Reviews</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Annuity analysis and customer-facing deliverables
            </p>
          </div>
          <Link
            href="/financial-review/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" />
            New Review
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <p className="text-lg">No financial reviews yet.</p>
            <p className="text-sm mt-1">Upload a carrier statement to get started.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Review #</th>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Location</th>
                  <th className="text-left px-4 py-3">Contracts</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map(r => {
                  const c = r.customers
                  const contractCount = Array.isArray(r.contracts) ? r.contracts.length : 0
                  const statusLabel = STATUS_LABELS[r.status] ?? r.status
                  const statusColor = STATUS_COLORS[r.status] ?? 'bg-slate-700 text-slate-300'
                  const created = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

                  return (
                    <tr key={r.id} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/financial-review/${r.id}`} className="text-blue-400 hover:text-blue-300 font-mono text-xs">
                          {r.review_number ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {c ? (
                          <Link href={`/financial-review/${r.id}`} className="text-white hover:text-slate-200">
                            {c.first_name} {c.last_name}
                          </Link>
                        ) : (
                          <Link href={`/financial-review/${r.id}`} className="text-slate-500 italic hover:text-slate-400">
                            No client
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {c?.city && c?.state ? `${c.city}, ${c.state}` : (c?.state ?? '—')}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {contractCount} contract{contractCount !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{created}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
