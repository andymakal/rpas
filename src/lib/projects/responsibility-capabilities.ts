/**
 * Project RESPONSIBILITY -> work CAPABILITY mapping (client-safe) — Right Path.
 *
 * This is the single, authoritative place that says which work-function
 * activities a project responsibility (project_participants.roles[]) establishes
 * as PROJECT-SCOPED work eligibility (producer_work_functions). It exists to
 * close a real gap: historically a responsibility was deliberately decoupled
 * from capability, which meant adding someone to a project Team with an
 * operations responsibility granted them NO ability to actually perform that
 * work (My Work / the shared queues gate entirely on producer_work_functions).
 * A person assigned the same responsibility as a colleague could therefore be
 * silently excluded from the same work.
 *
 * The mapping is grounded in the one prior hand-written precedent
 * (migration 20261112000001, which granted the operations responsibilities
 * outreach + research + operations_prep) and in the declared activity
 * definitions in the work_functions catalog (migration 20261021000001).
 *
 * Deliberate boundaries, so this bridge stays narrow and safe:
 *   - It establishes ONLY project-scoped eligibility (project_id = the project).
 *     It never creates or implies an agency-wide (project_id null) assignment.
 *   - 'determination' is LICENSE-GATED (requires life_licensed). It is mapped to
 *     the producer responsibilities, but the sync only attempts it when the
 *     producer affirmatively holds the license, so the qualification gate is
 *     preserved, never bypassed and never forced into a hard error.
 *   - 'office_support' is agency-wide office work by definition and is NEVER
 *     established from a project responsibility.
 *   - 'project_owner' is an ownership / accountability responsibility, not a
 *     hands-on activity, so it establishes NO work capability.
 *
 * Client-safe: a dependency-free constant map with no server-only imports, so
 * the Team UI can describe the effect of a responsibility without pulling in the
 * server graph. The actual write/reconcile lives server-side in
 * src/lib/projects/capability-sync.ts.
 */

import type { ProjectRole } from './project-roles'
import type { WorkFunctionKey, QualificationKey } from '@/lib/capabilities/work-functions'

/**
 * The work-function activities each project responsibility establishes as
 * project-scoped routable ('primary') eligibility. A responsibility absent from
 * this map (or mapped to an empty list) establishes no capability.
 *
 *   operations / operations_manager / outreach -> the operational bundle
 *     (outreach + research + operations_prep), per the 20261112000001 precedent.
 *     'outreach' is the activity that surfaces due calls, the exact work a
 *     newly-added operations person was previously excluded from.
 *   underwriting_support -> operations_prep + research (document / contact
 *     preparation work; both are license-ungated).
 *   producer / senior_producer -> determination (the customer-level candidacy
 *     decision; LICENSE-GATED on life_licensed, suppressed when not held).
 *   project_owner -> nothing (ownership, not a performed activity).
 */
export const RESPONSIBILITY_CAPABILITIES: Record<ProjectRole, WorkFunctionKey[]> = {
  operations_manager: ['outreach', 'research', 'operations_prep'],
  operations: ['outreach', 'research', 'operations_prep'],
  outreach: ['outreach', 'research', 'operations_prep'],
  underwriting_support: ['operations_prep', 'research'],
  producer: ['determination'],
  senior_producer: ['determination'],
  project_owner: [],
}

/**
 * The work functions that are LICENSE-GATED, with the qualification each
 * requires. Mirrors work_functions.required_qualification (the DB is the source
 * of truth and its trigger is authoritative); this map lets the sync decide, up
 * front, to skip a gated activity for a producer who does not affirmatively hold
 * the license rather than let the insert hard-fail. It is intentionally tiny and
 * only names the gated activities.
 */
export const CAPABILITY_REQUIRED_QUALIFICATION: Partial<Record<WorkFunctionKey, QualificationKey>> = {
  determination: 'life_licensed',
}

/**
 * The full set of work functions the given responsibility set establishes,
 * de-duplicated. Empty when the set implies no capability. This is the union
 * over every responsibility the participant holds, so dropping ONE responsibility
 * still keeps any activity another held responsibility justifies.
 */
export function capabilitiesForRoles(roles: readonly string[]): WorkFunctionKey[] {
  const out = new Set<WorkFunctionKey>()
  for (const r of roles) {
    const mapped = RESPONSIBILITY_CAPABILITIES[r as ProjectRole]
    if (!mapped) continue
    for (const wf of mapped) out.add(wf)
  }
  return Array.from(out)
}
