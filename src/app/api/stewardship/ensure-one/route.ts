import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { ensureOneCustomerOutreach } from '@/lib/stewardship/ensure-onboarding'

/**
 * POST /api/stewardship/ensure-one   { customer_id: string }
 *
 * The create-on-first-action seam for Servicing Agent Onboarding. The board
 * surfaces members who need servicing access as DERIVED items (no record is
 * created on read). When an operator opens such a derived item to act on it,
 * the client calls this route to materialize the durable onboarding record for
 * that one customer and get back the outreach id to open.
 *
 * This is the ONLY place a record is created from the board flow, and it fires
 * on an explicit operator action — never on a page read. Idempotent: if the
 * customer already has an open outreach row, its id is returned unchanged.
 */
export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: { customer_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const customerId = body.customer_id?.trim()
  if (!customerId) return Response.json({ error: 'customer_id is required' }, { status: 400 })

  const supabase = createAdminClient()
  const result = await ensureOneCustomerOutreach(supabase, customerId)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 409 })
  }
  return Response.json({ data: { outreach_id: result.outreachId } }, { status: 201 })
}
