'use client'

/**
 * TalkPathCard — the collapsible "what to say on this call" Lego.
 *
 * The talk path is the spoken script the worker reads on THIS call. Before the
 * call it sits collapsed near the Call button so the worker can read what they
 * are about to say before dialing; once the customer is reached it moves below
 * the reach decision and opens, so the script is the next thing in front of
 * them. Collapsed by default, and the WHOLE card is the toggle: click anywhere
 * to open, and click anywhere in the open box to close, so toggling is quick
 * and does not require a precise click on the header.
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

  // The WHOLE card is one toggle button: click anywhere to open when collapsed
  // and anywhere (header or body) to close when expanded, so opening and closing
  // is quick and forgiving rather than needing a precise click on the small
  // header strip. This mirrors the shared cap-panel behavior (the open box is
  // itself the close control). The chevron still shows the direction.
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={toggle}
      className={cn(
        'block w-full rounded-xl border border-surface-border bg-surface-muted text-left transition-colors hover:bg-surface-border/30',
        className,
      )}
    >
      <span className="flex w-full items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-supporting">
          <MessageSquareQuote className="size-3.5 shrink-0" aria-hidden /> {label}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-ink-supporting transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </span>
      {expanded && (
        <span className="block px-3 pb-3">
          <span className={cn('block whitespace-pre-line leading-relaxed text-ink-secondary', bodySizeClassName)}>{body}</span>
        </span>
      )}
    </button>
  )
}
