import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Authorize an internal (admin / SML team) caller for stewardship routes.
 *
 * The Right Path auth model (see 20260516000003_agency_members.sql): a user is
 * an internal admin when they have NO agency_members row; a user mapped to an
 * agency gets app_role 'agency' and belongs on the /portal surface, not here.
 * The JWT carries app_role, injected by custom_access_token_hook.
 *
 * Stewardship routes read/write internal-only tables via the service-role
 * client (which bypasses RLS), so the route itself must enforce admin — being
 * merely authenticated is not enough. We check the app_role claim first and,
 * because that depends on the JWT hook being enabled, fall back to the
 * authoritative source: the absence of an agency_members row.
 *
 * Returns { ok: true, userId } for an internal admin, or { ok: false, status,
 * error } to return directly from the route.
 */
export async function requireInternalAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }
> {
  const sessionClient = await createClient()
  const { data: { user }, error } = await sessionClient.auth.getUser()
  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  // Primary signal: the app_role claim on the verified session.
  let role: string | null = null
  try {
    const { data: claimsData } = await sessionClient.auth.getClaims()
    const claims = claimsData?.claims as Record<string, unknown> | undefined
    if (claims && typeof claims.app_role === 'string') {
      role = claims.app_role as string
    }
  } catch {
    // getClaims unavailable or token lacks the hook claims — fall through.
  }

  if (role === 'admin') return { ok: true, userId: user.id }
  if (role === 'agency') return { ok: false, status: 403, error: 'Forbidden' }

  // Fallback (claim absent): an internal admin is a user with no agency mapping.
  // Use the service-role client so this lookup is not itself gated by RLS.
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('agency_members')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, userId: user.id }
}
