import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Retired. "Call Other Reachable Customers" was merged into the single call list
 * at /stewardship/calls-due (everybody owed a call). This route stays only so a
 * saved link still lands somewhere sensible; project scope is carried through.
 */
export default async function AvailableToCallRedirect({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>
}) {
  const { project_id: projectId } = await searchParams
  redirect(
    projectId
      ? `/stewardship/calls-due?project_id=${encodeURIComponent(projectId)}`
      : '/stewardship/calls-due',
  )
}
