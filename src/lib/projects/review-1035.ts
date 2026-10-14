/**
 * 1035 Exchange Review — Step 2 / Step 3 read model.
 *
 * This is the project-type-specific workflow logic for the 1035 Exchange Review
 * project (NOT a general rules engine). It derives, per project customer:
 *
 *   Step 2 — Establish Servicing Access
 *     Evaluated over ALL known PERMANENT policies the customer holds (not just
 *     the policies that triggered project membership). Satisfied only when every
 *     known permanent policy has sa_status = 'confirmed'. Term policies never
 *     block advancement. If a new unconfirmed permanent policy appears later,
 *     Step 2 becomes unsatisfied again automatically — because this is derived
 *     live from service_policies, nothing needs to be reset by hand.
 *
 *   Step 3 — Prepare & Evaluate
 *     Operations collects the carrier statement and the reprojection for EACH
 *     known permanent policy (stored in policy_documents, scoped to this
 *     project + customer + policy). A customer can have several permanent
 *     policies, and policies not originally flagged may still become part of a
 *     1035 exchange, so all known permanent policies are shown and each can
 *     receive its own documents. Document completeness is INFORMATIONAL: it is
 *     shown per policy but does NOT gate advancement. Operations marks
 *     preparation complete to hand the customer to Bob even when supplemental
 *     policies are still missing documents. Bob then makes the single
 *     customer-level determination (Candidate / Not a Candidate), decides which
 *     policies are exchange candidates, and whether to combine them. Stored on
 *     project_customer_reviews; the determination stays customer-level.
 *
 * The "whose turn is it" stage is DERIVED here from those facts; it is not a
 * stored column, so it can never drift from the underlying data.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPermanent } from '@/lib/policies/product-type'

/** The two Step-3 documents operations must collect. */
export const REQUIRED_DOCUMENT_TYPES = ['carrier_statement', 'reprojection'] as const
export type RequiredDocumentType = (typeof REQUIRED_DOCUMENT_TYPES)[number]

/**
 * The single private Right Path document bucket (see migration
 * 20261018000001_rightpath_documents_storage). Actual file bytes live here;
 * policy_documents.storage_location holds the object PATH within it.
 */
export const DOCUMENTS_BUCKET = 'rightpath-documents'

/**
 * Deterministic object path for a Step-3 document. Stable per
 * (project, customer, policy, document_type) so re-uploading supersedes the
 * prior object for THAT policy (same key, overwrite) instead of leaving
 * duplicates — and so a document for one policy can never overwrite another
 * policy's document. A project customer can have multiple policies being
 * evaluated, so the statement and reprojection are policy-specific. The original
 * file extension is preserved for correct content handling on download.
 */
export function documentObjectPath(
  projectId: string,
  customerId: string,
  policyId: string,
  documentType: RequiredDocumentType,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9.]/gi, '').replace(/^\.?/, '.')
  return `1035/${projectId}/${customerId}/${policyId}/${documentType}${safeExt}`
}

export type Determination = 'candidate' | 'not_a_candidate'
export type PrepStatus = 'preparing' | 'ready_for_evaluation'

/**
 * The derived workflow stage for a customer. This is what the "whose work is
 * next" indicator renders.
 *   - stewardship:        Step 2 not satisfied — the existing Stewardship flow
 *                         owns the next action (establish servicing access).
 *   - operations_prep:    Step 2 satisfied, Step 3 preparation incomplete —
 *                         operations must collect/finish the documents.
 *   - bob_evaluation:     preparation complete, no determination yet — Bob's turn.
 *   - ready_for_outreach: Bob determined CANDIDATE. Step 3 is complete, but the
 *                         1035 work is NOT done — the customer must proceed to
 *                         Step 4 (Outreach & Scheduling), which is not built yet.
 *                         Represented as "awaiting Step 4", not Done.
 *   - complete:           Bob determined NOT A CANDIDATE — the 1035 review is
 *                         genuinely done at the end of Step 3 (no Step 4).
 *
 * Only 'not_a_candidate' is terminal. 'candidate' is terminal FOR STEP 3 but
 * hands off to Step 4, so it is deliberately a distinct, non-Done stage.
 */
export type WorkflowStage =
  | 'stewardship'
  | 'operations_prep'
  | 'bob_evaluation'
  | 'ready_for_outreach'
  | 'complete'

export type PolicyAccess = {
  id: string
  policy_number: string
  product_type: string | null
  coverage_status: string | null
  sa_status: string | null
  permanent: boolean
  // Step 3 — documents are collected per policy (a customer can have several
  // permanent policies being evaluated at once). These two flags report, for
  // THIS policy, whether each required Step-3 document is on file.
  has_carrier_statement: boolean
  has_reprojection: boolean
  documents_complete: boolean
  // Step 3 — explicit SKIPS: operations marked a required document unavailable
  // for THIS policy (durable, reversible; NOT a received document). From
  // project_customer_document_skips.
  carrier_statement_skipped: boolean
  reprojection_skipped: boolean
  // A required document is ADDRESSED when it is uploaded OR explicitly skipped.
  // Both must be addressed for the policy to be ready for the handoff gate.
  carrier_statement_addressed: boolean
  reprojection_addressed: boolean
  documents_addressed: boolean
}

export type CustomerWorkflow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  // Step 2
  permanent_policies: PolicyAccess[]
  permanent_count: number
  unconfirmed_permanent_count: number
  step2_satisfied: boolean
  // Step 3 — documents (INFORMATIONAL aggregate across the customer's permanent
  // policies). has_* is true only when every permanent policy has that
  // document; documents_complete is true only when every permanent policy has
  // both. These report progress to operations and Bob — they are NOT a gate on
  // advancement. Operations may hand the customer to Bob with supplemental
  // policies still missing documents.
  has_carrier_statement: boolean
  has_reprojection: boolean
  documents_complete: boolean
  // Step 3 — HANDOFF GATE: every permanent policy's carrier statement AND
  // reprojection must each be ADDRESSED (uploaded OR explicitly skipped) before
  // operations can mark the customer ready for producer evaluation. Unlike
  // documents_complete (informational: uploaded-only), this counts skips too and
  // is the hard gate the server enforces. Zero permanent policies reads as
  // satisfied (nothing to prepare).
  prep_gate_satisfied: boolean
  // Step 3 — determination/prep state (from project_customer_reviews)
  prep_status: PrepStatus
  determination: Determination | null
  determined_at: string | null
  // derived
  stage: WorkflowStage
  whose_turn: 'Stewardship' | 'Operations' | 'Bob' | 'Outreach' | 'Done'
}

function deriveStage(args: {
  step2: boolean
  prepReady: boolean
  /** Live document-readiness: every permanent policy's two required documents
   * are addressed (uploaded or explicitly skipped) RIGHT NOW. */
  prepGateSatisfied: boolean
  determination: Determination | null
}): WorkflowStage {
  if (!args.step2) return 'stewardship'
  // A recorded determination ENDS Step 3 and is preserved regardless of the
  // current document state: once the producer has decided, later removing a
  // document or reversing a skip must never retroactively undo that decision.
  // Candidate hands off to Step 4 (not Done); Not a Candidate is terminal.
  if (args.determination === 'candidate') return 'ready_for_outreach'
  if (args.determination === 'not_a_candidate') return 'complete'
  // Not yet determined. The customer is ready for the producer's evaluation
  // only when operations marked preparation complete AND every required
  // document is CURRENTLY addressed. This is deliberately re-derived from live
  // document state, so if an employee reverses a skip or removes a document
  // after handoff, readiness falls back to operations_prep and no NEW
  // determination can be made until the gap is addressed again. (The stored
  // prep_status flag alone is not sufficient — it can go stale.)
  if (args.prepReady && args.prepGateSatisfied) return 'bob_evaluation'
  return 'operations_prep'
}

function whoseTurn(stage: WorkflowStage): CustomerWorkflow['whose_turn'] {
  switch (stage) {
    case 'stewardship':        return 'Stewardship'
    case 'operations_prep':    return 'Operations'
    case 'bob_evaluation':     return 'Bob'
    // Candidate: Step 4 Outreach & Scheduling is next (not built yet).
    case 'ready_for_outreach': return 'Outreach'
    case 'complete':           return 'Done'
  }
}

type ProjectCustomerRow = { customer_id: string }
type CustomerRow = { id: string; first_name: string | null; last_name: string | null; is_test: boolean }
type PolicyRow = {
  id: string
  customer_id: string | null
  policy_number: string
  product_type: string | null
  coverage_status: string | null
  sa_status: string | null
  is_test: boolean
}
type DocRow = { customer_id: string | null; policy_id: string | null; document_type: string }
type ReviewRow = {
  customer_id: string
  prep_status: PrepStatus
  determination: Determination | null
  determined_at: string | null
}

/**
 * Build the per-customer 1035 workflow read model for an entire project.
 * One batched pass: project members -> customers -> all their policies ->
 * project-scoped documents -> project_customer_reviews. No per-customer queries.
 */
// NOTE on Servicing Agent Onboarding membership: this read model is a PURE read
// (no writes). Every project member is EVALUATED against the onboarding workflow
// from facts (membership + policy servicing-access) — see
// src/lib/projects/workflows.ts — so a member who already has confirmed access
// reads as past the 'stewardship' stage automatically, and a member who needs
// access is actionable WITHOUT any pre-created record. Opening this view never
// creates a record; a durable stewardship_outreach row is created only when an
// operator actually acts on a customer.
export async function buildProjectWorkflow(
  supabase: SupabaseClient,
  projectId: string,
): Promise<CustomerWorkflow[]> {
  // 1. Project membership (the Step 1 population — never modified here).
  const { data: members } = await supabase
    .from('project_customers')
    .select('customer_id')
    .eq('project_id', projectId)
  const customerIds = Array.from(
    new Set(((members ?? []) as ProjectCustomerRow[]).map(m => m.customer_id)),
  )
  if (customerIds.length === 0) return []

  // 2. Customers (exclude test rows).
  const customerById = new Map<string, CustomerRow>()
  await chunked(customerIds, 300, async chunk => {
    const { data } = await supabase
      .from('customers')
      .select('id, first_name, last_name, is_test')
      .in('id', chunk)
    for (const c of (data ?? []) as CustomerRow[]) {
      if (!c.is_test) customerById.set(c.id, c)
    }
  })

  // 3. ALL known policies for these customers (not just the matched ones).
  const policiesByCustomer = new Map<string, PolicyAccess[]>()
  await chunked(customerIds, 300, async chunk => {
    const { data } = await supabase
      .from('service_policies')
      .select('id, customer_id, policy_number, product_type, coverage_status, sa_status, is_test')
      .in('customer_id', chunk)
      .eq('is_test', false)
    for (const p of (data ?? []) as PolicyRow[]) {
      if (!p.customer_id) continue
      const list = policiesByCustomer.get(p.customer_id) ?? []
      list.push({
        id: p.id,
        policy_number: p.policy_number,
        product_type: p.product_type,
        coverage_status: p.coverage_status,
        sa_status: p.sa_status,
        permanent: isPermanent(p.product_type),
        // Filled in during assembly from docsByPolicy / skipsByPolicy.
        has_carrier_statement: false,
        has_reprojection: false,
        documents_complete: false,
        carrier_statement_skipped: false,
        reprojection_skipped: false,
        carrier_statement_addressed: false,
        reprojection_addressed: false,
        documents_addressed: false,
      })
      policiesByCustomer.set(p.customer_id, list)
    }
  })

  // 4. Step-3 documents for THIS project, grouped by POLICY + type. Documents
  // are policy-specific: a customer can have multiple policies being evaluated,
  // and each needs its own carrier statement + reprojection. Keyed by policy_id
  // so one policy's documents are never conflated with another's.
  const docsByPolicy = new Map<string, Set<string>>()
  {
    const { data } = await supabase
      .from('policy_documents')
      .select('customer_id, policy_id, document_type')
      .eq('project_id', projectId)
    for (const d of (data ?? []) as DocRow[]) {
      if (!d.policy_id) continue
      const set = docsByPolicy.get(d.policy_id) ?? new Set<string>()
      set.add(d.document_type)
      docsByPolicy.set(d.policy_id, set)
    }
  }

  // 4b. Explicit document SKIPS for THIS project, grouped by POLICY + type. A
  // skip is a durable "unavailable" marker (project_customer_document_skips),
  // the same grain as a real document. A (policy, type) is ADDRESSED when a
  // document exists OR a skip exists.
  const skipsByPolicy = new Map<string, Set<string>>()
  {
    const { data, error } = await supabase
      .from('project_customer_document_skips')
      .select('policy_id, document_type')
      .eq('project_id', projectId)
    // Tolerate the table not yet existing (migration not applied on a given
    // environment): no skips simply means nothing is marked unavailable, so the
    // read model and the gate degrade to "documents must be uploaded". Any other
    // error is non-fatal here for the same reason.
    if (!error) {
      for (const s of (data ?? []) as { policy_id: string | null; document_type: string }[]) {
        if (!s.policy_id) continue
        const set = skipsByPolicy.get(s.policy_id) ?? new Set<string>()
        set.add(s.document_type)
        skipsByPolicy.set(s.policy_id, set)
      }
    }
  }

  // 5. project_customer_reviews (prep + determination) for this project.
  const reviewByCustomer = new Map<string, ReviewRow>()
  {
    const { data } = await supabase
      .from('project_customer_reviews')
      .select('customer_id, prep_status, determination, determined_at')
      .eq('project_id', projectId)
    for (const r of (data ?? []) as ReviewRow[]) reviewByCustomer.set(r.customer_id, r)
  }

  // 6. Assemble.
  const out: CustomerWorkflow[] = []
  for (const cid of customerIds) {
    const cust = customerById.get(cid)
    if (!cust) continue // test customer or missing — not surfaced

    const allPolicies = policiesByCustomer.get(cid) ?? []
    // Attach each policy's own Step-3 document presence (documents are
    // policy-specific). Done for every policy; only permanent ones are the
    // evaluated set that gates readiness.
    for (const p of allPolicies) {
      const set = docsByPolicy.get(p.id) ?? new Set<string>()
      const skips = skipsByPolicy.get(p.id) ?? new Set<string>()
      p.has_carrier_statement = set.has('carrier_statement')
      p.has_reprojection = set.has('reprojection')
      p.documents_complete = p.has_carrier_statement && p.has_reprojection
      // A skip only counts as "skipped" when there is no real document for that
      // type (an upload supersedes a skip for gating/display).
      p.carrier_statement_skipped = !p.has_carrier_statement && skips.has('carrier_statement')
      p.reprojection_skipped = !p.has_reprojection && skips.has('reprojection')
      p.carrier_statement_addressed = p.has_carrier_statement || p.carrier_statement_skipped
      p.reprojection_addressed = p.has_reprojection || p.reprojection_skipped
      p.documents_addressed = p.carrier_statement_addressed && p.reprojection_addressed
    }
    const permanent = allPolicies.filter(p => p.permanent)
    const unconfirmed = permanent.filter(p => p.sa_status !== 'confirmed')
    // Step 2 is satisfied when there is at least one permanent policy and all
    // permanent policies are confirmed. A customer with zero permanent policies
    // has no servicing access to establish for a 1035 (cash-value) review, so
    // they are not blocked by Step 2.
    const step2Satisfied = unconfirmed.length === 0

    // Step 3 documents are tracked PER permanent policy and reported as an
    // informational customer-level aggregate: has* is true only when every
    // permanent policy has that document; documentsComplete only when every
    // permanent policy has both. These describe collection progress and do NOT
    // gate advancement — operations can hand the customer to Bob with
    // supplemental policies still missing documents. (Zero permanent policies
    // reads as complete, matching Step 2's no-permanent-policy case.)
    const hasCarrier = permanent.length > 0 && permanent.every(p => p.has_carrier_statement)
    const hasReproj = permanent.length > 0 && permanent.every(p => p.has_reprojection)
    const documentsComplete = permanent.length === 0
      ? true
      : permanent.every(p => p.documents_complete)

    // Handoff gate: every permanent policy's two required documents must each be
    // ADDRESSED (uploaded OR explicitly skipped). This is the hard requirement
    // for marking the customer ready for producer evaluation. Zero permanent
    // policies reads as satisfied (nothing to prepare), matching Step 2.
    const prepGateSatisfied = permanent.length === 0
      ? true
      : permanent.every(p => p.documents_addressed)

    const review = reviewByCustomer.get(cid)
    const prepStatus: PrepStatus = review?.prep_status ?? 'preparing'
    const determination = review?.determination ?? null

    const stage = deriveStage({
      step2: step2Satisfied,
      prepReady: prepStatus === 'ready_for_evaluation',
      prepGateSatisfied,
      determination,
    })

    out.push({
      customer_id: cid,
      first_name: cust.first_name,
      last_name: cust.last_name,
      permanent_policies: permanent,
      permanent_count: permanent.length,
      unconfirmed_permanent_count: unconfirmed.length,
      step2_satisfied: step2Satisfied,
      has_carrier_statement: hasCarrier,
      has_reprojection: hasReproj,
      documents_complete: documentsComplete,
      prep_gate_satisfied: prepGateSatisfied,
      prep_status: prepStatus,
      determination,
      determined_at: review?.determined_at ?? null,
      stage,
      whose_turn: whoseTurn(stage),
    })
  }

  // Sort: active work first (stewardship, operations, bob), then the Step-4
  // handoff (ready_for_outreach), then the terminal complete; then by name.
  const order: Record<WorkflowStage, number> = {
    stewardship: 0, operations_prep: 1, bob_evaluation: 2, ready_for_outreach: 3, complete: 4,
  }
  out.sort((a, b) => {
    if (order[a.stage] !== order[b.stage]) return order[a.stage] - order[b.stage]
    const an = `${a.last_name ?? ''} ${a.first_name ?? ''}`.trim().toLowerCase()
    const bn = `${b.last_name ?? ''} ${b.first_name ?? ''}`.trim().toLowerCase()
    return an.localeCompare(bn)
  })
  return out
}

/** Summary counts for the project header. */
export function summarizeWorkflow(rows: CustomerWorkflow[]) {
  const by: Record<WorkflowStage, number> = {
    stewardship: 0, operations_prep: 0, bob_evaluation: 0, ready_for_outreach: 0, complete: 0,
  }
  let candidates = 0
  let notCandidates = 0
  for (const r of rows) {
    by[r.stage] += 1
    if (r.determination === 'candidate') candidates += 1
    if (r.determination === 'not_a_candidate') notCandidates += 1
  }
  return { total: rows.length, by, candidates, notCandidates }
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size))
  }
}
