/**
 * Capability resolution (server-only) — Right Path.
 *
 * Resolves the signed-in user to their producer record and their capability
 * eligibilities (producer_work_functions). This is the single place that turns
 * "the current session" into "what this employee is eligible to do", so the
 * shared-queue composition and the Team editor read one consistent profile.
 *
 * Right Path auth model: the signed-in user maps to a producers row via
 * producers.auth_user_id = auth.users.id. An internal admin without a producer
 * row (rare) resolves to null, which the callers treat as "no personal work
 * profile" (they still see the shared board, just nothing marked as theirs).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  AssignmentType,
  CapabilityEligibility,
  ProducerCapabilityProfile,
  WorkFunction,
  WorkFunctionKey,
  QualificationKey,
} from './work-functions'

type ProducerRow = { id: string; first_name: string | null; last_name: string | null }
type WorkFunctionRow = {
  id: string
  canonical_key: string
  label: string
  description: string | null
  required_qualification: string | null
  sort_order: number
}
type AssignmentRow = {
  work_function_id: string
  assignment_type: string
  project_id: string | null
}

/** Load the full capability catalog (active work functions), ordered. */
export async function loadWorkFunctions(): Promise<WorkFunction[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('work_functions')
    .select('id, canonical_key, label, description, required_qualification, sort_order')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw new Error(`work_functions read failed: ${error.message}`)
  return ((data ?? []) as WorkFunctionRow[]).map((w) => ({
    id: w.id,
    canonicalKey: w.canonical_key as WorkFunctionKey,
    label: w.label,
    description: w.description,
    requiredQualification: (w.required_qualification as QualificationKey | null) ?? null,
    sortOrder: w.sort_order,
  }))
}

/**
 * Resolve the producer for a signed-in auth user id, or null when the user has
 * no producer record. Uses the service-role client (the caller is already an
 * authorized internal admin at the surface).
 */
export async function resolveProducerForUser(
  authUserId: string,
): Promise<ProducerRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('producers')
    .select('id, first_name, last_name')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return (data as ProducerRow | null) ?? null
}

/**
 * Build the capability profile (identity + eligibilities) for a signed-in user.
 * Returns null when the user has no producer record. Capability keys are mapped
 * through the work_functions catalog so the profile speaks in canonical keys.
 */
export async function resolveCapabilityProfile(
  authUserId: string,
): Promise<ProducerCapabilityProfile | null> {
  const producer = await resolveProducerForUser(authUserId)
  if (!producer) return null

  const supabase = createAdminClient()
  const [{ data: wfData }, { data: asgData }] = await Promise.all([
    supabase.from('work_functions').select('id, canonical_key'),
    supabase
      .from('producer_work_functions')
      .select('work_function_id, assignment_type, project_id')
      .eq('producer_id', producer.id),
  ])

  const keyById = new Map<string, WorkFunctionKey>(
    ((wfData ?? []) as { id: string; canonical_key: string }[]).map((w) => [
      w.id,
      w.canonical_key as WorkFunctionKey,
    ]),
  )

  const eligibilities: CapabilityEligibility[] = ((asgData ?? []) as AssignmentRow[])
    .map((a) => {
      const wf = keyById.get(a.work_function_id)
      if (!wf) return null
      return {
        workFunction: wf,
        assignment: a.assignment_type as AssignmentType,
        projectId: a.project_id,
      } satisfies CapabilityEligibility
    })
    .filter((e): e is CapabilityEligibility => e !== null)

  return {
    producerId: producer.id,
    firstName: producer.first_name ?? '',
    lastName: producer.last_name ?? '',
    eligibilities,
  }
}
