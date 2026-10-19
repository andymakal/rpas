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
 * Legacy TYPE-NAME test for the Permanent Policy Review project (formerly named
 * "1035 Exchange" in the catalog). The authoritative signal for whether a
 * project exposes the review surfaces is the WORKFLOW WIRING (does it contain
 * review_preparation?), resolved via projectHasWorkflow / getProjectWorkflows.
 * This predicate only exists as the pre-migration FALLBACK those callers pass
 * when the workflow tables are absent, and as the hard gate on the standalone
 * review / contact-research surfaces until they too read the wiring.
 *
 * It matches BOTH the current catalog name ("Permanent Policy Review") and the
 * legacy "1035" name, so the gate stays correct across environments regardless
 * of whether the rename migration has landed on that branch. Do not use this to
 * DRIVE behavior from the name — it is a compatibility test, not business logic.
 */
export function isPermanentPolicyReviewTypeName(projectTypeName: string): boolean {
  return /1035|permanent policy review/i.test(projectTypeName)
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
 * Resolve the states of a project's workflows for ONE customer, honoring the
 * gate dependency REGARDLESS of the order the workflows are listed in.
 *
 * This is the pure core of the per-customer evaluation (no DB), extracted so the
 * order-independence guarantee is directly testable. Gates are resolved along
 * the actual dependency edge with memoization + cycle protection, so a
 * prerequisite that appears AFTER its dependent in the list still gates it
 * correctly and a valid dependency never leaves a customer incorrectly blocked.
 *
 * `policies` + `reviewDetermined` are the facts the typed strategies consume
 * (see evaluateWorkflowForCustomer).
 */
export function evaluateWorkflowsForCustomer(args: {
  customerId: string
  workflows: ProjectWorkflow[]
  policies: { product_type: string | null; sa_status: string | null }[]
  reviewDetermined: boolean
}): WorkflowCustomerState[] {
  const { customerId, workflows, policies, reviewDetermined } = args
  const pwById = new Map(workflows.map((w) => [w.id, w]))
  const completeMemo = new Map<string, boolean>()
  const inProgress = new Set<string>()

  const completeOf = (w: ProjectWorkflow): boolean => {
    const memoized = completeMemo.get(w.id)
    if (memoized !== undefined) return memoized
    if (inProgress.has(w.id)) return false // cycle guard
    inProgress.add(w.id)
    const { status } = evaluateWorkflowForCustomer({
      workflowKey: w.key,
      gateComplete: gateCompleteOf(w),
      policies,
      reviewDetermined,
    })
    inProgress.delete(w.id)
    const isComplete = status === 'complete'
    completeMemo.set(w.id, isComplete)
    return isComplete
  }

  const gateCompleteOf = (w: ProjectWorkflow): boolean => {
    if (!w.gatedByProjectWorkflowId) return true
    const gate = pwById.get(w.gatedByProjectWorkflowId)
    if (!gate) return true // dangling reference: no real prerequisite
    return completeOf(gate)
  }

  return workflows.map((w) => {
    const { status, reason } = evaluateWorkflowForCustomer({
      workflowKey: w.key,
      gateComplete: gateCompleteOf(w),
      policies,
      reviewDetermined,
    })
    return { customerId, projectWorkflowId: w.id, workflowKey: w.key, status, reason }
  })
}

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

  // Resolve each member's workflow states via the pure, ORDER-INDEPENDENT
  // resolver (gates followed along the real dependency edge, not by position).
  for (const cid of memberIds) {
    byCustomer.set(
      cid,
      evaluateWorkflowsForCustomer({
        customerId: cid,
        workflows,
        policies: policiesByCustomer.get(cid) ?? [],
        reviewDetermined: determined.has(cid),
      }),
    )
  }

  return { workflows, byCustomer }
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration helpers — the smallest sufficient operations the project
// interface needs to SELECT reusable workflows and wire their dependencies.
// These are the only writers of workflows / project_workflows. All reads of the
// catalog + a project's selection flow through here so the UI and the evaluator
// agree.
// ─────────────────────────────────────────────────────────────────────────────

/** One reusable workflow in the catalog (for the "add workflow" picker). */
export interface CatalogWorkflow {
  id: string
  key: string
  name: string
  description: string | null
  completionMode: 'automatic' | 'manual'
}

/** The reusable workflow catalog (every definition an operator can select). */
export async function getWorkflowCatalog(supabase: SupabaseClient): Promise<CatalogWorkflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, key, name, description, completion_mode')
    .order('key', { ascending: true })
  if (error) return []
  return ((data ?? []) as { id: string; key: string; name: string; description: string | null; completion_mode: 'automatic' | 'manual' }[])
    .map((w) => ({ id: w.id, key: w.key, name: w.name, description: w.description, completionMode: w.completion_mode }))
}

/** Add a workflow to a project (idempotent on the unique project+workflow pair),
 * appended after the current last position. */
export async function addProjectWorkflow(
  supabase: SupabaseClient,
  projectId: string,
  workflowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Next position = after the current max for this project.
  const existing = await getProjectWorkflows(supabase, projectId)
  if (existing.some((w) => w.workflowId === workflowId)) {
    return { ok: true } // already present — idempotent
  }
  const nextPosition = existing.reduce((max, w) => Math.max(max, w.position), -1) + 1
  const { error } = await supabase
    .from('project_workflows')
    .insert({ project_id: projectId, workflow_id: workflowId, position: nextPosition })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Remove a workflow from a project. First clears any gate pointing AT the
 * removed row (so no dangling dependency remains), then deletes the row. */
export async function removeProjectWorkflow(
  supabase: SupabaseClient,
  projectId: string,
  projectWorkflowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Clear any gate that referenced the row being removed.
  const { error: clearErr } = await supabase
    .from('project_workflows')
    .update({ gated_by_workflow_id: null })
    .eq('project_id', projectId)
    .eq('gated_by_workflow_id', projectWorkflowId)
  if (clearErr) return { ok: false, error: clearErr.message }
  const { error } = await supabase
    .from('project_workflows')
    .delete()
    .eq('project_id', projectId)
    .eq('id', projectWorkflowId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Set (or clear) which workflow GATES another, within the same project.
 * `gatedByProjectWorkflowId = null` clears the dependency. Guards against a
 * self-gate and against a direct cycle (A gates B while B gates A), which are
 * the only cycles possible with the single-level gate this release supports.
 */
export async function setProjectWorkflowGate(
  supabase: SupabaseClient,
  projectId: string,
  projectWorkflowId: string,
  gatedByProjectWorkflowId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (gatedByProjectWorkflowId === projectWorkflowId) {
    return { ok: false, error: 'A workflow cannot gate itself.' }
  }
  const existing = await getProjectWorkflows(supabase, projectId)
  const target = existing.find((w) => w.id === projectWorkflowId)
  if (!target) return { ok: false, error: 'Workflow is not part of this project.' }
  if (gatedByProjectWorkflowId) {
    const gate = existing.find((w) => w.id === gatedByProjectWorkflowId)
    if (!gate) return { ok: false, error: 'The gating workflow is not part of this project.' }
    // Direct-cycle guard: the chosen gate must not itself be gated by the
    // target (A gates B and B gates A).
    if (gate.gatedByProjectWorkflowId === projectWorkflowId) {
      return { ok: false, error: 'That would create a circular dependency between the two workflows.' }
    }
  }
  const { error } = await supabase
    .from('project_workflows')
    .update({ gated_by_workflow_id: gatedByProjectWorkflowId })
    .eq('project_id', projectId)
    .eq('id', projectWorkflowId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
