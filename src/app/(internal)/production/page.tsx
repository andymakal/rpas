import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import ProductionClient from './ProductionClient'

export const metadata: Metadata = { title: 'Production' }

export const dynamic = 'force-dynamic'

export type PlacedCase = {
  id: string
  customer_id: string | null
  placed_at: string | null
  face_amount: number | null
  annual_premium: number | null
  policy_number: string | null
  customers: { first_name: string; last_name: string } | null
  agencies: { name: string; display_name: string | null } | null
  agents: { first_name: string; last_name: string } | null
  products: {
    name: string
    carriers: { short_name: string } | null
  } | null
}

export default async function ProductionPage() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('cases')
    .select(`
      id, customer_id, placed_at, face_amount, annual_premium, policy_number,
      customers!customer_id ( first_name, last_name ),
      agencies ( name, display_name ),
      agents ( first_name, last_name ),
      products ( name, carriers ( short_name ) )
    `)
    .eq('internal_status', 'placed')
    .eq('is_test', false)
    .order('placed_at', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('Production fetch error:', error)
    return (
      <div className="p-8">
        <p className="text-red-400">Failed to load production data: {error.message}</p>
      </div>
    )
  }

  const cases = (data as unknown as PlacedCase[]) ?? []

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">Production</h1>
          <p className="text-slate-400 text-sm mt-0.5">All placed policies — in-force tracker</p>
        </div>
        <ProductionClient cases={cases} />
      </div>
    </div>
  )
}
