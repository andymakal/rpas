'use client'

/**
 * Servicing Agent status — a small read-only Lego that says whether Right Path
 * is the servicing agent on one policy. It maps the stored `sa_status` onto
 * plain operator wording and never shows the raw stored value:
 *   confirmed   -> "Servicing agent: Yes"
 *   not_on_file -> "Servicing agent: No"
 *   anything else (unknown, missing) -> "Servicing agent: Unknown"
 */

import { cn } from '@/lib/utils'

export type ServicingAgentAnswer = 'yes' | 'no' | 'unknown'

/** Pure mapping from the stored sa_status to the three operator-facing answers. */
export function servicingAgentAnswer(saStatus: string | null | undefined): ServicingAgentAnswer {
  if (saStatus === 'confirmed') return 'yes'
  if (saStatus === 'not_on_file') return 'no'
  return 'unknown'
}

const WORDING: Record<ServicingAgentAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  unknown: 'Unknown',
}

export function ServicingAgentStatus({
  saStatus,
  className,
}: {
  saStatus: string | null | undefined
  className?: string
}) {
  const answer = servicingAgentAnswer(saStatus)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-muted px-2 py-0.5 text-sm font-medium',
        answer === 'yes' ? 'text-ink' : 'text-ink-supporting',
        className,
      )}
    >
      <span className="text-ink-supporting">Servicing agent:</span>
      {WORDING[answer]}
    </span>
  )
}
