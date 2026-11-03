'use client'

/**
 * CallContextCard — the "what is this call, and what happened last" Lego.
 *
 * Sits directly under the panel heading on a call surface and answers two
 * questions before the worker dials: what kind of call this is (the prominent
 * call-number tag, e.g. "First Outreach Call") and what happened on the
 * previous attempt (one plain reason line, e.g. "Introductory email sent Oct
 * 21. No response yet."). Both are plain presentation inputs: the host resolves
 * them from the customer's attempt history and reason facts and passes strings
 * in, so this Lego owns only the presentation and stays reusable across call
 * surfaces (it carries no knowledge of the internal task-detail shape).
 */

import { CircleAlert } from 'lucide-react'
import { OperationalTag } from './primitives'

export function CallContextCard({
  label,
  reason,
}: {
  /** The call-number / kind tag, e.g. "First Outreach Call". */
  label: string
  /** One-line summary of the previous attempt / why this call is due. Omitted
   * or null renders just the tag. */
  reason?: string | null
}) {
  return (
    <div className="space-y-1">
      <OperationalTag tone="reason">
        <CircleAlert className="mr-1.5 size-4" aria-hidden /> {label}
      </OperationalTag>
      {reason && <p className="text-sm text-ink-secondary">{reason}</p>}
    </div>
  )
}
