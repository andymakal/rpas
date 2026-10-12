import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { assertProjectActive } from '@/lib/projects/guard'
import {
  REQUIRED_DOCUMENT_TYPES,
  type RequiredDocumentType,
} from '@/lib/projects/review-1035'

/**
 * Step 3 document SKIPS for the 1035 Exchange Review.
 *
 * A skip is a durable, reversible marker that operations explicitly marked a
 * required document (carrier_statement | reprojection) UNAVAILABLE for a
 * specific permanent policy. It is NOT a received document — real files live in
 * policy_documents. A (policy, type) counts as ADDRESSED for the handoff gate
 * when a document exists OR a skip row exists.
 *
 * POST   { document_type, policy_id, reason? } -> record a skip (upsert).
 * DELETE ?type=<document_type>&policy_id=<id>  -> remove the skip (reverse it).
 *
 * Both require an internal admin and use the service-role client, matching the
 * documents route. Writes are blocked on archived projects.
 */

async function resolveTarget(
  projectId: string,
  customerId: string,
  policyId: string | null,
  documentType: string,
) {
  const supabase = createAdminClient()

  const active = await assertProjectActive(supabase, projectId)
  if (!active.ok) return { ok: false as const, status: active.status, error: active.error }

  if (!REQUIRED_DOCUMENT_TYPES.includes(documentType as RequiredDocumentType)) {
    return {
      ok: false as const,
      status: 400,
      error: `document_type must be one of: ${REQUIRED_DOCUMENT_TYPES.join(', ')}`,
    }
  }
  if (!policyId) {
    return { ok: false as const, status: 400, error: 'policy_id is required (skips are policy-specific)' }
  }

  // Confirm the customer is in this project.
  const { data: membership } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!membership) {
    return { ok: false as const, status: 404, error: 'Customer is not in this project' }
  }

  // The policy must belong to this customer.
  const { data: p } = await supabase
    .from('service_policies')
    .select('id')
    .eq('id', policyId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!p) {
    return { ok: false as const, status: 400, error: 'policy_id does not belong to this customer' }
  }

  return { ok: true as const, supabase }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params

  let body: { document_type?: string; policy_id?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const documentType = String(body.document_type ?? '').trim()
  const policyId = String(body.policy_id ?? '').trim() || null
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null

  const target = await resolveTarget(projectId, customerId, policyId, documentType)
  if (!target.ok) return Response.json({ error: target.error }, { status: target.status })

  const { error } = await target.supabase
    .from('project_customer_document_skips')
    .upsert(
      {
        project_id: projectId,
        customer_id: customerId,
        policy_id: policyId,
        document_type: documentType,
        reason,
        skipped_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,customer_id,policy_id,document_type' },
    )
  if (error) {
    console.error('review-1035 document skip upsert error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ data: { policy_id: policyId, document_type: documentType, skipped: true } }, { status: 201 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; customerId: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id: projectId, customerId } = await params
  const sp = new URL(request.url).searchParams
  const documentType = (sp.get('type') ?? '').trim()
  const policyId = (sp.get('policy_id') ?? '').trim() || null

  const target = await resolveTarget(projectId, customerId, policyId, documentType)
  if (!target.ok) return Response.json({ error: target.error }, { status: target.status })

  const { error } = await target.supabase
    .from('project_customer_document_skips')
    .delete()
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
    .eq('policy_id', policyId)
    .eq('document_type', documentType)
  if (error) {
    console.error('review-1035 document skip delete error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ success: true })
}
