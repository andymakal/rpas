'use client'

/**
 * Policies — a reusable, read-only card that shows the policy facts a worker
 * needs while contacting a customer: policy number, policy type, face amount,
 * issue date, and cash value when applicable. It renders EXISTING policy data
 * (service_policies) and never invents a missing value: a field with no value
 * on file reads plainly as "Not on file" rather than a fabricated figure.
 *
 * One "Policies" heading for the whole set (shown once). Each policy starts
 * COLLAPSED, showing only its policy number and an expansion caret; expanding
 * reveals the existing detail rows. When several policies are present the card
 * offers Expand All / Collapse All. It is display only: no editing, no
 * persistence, no business judgment.
 *
 * It visually matches the shared Customer Contact card (the light-theme section
 * shell, the design tokens, the stacked rows separated by the stronger surface
 * divider) so the two sit together beneath one another as one customer-context
 * column.
 */

import { useMemo, useState } from 'react'
import { FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One policy's read-only summary fields. Mirrors the service_policies columns
 * the workflow already reads; the host maps its own record onto this shape. */
export interface PolicySummary {
  id: string
  policy_number: string | null
  /** The product/policy type (service_policies.product_type). */
  product_type: string | null
  /** Face amount in dollars (service_policies.face_amount). */
  face_amount: number | null
  /** Issue date (service_policies.issue_date), ISO or date string. */
  issue_date: string | null
  /** Cash value in dollars (service_policies.cash_value_amount), when the
   * policy carries one. Null/absent for policies with no cash value (e.g.
   * term), where the row is simply not shown. */
  cash_value_amount?: number | null
  /** Carrier, shown as supporting context when known. */
  carrier?: string | null
}

const EM_DASH = '\u2014'

function currency(n: number | null | undefined): string | null {
  if (n == null) return null
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Format an issue date as MM/DD/YYYY. Parses a bare date at noon so a
 * timezone shift never rolls it to the previous day. Returns null when absent
 * or unparseable (we never invent a date). */
function formatIssueDate(raw: string | null): string | null {
  if (!raw) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

/** One label/value row. A missing value reads plainly as "Not on file" in the
 * muted tone reserved for unavailable information. */
function SummaryRow({
  label, value, mono = false, first = false,
}: {
  label: string
  value: string | null
  mono?: boolean
  first?: boolean
}) {
  const present = value != null && value.trim().length > 0
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2.5', !first && 'pt-2.5')}>
      <dt className="text-sm uppercase tracking-wide text-ink-supporting">{label}</dt>
      <dd
        className={cn(
          'text-right text-base',
          present ? 'font-medium text-ink' : 'italic text-ink-muted',
          mono && present && 'font-mono',
        )}
      >
        {present ? value : 'Not on file'}
      </dd>
    </div>
  )
}

/** The existing policy detail rows, revealed when a policy is expanded. The
 * cash-value row is shown ONLY when the policy carries a cash value; term
 * policies simply omit it rather than showing a zero. */
function PolicyDetails({ policy }: { policy: PolicySummary }) {
  const faceValue = currency(policy.face_amount)
  const cashValue = currency(policy.cash_value_amount)
  const hasCashValue = policy.cash_value_amount != null
  return (
    <dl className="divide-y divide-surface-border-strong">
      <SummaryRow label="Policy type" value={policy.product_type} first />
      {policy.carrier && <SummaryRow label="Carrier" value={policy.carrier} />}
      <SummaryRow label="Face amount" value={faceValue} />
      <SummaryRow label="Issue date" value={formatIssueDate(policy.issue_date)} />
      {hasCashValue && <SummaryRow label="Cash value" value={cashValue ?? EM_DASH} />}
    </dl>
  )
}

/**
 * One collapsible policy: a header button showing the policy number and an
 * expansion caret, with the existing detail rows revealed when expanded. The
 * header is the toggle; the whole control is keyboard-accessible and read-only.
 */
function PolicyRow({
  policy, expanded, onToggle,
}: {
  policy: PolicySummary
  expanded: boolean
  onToggle: () => void
}) {
  const number = policy.policy_number?.trim()
  const detailsId = `policy-details-${policy.id}`
  return (
    <div className="py-1 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring/40"
      >
        {expanded
          ? <ChevronDown className="size-4 shrink-0 text-ink-supporting" aria-hidden />
          : <ChevronRight className="size-4 shrink-0 text-ink-supporting" aria-hidden />}
        <span className={cn('text-base', number ? 'font-mono font-medium text-ink' : 'italic text-ink-muted')}>
          {number || 'No policy number on file'}
        </span>
      </button>
      {expanded && (
        <div id={detailsId} className="mt-1 pl-6 pr-1 pb-2">
          <PolicyDetails policy={policy} />
        </div>
      )}
    </div>
  )
}

/**
 * The Policies card for a customer's set of policies. One heading, each policy
 * collapsed to its number with an expansion caret, Expand All / Collapse All
 * when several are present. When there are no policies on file the card shows a
 * plain empty state. Read-only.
 */
export function PolicySummaryList({
  policies,
  className,
}: {
  policies: PolicySummary[]
  className?: string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const allExpanded = policies.length > 0 && policies.every((p) => expanded.has(p.id))
  const hasMultiple = policies.length > 1

  const toggleOne = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const expandAll = () => setExpanded(new Set(policies.map((p) => p.id)))
  const collapseAll = () => setExpanded(new Set())

  // Stable ordering only affects the all-expanded check; nothing here mutates
  // the incoming policies.
  const items = useMemo(() => policies, [policies])

  return (
    <section
      className={cn(
        'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
        className,
      )}
      aria-label="Policies"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-ink-supporting" aria-hidden />
          <h3 className="text-[22px] font-semibold leading-tight text-ink">Policies</h3>
          {items.length > 0 && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-sm font-medium text-ink-supporting">
              {items.length}
            </span>
          )}
        </div>
        {hasMultiple && (
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition-colors hover:text-brand-hover"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-base italic text-ink-muted">No policy on file.</p>
      ) : (
        <ul className="mt-3 divide-y divide-surface-border">
          {items.map((p) => (
            <li key={p.id}>
              <PolicyRow
                policy={p}
                expanded={expanded.has(p.id)}
                onToggle={() => toggleOne(p.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A single policy's card, kept for callers that render exactly one policy on
 * its own. It reuses the same collapsible row inside the shared "Policies"
 * shell, so it reads identically to one item of the list. Read-only.
 */
export function PolicySummaryCard({
  policy,
  className,
}: {
  policy: PolicySummary
  className?: string
}) {
  return <PolicySummaryList policies={[policy]} className={className} />
}
