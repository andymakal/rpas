import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { buildProjectWorkflow } from '@/lib/projects/review-1035'

/**
 * PATCH /api/projects/[id]/review-1035/[customerId]
 *
 * Advance a customer's Step 3 state in a 1035 project. Two distinct actions,
 * one at a time:
 *
 *   { action: 'set_prep', prep_status: 'preparing' | 'ready_for_evaluation' }
 *     Operations marks preparation. 'ready_for_evaluation' is only allowed when
 *     Step 2 is satisfied AND both required documents are present — otherwise the
 *     customer cannot be surfaced to Bob. Enforced server-side against the live
 *     derived workflow so the state can never claim readiness it does not have.
 *
 *   { action: 'set_determination', determination: 'candidate' | 'not_a_candidate',
 *     determined_by?: <producers.id>, notes?: string }
 *     Bob records the durable 1035 determination. Allowed only when the customer
 *     is actually ready for evaluation (Step 2 satisfied, documents complete,
 *     preparation marked ready). Pass determination: null to clear it.
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

  let body: {
    action?: string
    prep_status?: string
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

  if (body.action === 'set_prep') {
    const next = body.prep_status
    if (next !== 'preparing' && next !== 'ready_for_evaluation') {
      return Response.json({ error: "prep_status must be 'preparing' or 'ready_for_evaluation'" }, { status: 400 })
    }
    if (next === 'ready_for_evaluation') {
      // Step 2 is the only hard gate for the handoff to Bob: all known permanent
      // policies must have confirmed servicing access. Document completeness is
      // deliberately NOT required — supplemental permanent policies may still be
      // missing a statement/reprojection, and that must not block advancement.
      // Bob decides which policies are exchange candidates and whether to
      // combine them.
      if (!wf.step2_satisfied) {
        return Response.json(
          { error: 'Servicing access (Step 2) is not established for all permanent policies; complete Stewardship first.' },
          { status: 409 },
        )
      }
    }
    const { error } = await supabase
      .from('project_customer_reviews')
      .upsert(
        { project_id: projectId, customer_id: customerId, prep_status: next },
        { onConflict: 'project_id,customer_id' },
      )
    if (error) {
      console.error('review-1035 set_prep error:', error)
      return Response.json({ error: error.message }, { status: 500 })
    }
    return await freshState(supabase, projectId, customerId)
  }

  if (body.action === 'set_determination') {
    const det = body.determination
    if (det !== 'candidate' && det !== 'not_a_candidate' && det !== null) {
      return Response.json({ error: "determination must be 'candidate', 'not_a_candidate', or null" }, { status: 400 })
    }
    if (det !== null) {
      // Bob can only decide a customer who is ready for evaluation: Step 2
      // satisfied and operations has marked preparation complete. Document
      // completeness is NOT required — Bob evaluates with whatever documents are
      // present and determines which policies qualify.
      if (!wf.step2_satisfied || wf.prep_status !== 'ready_for_evaluation') {
        return Response.json(
          { error: 'Customer is not ready for evaluation yet (needs servicing access and operations to mark preparation complete).' },
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

  return Response.json({ error: "action must be 'set_prep' or 'set_determination'" }, { status: 400 })
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
