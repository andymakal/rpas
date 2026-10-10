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

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ShieldCheck, ShieldAlert, FileText, FileCheck2, Play, Check, X,
  CircleUser, ClipboardCheck, Loader2,
} from 'lucide-react'
import { OperationalTag, type OperationalTone, NextNote } from '@/components/workflow'

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
  bob_evaluation: 'Ready for Bob',
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

export function Review1035Client({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<CustomerWorkflow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-5 text-teal-700" aria-hidden />
        <h2 className="text-lg font-semibold text-ink">Review workflow</h2>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryCard label="Needs access" value={summary.by.stewardship} tone="blocked" />
          <SummaryCard label="Operations prep" value={summary.by.operations_prep} tone="reason" />
          <SummaryCard label="Ready for Bob" value={summary.by.bob_evaluation} tone="exception" />
          <SummaryCard label="Ready for outreach" value={summary.by.ready_for_outreach} tone="reason"
            sub="Candidate · awaiting Step 4" />
          <SummaryCard label="Not a candidate" value={summary.by.complete} tone="info"
            sub="1035 review complete" />
        </div>
      )}

      <div className="space-y-3">
        {rows.map(r => (
          <CustomerRow key={r.customer_id} projectId={projectId} row={r} onChanged={load} />
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center text-ink-supporting">
            No customers in this project yet.
          </div>
        )}
      </div>
    </section>
  )
}

function SummaryCard({ label, value, tone, sub }: { label: string; value: number; tone: OperationalTone; sub?: string }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-supporting">{label}</p>
        <OperationalTag tone={tone} className="px-2.5 py-0.5 text-sm">{value}</OperationalTag>
      </div>
      {sub && <p className="mt-2 text-xs text-ink-supporting">{sub}</p>}
    </div>
  )
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
          <p className="text-sm font-semibold text-ink">Step 3 · Prepare &amp; evaluate</p>
          <p className="mt-1 text-sm text-ink-supporting">
            Collect a carrier statement and reprojection for each permanent policy. Missing
            documents on supplemental policies don&apos;t block handing the customer to Bob.
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
                />
              ))}
            </div>
          )}

          {!row.step2_satisfied && (
            <p className="mt-3 text-sm text-ink-supporting">
              Documents can be collected once servicing access is established.
            </p>
          )}

          {/* Operations: mark preparation complete / reopen */}
          {row.step2_satisfied && row.determination == null && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {row.prep_status !== 'ready_for_evaluation' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ action: 'set_prep', prep_status: 'ready_for_evaluation' })}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ClipboardCheck className="size-4" aria-hidden />
                  Hand to Bob for evaluation
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ action: 'set_prep', prep_status: 'preparing' })}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-surface-border-strong px-3 text-sm font-semibold text-ink-secondary transition-colors hover:bg-surface-muted"
                >
                  Reopen preparation
                </button>
              )}
              {row.prep_status !== 'ready_for_evaluation' && !row.documents_complete && (
                <span className="text-sm text-ink-secondary">
                  Some policies are missing documents. You can still hand to Bob — he decides which policies qualify.
                </span>
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
  policy, disabled, onUpload, onView,
}: {
  policy: PolicyAccess
  disabled: boolean
  onUpload: (type: DocType, file: File) => void
  onView: (type: DocType) => void
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{policy.policy_number}</span>
          <span className="text-sm text-ink-supporting">{policy.product_type ?? '—'}</span>
        </div>
        {policy.documents_complete ? (
          <OperationalTag tone="info" className="px-2.5 py-0.5 text-sm">Documents complete</OperationalTag>
        ) : (
          <OperationalTag tone="reason" className="px-2.5 py-0.5 text-sm">Documents outstanding</OperationalTag>
        )}
      </div>
      <div className="mt-2 space-y-2">
        <DocRow
          label="Carrier statement"
          present={policy.has_carrier_statement}
          disabled={disabled}
          onUpload={file => onUpload('carrier_statement', file)}
          onView={() => onView('carrier_statement')}
        />
        <DocRow
          label="Reprojection"
          present={policy.has_reprojection}
          disabled={disabled}
          onUpload={file => onUpload('reprojection', file)}
          onView={() => onView('reprojection')}
        />
      </div>
    </div>
  )
}

function DocRow({
  label, present, disabled, onUpload, onView,
}: {
  label: string
  present: boolean
  disabled: boolean
  onUpload: (file: File) => void
  onView: () => void
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
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm text-ink-secondary">
        {present
          ? <FileCheck2 className="size-4 text-status-confirmed-foreground" aria-hidden />
          : <FileText className="size-4 text-ink-supporting" aria-hidden />}
        {label}
      </span>
      <div className="flex items-center gap-3">
        {present && (
          <>
            <span className="text-sm font-medium text-status-confirmed-foreground">Stored</span>
            <button
              type="button"
              onClick={onView}
              className="text-sm font-semibold text-brand hover:text-brand-hover"
            >
              View
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={onChange}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={pick}
          className="text-sm font-semibold text-brand hover:text-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {present ? 'Replace' : 'Upload'}
        </button>
      </div>
    </div>
  )
}
