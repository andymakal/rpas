import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { NextRequest } from 'next/server'

/**
 * Project maintenance — PATCH /api/projects/[id]
 *
 * The single endpoint for a project's lifecycle maintenance actions. Each call
 * carries an `action`; all of them are authorized for internal admins only
 * (requireInternalAdmin), and every write goes through the service-role client
 * which bypasses RLS. These are soft state changes on the project row — NOTHING
 * is ever deleted, so runs, memberships, matches, documents, workflow history,
 * and customer relationships are always preserved.
 *
 *   edit     — rename and/or re-describe the project. No status change.
 *   complete — move an active project to completed (sets completed_at/by).
 *   reopen   — return a completed project to active (clears completed_at/by).
 *   archive  — remove a project from the normal working lists without deleting
 *              records. Allowed from active OR completed. Records the state it
 *              came from in previous_status so restore is exact.
 *   restore  — return an archived project to its previous state (active or
 *              completed), using previous_status.
 *
 * The projects_completed_consistency / projects_status_check constraints
 * (20261020000001) are the backstop: they reject any inconsistent lifecycle
 * column combination at the database, so the handler and the DB agree.
 */

const SELECT =
  'id, name, description, status, created_at, completed_at, archived_at, previous_status, project_types ( name )'

type ProjectTypeEmbed = { name: string } | null

type Body = {
  action?: 'edit' | 'complete' | 'reopen' | 'archive' | 'restore'
  name?: string
  description?: string | null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  let body: Body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // The live project, needed to validate the transition against its real state.
  const { data: current, error: readError } = await supabase
    .from('projects')
    .select('id, status, completed_at, previous_status')
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    return Response.json({ error: readError.message }, { status: 500 })
  }
  if (!current) {
    return Response.json({ error: 'Project not found.' }, { status: 404 })
  }

  const now = new Date().toISOString()
  let patch: Record<string, unknown>

  switch (body.action) {
    case 'edit': {
      // Rename / re-describe. An archived project is read-only until restored,
      // so editing it is blocked to match "cannot receive new activity".
      if (current.status === 'archived') {
        return Response.json(
          { error: 'This project is archived. Restore it before editing.' },
          { status: 409 },
        )
      }
      const next: Record<string, unknown> = {}
      if (typeof body.name === 'string') {
        const name = body.name.trim()
        if (!name) {
          return Response.json({ error: 'A project name is required.' }, { status: 400 })
        }
        next.name = name
      }
      if ('description' in body) {
        const d = typeof body.description === 'string' ? body.description.trim() : ''
        next.description = d.length > 0 ? d : null
      }
      if (Object.keys(next).length === 0) {
        return Response.json({ error: 'Nothing to update.' }, { status: 400 })
      }
      patch = next
      break
    }

    case 'complete': {
      if (current.status !== 'active') {
        return Response.json(
          { error: 'Only an active project can be marked complete.' },
          { status: 409 },
        )
      }
      patch = { status: 'completed', completed_at: now, completed_by: auth.userId }
      break
    }

    case 'reopen': {
      if (current.status !== 'completed') {
        return Response.json(
          { error: 'Only a completed project can be reopened.' },
          { status: 409 },
        )
      }
      patch = { status: 'active', completed_at: null, completed_by: null }
      break
    }

    case 'archive': {
      if (current.status === 'archived') {
        return Response.json({ error: 'This project is already archived.' }, { status: 409 })
      }
      // Remember the exact state we came from so restore is unambiguous. The
      // completed_at timestamp is preserved untouched for a completed project,
      // so restoring returns it to completed with its original completion.
      patch = {
        status: 'archived',
        archived_at: now,
        archived_by: auth.userId,
        previous_status: current.status, // 'active' | 'completed'
      }
      break
    }

    case 'restore': {
      if (current.status !== 'archived') {
        return Response.json({ error: 'Only an archived project can be restored.' }, { status: 409 })
      }
      const back = current.previous_status === 'completed' ? 'completed' : 'active'
      patch = {
        status: back,
        archived_at: null,
        archived_by: null,
        previous_status: null,
      }
      break
    }

    default:
      return Response.json(
        { error: "action must be 'edit', 'complete', 'reopen', 'archive', or 'restore'." },
        { status: 400 },
      )
  }

  const { data: updated, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select(SELECT)
    .single()

  if (error || !updated) {
    console.error('project maintenance update error:', error)
    return Response.json({ error: error?.message ?? 'Failed to update project' }, { status: 500 })
  }

  const { project_types, ...rest } = updated as typeof updated & { project_types: ProjectTypeEmbed }
  return Response.json({ data: { ...rest, project_type: project_types?.name ?? '' } })
}
