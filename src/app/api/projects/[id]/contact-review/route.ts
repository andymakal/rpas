import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import {
  buildContactReview,
  summarizeContactReview,
  loadContactReviewCustomer,
} from '@/lib/projects/contact-review'

/**
 * GET /api/projects/[id]/contact-review
 *
 * The project-scoped Contact Review list: every project customer missing a
 * usable email or phone, each once. Read-only; derives the list from the live
 * project_customers population and the current customers rows. Does not touch
 * stewardship_outreach, customer_prereviews, or any workflow status.
 *
 * Optional ?customer_id=<uuid> returns that ONE project customer as `reopen`,
 * bypassing the durable research suppression that keeps the routine list clear.
 * This is the deliberate "research again" path for a customer who was
 * researched-not-found and therefore dropped from the list: the client opens
 * their existing Contact Review task directly. `reopen` is null when the
 * customer is not in the project or already has both methods.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  const customerId = new URL(request.url).searchParams.get('customer_id')?.trim() || null

  const rows = await buildContactReview(supabase, id)
  const reopen = customerId
    ? await loadContactReviewCustomer(supabase, id, customerId)
    : null

  return Response.json({
    data: { customers: rows, summary: summarizeContactReview(rows), reopen },
  })
}
