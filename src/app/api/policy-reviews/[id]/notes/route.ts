import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('customer_notes')
    .select('id, section, author_name, body, created_at')
    .eq('policy_review_id', id)
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionClient = await createClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { section?: string; body?: string }
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const section = body.section?.trim()
  const text    = body.body?.trim()
  if (!section || !['triage', 'producer', 'underwriting'].includes(section)) {
    return Response.json({ error: 'Invalid section' }, { status: 400 })
  }
  if (!text) return Response.json({ error: 'Note body is required' }, { status: 400 })

  const supabase = createAdminClient()

  // Look up customer_id via policy_review → service_policy
  const { data: reviewRow } = await supabase
    .from('policy_reviews')
    .select('policy_id')
    .eq('id', id)
    .single()
  if (!reviewRow?.policy_id) {
    return Response.json({ error: 'Policy review not found' }, { status: 404 })
  }

  const { data: policyRow } = await supabase
    .from('service_policies')
    .select('customer_id')
    .eq('id', reviewRow.policy_id)
    .single()

  const { data: profile } = await supabase
    .from('staff_profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()
  const authorName = profile?.display_name ?? user.email?.split('@')[0] ?? 'Staff'

  const { data, error } = await supabase
    .from('customer_notes')
    .insert({
      customer_id:     policyRow?.customer_id ?? null,
      policy_review_id: id,
      section,
      author_id:       user.id,
      author_name:     authorName,
      body:            text,
    })
    .select('id, section, author_name, body, created_at')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data }, { status: 201 })
}
