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
 *     permanent policy being evaluated (stored in policy_documents, scoped to
 *     this project + customer + policy). A customer can have several permanent
 *     policies in evaluation, so the documents are policy-specific. Step 3 is
 *     ready for Bob only when every evaluated policy has BOTH documents. When
 *     that holds and operations marks preparation complete, the customer is
 *     surfaced for Bob's single determination (Candidate / Not a Candidate),
 *     stored on project_customer_reviews. The determination stays customer-level
 *     and unchanged.
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
  // Step 3 — documents. The evaluated set is the customer's permanent policies;
  // readiness requires BOTH documents for EVERY evaluated policy. These
  // customer-level flags are the aggregate across all evaluated policies and
  // drive the single customer-level Bob determination (unchanged).
  has_carrier_statement: boolean
  has_reprojection: boolean
  documents_complete: boolean
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
  documentsComplete: boolean
  prepReady: boolean
  determination: Determination | null
}): WorkflowStage {
  if (!args.step2) return 'stewardship'
  // A recorded determination ends Step 3. Candidate hands off to Step 4
  // (Outreach & Scheduling) — Step 3 is complete but the work is not Done.
  // Not a Candidate is terminal: the 1035 review is complete at Step 3.
  if (args.determination === 'candidate') return 'ready_for_outreach'
  if (args.determination === 'not_a_candidate') return 'complete'
  // Step 2 done, not yet determined. Bob's turn only once operations has both
  // documents AND has marked preparation complete. Otherwise it is ops' turn.
  if (args.documentsComplete && args.prepReady) return 'bob_evaluation'
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
        // Filled in during assembly from docsByPolicy.
        has_carrier_statement: false,
        has_reprojection: false,
        documents_complete: false,
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
      p.has_carrier_statement = set.has('carrier_statement')
      p.has_reprojection = set.has('reprojection')
      p.documents_complete = p.has_carrier_statement && p.has_reprojection
    }
    const permanent = allPolicies.filter(p => p.permanent)
    const unconfirmed = permanent.filter(p => p.sa_status !== 'confirmed')
    // Step 2 is satisfied when there is at least one permanent policy and all
    // permanent policies are confirmed. A customer with zero permanent policies
    // has no servicing access to establish for a 1035 (cash-value) review, so
    // they are not blocked by Step 2.
    const step2Satisfied = unconfirmed.length === 0

    // Step 3 documents are evaluated PER permanent policy. The customer-level
    // aggregate flags report whether EVERY evaluated (permanent) policy has each
    // document, and documents_complete requires both documents for every
    // evaluated policy. With zero permanent policies there is nothing to
    // collect, so the customer is not blocked on documents (matches Step 2's
    // treatment of the no-permanent-policy case).
    const hasCarrier = permanent.length > 0 && permanent.every(p => p.has_carrier_statement)
    const hasReproj = permanent.length > 0 && permanent.every(p => p.has_reprojection)
    const documentsComplete = permanent.length === 0
      ? true
      : permanent.every(p => p.documents_complete)

    const review = reviewByCustomer.get(cid)
    const prepStatus: PrepStatus = review?.prep_status ?? 'preparing'
    const determination = review?.determination ?? null

    const stage = deriveStage({
      step2: step2Satisfied,
      documentsComplete,
      prepReady: prepStatus === 'ready_for_evaluation',
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
