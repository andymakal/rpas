import type { Metadata } from 'next'
import { Suspense } from 'react'
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

export type GdcRecord = {
  id: string
  policy_number: string | null
  insured_name: string | null
  product: string | null
  product_category: string | null
  production_credit: number
  policy_count: number
  app_date: string | null
  process_date: string | null
  linked_case_id: string | null
  linked_customer_id: string | null
  agency_id: string | null
  agencies: { name: string; display_name: string | null } | null
  linked_customer: { first_name: string; last_name: string } | null
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const sp = await searchParams
  const currentYear = new Date().getFullYear()
  const year = parseInt(sp.year ?? String(currentYear), 10)
  const safeYear = isNaN(year) ? currentYear : year

  const supabase = createAdminClient()

  const [casesResult, gdcResult] = await Promise.all([
    supabase
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
      .order('placed_at', { ascending: false, nullsFirst: false }),

    supabase
      .from('gdc_records')
      .select(`
        id, policy_number, insured_name, product, product_category,
        production_credit, policy_count, app_date, process_date,
        linked_case_id, linked_customer_id, agency_id,
        agencies ( name, display_name ),
        customers!linked_customer_id ( first_name, last_name )
      `)
      .gte('process_date', `${safeYear}-01-01`)
      .lte('process_date', `${safeYear}-12-31`)
      .order('process_date', { ascending: false, nullsFirst: false }),
  ])

  if (casesResult.error) {
    console.error('Production cases fetch error:', casesResult.error)
    return (
      <div className="p-8">
        <p className="text-red-400">Failed to load placed cases: {casesResult.error.message}</p>
      </div>
    )
  }

  const cases = (casesResult.data as unknown as PlacedCase[]) ?? []

  const rawGdc = (gdcResult.data ?? []) as unknown as (Omit<GdcRecord, 'linked_customer'> & {
    customers: { first_name: string; last_name: string } | null
  })[]

  // Normalize: rename the joined `customers` alias to `linked_customer`
  const gdcRecords: GdcRecord[] = rawGdc.map(r => {
    const { customers, ...rest } = r
    return { ...rest, linked_customer: customers ?? null }
  })

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">Production</h1>
          <p className="text-slate-400 text-sm mt-0.5">Pipeline reconciliation — placed cases vs. GDC actuals</p>
        </div>
        <Suspense fallback={null}>
          <ProductionClient
            cases={cases}
            gdcRecords={gdcRecords}
            selectedYear={safeYear}
            currentYear={currentYear}
          />
        </Suspense>
      </div>
    </div>
  )
}
