import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/financial-review/[id]
 * Update a financial review (contracts, notes, status).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: {
    contracts?:            unknown[]
    recommendation_notes?: string | null
    status?:               string
    customer_id?:          string | null
  }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.contracts            !== undefined) patch.contracts            = body.contracts
  if (body.recommendation_notes !== undefined) patch.recommendation_notes = body.recommendation_notes
  if (body.status               !== undefined) patch.status               = body.status
  if (body.customer_id          !== undefined) patch.customer_id          = body.customer_id

  const { data, error } = await supabase
    .from('financial_reviews')
    .update(patch)
    .eq('id', id)
    .select('id, review_number, status, contracts, recommendation_notes, customer_id, updated_at')
    .single()

  if (error || !data) {
    console.error('financial_review update error:', error)
    return Response.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return Response.json({ data })
}

/**
 * GET /api/financial-review/[id]
 * Fetch a single financial review with full customer context.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('financial_reviews')
    .select(`
      id, review_number, status, contracts, recommendation_notes, created_at, updated_at,
      customer_id,
      customers ( id, first_name, last_name, city, state, phone, email, date_of_birth, customer_group_id )
    `)
    .eq('id', id)
    .single()

  if (error || !data) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json({ data })
}
