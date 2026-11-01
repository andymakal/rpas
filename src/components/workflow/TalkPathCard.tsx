'use client'

/**
 * TalkPathCard — the collapsible "what to say on this call" Lego.
 *
 * The talk path is the spoken script the worker reads on THIS call. Before the
 * call it sits collapsed near the Call button so the worker can read what they
 * are about to say before dialing; once the customer is reached it moves below
 * the reach decision and opens, so the script is the next thing in front of
 * them. Collapsed by default: click the header to open, click again to close.
 *
 * Content is fed in (label + body) and this Lego owns only presentation and the
 * open/closed behavior. It carries no knowledge of which workflow or situation
 * produced the script — a host passes the resolved label and body, so the same
 * Lego serves every call workbench and, later, a situation-selected script. The
 * body preserves its own line breaks (read-aloud talk track).
 *
 * `open`/`onOpenChange` make the disclosure controllable so a host can drive it
 * (collapse the top copy and open the lower copy when the call is reached)
 * without a second component; omit them for an uncontrolled, self-toggling card
 * that starts from `defaultOpen` (collapsed unless told otherwise).
 */

import { useEffect, useState } from 'react'
import { MessageSquareQuote, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TalkPathCard({
  label = 'Talk Path',
  body,
  defaultOpen = false,
  open,
  onOpenChange,
  bodySizeClassName = 'text-lg',
  className,
}: {
  /** Short header label. Defaults to "Talk Path". */
  label?: string
  /** The talk track to read aloud. Preserves its own line breaks. */
  body: string
  /** Uncontrolled starting state when `open` is not supplied. Defaults closed. */
  defaultOpen?: boolean
  /** Controlled open state. When supplied, the host owns open/closed. */
  open?: boolean
  /** Controlled open-change handler. Required for the card to toggle when
   * `open` is supplied; omit (with `open`) for a host-forced static state. */
  onOpenChange?: (open: boolean) => void
  /** Tailwind text-size class for the body. Defaults to text-lg for read-aloud
   * legibility. */
  bodySizeClassName?: string
  className?: string
}) {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  // Re-seed the uncontrolled state when the caller's default changes, matching
  // the mentoring disclosure behavior.
  useEffect(() => {
    if (!isControlled) setInternalOpen(defaultOpen)
  }, [defaultOpen, isControlled])

  const expanded = isControlled ? open! : internalOpen
  function toggle() {
    if (isControlled) onOpenChange?.(!expanded)
    else setInternalOpen(v => !v)
  }

  return (
    <div className={cn('rounded-xl border border-surface-border bg-surface-muted', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-supporting">
          <MessageSquareQuote className="size-3.5 shrink-0" aria-hidden /> {label}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-ink-supporting transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <p className={cn('whitespace-pre-line leading-relaxed text-ink-secondary', bodySizeClassName)}>{body}</p>
        </div>
      )}
    </div>
  )
}
