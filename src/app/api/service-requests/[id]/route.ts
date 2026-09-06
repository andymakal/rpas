import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

const TERMINAL_COVERAGE = ['Surrendered', 'Terminated', 'Lapsed', 'Cancelled', 'Death Claim', 'Matured']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = ['workflow_status', 'request_type', 'notes', 'date_received', 'date_resolved']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('service_requests')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('service_request patch error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Surrender cascade: when a Policy Surrender SR resolves, mark the linked policy
  // Surrendered and flag the customer as a former client if no active policies remain.
  let surrenderCascade: { policyUpdated: boolean; customerIsFormer: boolean } | null = null

  if (patch.workflow_status === 'resolved') {
    const { data: srInfo } = await supabase
      .from('service_requests')
      .select('request_type, service_policies(id, customer_id)')
      .eq('id', id)
      .single()

    const effectiveType = (patch.request_type as string | undefined) ?? srInfo?.request_type
    const rawPolicy = srInfo?.service_policies
    const policyInfo = (Array.isArray(rawPolicy) ? rawPolicy[0] : rawPolicy) as
      | { id: string; customer_id: string | null }
      | null

    if (effectiveType === 'Policy Surrender' && policyInfo?.id && policyInfo.customer_id) {
      await supabase
        .from('service_policies')
        .update({ coverage_status: 'Surrendered' })
        .eq('id', policyInfo.id)

      const { data: remaining } = await supabase
        .from('service_policies')
        .select('coverage_status')
        .eq('customer_id', policyInfo.customer_id)
        .eq('is_test', false)
        .neq('id', policyInfo.id)

      const hasActive = (remaining ?? []).some(
        p => !TERMINAL_COVERAGE.includes(p.coverage_status as string)
      )
      const isFormer = !hasActive

      if (isFormer) {
        await supabase
          .from('customers')
          .update({ is_former_client: true })
          .eq('id', policyInfo.customer_id)
      }

      surrenderCascade = { policyUpdated: true, customerIsFormer: isFormer }
    }
  }

  return Response.json({ data, surrenderCascade })
}
