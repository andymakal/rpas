import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { buildServicingAgentChangePdf, type PostalAddress } from '@/lib/servicing-agent-form'

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
 *   delivery    — 'email' (default) returns the form only; 'postal' prepends a
 *                 cover letter addressed to the customer so the packet can be
 *                 printed and mailed. Postal requires a resolvable mailing
 *                 address on the customer record.
 */
export async function GET(request: NextRequest) {
  // Internal-admin only: this returns a customer's name and contract numbers on
  // a prefilled carrier form, so it must enforce the same authorization as every
  // other internal stewardship route — being merely authenticated is not enough.
  const auth = await requireInternalAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customer_id') ?? ''
  const ownerOverride = searchParams.get('owner_name')?.trim() ?? ''
  const contractsOverride = searchParams.get('contracts')?.trim() ?? ''
  const policyIds = searchParams.getAll('policy_id').filter(Boolean)
  const delivery = (searchParams.get('delivery')?.trim() ?? 'email').toLowerCase()
  const isPostal = delivery === 'postal'

  if (!customerId && !ownerOverride) {
    return NextResponse.json(
      { error: 'customer_id (or owner_name + contracts) is required' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // Owner name: override wins; otherwise the customer's full name. For the
  // postal path we also need the customer's mailing address, so fetch it in the
  // same lookup. A row is fetched whenever we have a customer_id and still need
  // the name OR a postal address.
  let ownerName = ownerOverride
  let postalTo: PostalAddress | null = null
  if (customerId && (!ownerName || isPostal)) {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('first_name, last_name, address_line1, city, state, zip')
      .eq('id', customerId)
      .single()
    if (error || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    if (!ownerName) {
      ownerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
    }
    if (isPostal) {
      const hasAddress = Boolean(customer.address_line1 && customer.city && customer.state && customer.zip)
      if (!hasAddress) {
        return NextResponse.json(
          { error: 'This customer has no complete mailing address on file. Add one before generating a postal packet.' },
          { status: 400 },
        )
      }
      postalTo = {
        name: ownerName || [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim(),
        line1: customer.address_line1,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
      }
    }
  }

  // Postal always requires a resolvable address, which comes from the customer
  // record. An owner_name override alone cannot produce a postal packet.
  if (isPostal && !postalTo) {
    return NextResponse.json(
      { error: 'A customer_id with a complete mailing address is required for postal delivery.' },
      { status: 400 },
    )
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

  const pdfBytes = await buildServicingAgentChangePdf({ ownerName, contractNumbers, postalTo })

  const safeName = ownerName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const filename = `servicing-agent-change-${isPostal ? 'postal-' : ''}${safeName || 'form'}.pdf`

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
