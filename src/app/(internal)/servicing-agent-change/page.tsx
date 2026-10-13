import { createAdminClient } from '@/lib/supabase/admin'
import { ServicingAgentChangeClient, type SacCustomer, type SacContract } from './ServicingAgentChangeClient'

export const dynamic = 'force-dynamic'

async function loadCustomer(id: string): Promise<{ customer: SacCustomer; contracts: SacContract[] } | null> {
  const supabase = createAdminClient()

  const { data: customer } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, phone, city, state')
    .eq('id', id)
    .single()

  if (!customer) return null

  const { data: policies } = await supabase
    .from('service_policies')
    .select('id, policy_number, carrier, product_type, coverage_status, insured_first_name, insured_last_name')
    .eq('customer_id', id)
    .eq('is_test', false)
    .order('policy_number', { ascending: true })

  const contracts: SacContract[] = (policies ?? [])
    .filter(p => p.policy_number)
    .map(p => ({
      id:            p.id,
      policy_number: p.policy_number,
      carrier:       p.carrier,
      product_type:  p.product_type,
      coverage_status: p.coverage_status,
      insured_name:  [p.insured_first_name, p.insured_last_name].filter(Boolean).join(' ') || null,
    }))

  return { customer, contracts }
}

export default async function ServicingAgentChangePage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { customer_id } = await searchParams

  const initial = customer_id ? await loadCustomer(customer_id) : null

  return (
    <ServicingAgentChangeClient
      initialCustomer={initial?.customer ?? null}
      initialContracts={initial?.contracts ?? []}
    />
  )
}
