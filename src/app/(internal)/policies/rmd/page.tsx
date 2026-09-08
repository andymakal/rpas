import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { RmdClient } from './RmdClient'

export const metadata: Metadata = { title: 'RMD Call List' }
export const dynamic = 'force-dynamic'

export type RmdRow = {
  customer_id:         string
  first_name:          string
  last_name:           string
  phone:               string | null
  age:                 number
  total_rmd_amount:    number
  total_account_value: number
  policy_count:        number
  carriers:            string
  agency_name:         string | null
}

const TERMINAL = ['Lapsed', 'Surrendered', 'Terminated', 'Cancelled', 'Matured']

function getAge(dob: string): number {
  const today = new Date()
  const birth = new Date(dob + 'T12:00:00')
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export default async function RmdPage() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('service_policies')
    .select(`
      carrier, cash_value_amount, type_data, customer_id,
      agencies ( name, display_name ),
      customers ( first_name, last_name, phone, date_of_birth )
    `)
    .eq('is_test', false)
    .eq('product_category', 'annuity')
    .not('coverage_status', 'in', `(${TERMINAL.join(',')})`)

  if (error) console.error('RMD fetch error:', error)

  // Group by customer; keep only those aged 73+
  const byCustomer = new Map<string, RmdRow>()

  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const customerId = r.customer_id as string | null
    if (!customerId) continue

    const custRaw = r.customers
    const cust = (Array.isArray(custRaw) ? custRaw[0] : custRaw) as {
      first_name: string; last_name: string; phone: string | null; date_of_birth: string | null
    } | null
    if (!cust?.date_of_birth) continue

    const age = getAge(cust.date_of_birth)
    if (age < 73) continue

    const td = r.type_data as Record<string, unknown> | null
    const rmdAmount  = td?.rmd_amount != null ? Number(td.rmd_amount) : 0
    const cashValue  = (r.cash_value_amount as number | null) ?? 0
    const carrier    = (r.carrier as string) ?? ''

    const agencyRaw = r.agencies
    const agency = (Array.isArray(agencyRaw) ? agencyRaw[0] : agencyRaw) as {
      name: string; display_name: string | null
    } | null
    const agencyName = agency?.display_name ?? agency?.name ?? null

    if (byCustomer.has(customerId)) {
      const row = byCustomer.get(customerId)!
      row.total_rmd_amount    += rmdAmount
      row.total_account_value += cashValue
      row.policy_count        += 1
      if (carrier && !row.carriers.split(', ').includes(carrier)) {
        row.carriers = row.carriers ? `${row.carriers}, ${carrier}` : carrier
      }
    } else {
      byCustomer.set(customerId, {
        customer_id:         customerId,
        first_name:          cust.first_name,
        last_name:           cust.last_name,
        phone:               cust.phone,
        age,
        total_rmd_amount:    rmdAmount,
        total_account_value: cashValue,
        policy_count:        1,
        carriers:            carrier,
        agency_name:         agencyName,
      })
    }
  }

  const rows: RmdRow[] = Array.from(byCustomer.values())
    .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <RmdClient rows={rows} />
      </div>
    </div>
  )
}
