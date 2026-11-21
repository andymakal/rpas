import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    customer_id, policy_number, carrier, client_name,
    product_type, registration, record_type, account_value, account_value_as_of,
    face_amount, annual_premium, premium_mode, pay_period, rate_class, term_length, issue_date,
  } = body

  if (!customer_id || !policy_number || !carrier || !client_name) {
    return Response.json(
      { error: 'customer_id, policy_number, carrier, and client_name are required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('service_policies')
    .insert({
      customer_id:    String(customer_id),
      policy_number:  String(policy_number).trim(),
      carrier:        String(carrier),
      client_name:    String(client_name).trim(),
      product_type:   product_type   ? String(product_type)   : null,
      registration:        registration        ? String(registration)        : null,
      record_type:         record_type         ? String(record_type)         : 'policy',
      account_value:       account_value       ? Number(account_value)       : null,
      account_value_as_of: account_value_as_of ? String(account_value_as_of) : null,
      face_amount:    face_amount    ? Number(face_amount)    : null,
      annual_premium: annual_premium ? Number(annual_premium) : null,
      premium_mode:   premium_mode   ? String(premium_mode)   : null,
      pay_period:     pay_period     ? String(pay_period)     : null,
      rate_class:     rate_class     ? String(rate_class)     : null,
      term_length:    term_length    ? String(term_length)    : null,
      issue_date:     issue_date     ? String(issue_date)     : null,
      coverage_status: 'Active',
      sa_status:      'unknown',
      is_test:        false,
    })
    .select()
    .single()

  if (error) {
    console.error('service-policies POST error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data }, { status: 201 })
}
