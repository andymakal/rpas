import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/admin/gdc-records/[id]
 *
 * Updates linkage on a gdc_record row.
 * Accepted fields: linked_customer_id (string | null), linked_case_id (string | null)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: { linked_customer_id?: string | null; linked_case_id?: string | null }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if ('linked_customer_id' in body) {
    update.linked_customer_id = body.linked_customer_id ?? null
  }
  if ('linked_case_id' in body) {
    update.linked_case_id = body.linked_case_id ?? null
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('gdc_records')
    .update(update)
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: { id } })
}
