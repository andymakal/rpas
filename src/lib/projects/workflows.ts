/**
 * Reusable project WORKFLOW model (server-only) — Right Path.
 *
 * The business model: a PROJECT defines a customer population and GROUPS
 * selected WORKFLOWS. A project's NAME or TYPE must never determine behavior —
 * the WORKFLOWS it contains do. Each workflow is reusable and defines its
 * objectives, how its completion is determined, and (via the project wiring)
 * whether it gates another workflow. Every project member is evaluated
 * INDEPENDENTLY against each contained workflow; completion is per-customer and
 * derived from authoritative business facts.
 *
 * This module is the single place that:
 *   1. resolves which workflows a project contains + their ordering/dependency
 *      (from the project_workflows wiring, data — never the project type name);
 *   2. evaluates each contained workflow per customer from the live facts;
 *   3. applies the explicit per-customer gate (a gated workflow is only OPEN for
 *      a customer once its gating workflow is COMPLETE for that customer).
 *
 * Completion is DERIVED, never stored as a new truth, so no business fact is
 * duplicated:
 *   - servicing_agent_onboarding: COMPLETE when every applicable permanent
 *     policy has servicing-agent access confirmed (service_policies.sa_status =
 *     'confirmed'). If access already existed, it is already complete with no
 *     onboarding effort. Where access is missing, the customer is OPEN and
 *     ACTIONABLE — derived purely from membership + policy facts, so a member
 *     needing access is actionable WITHOUT anyone manually starting onboarding
 *     and WITHOUT creating any record on read.
 *   - review_preparation: gated by onboarding; its internal readiness/
 *     determination is the existing per-customer prep state (reused from the
 *     1035 review model). It is only OPEN once onboarding is complete.
 *
 * IMPORTANT (no writes): evaluating a project's workflows NEVER creates a
 * record. The actionable onboarding population is derived from facts; a durable
 * stewardship_outreach row is created only when an operator actually acts on a
 * customer (records a touch / claim), not by rendering a page.
 *
 * This module performs READS ONLY and has no engine dependency, so it is safe
 * to import from server routes and compositions without pulling server-only
 * packages into any client bundle.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPermanent } from '@/lib/policies/product-type'

/** Stable workflow keys this release understands. The catalog may hold more;
 * only these have a typed completion strategy here. */
export const WORKFLOW_KEYS = ['servicing_agent_onboarding', 'review_preparation'] as const
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number]

/** A workflow the project contains, resolved from project_workflows + workflows. */
export interface ProjectWorkflow {
  /** project_workflows.id */
  id: string
  workflowId: string
  key: string
  name: string
  completionMode: 'automatic' | 'manual'
  position: number
  /** project_workflows.id of the workflow that gates this one (same project), or null. */
  gatedByProjectWorkflowId: string | null
}

/** The per-customer evaluation of one contained workflow. */
export type WorkflowCustomerStatus =
  // Not yet open: a gating workflow is incomplete for this customer.
  | 'blocked'
  // Open and actionable (work remains for this customer).
  | 'open'
  // Completion conditions satisfied for this customer.
  | 'complete'

export interface WorkflowCustomerState {
  customerId: string
  projectWorkflowId: string
  workflowKey: string
  status: WorkflowCustomerStatus
  /** A short, honest reason for the status (presentation + debugging). */
  reason: string
}

/**
 * Resolve the workflows a project contains, ordered by position, with each
 * one's gating dependency (as a project_workflows id). Returns [] when the
 * project contains no workflows OR when the workflow tables are not present on
 * this environment yet (graceful degradation: callers then fall back to their
 * prior behavior, so an unmigrated environment is never broken).
 */
export async function getProjectWorkflows(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectWorkflow[]> {
  const { data, error } = await supabase
    .from('project_workflows')
    .select('id, workflow_id, position, gated_by_workflow_id, workflows!inner ( key, name, completion_mode )')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
  // Table absent (migration not applied) or any read error: degrade to "no
  // declared workflows" so callers keep working against the prior behavior.
  if (error) return []
  type Row = {
    id: string
    workflow_id: string
    position: number
    gated_by_workflow_id: string | null
    workflows: { key: string; name: string; completion_mode: 'automatic' | 'manual' }
      | { key: string; name: string; completion_mode: 'automatic' | 'manual' }[]
      | null
  }
  const rows = (data ?? []) as unknown as Row[]
  return rows.map((r) => {
    const wf = Array.isArray(r.workflows) ? r.workflows[0] : r.workflows
    return {
      id: r.id,
      workflowId: r.workflow_id,
      key: wf?.key ?? '',
      name: wf?.name ?? '',
      completionMode: wf?.completion_mode ?? 'automatic',
      position: r.position,
      gatedByProjectWorkflowId: r.gated_by_workflow_id,
    }
  })
}

/** Whether a project contains a workflow with the given key. */
export function projectContainsWorkflow(workflows: ProjectWorkflow[], key: WorkflowKey): boolean {
  return workflows.some((w) => w.key === key)
}

/**
 * Whether a project CONTAINS a given workflow, resolved from the project_workflows
 * wiring (data — never the project name/type).
 *
 * `fallback` is returned when the workflow tables are not present on this
 * environment yet (pre-migration), so callers keep their prior behavior instead
 * of breaking. Callers that previously branched on the "1035 Exchange" type name
 * pass fallback = (that same name test) so behavior is identical until the
 * migration lands, then becomes workflow-driven automatically.
 */
export async function projectHasWorkflow(
  supabase: SupabaseClient,
  projectId: string,
  key: WorkflowKey,
  fallback: boolean,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('project_workflows')
    .select('workflows!inner ( key )')
    .eq('project_id', projectId)
    .eq('workflows.key', key)
    .limit(1)
  if (error) return fallback // table absent / unreadable: preserve prior behavior
  return (data ?? []).length > 0
}

/**
 * Every ACTIVE project that CONTAINS the given workflow, resolved from the
 * wiring. Returns null when the workflow tables are absent (pre-migration), so
 * callers fall back to their prior "find the 1035 project by type name" path.
 */
export async function activeProjectsWithWorkflow(
  supabase: SupabaseClient,
  key: WorkflowKey,
): Promise<{ id: string; name: string }[] | null> {
  const { data, error } = await supabase
    .from('project_workflows')
    .select('project_id, projects!inner ( id, name, status ), workflows!inner ( key )')
    .eq('workflows.key', key)
    .eq('projects.status', 'active')
  if (error) return null // table absent: signal caller to use its fallback
  type Row = { projects: { id: string; name: string } | { id: string; name: string }[] | null }
  const out: { id: string; name: string }[] = []
  const seen = new Set<string>()
  for (const r of (data ?? []) as unknown as Row[]) {
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects
    if (p && !seen.has(p.id)) {
      seen.add(p.id)
      out.push({ id: p.id, name: p.name })
    }
  }
  return out
}

/**
 * The onboarding completion FACT for one customer, derived from their policies.
 * COMPLETE when the customer has at least one applicable (permanent) policy and
 * every permanent policy has sa_status = 'confirmed'. A customer with zero
 * permanent policies has no cash-value servicing access to establish, so they
 * are not blocked by onboarding (treated as satisfied). Term policies never
 * block. This is the SAME condition the 1035 review model uses for Step 2, kept
 * here as the single reusable onboarding-completion predicate.
 *
 * Pure and exported so the rule is directly testable without a DB.
 */
export function onboardingCompleteForPolicies(
  policies: { product_type: string | null; sa_status: string | null }[],
): boolean {
  const permanent = policies.filter((p) => isPermanent(p.product_type))
  if (permanent.length === 0) return true // nothing to establish
  return permanent.every((p) => p.sa_status === 'confirmed')
}

/**
 * Evaluate a contained workflow for one customer, given the facts the strategy
 * needs. `gateComplete` is whether this workflow's gating workflow (if any) is
 * COMPLETE for this customer; callers compute it from the dependency wiring.
 *
 * Only the keys this release understands carry a typed strategy. An unknown key
 * is reported 'open' (present but with no completion rule here), never crashing.
 */
export function evaluateWorkflowForCustomer(args: {
  workflowKey: string
  gateComplete: boolean
  /** The customer's non-test policies (product_type + sa_status). */
  policies: { product_type: string | null; sa_status: string | null }[]
  /** For review_preparation: whether a producer determination has been recorded. */
  reviewDetermined?: boolean
}): { status: WorkflowCustomerStatus; reason: string } {
  switch (args.workflowKey) {
    case 'servicing_agent_onboarding': {
      // Onboarding has no upstream gate in the standard wiring; evaluate the
      // fact directly. Complete when applicable permanent access is confirmed.
      if (onboardingCompleteForPolicies(args.policies)) {
        return { status: 'complete', reason: 'Servicing access confirmed for the applicable policies.' }
      }
      return { status: 'open', reason: 'Servicing access is not yet confirmed for all applicable policies.' }
    }
    case 'review_preparation': {
      if (!args.gateComplete) {
        return { status: 'blocked', reason: 'Waiting on Servicing Agent Onboarding to complete.' }
      }
      if (args.reviewDetermined) {
        return { status: 'complete', reason: 'Producer determination recorded.' }
      }
      return { status: 'open', reason: 'Ready for review preparation.' }
    }
    default:
      // Unknown workflow key: it exists in the catalog but has no typed strategy
      // here. Treat as open (present, not auto-completing) so it never blocks.
      return { status: 'open', reason: 'Workflow has no completion strategy in this release.' }
  }
}

type PolicyFact = { customer_id: string; product_type: string | null; sa_status: string | null }

/**
 * Evaluate EVERY contained workflow for EVERY project member, independently per
 * customer, honoring the per-customer gate between workflows. Reads membership
 * and the customers' policy facts; performs no writes.
 *
 * Returns a map keyed by customer id to that customer's workflow states (one
 * per contained workflow this release understands). Callers use it to decide
 * which members are actionable in onboarding, which have advanced to review
 * preparation, and the project-level counts — all without a stored stage and
 * without creating any record.
 */
export async function evaluateProjectWorkflows(
  supabase: SupabaseClient,
  projectId: string,
  options?: {
    /** Customers with a recorded review determination (review_preparation = complete). */
    determinedCustomerIds?: Set<string>
  },
): Promise<{
  workflows: ProjectWorkflow[]
  byCustomer: Map<string, WorkflowCustomerState[]>
}> {
  const workflows = await getProjectWorkflows(supabase, projectId)
  const byCustomer = new Map<string, WorkflowCustomerState[]>()
  if (workflows.length === 0) return { workflows, byCustomer }

  // Membership (the population — never modified here).
  const { data: members } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)
  const memberIds = Array.from(
    new Set(((members ?? []) as { customer_id: string }[]).map((m) => m.customer_id)),
  )
  if (memberIds.length === 0) return { workflows, byCustomer }

  // Each member's non-test policy facts (the only facts the strategies need).
  const policiesByCustomer = new Map<string, PolicyFact[]>()
  await chunked(memberIds, 300, async (chunk) => {
    const { data } = await supabase
      .from('service_policies')
      .select('customer_id, product_type, sa_status, is_test')
      .in('customer_id', chunk)
      .eq('is_test', false)
    for (const p of (data ?? []) as (PolicyFact & { is_test: boolean })[]) {
      if (!p.customer_id) continue
      const list = policiesByCustomer.get(p.customer_id) ?? []
      list.push({ customer_id: p.customer_id, product_type: p.product_type, sa_status: p.sa_status })
      policiesByCustomer.set(p.customer_id, list)
    }
  })

  const determined = options?.determinedCustomerIds ?? new Set<string>()

  // Evaluate workflows in dependency order. Because a gate references another
  // project_workflows row, we resolve each workflow's gating COMPLETE flag per
  // customer from the states already computed in this pass. project_workflows is
  // ordered by position and a gate points "upstream", so a single ordered pass
  // (gates before gated) resolves correctly for the standard wiring.
  const pwById = new Map(workflows.map((w) => [w.id, w]))

  for (const cid of memberIds) {
    const policies = policiesByCustomer.get(cid) ?? []
    const states: WorkflowCustomerState[] = []
    const completeByPwId = new Map<string, boolean>()
    for (const w of workflows) {
      // Resolve the gate's completeness for this customer from states computed
      // earlier in this ordered pass.
      let gateComplete = true
      if (w.gatedByProjectWorkflowId) {
        gateComplete = completeByPwId.get(w.gatedByProjectWorkflowId) ?? false
        // Defensive: if the gate wasn't evaluated yet (unexpected ordering),
        // treat it as incomplete so a gated workflow never opens prematurely.
        if (!pwById.has(w.gatedByProjectWorkflowId)) gateComplete = true
      }
      const { status, reason } = evaluateWorkflowForCustomer({
        workflowKey: w.key,
        gateComplete,
        policies,
        reviewDetermined: determined.has(cid),
      })
      completeByPwId.set(w.id, status === 'complete')
      states.push({
        customerId: cid,
        projectWorkflowId: w.id,
        workflowKey: w.key,
        status,
        reason,
      })
    }
    byCustomer.set(cid, states)
  }

  return { workflows, byCustomer }
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size))
  }
}
