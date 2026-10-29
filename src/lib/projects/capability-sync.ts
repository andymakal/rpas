/**
 * RESPONSIBILITY -> CAPABILITY sync (server-only) — Right Path.
 *
 * Reconciles the project-scoped work eligibility (producer_work_functions) that
 * a participant's project responsibilities (project_participants.roles[]) imply,
 * so that assigning or changing a responsibility on the Team editor
 * automatically establishes the matching project-scoped capability — no separate
 * database intervention, and no more silently excluding a newly-added operations
 * person from the work their colleagues can do.
 *
 * The mapping (which responsibility implies which activity) lives in the
 * client-safe src/lib/projects/responsibility-capabilities.ts; this module owns
 * the WRITE/reconcile against the live tables.
 *
 * Invariants this sync preserves (all deliberate):
 *
 *   1. PROVENANCE OWNERSHIP. The sync creates and manages ONLY rows stamped
 *      source = 'role_sync'. It never inserts, updates, or deletes a 'manual'
 *      row (a human/admin grant or an evidence/migration grant) or a
 *      'migration_seed' row. So a responsibility change can never disturb an
 *      explicitly-granted capability.
 *
 *   2. AGENCY-WIDE UNTOUCHED. The sync only ever reads and writes PROJECT-SCOPED
 *      rows (project_id = this project). An agency-wide assignment (project_id
 *      null), such as Dulce's agency-wide outreach, is never created, never
 *      removed, and never duplicated by a project-scoped grant.
 *
 *   3. NO OVERWRITE OF EXPLICIT INTENT. When a role would establish an activity
 *      for which a row ALREADY exists for this (producer, activity, project) —
 *      in ANY source, including a deliberate 'overqualified' (capable-but-not-
 *      routinely-routed) marker — the sync leaves that row exactly as is. It only
 *      inserts a row when none exists, so it never upgrades or downgrades an
 *      existing assignment.
 *
 *   4. QUALIFICATION PRESERVED. A license-gated activity (e.g. determination,
 *      which requires life_licensed) is attempted only when the producer
 *      affirmatively holds the license. The DB trigger
 *      enforce_work_function_qualification remains the ultimate gate; this
 *      pre-check simply avoids a hard error and means an unlicensed producer
 *      quietly does not receive the gated capability instead of the whole
 *      responsibility edit failing.
 *
 *   5. SAFE REMOVAL. Removing a responsibility (or a participant) revokes ONLY
 *      the 'role_sync' project-scoped rows on THIS project whose activity is no
 *      longer justified by the participant's remaining responsibilities. It never
 *      revokes an activity another remaining responsibility still justifies, and
 *      never revokes agency-wide or manual access.
 *
 * It takes a SupabaseClient (the admin client at the call sites) and performs no
 * auth of its own — the Team API route gates with requireInternalAdmin. Failures
 * are returned, not thrown, so the caller can surface them without aborting the
 * already-committed responsibility write.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkFunctionKey, QualificationKey } from '@/lib/capabilities/work-functions'
import {
  capabilitiesForRoles,
  CAPABILITY_REQUIRED_QUALIFICATION,
} from './responsibility-capabilities'

/** Provenance marker for every capability row this sync owns. */
export const ROLE_SYNC_SOURCE = 'role_sync'

export type SyncResult = { ok: true } | { ok: false; error: string }

type WorkFunctionRow = {
  id: string
  canonical_key: string
  required_qualification: string | null
}

/**
 * Reconcile the role-derived project-scoped capability for ONE participant on
 * ONE project to match `roles`. Pass the participant's FULL current
 * responsibility set (an empty array when they were just removed or hold no
 * responsibilities); the sync computes the desired activity set from it and makes
 * the participant's 'role_sync' rows on this project match — adding the missing
 * justified ones and removing the now-unjustified ones. Idempotent.
 */
export async function syncParticipantCapabilities(
  supabase: SupabaseClient,
  projectId: string,
  producerId: string,
  roles: readonly string[],
): Promise<SyncResult> {
  if (!projectId || !producerId) {
    return { ok: false, error: 'projectId and producerId are required.' }
  }

  // The activities the current responsibilities justify (empty when none).
  const desired = new Set<WorkFunctionKey>(capabilitiesForRoles(roles))

  // Resolve the capability catalog once: canonical_key -> { id, requiredQual }.
  const { data: wfData, error: wfErr } = await supabase
    .from('work_functions')
    .select('id, canonical_key, required_qualification')
    .eq('is_active', true)
  if (wfErr) return { ok: false, error: wfErr.message }
  const byKey = new Map<string, WorkFunctionRow>(
    ((wfData ?? []) as WorkFunctionRow[]).map((w) => [w.canonical_key, w]),
  )

  // The producer's qualification facts, to pre-screen license-gated activities
  // (preserve the gate; never force a grant that would hard-fail the trigger).
  const { data: prod, error: prodErr } = await supabase
    .from('producers')
    .select('is_life_licensed, is_securities_licensed, is_registered_support_staff')
    .eq('id', producerId)
    .maybeSingle()
  if (prodErr) return { ok: false, error: prodErr.message }
  const quals: Partial<Record<QualificationKey, boolean | null>> = {
    life_licensed: (prod as { is_life_licensed: boolean | null } | null)?.is_life_licensed ?? null,
    securities_licensed: (prod as { is_securities_licensed: boolean | null } | null)?.is_securities_licensed ?? null,
    registered_support_staff:
      (prod as { is_registered_support_staff: boolean | null } | null)?.is_registered_support_staff ?? null,
  }
  const holdsRequiredLicense = (wf: WorkFunctionKey): boolean => {
    const required = CAPABILITY_REQUIRED_QUALIFICATION[wf]
    if (!required) return true // no gate
    return quals[required] === true // affirmatively held only (NULL/false fail)
  }

  // Every existing capability row for this producer on THIS project (all
  // sources), so we can tell what role_sync already owns, and what exists under
  // another source that we must NOT touch or duplicate.
  const { data: existingRows, error: exErr } = await supabase
    .from('producer_work_functions')
    .select('id, work_function_id, source')
    .eq('producer_id', producerId)
    .eq('project_id', projectId)
  if (exErr) return { ok: false, error: exErr.message }

  // A routable AGENCY-WIDE assignment already lets the producer work this
  // activity on every project, so establishing a project-scoped row for the same
  // activity would be a redundant grant. Collect those agency-wide activities so
  // the insert step can skip them (and so a stale role_sync project row can be
  // cleaned up below). Agency-wide rows themselves are read-only here — never
  // created, removed, or modified by the sync.
  const { data: agencyRows, error: awErr } = await supabase
    .from('producer_work_functions')
    .select('work_function_id, assignment_type')
    .eq('producer_id', producerId)
    .is('project_id', null)
    .in('assignment_type', ['primary', 'support'])
  if (awErr) return { ok: false, error: awErr.message }

  const wfKeyById = new Map<string, string>(
    ((wfData ?? []) as WorkFunctionRow[]).map((w) => [w.id, w.canonical_key]),
  )
  type ExistingRow = { id: string; work_function_id: string; source: string }
  const existing = (existingRows ?? []) as ExistingRow[]

  // Activities already covered agency-wide by a routable row (keyed by canonical
  // key). A project-scoped grant for any of these is redundant.
  const agencyWideKeys = new Set<string>(
    ((agencyRows ?? []) as { work_function_id: string }[])
      .map((r) => wfKeyById.get(r.work_function_id))
      .filter((k): k is string => !!k),
  )

  // Activities that already have ANY project-scoped row (any source), keyed by
  // canonical key — used to avoid overwriting explicit intent or duplicating.
  const existingKeys = new Set<string>(
    existing.map((r) => wfKeyById.get(r.work_function_id)).filter((k): k is string => !!k),
  )
  // The role_sync rows specifically, keyed by canonical key — the only rows the
  // sync may remove.
  const roleSyncByKey = new Map<string, ExistingRow>()
  for (const r of existing) {
    if (r.source !== ROLE_SYNC_SOURCE) continue
    const key = wfKeyById.get(r.work_function_id)
    if (key) roleSyncByKey.set(key, r)
  }

  // ── INSERT the justified activities that have no row yet ───────────────────
  // Only when no row exists in ANY source (never overwrite manual/overqualified)
  // and, for a license-gated activity, only when the license is affirmatively
  // held (preserve the qualification gate).
  const toInsert: { producer_id: string; work_function_id: string; assignment_type: string; project_id: string; source: string }[] = []
  for (const wf of desired) {
    if (existingKeys.has(wf)) continue // already granted by some source; leave it
    if (agencyWideKeys.has(wf)) continue // already covered agency-wide; redundant
    if (!holdsRequiredLicense(wf)) continue // gated and not licensed; skip quietly
    const cat = byKey.get(wf)
    if (!cat) continue // activity not in this environment's catalog
    toInsert.push({
      producer_id: producerId,
      work_function_id: cat.id,
      assignment_type: 'primary',
      project_id: projectId,
      source: ROLE_SYNC_SOURCE,
    })
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from('producer_work_functions').insert(toInsert)
    if (error) return { ok: false, error: error.message }
  }

  // ── REMOVE the role_sync rows no longer justified ──────────────────────────
  // Only rows this sync owns (source = role_sync) that it would no longer
  // create: either the current responsibilities no longer imply the activity, OR
  // the activity is now covered by a routable agency-wide grant (so the project
  // row is redundant). Never touches manual/migration_seed rows, never touches
  // agency-wide rows, and never removes an activity another held responsibility
  // still justifies (desired is the union over all roles). Removing a redundant
  // role_sync row never reduces access, because the agency-wide grant still
  // confers it.
  const idsToRemove = Array.from(roleSyncByKey.entries())
    .filter(([key]) => !desired.has(key as WorkFunctionKey) || agencyWideKeys.has(key))
    .map(([, row]) => row.id)
  if (idsToRemove.length > 0) {
    const { error } = await supabase
      .from('producer_work_functions')
      .delete()
      .in('id', idsToRemove)
    if (error) return { ok: false, error: error.message }
  }

  return { ok: true }
}
