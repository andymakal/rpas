/**
 * Client-safe project stage labels.
 *
 * STAGE_LABEL is a plain constant used by BOTH the server composition
 * (my-work/projects.ts) and the client view (MyProjectsClient.tsx). It lives in
 * its own tiny, dependency-free module so the client can import it WITHOUT
 * pulling in the server-only composition (which transitively depends on the
 * server-only ZEN engine). Keep this file free of any server-only import.
 */

import type { WorkflowStage } from '@/lib/projects/review-1035'

export const STAGE_LABEL: Record<WorkflowStage, string> = {
  stewardship: 'Establishing servicing access',
  operations_prep: 'Operations preparation',
  bob_evaluation: 'Awaiting determination',
  ready_for_outreach: 'Ready for Step 4 outreach',
  complete: 'Complete',
}
