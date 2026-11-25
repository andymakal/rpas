import { createAdminClient } from '@/lib/supabase/admin'
import { CarrierFormsClient } from './CarrierFormsClient'

export const dynamic = 'force-dynamic'

export type CarrierFormRow = {
  id:           string
  carrier_id:   string | null
  form_number:  string | null
  form_name:    string
  description:  string | null
  sr_types:     string[] | null
  states:       string[] | null
  file_url:     string | null
  is_fillable:  boolean
  fill_handler: string | null
  is_current:   boolean
  notes:        string | null
  created_at:   string
  carriers:     { id: string; name: string; short_name: string } | null
}

export type CarrierOption = { id: string; name: string; short_name: string }

export default async function CarrierFormsPage() {
  const supabase = createAdminClient()

  const [{ data: forms }, { data: carriers }] = await Promise.all([
    supabase
      .from('carrier_forms')
      .select('*, carriers ( id, name, short_name )')
      .order('is_current', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('carriers')
      .select('id, name, short_name')
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <CarrierFormsClient
          initialForms={(forms ?? []) as unknown as CarrierFormRow[]}
          carriers={(carriers ?? []) as CarrierOption[]}
        />
      </div>
    </div>
  )
}
