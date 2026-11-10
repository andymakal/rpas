'use client'

/**
 * StatusPanel — the compact "nothing here" / "all done" box for a page section.
 *
 * One Lego for the small status boxes that sit where a list or card would be:
 *   - tone 'empty': a dashed box with one muted line ("No policies to verify...").
 *   - tone 'done':  a teal box with a check, a bold title, and a supporting line.
 *
 * For the full finish line at the end of a continuous working screen (with Back
 * to My Work and Check again), use WorkCompleteState instead.
 */

import type { ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'

export function StatusPanel({
  tone,
  title,
  children,
}: {
  tone: 'empty' | 'done'
  /** Bold heading line. Used by the 'done' tone. */
  title?: ReactNode
  /** The supporting text (the only text for the 'empty' tone). */
  children: ReactNode
}) {
  if (tone === 'done') {
    return (
      <div className="rounded-2xl border border-status-confirmed-border bg-status-confirmed-soft p-8 text-center">
        <CircleCheck className="mx-auto mb-2 size-8 text-teal-700" aria-hidden />
        {title && <p className="text-lg font-semibold text-ink">{title}</p>}
        <p className="mt-1 text-sm text-ink-secondary">{children}</p>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center">
      <p className="text-base text-ink-supporting">{children}</p>
    </div>
  )
}
