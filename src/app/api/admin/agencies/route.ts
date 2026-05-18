import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, display_name, slug, sml_team_id } = body as {
    name:         string
    display_name: string
    slug:         string
    sml_team_id:  string | null
  }

  if (!name?.trim())         return Response.json({ error: 'Allstate name is required' }, { status: 400 })
  if (!display_name?.trim()) return Response.json({ error: 'Display name is required' }, { status: 400 })
  if (!slug?.trim())         return Response.json({ error: 'Slug is required' }, { status: 400 })

  const dashboard_token = crypto.randomUUID()

  const { data, error } = await supabase
    .from('agencies')
    .insert({
      name:            name.trim(),
      display_name:    display_name.trim(),
      slug:            slug.trim(),
      dashboard_token,
      sml_team_id:     sml_team_id || null,
      is_active:       true,
      is_test:         false,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'A slug with that value already exists — choose a different one.' }, { status: 409 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data }, { status: 201 })
}

export { toSlug }
