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
import { FileText } from 'lucide-react'
import { PolicyCard, type PolicySummary } from './PolicyCard'
import { cn } from '@/lib/utils'

export type { PolicySummary }

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
              <PolicyCard
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
