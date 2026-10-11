import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { resolveProducerForUser } from '@/lib/capabilities/resolve'

/**
 * POST /api/stewardship/claim   { outreach_id: string }
 * DELETE /api/stewardship/claim { outreach_id: string }   (release a claim)
 *
 * Claiming a shared Stewardship board item, ported from the IPF
 * queue-owned-until-claimed command (claim_initial_outreach), re-homed on
 * Right Path's own tables and auth:
 *
 *   - Work is SHARED by default: stewardship_outreach.claimed_by_producer_id is
 *     NULL at creation, so every item is visible and claimable by every eligible
 *     worker. Claiming is OPTIONAL and lightweight — a soft lease on the row —
 *     not routine assignment. The board is never filtered by the claim.
 *   - ELIGIBILITY GATE: the caller must hold a ROUTABLE (primary/support)
 *     capability on 'outreach'. 'overqualified' is not routable; a caller with
 *     no outreach assignment is rejected. (The research exception path is also
 *     claimable by an outreach-eligible worker in this first slice; the board's
 *     research items live under the same outreach-worker pool.)
 *   - ALREADY-CLAIMED GUARD: idempotent no-op when the item is already the
 *     caller's; rejected when another producer holds it. Implemented as a
 *     conditional UPDATE (claim only where currently unclaimed), which is
 *     race-safe at the row level without a server-side lock.
 *
 * This never changes workflow STATE (the queue/transition columns are
 * untouched); it only records/clears the optional commitment.
 */

async function resolveCaller() {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error }

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const producer = await resolveProducerForUser(user.id)
  if (!producer) {
    return {
      ok: false as const,
      status: 403,
      error: 'Your account has no team member profile, so it cannot claim shared work.',
    }
  }
  return { ok: true as const, producerId: producer.id }
}

/** Whether a producer holds a routable (primary/support) outreach capability. */
async function isOutreachEligible(
  supabase: ReturnType<typeof createAdminClient>,
  producerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('producer_work_functions')
    .select('assignment_type, work_functions!inner ( canonical_key )')
    .eq('producer_id', producerId)
    .in('assignment_type', ['primary', 'support'])
    .eq('work_functions.canonical_key', 'outreach')
    .limit(1)
  return (data?.length ?? 0) > 0
}

export async function POST(request: NextRequest) {
  const caller = await resolveCaller()
  if (!caller.ok) return Response.json({ error: caller.error }, { status: caller.status })

  let body: { outreach_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const outreachId = body.outreach_id
  if (!outreachId) return Response.json({ error: 'outreach_id is required' }, { status: 400 })

  const supabase = createAdminClient()

  if (!(await isOutreachEligible(supabase, caller.producerId))) {
    return Response.json(
      { error: 'Only an eligible Outreach worker (Primary or Support) can claim this item.' },
      { status: 403 },
    )
  }

  // Read current claim state.
  const { data: row, error: readErr } = await supabase
    .from('stewardship_outreach')
    .select('id, claimed_by_producer_id')
    .eq('id', outreachId)
    .maybeSingle()
  if (readErr) return Response.json({ error: readErr.message }, { status: 500 })
  if (!row) return Response.json({ error: 'Outreach item not found' }, { status: 404 })

  // Already claimed: idempotent if mine, rejected if another's.
  if (row.claimed_by_producer_id) {
    if (row.claimed_by_producer_id === caller.producerId) {
      return Response.json({ data: { outreach_id: outreachId, already_mine: true } })
    }
    return Response.json(
      { error: 'This item has already been claimed by another team member.' },
      { status: 409 },
    )
  }

  // Race-safe claim: update only while still unclaimed. If a concurrent claim
  // won, the filtered update affects zero rows and we report the conflict.
  const { data: claimed, error: updErr } = await supabase
    .from('stewardship_outreach')
    .update({ claimed_by_producer_id: caller.producerId, claimed_at: new Date().toISOString() })
    .eq('id', outreachId)
    .is('claimed_by_producer_id', null)
    .select('id')
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })
  if (!claimed || claimed.length === 0) {
    return Response.json(
      { error: 'This item was just claimed by another team member.' },
      { status: 409 },
    )
  }

  return Response.json({ data: { outreach_id: outreachId, claimed_by_producer_id: caller.producerId } })
}

export async function DELETE(request: NextRequest) {
  const caller = await resolveCaller()
  if (!caller.ok) return Response.json({ error: caller.error }, { status: caller.status })

  let body: { outreach_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const outreachId = body.outreach_id
  if (!outreachId) return Response.json({ error: 'outreach_id is required' }, { status: 400 })

  const supabase = createAdminClient()

  // A producer may release only their own claim. Clearing where the claim is
  // theirs keeps this safe without a lock.
  const { data: released, error } = await supabase
    .from('stewardship_outreach')
    .update({ claimed_by_producer_id: null, claimed_at: null })
    .eq('id', outreachId)
    .eq('claimed_by_producer_id', caller.producerId)
    .select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!released || released.length === 0) {
    return Response.json(
      { error: 'That item is not currently claimed by you.' },
      { status: 409 },
    )
  }
  return Response.json({ data: { outreach_id: outreachId, released: true } })
}
