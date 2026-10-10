import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { buildProjectWorkflow, summarizeWorkflow } from '@/lib/projects/review-1035'

/**
 * GET /api/projects/[id]/review-1035
 *
 * The per-customer 1035 Exchange Review read model for a project: Step 2
 * servicing-access state (derived over ALL known permanent policies), Step 3
 * document + determination state, and the derived whose-turn stage. Read-only;
 * does not modify the project population or any stewardship rows.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  const rows = await buildProjectWorkflow(supabase, id)
  return Response.json({ data: { customers: rows, summary: summarizeWorkflow(rows) } })
}
