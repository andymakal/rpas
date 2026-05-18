import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProductsClient } from './ProductsClient'

export const metadata: Metadata = { title: 'Products' }

export const dynamic = 'force-dynamic'

export type ProductRow = {
  id:              string
  name:            string
  carrier_id:      string | null
  product_type_id: string | null
  gdc_multiplier:  number
  is_active:       boolean
  notes:           string | null
  carrier_name:    string | null
  product_type:    string | null
}

export type CarrierOption = { id: string; name: string; short_name: string | null }
export type ProductTypeOption = { id: string; name: string }

export default async function ProductsPage() {
  const supabase = createAdminClient()

  const [{ data: products }, { data: carriers }, { data: productTypes }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, carrier_id, product_type_id, gdc_multiplier, is_active, notes, carriers(name), product_types(name)')
      .order('name'),
    supabase
      .from('carriers')
      .select('id, name, short_name')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('product_types')
      .select('id, name')
      .order('sort_order'),
  ])

  const rows: ProductRow[] = (products ?? []).map((p: Record<string, unknown>) => ({
    id:              p.id as string,
    name:            p.name as string,
    carrier_id:      p.carrier_id as string | null,
    product_type_id: p.product_type_id as string | null,
    gdc_multiplier:  p.gdc_multiplier as number,
    is_active:       p.is_active as boolean,
    notes:           p.notes as string | null,
    carrier_name:    (p.carriers as { name: string } | null)?.name ?? null,
    product_type:    (p.product_types as { name: string } | null)?.name ?? null,
  }))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-white text-2xl font-semibold">Products</h1>
        <p className="text-slate-400 text-sm mt-1">
          Edit carrier assignments, GDC multipliers, and product details.
          Changes take effect immediately.
        </p>
      </div>
      <ProductsClient
        products={rows}
        carriers={carriers ?? []}
        productTypes={productTypes ?? []}
      />
    </div>
  )
}
