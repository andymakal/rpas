import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { DOCUMENTS_BUCKET } from '@/lib/projects/review-1035'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const contentType = request.headers.get('content-type') ?? ''
  let body: Record<string, unknown>
  let newStoragePath: string | null = null

  if (contentType.includes('multipart/form-data')) {
    const fd = await request.formData()
    body = Object.fromEntries(
      [...fd.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v])
    )
    const file = fd.get('file') as File | null
    if (file && file.size > 0) {
      const carrierId = (body.carrier_id as string | undefined)?.trim()
      const ts = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `carrier-forms/${carrierId ?? 'unknown'}/${ts}-${safeName}`
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { error: upErr } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, bytes, { contentType: file.type || 'application/pdf', upsert: false })
      if (upErr) return Response.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
      newStoragePath = path

      // Delete old file if replacing
      const { data: existing } = await supabase
        .from('carrier_forms').select('file_url').eq('id', id).single()
      if (existing?.file_url && existing.file_url !== path) {
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([existing.file_url])
      }
    }
  } else {
    body = await request.json()
  }

  const updates: Record<string, unknown> = {}

  if ('carrier_id'   in body) updates.carrier_id   = body.carrier_id   || null
  if ('form_number'  in body) updates.form_number   = body.form_number  || null
  if ('form_name'    in body) updates.form_name     = body.form_name
  if ('description'  in body) updates.description   = body.description  || null
  if ('fill_handler' in body) updates.fill_handler  = body.fill_handler || null
  if ('notes'        in body) updates.notes         = body.notes        || null
  if ('is_fillable'  in body) updates.is_fillable   = body.is_fillable === true || body.is_fillable === 'true'
  if ('is_current'   in body) updates.is_current    = body.is_current   !== false && body.is_current !== 'false'

  if ('sr_types' in body) {
    const raw = body.sr_types
    updates.sr_types = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? raw.split(',').map(s => s.trim()).filter(Boolean)
        : null
  }
  if ('states' in body) {
    const raw = body.states
    updates.states = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? raw.split(',').map(s => s.trim()).filter(Boolean)
        : null
  }

  if (newStoragePath) updates.file_url = newStoragePath

  const { data, error } = await supabase
    .from('carrier_forms').update(updates).eq('id', id).select('*').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: row } = await supabase
    .from('carrier_forms').select('file_url').eq('id', id).single()
  if (row?.file_url) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([row.file_url])
  }

  const { error } = await supabase.from('carrier_forms').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
