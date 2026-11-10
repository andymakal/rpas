import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import { buildProjectWorkflow } from '@/lib/projects/review-1035'

/**
 * PATCH /api/projects/[id]/review-1035/[customerId]
 *
 * Record a customer's Step 3 determination in a 1035 project:
 *
 *   { action: 'set_determination', determination: 'candidate' | 'not_a_candidate',
 *     determined_by?: <producers.id>, notes?: string }
 *     The producer records the durable 1035 determination. Allowed only once
 *     servicing access is established (Step 2 satisfied); there is no
 *     operations-preparation gate. Pass determination: null to clear it.
 *
 * The project_customer_reviews row is created lazily on first write.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params
  const supabase = createAdminClient()

  // Archived projects are read-only: the determination cannot advance
  // until the project is restored. The read model (GET) stays available.
  const active = await assertProjectActive(supabase, projectId)
  if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

  let body: {
    action?: string
    determination?: string | null
    determined_by?: string | null
    notes?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Derive the live workflow for this customer so every write is validated
  // against the real Step 2 / document state, not a client claim.
  const rows = await buildProjectWorkflow(supabase, projectId)
  const wf = rows.find(r => r.customer_id === customerId)
  if (!wf) {
    return Response.json({ error: 'Customer is not in this project' }, { status: 404 })
  }

  if (body.action === 'set_determination') {
    const det = body.determination
    if (det !== 'candidate' && det !== 'not_a_candidate' && det !== null) {
      return Response.json({ error: "determination must be 'candidate', 'not_a_candidate', or null" }, { status: 400 })
    }
    if (det !== null) {
      // A NEW determination requires servicing access to be established RIGHT
      // NOW. Clearing one (det === null) is always allowed.
      if (!wf.step2_satisfied) {
        return Response.json(
          { error: 'Customer is not ready for evaluation: servicing access is not established for every permanent policy.' },
          { status: 409 },
        )
      }
    }
    const patch: Record<string, unknown> = {
      project_id: projectId,
      customer_id: customerId,
      determination: det,
      determined_at: det === null ? null : new Date().toISOString(),
      determined_by: det === null ? null : (body.determined_by ?? null),
    }
    if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
    const { error } = await supabase
      .from('project_customer_reviews')
      .upsert(patch, { onConflict: 'project_id,customer_id' })
    if (error) {
      console.error('review-1035 set_determination error:', error)
      return Response.json({ error: error.message }, { status: 500 })
    }
    return await freshState(supabase, projectId, customerId)
  }

  return Response.json({ error: "action must be 'set_determination'" }, { status: 400 })
}

async function freshState(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  customerId: string,
) {
  const rows = await buildProjectWorkflow(supabase, projectId)
  const wf = rows.find(r => r.customer_id === customerId) ?? null
  return Response.json({ data: wf })
}
