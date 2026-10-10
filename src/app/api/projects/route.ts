import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * Projects API — the durable project record.
 *
 * This is the foundation endpoint only: it creates and lists the basic project
 * record. Population criteria, runs, 1035 rules, and the project workflow are
 * intentionally not handled here yet.
 *
 * The project type is a durable foreign key to project_types; new projects must
 * reference an existing (active) type by id rather than free text.
 */

type NewProjectBody = {
  name?: string
  project_type_id?: string
  description?: string | null
}

// Shape returned by the project_types embed. PostgREST returns an object for a
// to-one relationship, but types it loosely, so we narrow it here.
type ProjectTypeEmbed = { name: string } | null

/**
 * POST /api/projects
 * Create a new project. New projects always start Active.
 * Body: { name, project_type_id, description? }
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: NewProjectBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const projectTypeId =
    typeof body.project_type_id === 'string' ? body.project_type_id.trim() : ''
  const description =
    typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null

  if (!name) {
    return Response.json({ error: 'A project name is required.' }, { status: 400 })
  }
  if (!projectTypeId) {
    return Response.json({ error: 'A project type is required.' }, { status: 400 })
  }

  // Guard: the type must exist and be active. This gives a clear 400 instead of
  // a raw FK error, and stops new projects being created against a retired type.
  const { data: type, error: typeError } = await supabase
    .from('project_types')
    .select('id, is_active')
    .eq('id', projectTypeId)
    .maybeSingle()

  if (typeError) {
    return Response.json({ error: typeError.message }, { status: 500 })
  }
  if (!type) {
    return Response.json({ error: 'That project type does not exist.' }, { status: 400 })
  }
  if (!type.is_active) {
    return Response.json({ error: 'That project type is no longer available.' }, { status: 400 })
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      name,
      project_type_id: projectTypeId,
      description,
      status: 'active',
    })
    .select('id, name, description, status, created_at, completed_at, project_types ( name )')
    .single()

  if (error || !project) {
    console.error('projects insert error:', error)
    return Response.json({ error: error?.message ?? 'Failed to create project' }, { status: 500 })
  }

  const { project_types, ...rest } = project as typeof project & { project_types: ProjectTypeEmbed }
  return Response.json(
    { data: { ...rest, project_type: project_types?.name ?? '' } },
    { status: 201 },
  )
}

/**
 * GET /api/projects
 * List all projects, newest first, with their type name.
 */
export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, status, created_at, completed_at, project_types ( name )')
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map(p => {
    const { project_types, ...rest } = p as typeof p & { project_types: ProjectTypeEmbed }
    return { ...rest, project_type: project_types?.name ?? '' }
  })

  return Response.json({ data: rows })
}
