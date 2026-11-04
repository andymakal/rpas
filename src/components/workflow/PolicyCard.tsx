'use client'

/**
 * PolicyCard — one policy as a self-contained, collapsible, read-only Lego.
 *
 * Collapsed it shows the policy number with its coverage status in parentheses
 * (as it came from the carrier, never reworded) and the Servicing Agent answer.
 * Expanded it shows the policy facts: insured, type, carrier, face amount,
 * annual premium, rate class, issue date, and cash value when the policy
 * carries one. A field with no value on file reads "Not on file"; nothing is
 * invented. When no separate insured is recorded the insured is the owner.
 *
 * Expansion state belongs to the host (PolicySummaryList) so it can offer
 * Expand all / Collapse all; PolicyCard itself is controlled.
 */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ServicingAgentStatus } from './ServicingAgentStatus'

/** One policy's read-only summary fields. The host maps its own record onto it. */
export interface PolicySummary {
  id: string
  policy_number: string | null
  /** The product/policy type (service_policies.product_type). */
  product_type: string | null
  /** Face amount in dollars (service_policies.face_amount). */
  face_amount: number | null
  /** Issue date (service_policies.issue_date), ISO or date string. */
  issue_date: string | null
  /** Cash value in dollars; null/absent for policies with none (e.g. term). */
  cash_value_amount?: number | null
  carrier?: string | null
  /** Coverage status text as received (service_policies.coverage_status). */
  coverage_status?: string | null
  /** Annual premium in dollars (service_policies.annual_premium). */
  annual_premium?: number | null
  /** Rate class (service_policies.rate_class). */
  rate_class?: string | null
  /** The insured's full name when recorded; null/absent means the owner. */
  insured_name?: string | null
  /** Stored servicing-agent status (unknown | confirmed | not_on_file). */
  sa_status?: string | null
}

function currency(n: number | null | undefined): string | null {
  if (n == null) return null
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** MM/DD/YYYY. A bare date is parsed at noon so a timezone never rolls it back
 * a day. Null when absent or unparseable. */
function formatIssueDate(raw: string | null): string | null {
  if (!raw) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

function SummaryRow({
  label, value, first = false,
}: {
  label: string
  value: string | null
  first?: boolean
}) {
  const present = value != null && value.trim().length > 0
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1', first && 'pt-0.5')}>
      <dt className="text-xs uppercase leading-5 tracking-wide text-ink-supporting">{label}</dt>
      <dd className={cn('text-right text-base leading-5', present ? 'font-medium text-ink' : 'italic text-ink-muted')}>
        {present ? value : 'Not on file'}
      </dd>
    </div>
  )
}

export function PolicyCard({
  policy, expanded, onToggle,
}: {
  policy: PolicySummary
  expanded: boolean
  onToggle: () => void
}) {
  const number = policy.policy_number?.trim()
  const status = policy.coverage_status?.trim()
  const insured = policy.insured_name?.trim()
  const detailsId = `policy-details-${policy.id}`
  const hasCashValue = policy.cash_value_amount != null

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
        <span className="min-w-0 flex-1 text-base">
          <span className={cn(number ? 'font-mono font-medium text-ink' : 'italic text-ink-muted')}>
            {number || 'No policy number on file'}
          </span>
          {status && <span className="text-ink-supporting">{` (${status})`}</span>}
        </span>
        <ServicingAgentStatus saStatus={policy.sa_status} className="shrink-0" />
      </button>
      {expanded && (
        <div id={detailsId} className="mt-1 pb-2 pl-6 pr-1">
          <dl className="divide-y divide-surface-border-strong">
            <SummaryRow label="Insured" value={insured || 'Owner'} first />
            <SummaryRow label="Policy type" value={policy.product_type} />
            {policy.carrier && <SummaryRow label="Carrier" value={policy.carrier} />}
            <SummaryRow label="Face amount" value={currency(policy.face_amount)} />
            <SummaryRow label="Annual premium" value={currency(policy.annual_premium)} />
            <SummaryRow label="Rate class" value={policy.rate_class ?? null} />
            <SummaryRow label="Issue date" value={formatIssueDate(policy.issue_date)} />
            {hasCashValue && <SummaryRow label="Cash value" value={currency(policy.cash_value_amount)} />}
          </dl>
        </div>
      )}
    </div>
  )
}
