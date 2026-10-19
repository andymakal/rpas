import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import {
  DOCUMENTS_BUCKET,
  SERVICING_AUTHORIZATION_TYPE,
  authorizationObjectPath,
} from '@/lib/stewardship/authorization-document'

/**
 * Signed servicing-agent authorization document — stored in Right Path's ONE
 * existing document repository (the private `rightpath-documents` bucket +
 * policy_documents table). This route is the servicing-access analogue of the
 * 1035 Operations-Preparation documents route; it reuses the same bucket, the
 * same table, and the same private-signed-URL download, adding only the
 * `servicing_authorization` document type.
 *
 * The subject is the stewardship_outreach item (the working-screen subject).
 * The form is anchored to the servicing request's representative policy (the
 * first request policy), with project_id carried when the customer belongs to a
 * project and null otherwise (the standalone intake path has no project).
 *
 *   POST   multipart/form-data: file -> upload bytes (overwriting the stable
 *          per-request object) and upsert the policy_documents row. Records a
 *          receipt touch in Customer History.
 *   GET    -> a short-lived signed URL for the stored authorization (the bucket
 *          stays private; no public URL is ever produced), or 404 when none.
 *   DELETE -> remove the object and the record.
 *
 * All three require an internal admin and use the service-role client (which
 * bypasses storage RLS, matching the rest of the app). This route handles file
 * bodies, so it verifies auth itself rather than relying on the proxy.
 */

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — signed form scans / PDFs

function extFromName(name: string | null): string {
  if (!name) return ''
  const m = name.match(/\.([a-z0-9]+)$/i)
  return m ? `.${m[1].toLowerCase()}` : ''
}

/** Best-effort display name for a history touch, mirroring the stewardship PATCH
 * route: prefer staff_profiles.display_name, fall back to the email local-part. */
async function resolveEmployeeName(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  try {
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return null
    const { data: profile } = await admin
      .from('staff_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
    return profile?.display_name ?? user.email?.split('@')[0] ?? null
  } catch {
    return null
  }
}

/**
 * Resolve the outreach item -> customer id, the request's representative policy
 * id (the first request policy), and the customer's project id (if any). Null
 * when the item does not exist or has no request policy to anchor the form to.
 */
async function resolveSubject(
  admin: ReturnType<typeof createAdminClient>,
  outreachId: string,
): Promise<{ customerId: string; policyId: string; projectId: string | null } | null> {
  const { data: outreach } = await admin
    .from('stewardship_outreach')
    .select('id, customer_prereviews!inner ( customer_id )')
    .eq('id', outreachId)
    .single()
  if (!outreach) return null
  const customerId = (outreach as unknown as {
    customer_prereviews: { customer_id: string }
  }).customer_prereviews.customer_id

  // The representative request policy: the first policy in this outreach's
  // servicing request. One signed authorization covers the whole request, so a
  // single anchor is correct; we pick a stable one (lowest policy id order).
  const { data: links } = await admin
    .from('stewardship_outreach_policies')
    .select('policy_id')
    .eq('outreach_id', outreachId)
  const policyIds = (links ?? []).map((l: { policy_id: string }) => l.policy_id)
  if (policyIds.length === 0) return null
  // Deterministic choice so the stored object path is stable across re-uploads.
  const policyId = [...policyIds].sort()[0]

  // The customer's project (if any), so the authorization coexists with the
  // project's other documents. The standalone intake path has no project.
  const { data: member } = await admin
    .from('project_customers')
    .select('project_id')
    .eq('customer_id', customerId)
    .limit(1)
    .maybeSingle()
  const projectId = (member?.project_id as string | undefined) ?? null

  return { customerId, policyId, projectId }
}

/** Find the stored authorization row for this subject, matching the project
 * scope (NULL project means the standalone path). */
async function findAuthorizationRow(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  policyId: string,
  projectId: string | null,
): Promise<{ storage_location: string } | null> {
  let q = admin
    .from('policy_documents')
    .select('storage_location')
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', SERVICING_AUTHORIZATION_TYPE)
  q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
  const { data } = await q.maybeSingle()
  return (data as { storage_location: string } | null) ?? null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const admin = createAdminClient()

  const subject = await resolveSubject(admin, id)
  if (!subject) {
    return Response.json({ error: 'Outreach item not found, or it has no request policy to anchor the form to.' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data with a file' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'A non-empty file is required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit` }, { status: 413 })
  }

  const { customerId, policyId, projectId } = subject
  const documentDate = new Date().toISOString().slice(0, 10)
  const objectPath = authorizationObjectPath(customerId, policyId, extFromName(file.name))

  // Upload bytes to the shared private bucket at the stable per-request path.
  // upsert:true overwrites the prior object so a re-upload supersedes the prior
  // authorization for this servicing request.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(objectPath, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    })
  if (upErr) {
    console.error('servicing-authorization storage upload error:', upErr)
    return Response.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
  }

  // Clean up an orphaned prior object whose path differed (e.g. a different
  // extension), so supersede is clean.
  const prior = await findAuthorizationRow(admin, customerId, policyId, projectId)
  if (prior?.storage_location && prior.storage_location !== objectPath) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([prior.storage_location])
  }

  // Upsert the durable record. The table's unique key includes project_id; for
  // the standalone (null-project) path Postgres treats NULL as distinct, so a
  // plain upsert could duplicate. Delete any existing row for this subject
  // first, then insert, to guarantee one authorization row per servicing
  // request regardless of project scope.
  {
    let del = admin
      .from('policy_documents')
      .delete()
      .eq('customer_id', customerId)
      .eq('policy_id', policyId)
      .eq('document_type', SERVICING_AUTHORIZATION_TYPE)
    del = projectId ? del.eq('project_id', projectId) : del.is('project_id', null)
    await del
  }
  const { data, error } = await admin
    .from('policy_documents')
    .insert({
      project_id: projectId,
      customer_id: customerId,
      policy_id: policyId,
      document_type: SERVICING_AUTHORIZATION_TYPE,
      document_date: documentDate,
      storage_location: objectPath,
    })
    .select('id, document_type, document_date, storage_location, policy_id')
    .single()
  if (error) {
    console.error('servicing-authorization record insert error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Record the receipt of the signed authorization in Customer History (the one
  // durable history store, case_touches). Best-effort attribution; a failed
  // touch must never block the upload itself (the document is already saved).
  const touchedBy = await resolveEmployeeName(admin)
  const { error: touchErr } = await admin
    .from('case_touches')
    .insert({
      customer_id: customerId,
      case_id: null,
      touch_type: 'email', // inbound return (a scan/email is the usual channel)
      notes: 'Signed servicing-agent authorization received and saved to documents.',
      touched_at: new Date().toISOString(),
      touched_by: touchedBy,
    })
  if (touchErr) {
    console.error('servicing-authorization receipt touch log error:', touchErr)
  }

  return Response.json({ data: { ...data, file_name: file.name, size: file.size } }, { status: 201 })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const admin = createAdminClient()

  const subject = await resolveSubject(admin, id)
  if (!subject) return Response.json({ error: 'Outreach item not found' }, { status: 404 })

  const row = await findAuthorizationRow(admin, subject.customerId, subject.policyId, subject.projectId)
  if (!row?.storage_location) {
    return Response.json({ error: 'No signed authorization on file for this request yet.' }, { status: 404 })
  }

  const { data: signed, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_location, 300)
  if (error || !signed) {
    console.error('servicing-authorization signed URL error:', error)
    return Response.json({ error: 'Could not create a download link' }, { status: 500 })
  }
  return Response.json({ data: { url: signed.signedUrl, expires_in: 300 } })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const admin = createAdminClient()

  const subject = await resolveSubject(admin, id)
  if (!subject) return Response.json({ error: 'Outreach item not found' }, { status: 404 })
  const { customerId, policyId, projectId } = subject

  const row = await findAuthorizationRow(admin, customerId, policyId, projectId)
  if (row?.storage_location) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([row.storage_location])
  }

  let del = admin
    .from('policy_documents')
    .delete()
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', SERVICING_AUTHORIZATION_TYPE)
  del = projectId ? del.eq('project_id', projectId) : del.is('project_id', null)
  const { error } = await del
  if (error) {
    console.error('servicing-authorization delete error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ success: true })
}
