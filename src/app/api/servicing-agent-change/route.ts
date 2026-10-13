import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildServicingAgentChangePdf } from '@/lib/servicing-agent-form'

/**
 * GET /api/servicing-agent-change?customer_id=...&policy_id=...&policy_id=...
 *
 * Generates the filled Everlake/Allstate Servicing Agent Change (ALL2018-4) PDF
 * for a customer and the selected contracts, and returns it as a downloadable
 * file. The permanent new-servicing-agent values are baked into the form; the
 * owner name is the customer's full name; signature and date are left blank.
 *
 * Optional overrides let the operator correct values before generating:
 *   owner_name  — overrides the printed requester name
 *   contracts   — comma-separated contract numbers used verbatim (overrides the
 *                 policy_id lookup; supports hand-corrected / missing numbers)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customer_id') ?? ''
  const ownerOverride = searchParams.get('owner_name')?.trim() ?? ''
  const contractsOverride = searchParams.get('contracts')?.trim() ?? ''
  const policyIds = searchParams.getAll('policy_id').filter(Boolean)

  if (!customerId && !ownerOverride) {
    return NextResponse.json(
      { error: 'customer_id (or owner_name + contracts) is required' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // Owner name: override wins; otherwise the customer's full name.
  let ownerName = ownerOverride
  if (!ownerName && customerId) {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', customerId)
      .single()
    if (error || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    ownerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
  }

  // Contract numbers: an explicit comma-separated override wins (allows the
  // operator to add missing or corrected numbers). Otherwise resolve the
  // selected policy ids to their policy_number, scoped to THIS customer so a
  // stray id can never pull another customer's contract.
  let contractNumbers: string[] = []
  if (contractsOverride) {
    contractNumbers = contractsOverride.split(',').map(s => s.trim()).filter(Boolean)
  } else if (policyIds.length > 0 && customerId) {
    const { data: policies, error } = await supabase
      .from('service_policies')
      .select('id, policy_number')
      .eq('customer_id', customerId)
      .eq('is_test', false)
      .in('id', policyIds)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // Preserve the operator's selection order.
    const byId = new Map((policies ?? []).map(p => [p.id, p.policy_number as string]))
    contractNumbers = policyIds
      .map(id => byId.get(id))
      .filter((n): n is string => Boolean(n && n.trim()))
  }

  if (!ownerName) {
    return NextResponse.json(
      { error: 'Could not resolve the contract owner name.' },
      { status: 400 },
    )
  }

  const pdfBytes = await buildServicingAgentChangePdf({ ownerName, contractNumbers })

  const safeName = ownerName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const filename = `servicing-agent-change-${safeName || 'form'}.pdf`

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
