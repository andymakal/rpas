/**
 * Client-safe project RESPONSIBILITY vocabulary and labels.
 *
 * A project responsibility (stored in project_participants.role) describes what
 * a participant is responsible for ON THIS PROJECT. It is deliberately kept
 * DISTINCT from:
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
 */

/** The project responsibilities the interface offers and recognizes. */
export const PROJECT_ROLES = [
  'owner',
  'operations_manager',
  'operations',
  'operations_escalation',
  'producer',
  'senior_producer',
  'underwriting_support',
  'outreach',
] as const

export type ProjectRole = (typeof PROJECT_ROLES)[number]

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Project owner and operations manager',
  operations_manager: 'Operations manager',
  operations: 'Operations',
  operations_escalation: 'Operations escalation',
  producer: 'Producer',
  senior_producer: 'Senior producer',
  underwriting_support: 'Underwriting support',
  outreach: 'Outreach',
}

/**
 * Human label for a stored responsibility value. Unknown/legacy values are
 * de-slugged so nothing ever renders raw snake_case, keeping older data
 * readable without forcing a backfill.
 */
export function roleLabel(role: string): string {
  if (role in ROLE_LABELS) return ROLE_LABELS[role as ProjectRole]
  return role.replace(/_/g, ' ')
}

/** Options for a responsibility <select>, in display order with labels. */
export const ROLE_OPTIONS: { value: ProjectRole; label: string }[] = PROJECT_ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}))
