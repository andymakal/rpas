import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Project types API — the durable catalog of project kinds.
 *
 * GET /api/project-types
 * List active project types, used to populate the "Start New" dropdown.
 * Inactive types are intentionally excluded here; projects that already
 * reference an inactive type keep it, but it is no longer offered for new ones.
 */
export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('project_types')
    .select('id, name, description')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: data ?? [] })
}
