import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import {
  getProjectWorkflows,
  getWorkflowCatalog,
  addProjectWorkflow,
  removeProjectWorkflow,
  setProjectWorkflowGate,
} from '@/lib/projects/workflows'

/**
 * Project workflow configuration — the smallest interface to SELECT reusable
 * workflows for a project and wire which ones GATE others.
 *
 *   GET  /api/projects/[id]/workflows
 *     -> { selected: ProjectWorkflow[], catalog: CatalogWorkflow[] }
 *     The project's selected workflows (ordered, with their gate dependency)
 *     plus the reusable catalog to pick from.
 *
 *   POST /api/projects/[id]/workflows   { action, ... }
 *     action = 'add'      { workflow_id }                    — add a reusable
 *                                                              workflow to the
 *                                                              project.
 *     action = 'remove'   { project_workflow_id }            — remove it (clears
 *                                                              any gate pointing
 *                                                              at it).
 *     action = 'set-gate' { project_workflow_id,
 *                           gated_by_workflow_id | null }    — set/clear which
 *                                                              workflow gates it.
 *
 * Internal admins only; all writes via the service-role client. No business
 * records (customers, outreach, reviews) are touched — this only edits the
 * project's workflow WIRING.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()
  const [selected, catalog] = await Promise.all([
    getProjectWorkflows(supabase, id),
    getWorkflowCatalog(supabase),
  ])
  return Response.json({ data: { selected, catalog } })
}

type Body = {
  action?: 'add' | 'remove' | 'set-gate'
  workflow_id?: string
  project_workflow_id?: string
  gated_by_workflow_id?: string | null
}

export async function POST(
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

  let result: { ok: true } | { ok: false; error: string }
  switch (body.action) {
    case 'add': {
      if (!body.workflow_id) return Response.json({ error: 'workflow_id is required' }, { status: 400 })
      result = await addProjectWorkflow(supabase, id, body.workflow_id)
      break
    }
    case 'remove': {
      if (!body.project_workflow_id) return Response.json({ error: 'project_workflow_id is required' }, { status: 400 })
      result = await removeProjectWorkflow(supabase, id, body.project_workflow_id)
      break
    }
    case 'set-gate': {
      if (!body.project_workflow_id) return Response.json({ error: 'project_workflow_id is required' }, { status: 400 })
      result = await setProjectWorkflowGate(
        supabase,
        id,
        body.project_workflow_id,
        body.gated_by_workflow_id ?? null,
      )
      break
    }
    default:
      return Response.json({ error: "action must be 'add', 'remove', or 'set-gate'." }, { status: 400 })
  }

  if (!result.ok) return Response.json({ error: result.error }, { status: 409 })

  // Return the refreshed selection so the client can re-render from the server.
  const [selected, catalog] = await Promise.all([
    getProjectWorkflows(supabase, id),
    getWorkflowCatalog(supabase),
  ])
  return Response.json({ data: { selected, catalog } })
}
