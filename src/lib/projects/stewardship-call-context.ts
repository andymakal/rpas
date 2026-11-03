/**
 * Stewardship call-context glue (server-only) — Right Path.
 *
 * Ties the reusable call-context catalog (resolveCallContext) to the stewardship
 * board. The board's outbound call IS the servicing_agent_onboarding phase, so
 * for a given customer this resolves the coordinate the catalog is keyed on —
 * (the customer's project TYPE, the servicing_agent_onboarding workflow) — and
 * returns the filled reason / talk-path / mentoring the OutreachCallPanel feeds
 * to its Legos.
 *
 * It degrades gracefully: when the customer is not in a project, the project has
 * no type, the catalog has no row, or the workflow tables are absent
 * (pre-migration), resolveCallContext returns the built-in default, so the panel
 * always has content and nothing breaks on an unmigrated environment. The only
 * writes anywhere in this path are none — reads only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCallContext, type CallContextContent, type CallContextIdentity } from './call-context'

/** The fixed catalog id of the Servicing Agent Onboarding workflow (seeded with
 * a stable id in 20261102000001_project_workflows.sql). The board's call is
 * always this phase, so the content coordinate uses it directly. */
const SERVICING_AGENT_ONBOARDING_WORKFLOW_ID = 'c0f10000-0000-4000-8000-000000000001'

/**
 * Resolve the call-context content for a stewardship customer's outbound call.
 *
 * `customerId` locates the project membership; the project's type is the first
 * half of the catalog key and the servicing_agent_onboarding workflow is the
 * second. `identity` fills the caller/customer names exactly as the panel does.
 */
export async function resolveStewardshipCallContext(
  supabase: SupabaseClient,
  args: { customerId: string; identity: CallContextIdentity },
): Promise<CallContextContent> {
  const { customerId, identity } = args

  // The customer's project (membership is unique per customer per project; the
  // stewardship board works one active project population). Resolve its TYPE.
  let projectTypeId: string | null = null
  const { data: member } = await supabase
    .from('project_customers')
    .select('project_id, projects!inner ( project_type_id )')
    .eq('customer_id', customerId)
    .limit(1)
    .maybeSingle()
  if (member) {
    type Row = { projects: { project_type_id: string } | { project_type_id: string }[] | null }
    const p = (member as Row).projects
    const proj = Array.isArray(p) ? p[0] : p
    projectTypeId = proj?.project_type_id ?? null
  }

  return resolveCallContext(supabase, {
    projectTypeId,
    workflowId: SERVICING_AGENT_ONBOARDING_WORKFLOW_ID,
    identity,
  })
}
