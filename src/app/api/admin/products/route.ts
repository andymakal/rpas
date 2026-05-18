import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, carrier_id, product_type_id, gdc_multiplier, notes } = body as {
    name:            string
    carrier_id:      string | null
    product_type_id: string | null
    gdc_multiplier:  number
    notes:           string | null
  }

  if (!name?.trim()) {
    return Response.json({ error: 'Product name is required' }, { status: 400 })
  }
  if (typeof gdc_multiplier !== 'number' || isNaN(gdc_multiplier)) {
    return Response.json({ error: 'GDC multiplier must be a number' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      name:            name.trim(),
      carrier_id:      carrier_id || null,
      product_type_id: product_type_id || null,
      gdc_multiplier,
      notes:           notes || null,
      is_active:       true,
    })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data }, { status: 201 })
}
