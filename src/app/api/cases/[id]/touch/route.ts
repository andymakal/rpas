import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: current, error: fetchErr } = await supabase
    .from('cases')
    .select('touches')
    .eq('id', id)
    .single()

  if (fetchErr || !current) {
    return Response.json({ error: 'Case not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('cases')
    .update({
      touches: (current.touches ?? 0) + 1,
      last_contact_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('touches, last_contact_at')
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data })
}
