import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { ensureOneCustomerOutreach } from '@/lib/stewardship/ensure-onboarding'

/**
 * POST /api/stewardship/servicing-access/open   { customer_id: string }
 *
 * Open a specific customer for servicing access when a signed authorization
 * arrives. The Servicing Access working screen lets an employee search for the
 * customer and jump straight to them without browsing a list; this route
 * resolves (or lazily creates, on this explicit action) the customer's open
 * stewardship_outreach row and returns its id so the screen can reserve and
 * open it.
 *
 * It reuses the SAME create-on-first-action seam the board uses
 * (ensureOneCustomerOutreach), so no new record is created on a page read and a
 * customer who already has an open outreach row simply has its id returned.
 * It never advances the workflow by itself — the employee records receipt,
 * uploads the form, prepares the carrier email, and confirms on the screen.
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
  return Response.json({ data: { item_id: result.outreachId } }, { status: 201 })
}
