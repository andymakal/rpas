import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * POST /api/financial-review
 * Create a new financial review record.
 * Body: { customer_id, contracts, recommendation_notes? }
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: {
    customer_id?: string
    contracts?: unknown[]
    recommendation_notes?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Auto-generate review number: FR-YYYY-NNN
  const year   = new Date().getFullYear()
  const prefix = `FR-${year}-`

  const { data: maxRow } = await supabase
    .from('financial_reviews')
    .select('review_number')
    .like('review_number', `${prefix}%`)
    .order('review_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let seq = 1
  if (maxRow?.review_number) {
    const parts = (maxRow.review_number as string).split('-')
    const last  = parseInt(parts[2] ?? '0', 10)
    if (!isNaN(last)) seq = last + 1
  }
  const reviewNumber = `${prefix}${String(seq).padStart(3, '0')}`

  const { data: review, error } = await supabase
    .from('financial_reviews')
    .insert({
      review_number:        reviewNumber,
      customer_id:          body.customer_id ?? null,
      contracts:            body.contracts   ?? [],
      recommendation_notes: body.recommendation_notes ?? null,
      status:               'draft',
    })
    .select('id, review_number, customer_id, status')
    .single()

  if (error || !review) {
    console.error('financial_review insert error:', error)
    return Response.json({ error: error?.message ?? 'Failed to create review' }, { status: 500 })
  }

  return Response.json({ data: review }, { status: 201 })
}

/**
 * GET /api/financial-review
 * List all financial reviews.
 */
export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('financial_reviews')
    .select(`
      id, review_number, status, created_at, updated_at, recommendation_notes,
      customers ( id, first_name, last_name, city, state )
    `)
    .eq('is_test', false)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: data ?? [] })
}
