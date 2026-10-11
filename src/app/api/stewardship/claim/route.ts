import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { resolveProducerForUser } from '@/lib/capabilities/resolve'
import type { OutreachQueue } from '@/lib/stewardship/queues'
import type { WorkFunctionKey } from '@/lib/capabilities/work-functions'

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
 *   - ACTIONABLE ONLY: a decided/closed item (its customer_prereview has a
 *     decision) is no longer outreach work and cannot be claimed. Waiting-state
 *     items are likewise not claimable (no action to commit to).
 *   - ELIGIBILITY MATCHES THE ACTUAL ACTIVITY + PROJECT SCOPE: the item's queue
 *     determines its activity (ready-to-call / ready-to-email => outreach;
 *     research-needed => research), and the caller must hold a ROUTABLE
 *     (primary/support) capability for THAT activity. A project-scoped
 *     eligibility counts only when the item's customer belongs to that project;
 *     agency-wide eligibility always counts. 'overqualified' is not routable.
 *   - ALREADY-CLAIMED GUARD: idempotent no-op when the item is already the
 *     caller's; rejected when another producer holds it. The claim itself is a
 *     race-safe conditional UPDATE (claim only where still unclaimed).
 *
 * This never changes workflow STATE (the queue/transition columns are
 * untouched); it only records/clears the optional commitment, so a claim can
 * never cause a customer obligation (e.g. a due callback) to be missed.
 */

/** The actionable queues and the activity each maps to. Waiting queues are
 * absent on purpose: they are not claimable work. */
const QUEUE_ACTIVITY: Partial<Record<OutreachQueue, WorkFunctionKey>> = {
  'ready-to-call': 'outreach',
  'ready-to-email': 'outreach',
  'research-needed': 'research',
}

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

/**
 * Whether a producer holds a routable (primary/support) capability for the given
 * activity, honoring project scope: an agency-wide assignment (project_id null)
 * always qualifies; a project-scoped assignment qualifies only when the item's
 * customer belongs to that project.
 */
async function isEligibleForActivity(
  supabase: ReturnType<typeof createAdminClient>,
  producerId: string,
  activity: WorkFunctionKey,
  itemProjectIds: Set<string>,
): Promise<boolean> {
  const { data } = await supabase
    .from('producer_work_functions')
    .select('project_id, assignment_type, work_functions!inner ( canonical_key )')
    .eq('producer_id', producerId)
    .in('assignment_type', ['primary', 'support'])
    .eq('work_functions.canonical_key', activity)
  for (const row of (data ?? []) as { project_id: string | null }[]) {
    if (row.project_id === null) return true // agency-wide
    if (itemProjectIds.has(row.project_id)) return true // in-scope project
  }
  return false
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

  // Read the item with the facts needed to judge actionability + activity +
  // project scope: its queue, claim state, and its customer (via prereview).
  const { data: row, error: readErr } = await supabase
    .from('stewardship_outreach')
    .select(`
      id, queue, claimed_by_producer_id,
      customer_prereviews!inner ( decision, customer_id )
    `)
    .eq('id', outreachId)
    .maybeSingle()
  if (readErr) return Response.json({ error: readErr.message }, { status: 500 })
  if (!row) return Response.json({ error: 'Outreach item not found' }, { status: 404 })

  const pre = (row as unknown as {
    queue: OutreachQueue
    claimed_by_producer_id: string | null
    customer_prereviews: { decision: string | null; customer_id: string }
  })

  // ACTIONABLE ONLY: a decided pre-review is no longer outreach work; a
  // non-actionable (waiting / unknown) queue has no action to commit to.
  if (pre.customer_prereviews.decision != null) {
    return Response.json(
      { error: 'This work is already decided and is no longer claimable.' },
      { status: 409 },
    )
  }
  const activity = QUEUE_ACTIVITY[pre.queue]
  if (!activity) {
    return Response.json(
      { error: 'This item is in a waiting state and is not actionable work to claim.' },
      { status: 409 },
    )
  }

  // The project(s) the item's customer belongs to, for project-scoped eligibility.
  const itemProjectIds = new Set<string>()
  {
    const { data: memberships } = await supabase
      .from('project_customers')
      .select('project_id')
      .eq('customer_id', pre.customer_prereviews.customer_id)
    for (const m of (memberships ?? []) as { project_id: string }[]) itemProjectIds.add(m.project_id)
  }

  // ELIGIBILITY must match the ACTUAL activity (outreach vs research) and scope.
  if (!(await isEligibleForActivity(supabase, caller.producerId, activity, itemProjectIds))) {
    const label = activity === 'research' ? 'Research' : 'Outreach'
    return Response.json(
      { error: `Only an eligible ${label} worker (Primary or Support, in scope) can claim this item.` },
      { status: 403 },
    )
  }

  // Already claimed: idempotent if mine, rejected if another's.
  if (pre.claimed_by_producer_id) {
    if (pre.claimed_by_producer_id === caller.producerId) {
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
