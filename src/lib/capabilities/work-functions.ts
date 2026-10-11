/**
 * Employee capabilities — shared TYPES and the capability catalog keys
 * (Right Path).
 *
 * Ported from IPF (bobpfromm/ipf-stewardship) src/lib/team-capabilities.ts, the
 * established eligibility model, and re-homed on Right Path's own `producers`
 * table (single-tenant, no practice_id). This module carries ONLY serializable
 * types and the canonical capability keys, with NO server-only imports, so a
 * 'use client' component (the Team capabilities editor) can import it without
 * pulling the server/Supabase graph into the browser bundle.
 *
 * The capability -> required-qualification requirement is NOT mirrored here as a
 * second source of truth: it lives in exactly one durable place, the declared
 * `work_functions.required_qualification` column (and the DB trigger that reads
 * it). This module only names the keys both the DB and the UI reference.
 */

/**
 * The qualification eligibility facts captured per producer. These are facts,
 * NOT titles and NOT routing assignments: NULL = unknown (not established),
 * true = affirmatively held, false = affirmatively not held. They match the
 * nullable boolean columns on public.producers.
 */
export type QualificationKey =
  | 'life_licensed'
  | 'securities_licensed'
  | 'registered_support_staff'

/**
 * The canonical keys of the first-slice capability catalog (public.work_functions).
 * These are the actual business activities present today — the shared
 * Stewardship board (outreach + the research exception) and the 1035 project's
 * own derived stages (operations preparation, senior-producer determination),
 * plus ordinary office support. No activity is named for work that does not yet
 * exist (no scheduling / appointment capability).
 */
export type WorkFunctionKey =
  | 'outreach'
  | 'research'
  | 'operations_prep'
  | 'determination'
  | 'office_support'

/**
 * How a producer is assigned to a capability. Routable assignments
 * (primary/support) make the producer ELIGIBLE to be routed that work.
 * 'overqualified' means capable but not normally routed. "Not qualified" is
 * never a stored value — it is simply the ABSENCE of an assignment row.
 */
export type AssignmentType = 'primary' | 'support' | 'overqualified'

/** The routable assignment types: these confer eligibility to pick up work. */
export const ROUTABLE_ASSIGNMENTS: readonly AssignmentType[] = ['primary', 'support']

/** True when an assignment type confers eligibility to be routed/claim the work. */
export function isRoutable(assignment: AssignmentType): boolean {
  return ROUTABLE_ASSIGNMENTS.includes(assignment)
}

/** A capability row from the catalog (public.work_functions). */
export interface WorkFunction {
  id: string
  canonicalKey: WorkFunctionKey
  label: string
  description: string | null
  requiredQualification: QualificationKey | null
  sortOrder: number
}

/**
 * One producer's eligibility for a single capability, resolved from
 * producer_work_functions. project_id is null for agency-wide eligibility, or a
 * project id when the eligibility is scoped to that project (participation
 * exception).
 */
export interface CapabilityEligibility {
  workFunction: WorkFunctionKey
  assignment: AssignmentType
  projectId: string | null
}

/**
 * The resolved capability profile for the signed-in producer: who they are and
 * what they are eligible to do. Serializable; assembled server-side.
 */
export interface ProducerCapabilityProfile {
  producerId: string
  firstName: string
  lastName: string
  /** All capability eligibilities (routable and overqualified). */
  eligibilities: CapabilityEligibility[]
}

/**
 * Whether this profile is ROUTABLY eligible for a capability (primary/support),
 * optionally within a project scope. Agency-wide eligibility (projectId null on
 * the eligibility row) always applies; a project-scoped eligibility applies only
 * for that project. Overqualified is deliberately NOT routable here: it means
 * "capable but do not route", so it never confers pick-up eligibility.
 */
export function isEligibleFor(
  profile: ProducerCapabilityProfile,
  workFunction: WorkFunctionKey,
  projectId?: string | null,
): boolean {
  return profile.eligibilities.some(
    (e) =>
      e.workFunction === workFunction &&
      isRoutable(e.assignment) &&
      (e.projectId === null || (projectId != null && e.projectId === projectId)),
  )
}
