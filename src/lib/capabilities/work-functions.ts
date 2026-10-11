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
 * The producer's held qualification facts, keyed by QualificationKey. Each is a
 * tri-state fact matching the nullable producers columns: true = affirmatively
 * held, false = affirmatively not held, null/absent = unknown (not established).
 * Used to classify a capability's licensing gate: an unknown (null) license is
 * NOT a confirmed gap, so it is treated distinctly from an affirmative "false".
 */
export type QualificationFacts = Partial<Record<QualificationKey, boolean | null>>

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
  /** The producer's held qualification facts (life/securities/support). */
  qualifications: QualificationFacts
}

/**
 * How a producer stands relative to one activity, beyond a single yes/no. These
 * are three genuinely different situations that must produce DIFFERENT routing:
 *
 *   - 'routable'   A routable (primary/support) assignment in scope: this work
 *                  is routinely routed to the producer. Routed + claimable.
 *   - 'assist'     Overqualified: the producer is CAPABLE but is not routinely
 *                  routed this work. Not routed, but may still ASSIST (claim) —
 *                  a qualified hand should never be blocked from helping.
 *   - 'unassigned' Qualified (holds any required license) but has NO assignment
 *                  for this activity. Not routed and not claimable; shown for
 *                  awareness. Management can assign them via the Team editor.
 *   - 'unlicensed' Missing a required qualification/license the activity gates
 *                  on. Not routed and not claimable; the gap is the reason.
 *
 * 'unknown_license' is folded into 'unassigned' deliberately: an unestablished
 * (null) license is NOT a confirmed gap, so it is never reported as unlicensed.
 */
export type CapabilityStatus = 'routable' | 'assist' | 'unassigned' | 'unlicensed'

/** True when a status confers the ability to pick up / claim the work. Routable
 * work is routed and claimable; 'assist' (overqualified) is claimable too, so a
 * qualified employee can help without being routinely assigned. */
export function canActOn(status: CapabilityStatus): boolean {
  return status === 'routable' || status === 'assist'
}

/** Whether the producer affirmatively holds a required qualification. An unknown
 * (null/absent) fact is NOT a confirmed hold, but it is also not a confirmed
 * gap — see classifyCapability for how unknown is handled. */
function holdsQualification(
  quals: QualificationFacts,
  required: QualificationKey | null,
): { held: boolean; known: boolean } {
  if (required == null) return { held: true, known: true } // no gate
  const v = quals[required]
  return { held: v === true, known: v === true || v === false }
}

/**
 * Classify a producer's standing for ONE activity, honoring project scope. This
 * is the single place the three/four distinct capability situations are
 * resolved; everything downstream (routing, claim gate, explanation) reads this
 * status rather than re-deriving a boolean.
 *
 * Order of resolution:
 *   1. A routable (primary/support) assignment in scope  -> 'routable'.
 *   2. An overqualified assignment (any scope match)     -> 'assist'.
 *   3. Otherwise, a CONFIRMED missing required license    -> 'unlicensed'.
 *   4. Otherwise (qualified or license unknown, no row)  -> 'unassigned'.
 *
 * The license gap outranks "unassigned" only when the gap is CONFIRMED
 * (affirmatively false). An unknown license with no assignment reads as
 * 'unassigned' (management simply has not assigned or established licensing),
 * never as a false "unlicensed" claim.
 */
export function classifyCapability(
  profile: ProducerCapabilityProfile,
  workFunction: WorkFunctionKey,
  requiredQualification: QualificationKey | null,
  projectId?: string | null,
): CapabilityStatus {
  const inScope = (e: CapabilityEligibility): boolean =>
    e.projectId === null || (projectId != null && e.projectId === projectId)

  const forActivity = profile.eligibilities.filter(
    (e) => e.workFunction === workFunction && inScope(e),
  )

  if (forActivity.some((e) => isRoutable(e.assignment))) return 'routable'
  if (forActivity.some((e) => e.assignment === 'overqualified')) return 'assist'

  const { held, known } = holdsQualification(profile.qualifications, requiredQualification)
  if (!held && known) return 'unlicensed' // a CONFIRMED license gap
  return 'unassigned' // qualified-or-unknown, but no assignment for this work
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
