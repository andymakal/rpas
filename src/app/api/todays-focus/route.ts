import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'

/**
 * Today's Focus API — temporary management direction fed to the GoRules Daily
 * Direction decision.
 *
 *   GET    /api/todays-focus          list currently-active focus
 *   POST   /api/todays-focus          create a focus (project or activity)
 *   DELETE /api/todays-focus?id=...    end a focus early
 *
 * Focus is temporary BY CONSTRUCTION: expires_at is required and must be in the
 * future, so a focus always ends and can never silently become a permanent
 * priority. The reader (getActiveFocus) only returns non-expired rows, so an
 * expired focus simply stops influencing anything. Focus NEVER disables other
 * work and never overrides a customer commitment or capability eligibility —
 * those constraints live in the ZEN engine, not here.
 *
 * Internal-only. Writes via the service-role client after requireInternalAdmin.
 */

const MAX_FOCUS_DAYS = 14 // a focus cannot be set further out than two weeks

export async function GET() {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('todays_focus')
    .select('id, scope, project_id, work_function_id, note, expires_at, created_at, projects ( name ), work_functions ( label, canonical_key )')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: {
    scope?: 'project' | 'activity'
    project_id?: string | null
    work_function_id?: string | null
    note?: string | null
    expires_at?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { scope } = body
  if (scope !== 'project' && scope !== 'activity') {
    return Response.json({ error: "scope must be 'project' or 'activity'" }, { status: 400 })
  }
  // Shape rules mirror the DB check: project focus needs a project; activity
  // focus needs an activity (and may optionally be scoped to a project).
  if (scope === 'project' && !body.project_id) {
    return Response.json({ error: 'A project focus requires a project_id' }, { status: 400 })
  }
  if (scope === 'activity' && !body.work_function_id) {
    return Response.json({ error: 'An activity focus requires a work_function_id' }, { status: 400 })
  }

  // expires_at is required and bounded: it must be in the future and within the
  // temporary window, so direction cannot be made permanent.
  if (!body.expires_at) {
    return Response.json({ error: 'expires_at is required (focus is always temporary)' }, { status: 400 })
  }
  const expires = new Date(body.expires_at)
  if (Number.isNaN(expires.getTime())) {
    return Response.json({ error: 'expires_at is not a valid date/time' }, { status: 400 })
  }
  const now = Date.now()
  if (expires.getTime() <= now) {
    return Response.json({ error: 'expires_at must be in the future' }, { status: 400 })
  }
  if (expires.getTime() - now > MAX_FOCUS_DAYS * 86_400_000) {
    return Response.json(
      { error: `A focus is temporary and cannot run longer than ${MAX_FOCUS_DAYS} days.` },
      { status: 400 },
    )
  }

  // Record who set the focus (auth user), for the created_by audit column.
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('todays_focus')
    .insert({
      scope,
      project_id: scope === 'project' ? body.project_id : (body.project_id ?? null),
      work_function_id: scope === 'activity' ? body.work_function_id : null,
      note: body.note?.trim() || null,
      created_by: user?.id ?? null,
      expires_at: expires.toISOString(),
    })
    .select('id')
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  const supabase = createAdminClient()
  // Ending a focus early is a hard delete: an expired/removed focus simply stops
  // influencing the decision. No terminal business state is involved.
  const { error } = await supabase.from('todays_focus').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: { id, ended: true } })
}
