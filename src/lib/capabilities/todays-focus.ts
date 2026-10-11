/**
 * Today's Focus — temporary management direction (Right Path).
 *
 * Today's Focus lets appropriate management direction ELEVATE a project or a
 * single activity for a bounded period. It is a priority SIGNAL fed to the
 * GoRules Daily Direction decision; it never disables other work and never
 * overrides a customer commitment or capability eligibility (those constraints
 * stay in the engine/UI).
 *
 * Temporary by construction: todays_focus.expires_at is NOT NULL, and this
 * reader returns ONLY currently-active focus (now < expires_at). An expired
 * focus silently stops influencing anything, so temporary direction can never
 * become a permanent priority.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkFunctionKey } from './work-functions'

/** A currently-active management focus. Serializable. */
export interface ActiveFocus {
  id: string
  scope: 'project' | 'activity'
  /** Set when scope = 'project', or when an activity focus is scoped to one project. */
  projectId: string | null
  /** The elevated activity (scope = 'activity'); null for a project focus. */
  workFunction: WorkFunctionKey | null
  note: string | null
  expiresAt: string
}

type FocusRow = {
  id: string
  scope: string
  project_id: string | null
  work_function_id: string | null
  note: string | null
  expires_at: string
  work_functions: { canonical_key: string } | null
}

/**
 * Read the currently-active Today's Focus entries (not yet expired). Ordered by
 * soonest expiry first. `now` is injected for testability.
 */
export async function getActiveFocus(now: Date = new Date()): Promise<ActiveFocus[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('todays_focus')
    .select('id, scope, project_id, work_function_id, note, expires_at, work_functions ( canonical_key )')
    .gt('expires_at', now.toISOString())
    .order('expires_at', { ascending: true })
  if (error) throw new Error(`todays_focus read failed: ${error.message}`)

  return ((data ?? []) as unknown as FocusRow[]).map((f) => ({
    id: f.id,
    scope: f.scope as 'project' | 'activity',
    projectId: f.project_id,
    workFunction: (f.work_functions?.canonical_key as WorkFunctionKey | undefined) ?? null,
    note: f.note,
    expiresAt: f.expires_at,
  }))
}

/**
 * Whether a given activity is currently elevated by Today's Focus, optionally
 * within a project scope. An activity focus with no project applies agency-wide;
 * one scoped to a project applies only for that project. A project-scope focus
 * elevates every activity within that project.
 */
export function focusElevatesActivity(
  focus: ActiveFocus[],
  workFunction: WorkFunctionKey,
  projectId?: string | null,
): boolean {
  return focus.some((f) => {
    if (f.scope === 'project') {
      return projectId != null && f.projectId === projectId
    }
    // activity focus
    if (f.workFunction !== workFunction) return false
    return f.projectId === null || (projectId != null && f.projectId === projectId)
  })
}

/** Whether a given project is currently elevated by a project-scope focus. */
export function focusElevatesProject(focus: ActiveFocus[], projectId: string): boolean {
  return focus.some((f) => f.scope === 'project' && f.projectId === projectId)
}
