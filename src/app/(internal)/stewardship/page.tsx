import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { StewardshipClient } from './StewardshipClient'

export const metadata: Metadata = { title: 'Stewardship' }
export const dynamic = 'force-dynamic'

export type AgencyOption = { id: string; name: string }

export default async function StewardshipPage() {
  const supabase = createAdminClient()

  const { data: agencies } = await supabase
    .from('agencies')
    .select('id, name, display_name')
    .eq('is_test', false)
    .order('name')

  const agencyOptions: AgencyOption[] = (agencies ?? []).map((a: Record<string, unknown>) => ({
    id: a.id as string,
    name: (a.display_name as string | null) ?? (a.name as string),
  }))

  return (
    <div className="min-h-full bg-slate-50 p-8">
      <StewardshipClient agencies={agencyOptions} />
    </div>
  )
}
