import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  // Pull what we need to copy from the parent case
  const { data: parent, error: parentErr } = await supabase
    .from('cases')
    .select('customer_id, agency_id, agent_id, lead_source')
    .eq('id', id)
    .single()

  if (parentErr || !parent) {
    return Response.json({ error: 'Parent case not found' }, { status: 404 })
  }

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* empty body is fine */ }

  const now = new Date().toISOString()

  const { data: newCase, error } = await supabase
    .from('cases')
    .insert({
      customer_id:       parent.customer_id,
      agency_id:         parent.agency_id,
      agent_id:          parent.agent_id,
      lead_source:       parent.lead_source,
      internal_status:   'app_submitted',
      submitted_at:      now,
      status_entered_at: now,
      product_id:        body.product_id        || null,
      face_amount:       body.face_amount        ? Number(body.face_amount)       : null,
      annual_premium:    body.annual_premium     ? Number(body.annual_premium)    : null,
      is_test:           false,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Sibling case insert error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Stamp initial status history
  await supabase.from('case_status_history').insert({
    case_id:     newCase.id,
    from_status: null,
    to_status:   'app_submitted',
  })

  return Response.json({ data: newCase })
}
