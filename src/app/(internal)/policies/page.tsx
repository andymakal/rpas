import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { PoliciesClient } from './PoliciesClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Policies' }

export type PolicyListRow = {
  id:               string
  client_name:      string
  policy_number:    string
  carrier:          string
  product_type:     string | null
  face_amount:      number | null
  annual_premium:   number | null
  cash_value_amount: number | null
  issue_date:       string | null
  term_length:      string | null
  rate_class:       string | null
  coverage_status:  string
  sa_status:        string
  sa_form_sent_at:  string | null
  customer_id:      string | null
  agency_id:        string | null
  agencies:         { name: string; display_name: string | null } | null
  customers:        { first_name: string; last_name: string } | null
}

export const PAGE_SIZE = 100

// Statuses treated as "inactive" — excluded by default, shown when showInactive=1
const INACTIVE_STATUSES = ['Lapsed', 'Surrendered', 'Terminated']

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; sa?: string; type?: string
    page?: string; sort?: string; dir?: string
    year?: string; tobacco?: string; inactive?: string
  }>
}) {
  const { q, sa, type, page: pageStr, sort, dir, year, tobacco, inactive } = await searchParams
  const supabase = createAdminClient()

  const page       = Math.max(1, parseInt(pageStr ?? '1', 10))
  const offset     = (page - 1) * PAGE_SIZE
  const sortCol    = sort === 'issue_date' ? 'issue_date' : sort === 'face_amount' ? 'face_amount' : 'carrier'
  const ascending  = sortCol === 'carrier' ? dir !== 'desc' : dir === 'asc'
  const showInactive = inactive === '1'

  const fields = `
    id, client_name, policy_number, carrier, product_type,
    face_amount, annual_premium, cash_value_amount,
    issue_date, term_length, rate_class,
    coverage_status, sa_status, sa_form_sent_at,
    customer_id, agency_id,
    agencies ( name, display_name ),
    customers ( first_name, last_name )
  `

  let query = supabase
    .from('service_policies')
    .select(fields, { count: 'exact' })
    .eq('is_test', false)
    .order(sortCol, { ascending, nullsFirst: false })

  // Secondary sort by client name when grouping by carrier
  if (sortCol === 'carrier') {
    query = query.order('client_name', { ascending: true })
  }

  if (q?.trim()) {
    query = query.or(`client_name.ilike.%${q.trim()}%,policy_number.ilike.%${q.trim()}%`)
  }
  if (sa)           query = query.eq('sa_status', sa)
  if (type)         query = query.eq('product_type', type)
  if (year)         query = query.gte('issue_date', `${year}-01-01`).lte('issue_date', `${year}-12-31`)
  if (tobacco === '1') {
    // Server pre-filters to tobacco/smoker; client removes any non-tobacco false positives
    query = query.or('rate_class.ilike.%tobacco%,rate_class.ilike.%smoker%')
  }
  if (!showInactive) {
    // Exclude lapsed, surrendered, terminated by default
    query = query.not('coverage_status', 'in', `(${INACTIVE_STATUSES.join(',')})`)
  }

  const { data, count, error } = await query.range(offset, offset + PAGE_SIZE - 1)
  if (error) console.error('Policies fetch error:', error)

  return (
    <PoliciesClient
      rows={(data as unknown as PolicyListRow[]) ?? []}
      totalCount={count ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      activeQ={q ?? ''}
      activeSa={sa ?? ''}
      activeType={type ?? ''}
      activeYear={year ?? ''}
      activeTobacco={tobacco === '1'}
      activeSort={sortCol}
      activeDir={ascending ? 'asc' : 'desc'}
      showInactive={showInactive}
    />
  )
}
