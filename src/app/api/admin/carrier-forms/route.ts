import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { DOCUMENTS_BUCKET } from '@/lib/projects/review-1035'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('carrier_forms')
    .select('*, carriers ( id, name, short_name )')
    .order('is_current', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  const contentType = request.headers.get('content-type') ?? ''
  let body: Record<string, unknown>
  let fileStoragePath: string | null = null

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
      fileStoragePath = path
    }
  } else {
    body = await request.json()
  }

  const srTypesRaw = body.sr_types
  const srTypes: string[] | null = Array.isArray(srTypesRaw)
    ? srTypesRaw
    : typeof srTypesRaw === 'string' && srTypesRaw.trim()
      ? srTypesRaw.split(',').map(s => s.trim()).filter(Boolean)
      : null

  const statesRaw = body.states
  const states: string[] | null = Array.isArray(statesRaw)
    ? statesRaw
    : typeof statesRaw === 'string' && statesRaw.trim()
      ? statesRaw.split(',').map(s => s.trim()).filter(Boolean)
      : null

  const record: Record<string, unknown> = {
    carrier_id:   body.carrier_id   || null,
    form_number:  body.form_number  || null,
    form_name:    body.form_name,
    description:  body.description  || null,
    sr_types:     srTypes,
    states:       states,
    file_url:     fileStoragePath ?? body.file_url ?? null,
    is_fillable:  body.is_fillable === true || body.is_fillable === 'true',
    fill_handler: body.fill_handler || null,
    is_current:   body.is_current !== false && body.is_current !== 'false',
    notes:        body.notes || null,
  }

  if (!record.form_name) return Response.json({ error: 'form_name is required' }, { status: 400 })
  if (!record.carrier_id) return Response.json({ error: 'carrier_id is required' }, { status: 400 })

  const { data, error } = await supabase.from('carrier_forms').insert(record).select('*').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data }, { status: 201 })
}
