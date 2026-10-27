import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const VALID_TYPES = new Set(['spouse', 'joint_owner', 'custodian'])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('customer_relationships')
    .select('id, relationship_type, related_customer_id')
    .eq('customer_id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const related_customer_id = typeof body.related_customer_id === 'string' ? body.related_customer_id.trim() : ''
  const relationship_type   = typeof body.relationship_type   === 'string' ? body.relationship_type.trim()   : ''

  if (!related_customer_id || !relationship_type) {
    return Response.json({ error: 'related_customer_id and relationship_type are required' }, { status: 400 })
  }
  if (!VALID_TYPES.has(relationship_type)) {
    return Response.json({ error: 'Invalid relationship_type' }, { status: 400 })
  }

  const rows = [
    { customer_id: id, related_customer_id, relationship_type },
    // Spouse links are always bidirectional
    ...(relationship_type === 'spouse'
      ? [{ customer_id: related_customer_id, related_customer_id: id, relationship_type: 'spouse' }]
      : []),
  ]

  const { error } = await supabase
    .from('customer_relationships')
    .upsert(rows, { onConflict: 'customer_id,related_customer_id,relationship_type', ignoreDuplicates: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true }, { status: 201 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const relatedId = searchParams.get('related_id')

  if (!relatedId) return Response.json({ error: 'related_id is required' }, { status: 400 })

  const { error } = await supabase
    .from('customer_relationships')
    .delete()
    .eq('customer_id', id)
    .eq('related_customer_id', relatedId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
