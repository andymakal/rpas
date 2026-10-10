import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import {
  REQUIRED_DOCUMENT_TYPES,
  type RequiredDocumentType,
  DOCUMENTS_BUCKET,
  documentObjectPath,
} from '@/lib/projects/review-1035'

/**
 * Step 3 document storage for the 1035 Exchange Review.
 *
 * The actual uploaded file bytes are stored in the private Supabase Storage
 * bucket `rightpath-documents`; policy_documents remains the durable record and
 * its storage_location holds the object PATH within that bucket. Each document
 * is associated with project + customer + policy + document type.
 *
 * Documents are POLICY-specific: a customer can have multiple policies being
 * evaluated, so each (policy, document_type) is a distinct document. A re-upload
 * supersedes only the same project + customer + policy + document type; a
 * document for Policy A never overwrites Policy B.
 *
 * POST   multipart/form-data: file + document_type + policy_id (+ optional
 *        document_date) -> upload bytes (overwriting the stable per-policy,
 *        per-type object) and upsert the policy_documents row.
 * GET    ?type=<document_type>&policy_id=<id> -> a short-lived SIGNED URL for
 *        authorized download. The bucket stays private; no public URL is ever
 *        produced.
 * DELETE ?type=<document_type>&policy_id=<id> -> remove the object and record.
 *
 * All three require an internal admin and use the service-role client (which
 * bypasses storage RLS, matching the rest of the app). This route handles file
 * bodies, so it verifies auth itself rather than relying on the proxy.
 */

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — carrier statements / illustrations

function extFromName(name: string | null): string {
  if (!name) return ''
  const m = name.match(/\.([a-z0-9]+)$/i)
  return m ? `.${m[1].toLowerCase()}` : ''
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params
  const supabase = createAdminClient()

  // Archived projects are read-only: no new documents may be uploaded until the
  // project is restored. Existing documents remain downloadable via GET.
  const active = await assertProjectActive(supabase, projectId)
  if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data with a file' }, { status: 400 })
  }

  const documentType = String(form.get('document_type') ?? '').trim() as RequiredDocumentType
  if (!REQUIRED_DOCUMENT_TYPES.includes(documentType)) {
    return Response.json(
      { error: `document_type must be one of: ${REQUIRED_DOCUMENT_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'A non-empty file is required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit` }, { status: 413 })
  }

  const documentDate = String(form.get('document_date') ?? '').trim() || new Date().toISOString().slice(0, 10)

  // Confirm the customer is in this project (do not attach documents to a
  // customer outside the project population).
  const { data: membership } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!membership) {
    return Response.json({ error: 'Customer is not in this project' }, { status: 404 })
  }

  // The document must be anchored to a specific policy — documents are
  // policy-specific. policy_id is required and must belong to this customer.
  const policyId = String(form.get('policy_id') ?? '').trim() || null
  if (!policyId) {
    return Response.json({ error: 'policy_id is required (documents are policy-specific)' }, { status: 400 })
  }
  {
    const { data: p } = await supabase
      .from('service_policies')
      .select('id')
      .eq('id', policyId)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (!p) return Response.json({ error: 'policy_id does not belong to this customer' }, { status: 400 })
  }

  // Upload bytes to the private bucket at the stable per-policy, per-type path.
  // upsert:true overwrites the prior object so a re-upload supersedes only this
  // policy's document of this type — a different policy has a different path and
  // is untouched.
  const objectPath = documentObjectPath(projectId, customerId, policyId, documentType, extFromName(file.name))
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(objectPath, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    })
  if (upErr) {
    console.error('review-1035 storage upload error:', upErr)
    return Response.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
  }

  // If a prior row for this (project, customer, policy, type) pointed at a
  // DIFFERENT object path (e.g. a different extension), remove that now-orphaned
  // object so supersede is clean. Scoped to this policy so another policy's
  // object is never removed.
  const { data: prior } = await supabase
    .from('policy_documents')
    .select('storage_location')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', documentType)
    .maybeSingle()
  if (prior?.storage_location && prior.storage_location !== objectPath) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([prior.storage_location])
  }

  // Upsert the durable record. storage_location = the object PATH in the bucket.
  const { data, error } = await supabase
    .from('policy_documents')
    .upsert(
      {
        project_id: projectId,
        customer_id: customerId,
        policy_id: policyId,
        document_type: documentType,
        document_date: documentDate,
        storage_location: objectPath,
      },
      { onConflict: 'project_id,customer_id,policy_id,document_type' },
    )
    .select('id, document_type, document_date, storage_location, policy_id')
    .single()

  if (error) {
    console.error('review-1035 document upsert error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: { ...data, file_name: file.name, size: file.size } }, { status: 201 })
}

/**
 * GET ?type=<document_type> — issue a short-lived signed URL for the stored
 * object so an authorized internal user can open/download it. The bucket stays
 * private; this never returns a public URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params
  const sp = new URL(request.url).searchParams
  const type = sp.get('type') ?? ''
  const policyId = sp.get('policy_id') ?? ''
  if (!REQUIRED_DOCUMENT_TYPES.includes(type as RequiredDocumentType)) {
    return Response.json({ error: 'type query param is required and must be a valid document type' }, { status: 400 })
  }
  if (!policyId) {
    return Response.json({ error: 'policy_id query param is required (documents are policy-specific)' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: doc } = await supabase
    .from('policy_documents')
    .select('storage_location')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', type)
    .maybeSingle()
  if (!doc?.storage_location) {
    return Response.json({ error: 'No document on file for that policy and type' }, { status: 404 })
  }

  // 5-minute signed URL. forceDownload keeps it as an attachment fetch.
  const { data: signed, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_location, 300)
  if (error || !signed) {
    console.error('review-1035 signed URL error:', error)
    return Response.json({ error: 'Could not create a download link' }, { status: 500 })
  }

  return Response.json({ data: { url: signed.signedUrl, expires_in: 300 } })
}

/**
 * DELETE ?type=<document_type> — remove the stored object and the record.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params
  const sp = new URL(request.url).searchParams
  const type = sp.get('type') ?? ''
  const policyId = sp.get('policy_id') ?? ''
  if (!REQUIRED_DOCUMENT_TYPES.includes(type as RequiredDocumentType)) {
    return Response.json({ error: 'type query param is required and must be a valid document type' }, { status: 400 })
  }
  if (!policyId) {
    return Response.json({ error: 'policy_id query param is required (documents are policy-specific)' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Archived projects are read-only: a project's own documents are frozen until
  // it is restored. Existing documents remain downloadable via GET.
  const active = await assertProjectActive(supabase, projectId)
  if (!active.ok) return Response.json({ error: active.error }, { status: active.status })

  // Remove the stored object first (best effort), then the record. Scoped to the
  // specific policy so another policy's document is never deleted.
  const { data: doc } = await supabase
    .from('policy_documents')
    .select('storage_location')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', type)
    .maybeSingle()
  if (doc?.storage_location) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_location])
  }

  const { error } = await supabase
    .from('policy_documents')
    .delete()
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', type)
  if (error) {
    console.error('review-1035 document delete error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ success: true })
}
