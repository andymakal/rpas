'use client'

/**
 * GatewayLookup — the shared "search Gateway by last name + policy number"
 * block used by the 1035 contact-gathering activities (project Contact Review
 * and Stewardship Research Needed).
 *
 * It is the single, reusable version of the look-up step both activities share:
 * the customer's last name and one existing policy number, each with a Copy
 * button that writes the value to the clipboard and briefly confirms the copy.
 * The policy number is the surest key to the right Gateway record; when none is
 * on file the control says so and the worker searches by last name alone.
 *
 * Behavior only — copy to clipboard and the transient "copied" confirmation.
 * It never reads or writes the customer record; the surrounding task owns the
 * contact capture and progression.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, FileText } from 'lucide-react'
import { WorkflowButton } from './primitives'

export function GatewayLookup({
  lastName,
  fallbackName,
  policyNumber,
  stepLabel = '1. Search Gateway',
}: {
  /** The customer's last name — the primary search term. */
  lastName: string | null
  /** Shown in place of an empty last name (e.g. the full name) so there is
   * always something to copy and search. */
  fallbackName?: string
  /** One policy number on file, or null/empty when the customer has none. */
  policyNumber: string | null
  /** The step heading. Defaults to the Contact Review wording; callers can pass
   * their own (e.g. a different step number) without changing the look. */
  stepLabel?: string
}) {
  const last = (lastName ?? '').trim()
  const policy = (policyNumber ?? '').trim()
  const hasPolicy = policy.length > 0
  const lastDisplay = last || (fallbackName ?? '').trim()

  // Which copy button last fired, so only that one shows its confirmed state.
  const [copiedField, setCopiedField] = useState<'last' | 'policy' | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copyValue = useCallback((field: 'last' | 'policy', value: string) => {
    void navigator.clipboard.writeText(value)
    setCopiedField(field)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedField(null), 2000)
  }, [])

  return (
    <div className="space-y-3 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
      <p className="text-base font-semibold text-ink-secondary">{stepLabel}</p>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xl font-semibold text-ink">{lastDisplay || 'Unknown'}</span>
        <WorkflowButton
          icon={copiedField === 'last' ? Check : Copy}
          selected={copiedField === 'last'}
          onClick={() => copyValue('last', lastDisplay)}
          disabled={!lastDisplay}
        >
          {copiedField === 'last' ? 'Last name copied' : 'Copy Last Name'}
        </WorkflowButton>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {hasPolicy ? (
          <>
            <span className="font-mono text-xl font-semibold text-ink">{policy}</span>
            <WorkflowButton
              icon={copiedField === 'policy' ? Check : Copy}
              selected={copiedField === 'policy'}
              onClick={() => copyValue('policy', policy)}
            >
              {copiedField === 'policy' ? 'Policy number copied' : 'Copy Policy Number'}
            </WorkflowButton>
          </>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-base text-ink-supporting">
            <FileText className="size-4 shrink-0" aria-hidden /> No policy number on file — search by last name
          </span>
        )}
      </div>

      <p className="text-base text-ink-supporting">
        Search Gateway with the last name and policy number, then enter what you find.
      </p>
    </div>
  )
}
