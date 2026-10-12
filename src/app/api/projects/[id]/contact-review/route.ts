import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { buildContactReview, summarizeContactReview } from '@/lib/projects/contact-review'

/**
 * GET /api/projects/[id]/contact-review
 *
 * The project-scoped Contact Review list: every project customer missing a
 * usable email or phone, each once. Read-only; derives the list from the live
 * project_customers population and the current customers rows. Does not touch
 * stewardship_outreach, customer_prereviews, or any workflow status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  const rows = await buildContactReview(supabase, id)
  return Response.json({ data: { customers: rows, summary: summarizeContactReview(rows) } })
}
