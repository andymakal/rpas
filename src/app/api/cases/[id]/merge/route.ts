import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * POST /api/cases/[id]/merge
 *
 * Merges a duplicate referral (the loser — [id]) into another referral
 * (the winner — merge_into_id). Both must belong to the same customer.
 *
 * What moves from loser → winner:
 *   - case_touches
 *   - customer_notes (by case_id)
 *   - case_status_history
 *   - case_household_members
 *
 * Null fields on the winner are filled from the loser.
 * Notes text is concatenated if both have content.
 * is_hot_lead is OR'd.
 * last_contact_at keeps the more recent value.
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
  if (!winnerId?.trim()) return Response.json({ error: 'merge_into_id is required' }, { status: 400 })
  if (loserId === winnerId) return Response.json({ error: 'Cannot merge a case into itself' }, { status: 400 })

  // Fetch both cases
  const { data: cases, error: fetchErr } = await supabase
    .from('cases')
    .select('id, customer_id, notes, face_amount, quoted_carrier, quoted_product_type, annual_premium, appointment_date, appointment_time, follow_up_date, allstate_policy_number, policy_number, producer_id, agent_id, is_hot_lead, last_contact_at, touches, spiff_earned, spiff_earned_at')
    .in('id', [loserId, winnerId])

  if (fetchErr || !cases || cases.length < 2) {
    return Response.json({ error: 'One or both cases not found' }, { status: 404 })
  }

  type CaseRow = typeof cases[0]
  const loser  = cases.find((c: CaseRow) => c.id === loserId)!
  const winner = cases.find((c: CaseRow) => c.id === winnerId)!

  if (loser.customer_id !== winner.customer_id) {
    return Response.json({ error: 'Cases belong to different customers — use the customer merge instead' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // 1. Move touches
  await supabase.from('case_touches').update({ case_id: winnerId }).eq('case_id', loserId)

  // 2. Move notes (customer_notes table)
  await supabase.from('customer_notes').update({ case_id: winnerId }).eq('case_id', loserId)

  // 3. Move status history
  await supabase.from('case_status_history').update({ case_id: winnerId }).eq('case_id', loserId)

  // 4. Move household members
  await supabase.from('case_household_members').update({ case_id: winnerId }).eq('case_id', loserId)

  // 5. Build winner update — fill nulls from loser, resolve conflicts
  const winnerUpdate: Record<string, unknown> = { updated_at: now }

  const nullFillFields = [
    'face_amount', 'quoted_carrier', 'quoted_product_type', 'annual_premium',
    'appointment_date', 'appointment_time', 'follow_up_date',
    'allstate_policy_number', 'policy_number', 'producer_id', 'agent_id',
  ] as const
  for (const field of nullFillFields) {
    if ((winner[field] === null || winner[field] === undefined) && loser[field] != null) {
      winnerUpdate[field] = loser[field]
    }
  }

  // Concatenate notes text
  if (loser.notes && winner.notes) {
    winnerUpdate.notes = `${winner.notes}\n\n---\n\n${loser.notes}`
  } else if (loser.notes && !winner.notes) {
    winnerUpdate.notes = loser.notes
  }

  // OR the hot-lead flag
  if (loser.is_hot_lead && !winner.is_hot_lead) winnerUpdate.is_hot_lead = true

  // Keep more recent last_contact_at
  if (loser.last_contact_at && (!winner.last_contact_at || loser.last_contact_at > winner.last_contact_at)) {
    winnerUpdate.last_contact_at = loser.last_contact_at
  }

  // Carry spiff if winner doesn't have it
  if (loser.spiff_earned && !winner.spiff_earned) {
    winnerUpdate.spiff_earned    = true
    winnerUpdate.spiff_earned_at = loser.spiff_earned_at
  }

  // Recount touches (will be sum of both after reassignment)
  const { count: touchCount } = await supabase
    .from('case_touches')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', winnerId)
  if (touchCount != null) winnerUpdate.touches = touchCount

  if (Object.keys(winnerUpdate).length > 1) {
    await supabase.from('cases').update(winnerUpdate).eq('id', winnerId)
  }

  // 6. Delete the loser
  const { error: deleteErr } = await supabase.from('cases').delete().eq('id', loserId)
  if (deleteErr) {
    return Response.json({ error: `Merge failed during cleanup: ${deleteErr.message}` }, { status: 500 })
  }

  return Response.json({ data: { winner_id: winnerId } })
}
