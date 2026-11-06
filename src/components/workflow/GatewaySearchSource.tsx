'use client'

/**
 * GatewaySearchSource — the Search Gateway source Lego.
 *
 * Gateway is the ALLSTATE system, so it can only find a customer who has an
 * Allstate policy. The search key is the last name plus a policy number; the
 * last name alone is never enough. The host decides whether to render this
 * source at all: with no Allstate policy number there is nothing to search, so
 * ContactSearch omits it entirely for a non-customer rather than showing a
 * search that cannot work.
 *
 * Own file per the design-system one-component-per-file rule; composed by the
 * ContactSearch subassembly.
 */

import { FileText } from 'lucide-react'
import { SourceCard, SourceHeader, ValueRow, useCopyField } from './contactSearchShared'

export function GatewaySearchSource({
  lastName,
  fallbackName,
  policyNumbers,
}: {
  lastName: string | null
  /** Shown when the last name is blank (e.g. the full name). */
  fallbackName?: string
  /** Every distinct Allstate policy number on file, de-duplicated by the host.
   * When empty the host should not render this source (nothing to search). */
  policyNumbers: readonly string[]
}) {
  const { copied, copy } = useCopyField()
  const lastDisplay = (lastName ?? '').trim() || (fallbackName ?? '').trim()
  const policies = (policyNumbers ?? []).map((p) => (p ?? '').trim()).filter((p) => p.length > 0)

  return (
    <SourceCard>
      <SourceHeader
        title={<p className="text-lg font-bold leading-tight tracking-tight text-brand">Search Gateway</p>}
      >
        Select Other locations, then search by last name and policy number.
      </SourceHeader>
      <ValueRow field="gw-last" display={lastDisplay} copied={copied} onCopy={copy} disabled={!lastDisplay} />
      {policies.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-supporting">
            Policy number{policies.length > 1 ? 's' : ''}
          </p>
          {policies.map((policy, i) => (
            <ValueRow key={`${policy}-${i}`} field={`gw-policy-${i}`} display={policy} copied={copied} onCopy={copy} mono />
          ))}
        </div>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
          <FileText className="size-4 shrink-0" aria-hidden /> No policy number on file — search by last name
        </span>
      )}
    </SourceCard>
  )
}
