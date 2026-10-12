'use client'

/**
 * 1035 Exchange Review — Step 2 / Step 3 operations surface for a project.
 *
 * Shows every project customer with their derived workflow stage and makes the
 * next owner of the work obvious: Stewardship (establish servicing access),
 * Operations (collect the carrier statement + reprojection, mark preparation
 * complete), or Bob (record Candidate / Not a Candidate). Light-theme workflow
 * tokens + shared OperationalTag.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ShieldCheck, ShieldAlert, FileText, FileCheck2, Play, Check, X,
  CircleUser, ClipboardCheck, Loader2, ShieldQuestion, Wrench, UserCheck,
  Send, CheckCircle2, ChevronLeft, Upload, ArrowLeft,
} from 'lucide-react'
import {
  OperationalTag, type OperationalTone, NextNote,
  QueueSection, QueueRow, QueueListHeader, CustomerQueueCard, QueueEmptyState,
} from '@/components/workflow'

type DocType = 'carrier_statement' | 'reprojection'
type Determination = 'candidate' | 'not_a_candidate'
type Stage = 'stewardship' | 'operations_prep' | 'bob_evaluation' | 'ready_for_outreach' | 'complete'

type PolicyAccess = {
  id: string
  policy_number: string
  product_type: string | null
  coverage_status: string | null
  sa_status: string | null
  permanent: boolean
  has_carrier_statement: boolean
  has_reprojection: boolean
  documents_complete: boolean
  carrier_statement_skipped: boolean
  reprojection_skipped: boolean
  carrier_statement_addressed: boolean
  reprojection_addressed: boolean
  documents_addressed: boolean
}

type CustomerWorkflow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  permanent_policies: PolicyAccess[]
  permanent_count: number
  unconfirmed_permanent_count: number
  step2_satisfied: boolean
  has_carrier_statement: boolean
  has_reprojection: boolean
  documents_complete: boolean
  prep_gate_satisfied: boolean
  prep_status: 'preparing' | 'ready_for_evaluation'
  determination: Determination | null
  determined_at: string | null
  stage: Stage
  whose_turn: 'Stewardship' | 'Operations' | 'Bob' | 'Outreach' | 'Done'
}

type Summary = {
  total: number
  by: Record<Stage, number>
  candidates: number
  notCandidates: number
}

const STAGE_LABEL: Record<Stage, string> = {
  stewardship: 'Needs servicing access',
  operations_prep: 'Operations preparation',
  bob_evaluation: 'Ready for producer evaluation',
  ready_for_outreach: 'Candidate · awaiting Step 4 outreach',
  complete: 'Not a candidate · 1035 review complete',
}

const TURN_TONE: Record<CustomerWorkflow['whose_turn'], OperationalTone> = {
  Stewardship: 'blocked',
  Operations: 'reason',
  Bob: 'exception',
  // Candidate hands off to Step 4 Outreach — active next work, not Done.
  Outreach: 'reason',
  Done: 'info',
}

/** The ordered stages shown as the step-based work overview, with the concise
 * copy and icon each step uses. Order is the real workflow order. 'action'
 * steps are active work; the two terminal-for-now steps use the quieter
 * 'waiting' tone so they read as outcomes, not work to push. */
const STAGE_STEPS: {
  stage: Stage
  label: string
  blurb: string
  icon: typeof ShieldAlert
  tone: 'action' | 'waiting'
}[] = [
  { stage: 'stewardship', label: 'Needs servicing access', blurb: 'Worked on the shared Stewardship board', icon: ShieldQuestion, tone: 'action' },
  { stage: 'operations_prep', label: 'Operations preparation', blurb: 'Collect the carrier statement and reprojection', icon: Wrench, tone: 'action' },
  { stage: 'bob_evaluation', label: 'Ready for determination', blurb: 'Awaiting the Candidate / Not a candidate decision', icon: UserCheck, tone: 'action' },
  { stage: 'ready_for_outreach', label: 'Candidate · awaiting Step 4', blurb: 'Determined a candidate; Step 4 outreach not built yet', icon: Send, tone: 'waiting' },
  { stage: 'complete', label: 'Not a candidate · complete', blurb: '1035 review finished at Step 3', icon: CheckCircle2, tone: 'waiting' },
]

/** Stewardship-stage work is OWNED BY the shared Stewardship board (the IPF
 * shared-queue doctrine), so opening one of its customers hands off to the
 * board, deep-linked to that customer's actual outreach task. The project's own
 * stages (operations prep, determination, and the two terminal states) are
 * worked inline here in a focused single-customer task view. */
function stageIsOnStewardshipBoard(stage: Stage): boolean {
  return stage === 'stewardship'
}

export function Review1035Client({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [rows, setRows] = useState<CustomerWorkflow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The step-based view has three levels: the step overview (openStage null),
  // one step's concise customer list (openStage set), and a single customer's
  // task (openCustomerId set). This mirrors the Stewardship board's
  // board -> list -> task shape rather than dumping every expanded card at once.
  const [openStage, setOpenStage] = useState<Stage | null>(null)
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/review-1035`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load'); return }
      setRows(json.data.customers)
      setSummary(json.data.summary)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const rowsByStage = useMemo(() => {
    const m = new Map<Stage, CustomerWorkflow[]>()
    for (const r of rows) {
      const list = m.get(r.stage) ?? []
      list.push(r)
      m.set(r.stage, list)
    }
    return m
  }, [rows])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading review workflow…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
        {error}
      </div>
    )
  }

  // Level 3 — a single customer's task (operations prep / determination / the
  // terminal states). The existing per-customer servicing controls are reused
  // unchanged; only ONE customer is shown, so this is their actual task.
  if (openCustomerId) {
    const row = rows.find(r => r.customer_id === openCustomerId)
    if (row) {
      const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'this customer'
      return (
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setOpenCustomerId(null)}
            className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-ink-supporting hover:text-ink"
          >
            <ChevronLeft className="size-4" aria-hidden /> Back to {openStage ? STAGE_LABEL[openStage].toLowerCase() : 'the workflow'}
          </button>
          <h2 className="sr-only">{name} — 1035 task</h2>
          <CustomerRow projectId={projectId} row={row} onChanged={load} />
        </section>
      )
    }
    // The customer moved out of the data (e.g. after an action); fall through.
  }

  // Level 2 — one step's concise customer list. Opening a customer leads to
  // their actual task: the Stewardship board (stewardship stage) or the inline
  // single-customer task (the project's own stages).
  if (openStage) {
    const step = STAGE_STEPS.find(s => s.stage === openStage)!
    const stageRows = rowsByStage.get(openStage) ?? []
    const onBoard = stageIsOnStewardshipBoard(openStage)
    return (
      <section className="space-y-4">
        <QueueListHeader
          icon={step.icon}
          label={step.label}
          count={stageRows.length}
          blurb={step.blurb}
          onBack={() => setOpenStage(null)}
          backLabel="All steps"
        />
        {onBoard && (
          <p className="rounded-xl border border-surface-border bg-surface-muted/50 px-4 py-3 text-sm text-ink-secondary">
            Establishing servicing access is worked on the shared Stewardship board.
            Opening a customer takes you straight to their outreach task there.
          </p>
        )}
        <div className="space-y-3">
          {stageRows.length === 0 ? (
            <QueueEmptyState>No customers at this step.</QueueEmptyState>
          ) : (
            stageRows.map(r => {
              const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Unknown customer'
              return (
                <CustomerQueueCard
                  key={r.customer_id}
                  name={name}
                  detail={customerStepDetail(r)}
                  trailing={
                    <OperationalTag tone={TURN_TONE[r.whose_turn]} className="px-3 py-1 text-sm">
                      {r.whose_turn}
                    </OperationalTag>
                  }
                  onOpen={() => {
                    if (onBoard) {
                      // Hand off to the shared board, deep-linked to this
                      // customer's actual outreach task.
                      router.push(`/stewardship?project_id=${projectId}&customer_id=${r.customer_id}`)
                    } else {
                      setOpenCustomerId(r.customer_id)
                    }
                  }}
                />
              )
            })
          )}
        </div>
      </section>
    )
  }

  // Level 1 — the step overview: each stage as a row with its count. This is
  // the concise progress/step view that replaces the 71-card dump.
  const total = summary?.total ?? rows.length
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-5 text-teal-700" aria-hidden />
          <h2 className="text-lg font-semibold text-ink">Review workflow</h2>
        </div>
        <p className="text-sm text-ink-supporting">
          {total.toLocaleString()} customer{total === 1 ? '' : 's'}
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center text-ink-supporting">
          No customers in this project yet.
        </div>
      ) : (
        <>
          {/* Side task: complete contact information missing from the import.
              A separate pass that reuses the shared research interface; it does
              not change the 1035 workflow stages below. */}
          <Link
            href={`/projects/${projectId}/contact-review`}
            className="group flex items-center gap-3 rounded-2xl border border-surface-border bg-surface-card px-5 py-4 transition-colors hover:border-brand-ring hover:bg-brand-wash/50"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand-icon">
              <CircleUser className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-ink">Contact Review</span>
              <span className="block text-sm text-ink-supporting">
                Look customers up in eAgent and complete missing email or phone information.
              </span>
            </span>
            <ArrowLeft className="size-5 shrink-0 rotate-180 text-surface-border-strong transition-colors group-hover:text-brand-icon" aria-hidden />
          </Link>

          {/* Progress across the five steps, at a glance. */}
          <StepProgress summary={summary} total={total} />

          <QueueSection label="Work by step">
            {STAGE_STEPS.map(step => (
              <QueueRow
                key={step.stage}
                icon={step.icon}
                label={step.label}
                tag={step.blurb}
                count={summary?.by[step.stage] ?? rowsByStage.get(step.stage)?.length ?? 0}
                tone={step.tone}
                onOpen={() => { setOpenCustomerId(null); setOpenStage(step.stage) }}
              />
            ))}
          </QueueSection>
        </>
      )}
    </section>
  )
}

/** A single, compact progress bar across the five workflow steps, so the whole
 * project's position is visible without opening any step. */
function StepProgress({ summary, total }: { summary: Summary | null; total: number }) {
  if (!summary || total === 0) return null
  const segments: { stage: Stage; className: string }[] = [
    { stage: 'stewardship', className: 'bg-tag-blocked-text' },
    { stage: 'operations_prep', className: 'bg-tag-reason-text' },
    { stage: 'bob_evaluation', className: 'bg-tag-exception-text' },
    { stage: 'ready_for_outreach', className: 'bg-brand' },
    { stage: 'complete', className: 'bg-ink-muted' },
  ]
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
      role="img"
      aria-label="Progress across the five 1035 workflow steps"
    >
      {segments.map(seg => {
        const n = summary.by[seg.stage] ?? 0
        if (n === 0) return null
        return (
          <div
            key={seg.stage}
            className={seg.className}
            style={{ width: `${(n / total) * 100}%` }}
            title={`${STAGE_LABEL[seg.stage]}: ${n}`}
          />
        )
      })}
    </div>
  )
}

/** A concise one-line detail for a customer in a step's list: enough to orient
 * (policy count + the current readiness) without expanding the whole card. */
function customerStepDetail(r: CustomerWorkflow): string {
  const policies = `${r.permanent_count} permanent ${r.permanent_count === 1 ? 'policy' : 'policies'}`
  switch (r.stage) {
    case 'stewardship':
      return `${r.unconfirmed_permanent_count} of ${r.permanent_count} not confirmed`
    case 'operations_prep':
      return r.documents_complete
        ? `${policies} · documents complete`
        : `${policies} · documents outstanding`
    case 'bob_evaluation':
      return `${policies} · prepared, awaiting determination`
    case 'ready_for_outreach':
      return `${policies} · candidate`
    case 'complete':
      return `${policies} · not a candidate`
  }
}

function CustomerRow({
  projectId, row, onChanged,
}: {
  projectId: string
  row: CustomerWorkflow
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unknown customer'

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setRowError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/review-1035/${row.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setRowError(json.error ?? 'Action failed'); return }
      await onChanged()
    } catch { setRowError('Network error') }
    finally { setBusy(false) }
  }

  async function uploadDocument(policyId: string, documentType: DocType, file: File) {
    setBusy(true); setRowError(null)
    try {
      const fd = new FormData()
      fd.append('document_type', documentType)
      fd.append('policy_id', policyId)
      fd.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/review-1035/${row.customer_id}/documents`, {
        method: 'POST',
        body: fd, // multipart; browser sets the boundary
      })
      const json = await res.json()
      if (!res.ok) { setRowError(json.error ?? 'Could not upload document'); return }
      await onChanged()
    } catch { setRowError('Network error') }
    finally { setBusy(false) }
  }

  async function viewDocument(policyId: string, documentType: DocType) {
    setRowError(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/review-1035/${row.customer_id}/documents?type=${documentType}&policy_id=${policyId}`,
        { cache: 'no-store' },
      )
      const json = await res.json()
      if (!res.ok) { setRowError(json.error ?? 'Could not open document'); return }
      window.open(json.data.url, '_blank', 'noopener,noreferrer')
    } catch { setRowError('Network error') }
  }

  // Mark a required document UNAVAILABLE (durable, reversible skip). It is not a
  // received document — it just lets preparation proceed when the document
  // genuinely cannot be obtained.
  async function skipDocument(policyId: string, documentType: DocType) {
    setBusy(true); setRowError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/review-1035/${row.customer_id}/documents/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_type: documentType, policy_id: policyId }),
      })
      const json = await res.json()
      if (!res.ok) { setRowError(json.error ?? 'Could not mark unavailable'); return }
      await onChanged()
    } catch { setRowError('Network error') }
    finally { setBusy(false) }
  }

  // Reverse a skip: the document is no longer marked unavailable.
  async function unskipDocument(policyId: string, documentType: DocType) {
    setBusy(true); setRowError(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/review-1035/${row.customer_id}/documents/skip?type=${documentType}&policy_id=${policyId}`,
        { method: 'DELETE' },
      )
      const json = await res.json()
      if (!res.ok) { setRowError(json.error ?? 'Could not undo'); return }
      await onChanged()
    } catch { setRowError('Network error') }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CircleUser className="mt-0.5 size-5 text-ink-supporting" aria-hidden />
          <div>
            <p className="text-base font-semibold text-ink">{name}</p>
            <p className="text-sm text-ink-supporting">{STAGE_LABEL[row.stage]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-supporting">Next:</span>
          <OperationalTag tone={TURN_TONE[row.whose_turn]} className="px-3 py-1 text-base">
            {row.whose_turn}
          </OperationalTag>
        </div>
      </div>

      {/* Step 2 — servicing access over ALL known permanent policies */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-4">
          <div className="flex items-center gap-2">
            {row.step2_satisfied
              ? <ShieldCheck className="size-4 text-status-confirmed-foreground" aria-hidden />
              : <ShieldAlert className="size-4 text-tag-blocked-text" aria-hidden />}
            <p className="text-sm font-semibold text-ink">Step 2 · Servicing access</p>
          </div>
          <p className="mt-2 text-sm text-ink-secondary">
            {row.permanent_count === 0
              ? 'No permanent policies on file — no servicing access to establish.'
              : row.step2_satisfied
                ? `All ${row.permanent_count} permanent ${row.permanent_count === 1 ? 'policy is' : 'policies are'} confirmed.`
                : `${row.unconfirmed_permanent_count} of ${row.permanent_count} permanent ${row.permanent_count === 1 ? 'policy is' : 'policies are'} not confirmed.`}
          </p>
          {!row.step2_satisfied && (
            <Link
              href={`/stewardship?project_id=${projectId}`}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
            >
              <Play className="size-4" aria-hidden />
              Work Stewardship
            </Link>
          )}
          {/* Policy-level detail, readable (not muted) because it drives the action */}
          <ul className="mt-3 space-y-1">
            {row.permanent_policies.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-ink">{p.policy_number}</span>
                <span className="text-ink-supporting">{p.product_type ?? '—'}</span>
                <span className={p.sa_status === 'confirmed' ? 'text-status-confirmed-foreground font-medium' : 'text-tag-blocked-text font-medium'}>
                  {p.sa_status === 'confirmed' ? 'confirmed' : (p.sa_status ?? 'unknown')}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Step 3 — documents (per policy) + readiness + determination */}
        <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-4">
          <p className="text-base font-semibold text-ink">Step 3 · Prepare &amp; evaluate</p>
          <p className="mt-1 text-sm text-ink-secondary">
            For each permanent policy, upload the Carrier Statement and the Reprojection, or mark one
            unavailable. Every required document must be addressed before the customer is ready for
            producer evaluation.
          </p>

          {row.permanent_count === 0 ? (
            <p className="mt-3 text-sm text-ink-secondary">
              No permanent policies to evaluate — no Step 3 documents required.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {row.permanent_policies.map(p => (
                <PolicyDocuments
                  key={p.id}
                  policy={p}
                  disabled={busy || !row.step2_satisfied}
                  onUpload={(type, file) => uploadDocument(p.id, type, file)}
                  onView={type => viewDocument(p.id, type)}
                  onSkip={type => skipDocument(p.id, type)}
                  onUnskip={type => unskipDocument(p.id, type)}
                />
              ))}
            </div>
          )}

          {!row.step2_satisfied && (
            <p className="mt-3 text-sm text-ink-supporting">
              Documents can be collected once servicing access is established.
            </p>
          )}

          {/* Operations: mark preparation complete / reopen. The handoff stays
              disabled until every required document is addressed (uploaded or
              marked unavailable) — the same rule the server enforces. */}
          {row.step2_satisfied && row.determination == null && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {row.prep_status !== 'ready_for_evaluation' ? (
                  <button
                    type="button"
                    disabled={busy || !row.prep_gate_satisfied}
                    title={row.prep_gate_satisfied ? undefined : 'Upload or mark unavailable every required document first'}
                    onClick={() => patch({ action: 'set_prep', prep_status: 'ready_for_evaluation' })}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-base font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ClipboardCheck className="size-4" aria-hidden />
                    Ready for Producer Evaluation
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch({ action: 'set_prep', prep_status: 'preparing' })}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-surface-border-strong px-4 text-base font-semibold text-ink-secondary transition-colors hover:bg-surface-muted"
                  >
                    Reopen preparation
                  </button>
                )}
              </div>
              {row.prep_status !== 'ready_for_evaluation' && !row.prep_gate_satisfied && (
                <p className="text-sm text-ink-secondary">
                  Upload or mark unavailable each policy&apos;s Carrier Statement and Reprojection to continue.
                </p>
              )}
            </div>
          )}

          {/* Bob: determination */}
          {row.stage === 'bob_evaluation' && (
            <div className="mt-3 rounded-lg border border-tag-exception-border bg-tag-exception-fill/40 p-3">
              <p className="text-sm font-semibold text-ink">Bob&apos;s 1035 determination</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ action: 'set_determination', determination: 'candidate' })}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:opacity-50"
                >
                  <Check className="size-4" aria-hidden /> Candidate
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ action: 'set_determination', determination: 'not_a_candidate' })}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-surface-border-strong px-3 text-sm font-semibold text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden /> Not a candidate
                </button>
              </div>
            </div>
          )}

          {/* Determined — Candidate hands off to Step 4 (not Done); Not a
              candidate is the terminal, complete-at-Step-3 outcome. */}
          {row.determination === 'candidate' && (
            <div className="mt-3 space-y-2 rounded-lg border border-tag-reason-border bg-tag-reason-fill/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <OperationalTag tone="reason" className="px-3 py-1 text-base">
                  1035 Candidate · Ready for Outreach
                </OperationalTag>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ action: 'set_determination', determination: null })}
                  className="text-sm font-medium text-ink-supporting underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                >
                  Undo
                </button>
              </div>
              <NextNote>
                Step 3 is complete. Next: Step 4 Outreach &amp; Scheduling (not available yet).
              </NextNote>
            </div>
          )}

          {row.determination === 'not_a_candidate' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <OperationalTag tone="info" className="px-3 py-1 text-base">
                Not a candidate · 1035 review complete
              </OperationalTag>
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ action: 'set_determination', determination: null })}
                className="text-sm font-medium text-ink-supporting underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          )}
        </div>
      </div>

      {rowError && (
        <p className="mt-3 rounded-lg border border-tag-blocked-border bg-tag-blocked-fill px-3 py-2 text-sm text-tag-blocked-text">
          {rowError}
        </p>
      )}
    </div>
  )
}

function PolicyDocuments({
  policy, disabled, onUpload, onView, onSkip, onUnskip,
}: {
  policy: PolicyAccess
  disabled: boolean
  onUpload: (type: DocType, file: File) => void
  onView: (type: DocType) => void
  onSkip: (type: DocType) => void
  onUnskip: (type: DocType) => void
}) {
  // A policy is READY when both required documents are addressed (uploaded or
  // marked unavailable). Until then it still has outstanding items.
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-ink">{policy.policy_number}</span>
          <span className="text-sm text-ink-supporting">{policy.product_type ?? '—'}</span>
        </div>
        {policy.documents_addressed ? (
          <OperationalTag tone="info" className="px-2.5 py-0.5 text-sm">Ready</OperationalTag>
        ) : (
          <OperationalTag tone="reason" className="px-2.5 py-0.5 text-sm">Needs attention</OperationalTag>
        )}
      </div>
      <div className="mt-3 space-y-2.5">
        <DocRow
          label="Carrier Statement"
          present={policy.has_carrier_statement}
          skipped={policy.carrier_statement_skipped}
          disabled={disabled}
          onUpload={file => onUpload('carrier_statement', file)}
          onView={() => onView('carrier_statement')}
          onSkip={() => onSkip('carrier_statement')}
          onUnskip={() => onUnskip('carrier_statement')}
        />
        <DocRow
          label="Reprojection"
          present={policy.has_reprojection}
          skipped={policy.reprojection_skipped}
          disabled={disabled}
          onUpload={file => onUpload('reprojection', file)}
          onView={() => onView('reprojection')}
          onSkip={() => onSkip('reprojection')}
          onUnskip={() => onUnskip('reprojection')}
        />
      </div>
    </div>
  )
}

/**
 * One required document for a policy. Three states, each with the right action:
 *   - uploaded ("Stored"): View + Replace
 *   - skipped ("Unavailable"): a reversible Undo
 *   - neither (outstanding): Upload or Skip (mark unavailable)
 * A skip is durable but reversible, and is never shown as a received document.
 */
function DocRow({
  label, present, skipped, disabled, onUpload, onView, onSkip, onUnskip,
}: {
  label: string
  present: boolean
  skipped: boolean
  disabled: boolean
  onUpload: (file: File) => void
  onView: () => void
  onSkip: () => void
  onUnskip: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function pick() { inputRef.current?.click() }
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so re-selecting the same filename still fires change.
    e.target.value = ''
    if (file) onUpload(file)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-surface-divider bg-surface-muted/40 px-3 py-2">
      <span className="flex items-center gap-2 text-base text-ink">
        {present
          ? <FileCheck2 className="size-4 text-status-confirmed-foreground" aria-hidden />
          : skipped
            ? <FileText className="size-4 text-ink-muted" aria-hidden />
            : <FileText className="size-4 text-ink-supporting" aria-hidden />}
        {label}
        {present && <span className="text-sm font-medium text-status-confirmed-foreground">· Stored</span>}
        {skipped && <span className="text-sm font-medium text-ink-muted">· Unavailable</span>}
      </span>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={onChange}
      />

      <div className="flex items-center gap-3">
        {present ? (
          <>
            <button type="button" onClick={onView}
              className="text-sm font-semibold text-brand hover:text-brand-hover">View</button>
            <button type="button" disabled={disabled} onClick={pick}
              className="text-sm font-semibold text-brand hover:text-brand-hover disabled:cursor-not-allowed disabled:opacity-50">Replace</button>
          </>
        ) : skipped ? (
          // Reversible: undo the skip to require the document again.
          <button type="button" disabled={disabled} onClick={onUnskip}
            className="text-sm font-semibold text-brand hover:text-brand-hover disabled:cursor-not-allowed disabled:opacity-50">Undo</button>
        ) : (
          <>
            <button type="button" disabled={disabled} onClick={pick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50">
              <Upload className="size-4" aria-hidden /> Upload
            </button>
            <button type="button" disabled={disabled} onClick={onSkip}
              className="text-sm font-semibold text-ink-supporting underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50">Skip</button>
          </>
        )}
      </div>
    </div>
  )
}
