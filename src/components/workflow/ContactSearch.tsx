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
 *      city and state. Name alone finds people; the city/state narrows it. The
 *      title links to the site (opens in a new tab).
 *
 * Behavior only: copy to clipboard, a transient "copied" confirmation, and open
 * the external site. It never reads or writes the customer record — the worker
 * reads the result and types what they find into the Customer Contact card.
 *
 * Instructions are mentoring (the graduation-cap MentorGuidance), not inline
 * body text, and the layout is deliberately compact (tight padding, small Copy
 * buttons sitting beside each value) since this is dense informational content.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Check, FileText, ExternalLink } from 'lucide-react'
import { WorkflowButton } from './primitives'
import { MentorCapButton, MentorCapPanel, useMentorDisclosure } from '@/lib/mentoring/MentorUi'

const FAST_PEOPLE_SEARCH_URL = 'https://www.fastpeoplesearch.com/'

/** One section's title with its own bare mentoring cap: the cap sits beside the
 * title, and tapping it reveals the coaching beneath — the standard inline cap
 * pattern used across the app (just the cap, no label text). Each section has
 * its own disclosure so the two caps open independently. */
function SearchSectionHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { open, setOpen } = useMentorDisclosure()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {title}
        {!open && <MentorCapButton onOpen={() => setOpen(true)} />}
      </div>
      {open && <MentorCapPanel onClose={() => setOpen(false)}>{children}</MentorCapPanel>}
    </div>
  )
}

type CopyKey = 'gw-last' | `gw-policy-${number}` | 'fps-name' | 'fps-location'

export function ContactSearch({
  lastName,
  firstName,
  fallbackName,
  policyNumbers,
  city,
  state,
}: {
  lastName: string | null
  firstName?: string | null
  fallbackName?: string
  policyNumbers: readonly string[]
  city?: string | null
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
      size="sm"
      icon={copied === field ? Check : Copy}
      selected={copied === field}
      onClick={() => copyValue(field, value)}
      disabled={disabled}
    >
      {copied === field ? 'Copied' : 'Copy'}
    </WorkflowButton>
  )

  // One value + its Copy button, tight vertical rhythm (the value and its button
  // sit together, so the rows do not need generous spacing).
  const valueRow = (field: CopyKey, display: string, opts?: { mono?: boolean; disabled?: boolean }) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className={opts?.mono
        ? 'font-mono text-lg font-semibold text-ink'
        : 'text-lg font-semibold text-ink'}>{display || 'Unknown'}</span>
      {copyBtn(field, display, opts?.disabled)}
    </div>
  )

  return (
    <div className="space-y-2.5">
      {/* 1. Gateway */}
      <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-muted/40 p-3">
        <SearchSectionHeader
          title={<p className="text-lg font-bold leading-tight tracking-tight text-brand">Search Gateway</p>}
        >
          Select Other locations, then search by last name and policy number.
        </SearchSectionHeader>
        {valueRow('gw-last', lastDisplay, { disabled: !lastDisplay })}
        {hasPolicy ? (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-supporting">
              Policy number{policies.length > 1 ? 's' : ''}
            </p>
            {policies.map((policy, i) => (
              <div key={`${policy}-${i}`}>{valueRow(`gw-policy-${i}`, policy, { mono: true })}</div>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
            <FileText className="size-4 shrink-0" aria-hidden /> No policy number on file — search by last name
          </span>
        )}
      </div>

      {/* 2. Fast People Search */}
      <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-muted/40 p-3">
        <SearchSectionHeader
          title={
            <a
              href={FAST_PEOPLE_SEARCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-lg font-bold leading-tight tracking-tight text-brand transition-colors hover:text-brand-hover"
            >
              Fast People Search <ExternalLink className="size-4" aria-hidden />
            </a>
          }
        >
          Search by full name and city and state. The name alone often finds the person; the city
          and state narrow it.
        </SearchSectionHeader>
        {valueRow('fps-name', fullName, { disabled: !fullName })}
        {cityState
          ? valueRow('fps-location', cityState)
          : (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
              <FileText className="size-4 shrink-0" aria-hidden /> No city/state on file — search by name
            </span>
          )}
      </div>
    </div>
  )
}
