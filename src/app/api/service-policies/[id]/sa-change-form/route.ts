import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { buildServicingAgentChangePdf } from '@/lib/servicing-agent-form'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: policy, error } = await supabase
    .from('service_policies')
    .select('client_name, policy_number')
    .eq('id', id)
    .single()

  if (error || !policy) {
    return new Response('Policy not found', { status: 404 })
  }

  const ownerName       = policy.client_name ?? 'Policy Owner'
  const contractNumbers = policy.policy_number ? [policy.policy_number] : []

  const pdfBytes = await buildServicingAgentChangePdf({ ownerName, contractNumbers })

  const safeName = ownerName.replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'SA-Change'
  const filename = `SA-Change-${safeName}.pdf`

  return new Response(pdfBytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
