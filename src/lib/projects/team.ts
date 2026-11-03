/**
 * Project TEAM model (server-only) — Right Path.
 *
 * A project's team is made of two existing, deliberately separate structures:
 *
 *   - project_participants         — who is ON the project and what they are
 *                                    RESPONSIBLE for (the `role`, plus an
 *                                    optional free-text `note`). One row per
 *                                    (project, producer). Drives My Projects
 *                                    visibility and the Overview Team section.
 *   - project_escalation_contacts  — the ORDERED operations escalation path for
 *                                    operational exceptions (tier 1 = first
 *                                    destination). One row per (project, tier).
 *
 * These are kept strictly distinct from a producer's job title
 * (producers.title) and their licensing facts (producers.is_*_licensed), and
 * THIS module never reads or writes a producer's capability / routing
 * eligibility (producer_work_functions / work_functions): a project
 * responsibility is still modelled as its own thing here.
 *
 * What DID change: the Team API route now layers a capability RECONCILE on top
 * of these writes (src/lib/projects/capability-sync.ts), so that assigning or
 * changing a project responsibility also establishes the matching PROJECT-SCOPED
 * work eligibility automatically. That bridge lives in the route and the sync
 * module, deliberately NOT in here, and it only ever manages its own
 * 'role_sync'-provenance rows — it never disturbs an agency-wide or manually
 * granted assignment. So this module stays a pure responsibility model; the
 * responsibility -> capability effect is composed one layer up.
 *
 * This is the single place the team is read and written, so the Overview Team
 * section, its API route, and the My Projects composition all agree. It takes a
 * SupabaseClient (the admin client at the call sites) and performs no auth of
 * its own — the API route gates with requireInternalAdmin.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * One person on a project. Shared shape for a participant and for an escalation
 * contact (escalation rows carry `tier`; participants carry `roles`).
 */
export interface ProjectPerson {
  producerId: string
  name: string
  /** Participation note, or the escalation tier note. */
  note: string | null
  /** The participant's SET of project responsibilities (project_owner,
   * operations_manager, operations, producer, ...). A person can hold several.
   * PROJECT responsibilities, kept distinct from the producer's job title, their
   * licensing facts, and their routing / capability assignments. Empty when none
   * are set. Operations escalation is NOT in this set — see `escalationTier`. */
  roles: string[]
  /** The producer's life-license FACT (a qualification, NOT a responsibility):
   * true = affirmatively held, false = affirmatively not, null = unknown. Shown
   * as a small annotation beside the responsibility, never merged into it. */
  isLifeLicensed?: boolean | null
  /** DERIVED from the escalation path: this participant's escalation tier (1 =
   * first destination), or null if they are not on the escalation path. The
   * single source of truth is project_escalation_contacts, not a stored role. */
  escalationTier?: number | null
  /** Set for rows that ARE escalation entries: 1 = first destination. */
  tier?: number
}

/** A selectable team member for the add-participant / escalation picker. */
export interface RosterMember {
  producerId: string
  name: string
  /** The producer's job title — shown ONLY to identify the person in the
   * picker. It is never stored as, or conflated with, a responsibility. */
  title: string | null
}

/** A project's full team: participants and the ordered escalation path. */
export interface ProjectTeam {
  participants: ProjectPerson[]
  escalation: ProjectPerson[]
}

type ParticipantRow = {
  producer_id: string
  note: string | null
  /** Current responsibilities. */
  roles: string[] | null
  /** Legacy single responsibility, read-mapped when `roles` is empty. */
  role: string | null
  producers: { first_name: string | null; last_name: string | null; is_life_licensed: boolean | null }
    | { first_name: string | null; last_name: string | null; is_life_licensed: boolean | null }[]
    | null
}
type EscalationRow = {
  producer_id: string
  tier: number
  note: string | null
  producers: { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null
}

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'Team member'
}

/**
 * Read a project's participants (with their responsibility) and its ordered
 * escalation path. Participants are returned in a stable order (by name) and
 * escalation by tier ascending (1 first).
 */
export async function getProjectTeam(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectTeam> {
  const [{ data: participants }, { data: escalation }] = await Promise.all([
    supabase
      .from('project_participants')
      .select('producer_id, note, roles, role, producers ( first_name, last_name, is_life_licensed )')
      .eq('project_id', projectId),
    supabase
      .from('project_escalation_contacts')
      .select('producer_id, tier, note, producers ( first_name, last_name )')
      .eq('project_id', projectId)
      .order('tier', { ascending: true }),
  ])

  const path: ProjectPerson[] = ((escalation ?? []) as unknown as EscalationRow[]).map((e) => {
    const prod = Array.isArray(e.producers) ? e.producers[0] : e.producers
    return {
      producerId: e.producer_id,
      name: fullName(prod?.first_name, prod?.last_name),
      note: e.note,
      roles: [],
      tier: e.tier,
    }
  })
  // Derive each participant's escalation tier from the path (single source of truth).
  const tierByProducer = new Map(path.map((e) => [e.producerId, e.tier as number]))

  const people: ProjectPerson[] = ((participants ?? []) as unknown as ParticipantRow[]).map((p) => {
    const prod = Array.isArray(p.producers) ? p.producers[0] : p.producers
    // Prefer the multi-value `roles`; fall back to the legacy single `role`
    // (expanding the combined 'owner' token) for any not-yet-migrated row.
    const roles = normalizeRoles(p.roles, p.role)
    return {
      producerId: p.producer_id,
      name: fullName(prod?.first_name, prod?.last_name),
      note: p.note,
      roles,
      isLifeLicensed: prod?.is_life_licensed ?? null,
      escalationTier: tierByProducer.get(p.producer_id) ?? null,
    }
  })
  people.sort((a, b) => a.name.localeCompare(b.name))

  return { participants: people, escalation: path }
}

/**
 * The stored responsibility set, preferring the multi-value `roles`. Falls back
 * to the legacy single `role` for a row not yet migrated: 'owner' expands to
 * project_owner + operations_manager, and 'operations_escalation' contributes
 * nothing (it lives in the escalation path, not the role set).
 */
function normalizeRoles(roles: string[] | null, legacyRole: string | null): string[] {
  if (roles && roles.length > 0) return roles
  if (!legacyRole) return []
  if (legacyRole === 'owner') return ['project_owner', 'operations_manager']
  if (legacyRole === 'operations_escalation') return []
  return [legacyRole]
}

/**
 * The active-producer roster for the pickers. Identity only (id, name, title);
 * licensing and capability columns are intentionally not selected so the team
 * UI cannot couple a responsibility to a capability or a license.
 */
export async function getTeamRoster(supabase: SupabaseClient): Promise<RosterMember[]> {
  const { data } = await supabase
    .from('producers')
    .select('id, first_name, last_name, title')
    .eq('is_active', true)
    .order('first_name', { ascending: true })
  return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; title: string | null }[])
    .map((p) => ({ producerId: p.id, name: fullName(p.first_name, p.last_name), title: p.title }))
}

type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Add a participant to the project, or update their responsibility SET / note if
 * they are already on it (idempotent on the unique (project, producer) pair).
 * `roles` is the full desired set (an empty array clears all responsibilities);
 * `note` null clears the note. The legacy single `role` column is cleared so the
 * array is the sole authoritative value.
 *
 * Operations escalation is NOT a role here — pass it through the escalation path
 * helpers; any such token is ignored defensively.
 */
export async function upsertParticipant(
  supabase: SupabaseClient,
  projectId: string,
  producerId: string,
  roles: string[],
  note: string | null,
): Promise<WriteResult> {
  if (!producerId) return { ok: false, error: 'A team member is required.' }

  // De-duplicate and drop any escalation token (escalation is not a stored role).
  const cleanRoles = Array.from(
    new Set((roles ?? []).filter((r) => r && r !== 'operations_escalation' && r !== 'owner')),
  )

  const { data: existing, error: readErr } = await supabase
    .from('project_participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('producer_id', producerId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }

  if (existing) {
    const { error } = await supabase
      .from('project_participants')
      .update({ roles: cleanRoles, role: null, note })
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const { error } = await supabase
    .from('project_participants')
    .insert({ project_id: projectId, producer_id: producerId, roles: cleanRoles, role: null, note })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Remove a participant from the project. Also removes any escalation entry for
 * that same producer on this project, so a removed person never lingers in the
 * escalation path (the two structures stay consistent).
 */
export async function removeParticipant(
  supabase: SupabaseClient,
  projectId: string,
  producerId: string,
): Promise<WriteResult> {
  if (!producerId) return { ok: false, error: 'A team member is required.' }

  const { error: escErr } = await supabase
    .from('project_escalation_contacts')
    .delete()
    .eq('project_id', projectId)
    .eq('producer_id', producerId)
  if (escErr) return { ok: false, error: escErr.message }

  const { error } = await supabase
    .from('project_participants')
    .delete()
    .eq('project_id', projectId)
    .eq('producer_id', producerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Place a producer at a given escalation tier (1 = first destination). Moves the
 * producer if they are already in the path, and is idempotent on the unique
 * (project, tier) pair. Any OTHER producer currently holding that tier is
 * cleared first so the tier is never doubly held. The producer must already be
 * a participant — escalation is drawn from the team, not an outside directory.
 */
export async function setEscalationContact(
  supabase: SupabaseClient,
  projectId: string,
  producerId: string,
  tier: number,
): Promise<WriteResult> {
  if (!producerId) return { ok: false, error: 'A team member is required.' }
  if (!Number.isInteger(tier) || tier < 1) return { ok: false, error: 'Tier must be a whole number of 1 or greater.' }

  // Escalation contacts come from the project team.
  const { data: isMember, error: memberErr } = await supabase
    .from('project_participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('producer_id', producerId)
    .maybeSingle()
  if (memberErr) return { ok: false, error: memberErr.message }
  if (!isMember) return { ok: false, error: 'Add the person to the team before placing them in the escalation path.' }

  // Free the target tier if a different producer holds it (unique (project,tier)).
  const { error: freeErr } = await supabase
    .from('project_escalation_contacts')
    .delete()
    .eq('project_id', projectId)
    .eq('tier', tier)
    .neq('producer_id', producerId)
  if (freeErr) return { ok: false, error: freeErr.message }

  // Move this producer to the target tier if they are already in the path.
  const { data: existing, error: readErr } = await supabase
    .from('project_escalation_contacts')
    .select('id')
    .eq('project_id', projectId)
    .eq('producer_id', producerId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }

  if (existing) {
    const { error } = await supabase
      .from('project_escalation_contacts')
      .update({ tier })
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const { error } = await supabase
    .from('project_escalation_contacts')
    .insert({ project_id: projectId, producer_id: producerId, tier })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Remove a producer from the escalation path (leaves them a participant). */
export async function removeEscalationContact(
  supabase: SupabaseClient,
  projectId: string,
  producerId: string,
): Promise<WriteResult> {
  if (!producerId) return { ok: false, error: 'A team member is required.' }
  const { error } = await supabase
    .from('project_escalation_contacts')
    .delete()
    .eq('project_id', projectId)
    .eq('producer_id', producerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
