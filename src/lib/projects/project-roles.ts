/**
 * Client-safe project RESPONSIBILITY vocabulary and labels.
 *
 * A project responsibility (stored in project_participants.roles[]) describes
 * what a participant is responsible for ON THIS PROJECT. A person can hold
 * SEVERAL at once (e.g. project owner AND operations manager AND producer).
 * Responsibilities are deliberately kept DISTINCT from:
 *   - the producer's job title            (producers.title)
 *   - their licensing facts               (producers.is_*_licensed)
 *   - their capability / routing eligibility (producer_work_functions / work_functions)
 *
 * Responsibility does not imply performing every activity, and it is never
 * derived from or written back to any of the above. This module is a tiny,
 * dependency-free constant set so BOTH the server reads and the client views
 * (Project Overview Team section, My Projects) render identical labels without
 * duplicating the mapping or pulling in any server-only code. Keep it free of
 * any server-only import.
 *
 * Operations escalation is NOT in this stored vocabulary: who an exception
 * escalates to lives in project_escalation_contacts (tier 1 = first), the single
 * source of truth. It is surfaced as a DERIVED responsibility label
 * (OPERATIONS_ESCALATION_LABEL) from the escalation path, never a checkbox that
 * writes a role.
 */

/**
 * The independent project responsibilities the interface offers and stores.
 * Project owner and operations manager are SEPARATE choices (the legacy single
 * 'owner' token meant both at once; it is expanded on migration).
 */
export const PROJECT_ROLES = [
  'project_owner',
  'operations_manager',
  'operations',
  'producer',
  'senior_producer',
  'underwriting_support',
  'outreach',
] as const

export type ProjectRole = (typeof PROJECT_ROLES)[number]

const ROLE_LABELS: Record<ProjectRole, string> = {
  project_owner: 'Project owner',
  operations_manager: 'Operations manager',
  operations: 'Operations',
  producer: 'Producer',
  senior_producer: 'Senior producer',
  underwriting_support: 'Underwriting support',
  outreach: 'Outreach',
}

/**
 * Labels for LEGACY single-value tokens that may still appear in unmigrated
 * `role` data, so they render readably without a forced backfill. 'owner' was
 * the combined project-owner + operations-manager responsibility.
 */
const LEGACY_ROLE_LABELS: Record<string, string> = {
  owner: 'Project owner and operations manager',
  operations_escalation: 'Operations escalation',
}

/** The display label for the escalation-derived responsibility (NOT a stored role). */
export const OPERATIONS_ESCALATION_LABEL = 'Operations escalation'

/**
 * Human label for a stored responsibility value. Known current roles, then
 * legacy tokens, then a de-slugged fallback so nothing ever renders raw
 * snake_case.
 */
export function roleLabel(role: string): string {
  if (role in ROLE_LABELS) return ROLE_LABELS[role as ProjectRole]
  if (role in LEGACY_ROLE_LABELS) return LEGACY_ROLE_LABELS[role]
  return role.replace(/_/g, ' ')
}

/** Whether a value is one of the current, storable responsibilities. */
export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value)
}

/** Options for a responsibility checklist, in display order with labels. */
export const ROLE_OPTIONS: { value: ProjectRole; label: string }[] = PROJECT_ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}))
