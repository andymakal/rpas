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
    product_type, face_amount, annual_premium, issue_date,
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
      face_amount:    face_amount    ? Number(face_amount)    : null,
      annual_premium: annual_premium ? Number(annual_premium) : null,
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
