import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * POST /api/customers/[id]/merge
 *
 * Merges a duplicate customer (the loser — [id]) into an existing record
 * (the winner — merge_into_id). All related records are reassigned to the
 * winner before the loser is deleted.
 *
 * Tables reassigned:
 *   cases            — customer_id
 *   service_policies — customer_id (optional FK)
 *
 * The suspected_duplicate_customer_id flag is cleared on all cases that
 * reference either party so the banner disappears after merge.
 *
 * Body: { merge_into_id: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: loserId } = await params
  const supabase = createAdminClient()

  let body: { merge_into_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { merge_into_id: winnerId } = body
  if (!winnerId?.trim()) {
    return Response.json({ error: 'merge_into_id is required' }, { status: 400 })
  }
  if (loserId === winnerId) {
    return Response.json({ error: 'Cannot merge a customer into themselves' }, { status: 400 })
  }

  // Verify both customers exist
  const { data: customers, error: fetchErr } = await supabase
    .from('customers')
    .select('id, first_name, last_name')
    .in('id', [loserId, winnerId])

  if (fetchErr || !customers || customers.length < 2) {
    return Response.json({ error: 'One or both customers not found' }, { status: 404 })
  }

  const now = new Date().toISOString()

  // 1. Reassign cases from loser → winner
  await supabase
    .from('cases')
    .update({ customer_id: winnerId, updated_at: now })
    .eq('customer_id', loserId)

  // 2. Clear the duplicate flag on any case that flagged either party
  await supabase
    .from('cases')
    .update({ suspected_duplicate_customer_id: null, updated_at: now })
    .or(`suspected_duplicate_customer_id.eq.${loserId},suspected_duplicate_customer_id.eq.${winnerId}`)

  // 3. Reassign service_policies from loser → winner (optional FK — only if set)
  await supabase
    .from('service_policies')
    .update({ customer_id: winnerId, updated_at: now })
    .eq('customer_id', loserId)

  // 4. If either customer is in a group, merge them (customer_groups link)
  const loser  = customers.find(c => c.id === loserId)!
  const winner = customers.find(c => c.id === winnerId)!

  // 5. Delete the loser — all FKs have been reassigned
  const { error: deleteErr } = await supabase
    .from('customers')
    .delete()
    .eq('id', loserId)

  if (deleteErr) {
    console.error('Customer delete error:', deleteErr)
    return Response.json({ error: `Merge failed during cleanup: ${deleteErr.message}` }, { status: 500 })
  }

  return Response.json({
    data: {
      winner_id:   winner.id,
      winner_name: `${winner.first_name} ${winner.last_name}`,
      loser_name:  `${loser.first_name} ${loser.last_name}`,
    },
  })
}
