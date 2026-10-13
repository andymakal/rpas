import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/servicing-agent-change/contracts?customer_id=...
 *
 * Returns the customer's on-file service policies (contracts) for selection in
 * the Servicing Agent Change form. Shape matches SacContract in the client.
 */
export async function GET(request: NextRequest) {
  const customerId = new URL(request.url).searchParams.get('customer_id') ?? ''
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('service_policies')
    .select('id, policy_number, carrier, product_type, coverage_status, insured_first_name, insured_last_name')
    .eq('customer_id', customerId)
    .eq('is_test', false)
    .order('policy_number', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const contracts = (data ?? [])
    .filter(p => p.policy_number)
    .map(p => ({
      id:              p.id,
      policy_number:   p.policy_number,
      carrier:         p.carrier,
      product_type:    p.product_type,
      coverage_status: p.coverage_status,
      insured_name:    [p.insured_first_name, p.insured_last_name].filter(Boolean).join(' ') || null,
    }))

  return NextResponse.json({ data: contracts })
}
