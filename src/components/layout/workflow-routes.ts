/**
 * The light-theme workflow routes — Bob's operator-facing pages.
 *
 * This is the single source of truth for which internal routes belong to the
 * light workflow layer (the new header, collapsible sidebar, Mentoring control).
 * Everything NOT matched here is one of Andy's existing dark pages and must keep
 * its original layout and behavior untouched.
 *
 * Each route segment also opts in by rendering WorkflowChrome from its own
 * layout.tsx; this predicate lets the shared sidebar know when it is being used
 * under the light workflow chrome so it can offer the collapse affordance there
 * and ONLY there.
 */

const WORKFLOW_ROUTE_PREFIXES = [
  '/my-work',
  '/my-projects',
  '/projects',
  '/stewardship',
  '/admin/todays-focus',
] as const

/** True when a pathname belongs to Bob's light-theme workflow layer. */
export function isWorkflowRoute(pathname: string): boolean {
  return WORKFLOW_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  )
}
