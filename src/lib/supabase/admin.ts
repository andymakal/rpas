import { createClient } from '@supabase/supabase-js'

/**
 * Production Supabase project ref. The service-role client below bypasses RLS,
 * so this ref must never be reachable from a non-production deployment (local
 * dev, Vercel Preview). Preview deployments are expected to point at the
 * persistent Supabase `development` branch (a data clone), never at this ref.
 */
const PRODUCTION_SUPABASE_REF = 'erbvssfcglhnelfelbfi'

/**
 * Guard: refuse to hand out a production service-role client outside a
 * production deployment. This is defense-in-depth against a Preview/dev
 * environment being misconfigured with production credentials — the exact
 * failure mode that would let a review environment write to the real database.
 *
 * - Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'.
 * - When VERCEL_ENV is unset (local `next dev`/`next build`), we also block the
 *   production ref, since local work targets the development branch.
 */
function assertNotProdOutsideProd(url: string): void {
  const pointsAtProduction = url.includes(PRODUCTION_SUPABASE_REF)
  if (!pointsAtProduction) return

  const vercelEnv = process.env.VERCEL_ENV
  const isProductionDeployment = vercelEnv === 'production'
  if (isProductionDeployment) return

  throw new Error(
    `Refusing to create a service-role Supabase client against the production ` +
      `project (${PRODUCTION_SUPABASE_REF}) in a non-production environment ` +
      `(VERCEL_ENV=${vercelEnv ?? 'unset'}). Preview and local environments ` +
      `must target the Supabase development branch.`,
  )
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  assertNotProdOutsideProd(url)

  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
