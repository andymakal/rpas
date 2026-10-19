'use client'

/**
 * Policy Summary — a reusable, read-only card that shows the policy facts a
 * worker needs while contacting a customer: policy number, policy type, face
 * amount, issue date, and cash value when applicable. It renders EXISTING
 * policy data (service_policies) and never invents a missing value: a field
 * with no value on file reads plainly as "Not on file" rather than a fabricated
 * figure.
 *
 * It visually matches the shared Customer Contact card (the light-theme section
 * shell, the design tokens, the stacked rows separated by the stronger surface
 * divider) so the two sit together beneath one another as one customer-context
 * column. It is display only: no editing, no persistence, no business judgment.
 */

import { FileText, ShieldCheck } from 'lucide-react'
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

/**
 * One policy's read-only summary. Rendered as a section matching the Customer
 * Contact card shell. The cash-value row is shown ONLY when the policy carries
 * a cash value; term policies simply omit it rather than showing a zero.
 */
export function PolicySummaryCard({
  policy,
  className,
}: {
  policy: PolicySummary
  className?: string
}) {
  const faceValue = currency(policy.face_amount)
  const cashValue = currency(policy.cash_value_amount)
  const hasCashValue = policy.cash_value_amount != null

  return (
    <section
      className={cn(
        'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
        className,
      )}
      aria-label="Policy summary"
    >
      <div className="flex items-center gap-2">
        <FileText className="size-5 text-ink-supporting" aria-hidden />
        <h3 className="text-[22px] font-semibold leading-tight text-ink">Policy summary</h3>
      </div>

      {policy.carrier && (
        <p className="mt-1 text-sm text-ink-supporting">{policy.carrier}</p>
      )}

      <dl className="mt-3 divide-y divide-surface-border-strong">
        <SummaryRow label="Policy number" value={policy.policy_number} mono first />
        <SummaryRow label="Policy type" value={policy.product_type} />
        <SummaryRow label="Face amount" value={faceValue} />
        <SummaryRow label="Issue date" value={formatIssueDate(policy.issue_date)} />
        {/* Cash value appears only when the policy actually carries one. */}
        {hasCashValue && <SummaryRow label="Cash value" value={cashValue ?? EM_DASH} />}
      </dl>
    </section>
  )
}

/**
 * The Policy Summary for a customer's set of policies. When the servicing
 * request names specific policies, those are summarized; a single policy renders
 * one card, several render a stacked set. When there are no policies on file the
 * section is omitted entirely (the caller decides whether to render anything).
 */
export function PolicySummaryList({
  policies,
  className,
}: {
  policies: PolicySummary[]
  className?: string
}) {
  if (policies.length === 0) {
    return (
      <section
        className={cn(
          'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
          className,
        )}
        aria-label="Policy summary"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-ink-supporting" aria-hidden />
          <h3 className="text-[22px] font-semibold leading-tight text-ink">Policy summary</h3>
        </div>
        <p className="mt-2 text-base italic text-ink-muted">No policy on file.</p>
      </section>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {policies.map((p) => (
        <PolicySummaryCard key={p.id} policy={p} />
      ))}
    </div>
  )
}
