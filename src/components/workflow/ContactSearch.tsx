'use client'

/**
 * ContactSearch — the self-contained "find this person" block shared by every
 * contact-research surface (project Contact Review, Stewardship Research
 * Needed, People We Can't Call, and any future surface the same way). It is the
 * one search Lego: it looks for ANY missing contact detail (email, phone, or
 * mailing address), not a phone specifically.
 *
 * Two sections, each a lookup destination with the terms that destination
 * needs, copyable one click at a time:
 *
 *   1. Search Gateway — the manual Allstate look-up. Last name + every distinct
 *      policy number on file (the surest key to the right record).
 *   2. Fast People Search — a free people finder. The customer's full name +
 *      city and state (fastpeoplesearch.com takes name + city/state, NOT the
 *      street or ZIP). Opens the site in a new tab.
 *
 * Behavior only: copy to clipboard, a transient "copied" confirmation, and open
 * the external site. It never reads or writes the customer record and runs no
 * integration — the worker reads the result and types what they find into the
 * Customer Contact card. The caller supplies the already-gathered terms.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, FileText, ExternalLink } from 'lucide-react'
import { WorkflowButton } from './primitives'

const FAST_PEOPLE_SEARCH_URL = 'https://www.fastpeoplesearch.com/'

type CopyKey = 'gw-last' | `gw-policy-${number}` | 'fps-name' | 'fps-location'

export function ContactSearch({
  lastName,
  firstName,
  fallbackName,
  policyNumbers,
  city,
  state,
}: {
  /** The customer's last name — the Gateway primary search term. */
  lastName: string | null
  /** The customer's first name, combined with last for the Fast People Search
   * full-name term. Optional; omitted falls back to the last name alone. */
  firstName?: string | null
  /** Shown in place of an empty last name (e.g. the full name) so there is
   * always something to copy and search. */
  fallbackName?: string
  /** Every distinct policy number on file, de-duplicated and ordered by the
   * caller. Empty when the customer has none. */
  policyNumbers: readonly string[]
  /** The customer's city, for the Fast People Search location term. */
  city?: string | null
  /** The customer's state, for the Fast People Search location term. */
  state?: string | null
}) {
  const last = (lastName ?? '').trim()
  const lastDisplay = last || (fallbackName ?? '').trim()
  const first = (firstName ?? '').trim()
  const fullName = [first, last].filter(Boolean).join(' ') || (fallbackName ?? '').trim()
  const cityState = [city?.trim(), state?.trim()].filter(Boolean).join(', ')
  const policies = (policyNumbers ?? []).map((p) => (p ?? '').trim()).filter((p) => p.length > 0)
  const hasPolicy = policies.length > 0

  const [copied, setCopied] = useState<CopyKey | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copyValue = useCallback((field: CopyKey, value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(field)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 2000)
  }, [])

  const copyBtn = (field: CopyKey, value: string, disabled = false) => (
    <WorkflowButton
      icon={copied === field ? Check : Copy}
      selected={copied === field}
      onClick={() => copyValue(field, value)}
      disabled={disabled}
    >
      {copied === field ? 'Copied' : 'Copy'}
    </WorkflowButton>
  )

  return (
    <div className="space-y-4">
      {/* 1. Gateway */}
      <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
        <p className="text-xl font-bold leading-tight tracking-tight text-brand">Search Gateway</p>
        <p className="text-sm text-ink-supporting">
          Select Other locations, then search by last name and policy number.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-xl font-semibold text-ink">{lastDisplay || 'Unknown'}</span>
          {copyBtn('gw-last', lastDisplay, !lastDisplay)}
        </div>

        {hasPolicy ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink-supporting">
              Policy number{policies.length > 1 ? 's' : ''}
            </p>
            {policies.map((policy, i) => (
              <div key={`${policy}-${i}`} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xl font-semibold text-ink">{policy}</span>
                {copyBtn(`gw-policy-${i}`, policy)}
              </div>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-base text-ink-supporting">
            <FileText className="size-4 shrink-0" aria-hidden /> No policy number on file — search by last name
          </span>
        )}
      </div>

      {/* 2. Fast People Search */}
      <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
        <a
          href={FAST_PEOPLE_SEARCH_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xl font-bold leading-tight tracking-tight text-brand transition-colors hover:text-brand-hover"
        >
          Fast People Search <ExternalLink className="size-4" aria-hidden />
        </a>
        <p className="text-sm text-ink-supporting">
          Search by full name and city and state (not the street or ZIP).
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-xl font-semibold text-ink">{fullName || 'Unknown'}</span>
          {copyBtn('fps-name', fullName, !fullName)}
        </div>

        {cityState ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xl font-semibold text-ink">{cityState}</span>
            {copyBtn('fps-location', cityState)}
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-base text-ink-supporting">
            <FileText className="size-4 shrink-0" aria-hidden /> No city/state on file — search by name
          </span>
        )}
      </div>
    </div>
  )
}
