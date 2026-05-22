import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// POST — earn SPIFF for this case
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: caseRow, error: fetchErr } = await supabase
    .from('cases')
    .select('spiff_earned, agent_id, agency_id, is_owner_referral')
    .eq('id', id)
    .single()

  if (fetchErr || !caseRow) {
    return Response.json({ error: 'Case not found' }, { status: 404 })
  }

  if (caseRow.is_owner_referral) {
    return Response.json({ error: 'SPIFF does not apply to owner referrals' }, { status: 400 })
  }

  if (caseRow.spiff_earned) {
    return Response.json({ error: 'SPIFF already earned for this case' }, { status: 409 })
  }

  const now = new Date().toISOString()

  const [, { data: record, error: insertErr }] = await Promise.all([
    supabase
      .from('cases')
      .update({ spiff_earned: true, spiff_earned_at: now })
      .eq('id', id),
    supabase
      .from('spiff_records')
      .insert({
        case_id:   id,
        agent_id:  caseRow.agent_id  ?? null,
        agency_id: caseRow.agency_id ?? null,
        amount:    10.00,
        earned_at: now,
      })
      .select()
      .single(),
  ])

  if (insertErr) {
    return Response.json({ error: insertErr.message }, { status: 500 })
  }

  return Response.json({ data: record })
}

// PATCH — fix agent_id on an existing spiff record (called after LSP is saved)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { agent_id?: string | null } = {}
  try { body = await request.json() } catch { /* ignore */ }

  await supabase
    .from('spiff_records')
    .update({ agent_id: body.agent_id ?? null })
    .eq('case_id', id)

  return Response.json({ ok: true })
}

// DELETE — void SPIFF for this case
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  await Promise.all([
    supabase.from('cases').update({ spiff_earned: false, spiff_earned_at: null }).eq('id', id),
    supabase.from('spiff_records').delete().eq('case_id', id),
  ])

  return Response.json({ ok: true })
}
