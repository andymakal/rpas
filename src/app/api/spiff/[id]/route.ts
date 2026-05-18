import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// PATCH — mark paid / unpaid
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { paid: boolean } = { paid: true }
  try { body = await request.json() } catch { /* default to paid */ }

  const { data, error } = await supabase
    .from('spiff_records')
    .update({ paid_at: body.paid ? new Date().toISOString() : null })
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}
