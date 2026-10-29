import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import {
  getProjectTeam,
  getTeamRoster,
  upsertParticipant,
  removeParticipant,
  setEscalationContact,
  removeEscalationContact,
} from '@/lib/projects/team'
import { isProjectRole } from '@/lib/projects/project-roles'
import { syncParticipantCapabilities } from '@/lib/projects/capability-sync'

/**
 * Project TEAM management — add / edit / remove project participants, assign
 * each participant's project responsibility, and set the ordered operations
 * escalation path. Reuses the existing project_participants and
 * project_escalation_contacts structures; it touches NO work assignment,
 * capability, or licensing record.
 *
 *   GET  /api/projects/[id]/team
 *     -> { team: { participants, escalation }, roster }
 *     The project's participants (with responsibility) and ordered escalation
 *     path, plus the active-producer roster for the pickers.
 *
 *   POST /api/projects/[id]/team   { action, ... }
 *     action = 'upsert-participant'   { producer_id, role? | null, note? | null }
 *     action = 'remove-participant'   { producer_id }
 *     action = 'set-escalation'       { producer_id, tier }
 *     action = 'remove-escalation'    { producer_id }
 *
 * Internal admins only; all writes via the service-role client.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()
  const [team, roster] = await Promise.all([
    getProjectTeam(supabase, id),
    getTeamRoster(supabase),
  ])
  return Response.json({ data: { team, roster } })
}

type Body = {
  action?: 'upsert-participant' | 'remove-participant' | 'set-escalation' | 'remove-escalation'
  producer_id?: string
  /** The full desired responsibility SET for the participant. */
  roles?: string[]
  note?: string | null
  tier?: number
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
    case 'upsert-participant': {
      if (!body.producer_id) return Response.json({ error: 'producer_id is required' }, { status: 400 })
      const roles = Array.isArray(body.roles) ? body.roles : []
      // Only accept known, storable responsibilities. Operations escalation is
      // not a role here — it is managed through the escalation path actions.
      const invalid = roles.filter((r) => !isProjectRole(r))
      if (invalid.length > 0) {
        return Response.json({ error: `Unknown responsibility: ${invalid.join(', ')}` }, { status: 400 })
      }
      result = await upsertParticipant(
        supabase,
        id,
        body.producer_id,
        roles,
        body.note && body.note.trim() ? body.note.trim() : null,
      )
      // Establish (or reconcile) the project-scoped work eligibility the stored
      // responsibilities imply, so assigning a responsibility actually lets the
      // person do that work. Mirrors upsertParticipant's own role cleaning so
      // the sync reconciles against exactly what was stored. The capability sync
      // only touches its own 'role_sync' project-scoped rows (never agency-wide,
      // manual, or migration_seed), so this cannot disturb an explicit grant.
      if (result.ok) {
        const storedRoles = Array.from(
          new Set(roles.filter((r) => r && r !== 'operations_escalation' && r !== 'owner')),
        )
        const sync = await syncParticipantCapabilities(supabase, id, body.producer_id, storedRoles)
        if (!sync.ok) result = sync
      }
      break
    }
    case 'remove-participant': {
      if (!body.producer_id) return Response.json({ error: 'producer_id is required' }, { status: 400 })
      result = await removeParticipant(supabase, id, body.producer_id)
      // The person no longer holds any responsibility on this project, so revoke
      // the project-scoped capability this sync established for them here (an
      // empty role set justifies no role_sync activity). Agency-wide and
      // manually-granted rows are left untouched.
      if (result.ok) {
        const sync = await syncParticipantCapabilities(supabase, id, body.producer_id, [])
        if (!sync.ok) result = sync
      }
      break
    }
    case 'set-escalation': {
      if (!body.producer_id) return Response.json({ error: 'producer_id is required' }, { status: 400 })
      if (typeof body.tier !== 'number') return Response.json({ error: 'tier is required' }, { status: 400 })
      result = await setEscalationContact(supabase, id, body.producer_id, body.tier)
      break
    }
    case 'remove-escalation': {
      if (!body.producer_id) return Response.json({ error: 'producer_id is required' }, { status: 400 })
      result = await removeEscalationContact(supabase, id, body.producer_id)
      break
    }
    default:
      return Response.json(
        { error: "action must be 'upsert-participant', 'remove-participant', 'set-escalation', or 'remove-escalation'." },
        { status: 400 },
      )
  }

  if (!result.ok) return Response.json({ error: result.error }, { status: 409 })

  // Return the refreshed team + roster so the client re-renders from server truth.
  const [team, roster] = await Promise.all([
    getProjectTeam(supabase, id),
    getTeamRoster(supabase),
  ])
  return Response.json({ data: { team, roster } })
}
