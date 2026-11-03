'use client'

/**
 * GatewayLookup — the self-contained "Search Gateway" block shared by every
 * Contact Research surface (project Contact Review and Stewardship Research
 * Needed today, any future surface the same way).
 *
 * It renders the manual-search information a worker copies into Gateway: the
 * customer's last name, and EVERY distinct Allstate policy number reliably on
 * file for that customer, each on its own compact row with its own Copy button.
 * The policy number is the surest key to the right Gateway record; when none is
 * on file the control says so and the worker searches by last name alone.
 *
 * It is behavior only — copy to clipboard and a transient "copied"
 * confirmation. It never reads or writes the customer record and runs no
 * Gateway integration; searching Gateway stays manual. The caller supplies the
 * already-gathered, de-duplicated policy numbers (see
 * `loadGatewayPolicyNumbers`), so the component carries no page-specific data
 * wiring.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, FileText } from 'lucide-react'
import { WorkflowButton } from './primitives'

export function GatewayLookup({
  lastName,
  fallbackName,
  policyNumbers,
}: {
  /** The customer's last name — the primary search term. */
  lastName: string | null
  /** Shown in place of an empty last name (e.g. the full name) so there is
   * always something to copy and search. */
  fallbackName?: string
  /** Every distinct policy number on file for the customer, already
   * de-duplicated and ordered by the caller. Empty when the customer has none. */
  policyNumbers: readonly string[]
}) {
  const last = (lastName ?? '').trim()
  const lastDisplay = last || (fallbackName ?? '').trim()
  const policies = (policyNumbers ?? [])
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
  const hasPolicy = policies.length > 0

  // Which copy control last fired (the last name, or a specific policy by
  // index), so only that one shows its confirmed state.
  const [copied, setCopied] = useState<'last' | `policy-${number}` | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copyValue = useCallback((field: 'last' | `policy-${number}`, value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(field)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 2000)
  }, [])

  return (
    <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
      <p className="text-xl font-bold leading-tight tracking-tight text-brand">Search Gateway</p>
      <p className="text-sm text-ink-supporting">
        Select Other locations, then search by last name and policy number.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <span className="text-xl font-semibold text-ink">{lastDisplay || 'Unknown'}</span>
        <WorkflowButton
          icon={copied === 'last' ? Check : Copy}
          selected={copied === 'last'}
          onClick={() => copyValue('last', lastDisplay)}
          disabled={!lastDisplay}
        >
          {copied === 'last' ? 'Copied' : 'Copy'}
        </WorkflowButton>
      </div>

      {hasPolicy ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink-supporting">
            Available policy number{policies.length > 1 ? 's' : ''}
          </p>
          {policies.map((policy, i) => (
            <div key={`${policy}-${i}`} className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xl font-semibold text-ink">{policy}</span>
              <WorkflowButton
                icon={copied === `policy-${i}` ? Check : Copy}
                selected={copied === `policy-${i}`}
                onClick={() => copyValue(`policy-${i}`, policy)}
              >
                {copied === `policy-${i}` ? 'Copied' : 'Copy'}
              </WorkflowButton>
            </div>
          ))}
        </div>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-base text-ink-supporting">
          <FileText className="size-4 shrink-0" aria-hidden /> No policy number on file — search by last name
        </span>
      )}
    </div>
  )
}
