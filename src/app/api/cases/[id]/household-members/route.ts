import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * GET  /api/cases/[id]/household-members  — list members for a case
 * POST /api/cases/[id]/household-members  — add a new member
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('case_household_members')
    .select('id, first_name, last_name, date_of_birth, gender, tobacco_use, height_ft, height_in, weight_lbs, health_notes, quoted_carrier, quoted_product_type, face_amount, linked_case_id, created_at')
    .eq('case_id', id)
    .order('created_at')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  let body: {
    first_name:    string
    last_name:     string
    date_of_birth?: string | null
    gender?:        string | null
    tobacco_use?:   string | null
  }
  try { body = await request.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.first_name?.trim()) return Response.json({ error: 'first_name is required' }, { status: 400 })
  if (!body.last_name?.trim())  return Response.json({ error: 'last_name is required' },  { status: 400 })

  const { data, error } = await supabase
    .from('case_household_members')
    .insert({
      case_id:       id,
      first_name:    body.first_name.trim(),
      last_name:     body.last_name.trim(),
      date_of_birth: body.date_of_birth || null,
      gender:        body.gender        || null,
      tobacco_use:   body.tobacco_use   || null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data }, { status: 201 })
}
