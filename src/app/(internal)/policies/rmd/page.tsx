import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { RmdClient } from './RmdClient'

export const metadata: Metadata = { title: 'RMD Call List' }
export const dynamic = 'force-dynamic'

export type RmdRow = {
  id:                string
  client_name:       string
  policy_number:     string
  carrier:           string
  product_type:      string | null
  cash_value_amount: number | null
  rmd_amount:        number | null
  coverage_status:   string
  customer_id:       string | null
  agencies:          { name: string; display_name: string | null } | null
  customers:         { first_name: string; last_name: string; phone: string | null } | null
}

const TERMINAL = ['Lapsed', 'Surrendered', 'Terminated', 'Cancelled', 'Matured']

export default async function RmdPage() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('service_policies')
    .select(`
      id, client_name, policy_number, carrier, product_type,
      cash_value_amount, type_data, coverage_status, customer_id,
      agencies ( name, display_name ),
      customers ( first_name, last_name, phone )
    `)
    .eq('is_test', false)
    .filter('type_data->>rmd_required', 'eq', 'true')
    .not('coverage_status', 'in', `(${TERMINAL.join(',')})`)
    .order('client_name', { ascending: true })

  if (error) console.error('RMD fetch error:', error)

  const rows: RmdRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const td = r.type_data as Record<string, unknown> | null
    return {
      id:                r.id as string,
      client_name:       r.client_name as string,
      policy_number:     r.policy_number as string,
      carrier:           r.carrier as string,
      product_type:      r.product_type as string | null,
      cash_value_amount: r.cash_value_amount as number | null,
      rmd_amount:        td?.rmd_amount != null ? Number(td.rmd_amount) : null,
      coverage_status:   r.coverage_status as string,
      customer_id:       r.customer_id as string | null,
      agencies:          (Array.isArray(r.agencies) ? r.agencies[0] : r.agencies) as RmdRow['agencies'],
      customers:         (Array.isArray(r.customers) ? r.customers[0] : r.customers) as RmdRow['customers'],
    }
  })

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <RmdClient rows={rows} />
      </div>
    </div>
  )
}
