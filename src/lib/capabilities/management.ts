/**
 * Management authorization (server-only) — Right Path.
 *
 * Today's Focus is management direction, so setting or changing it requires more
 * than being a signed-in internal user: the caller must hold a management
 * responsibility. Right Path models that as the evidenced producers.is_management
 * fact (a settled responsibility, NOT a job title). This is the single gate the
 * Today's Focus API and page use.
 *
 * The internal auth model has one internal role ('admin') shared by every
 * internal user, so admin alone cannot distinguish management from line staff.
 * This helper layers the management responsibility on top of requireInternalAdmin:
 * the caller must be an internal admin AND map to a producer whose is_management
 * is affirmatively true. An internal admin with no producer row, or whose flag is
 * null/false, is not authorized to set focus.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'

export type ManagementCheck =
  | { ok: true; userId: string; producerId: string }
  | { ok: false; status: number; error: string }

/**
 * Authorize a management caller for Today's Focus (and any other management
 * direction). Returns the resolved producer id when authorized.
 */
export async function requireManagement(): Promise<ManagementCheck> {
  // Must first be an authorized internal admin (not an agency/portal user).
  const admin = await requireInternalAdmin()
  if (!admin.ok) return { ok: false, status: admin.status, error: admin.error }

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }

  // Map to a producer and require the evidenced management responsibility.
  const supabase = createAdminClient()
  const { data: producer } = await supabase
    .from('producers')
    .select('id, is_management')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!producer) {
    return {
      ok: false,
      status: 403,
      error: 'Your account has no team member profile, so it cannot set management direction.',
    }
  }
  if (producer.is_management !== true) {
    return {
      ok: false,
      status: 403,
      error: 'Only authorized management may set or change Today\u2019s Focus.',
    }
  }
  return { ok: true, userId: user.id, producerId: producer.id as string }
}

/**
 * Lightweight read for a surface (page) to decide whether to render management
 * controls. Returns true only for an internal management caller. Never throws;
 * returns false on any non-management or error state.
 */
export async function isManagementCaller(): Promise<boolean> {
  const check = await requireManagement()
  return check.ok
}
