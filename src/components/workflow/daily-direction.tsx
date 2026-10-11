'use client'

/**
 * Daily Direction Assistant presence (Right Path).
 *
 * Ported from the IPF Assistant presentation pattern
 * (src/components/responsibility-queue/daily-direction-assistant.tsx +
 * assistant-notice.tsx), rebuilt on Right Path's own light-theme workflow
 * tokens (brand teal) rather than importing IPF styling.
 *
 * This is the ASSISTANT: a system-state explanation of what deserves attention
 * next and why, with a direct link into the existing Stewardship queues. It is a
 * DISTINCT concept from Mentoring (coaching). The Assistant tells the worker
 * what is next; Mentoring teaches. Do not merge them.
 *
 * The component does NO business judgment and NO data access: it renders the
 * ready DailyDirectionState the server composition resolved (the ZEN verdict,
 * the deterministic reason, the route, and the board breakdown). Date-only
 * callbacks are shown as a date-only due priority, never as an exact-time
 * commitment.
 */

import Link from 'next/link'
import { Sparkles, ArrowRight, Phone, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DailyDirectionState } from '@/lib/daily-direction/types'

/**
 * The rich Daily Direction briefing for the Stewardship board. Leads with the
 * single Next Best Action and its reason, offers a direct link into the
 * recommended queue, and shows the scannable board breakdown underneath.
 */
export function DailyDirectionBriefing({
  state,
  className,
}: {
  state: DailyDirectionState
  className?: string
}) {
  const hasAction = state.route != null && state.nextActionKind !== 'none'

  return (
    <section
      aria-label="Assistant"
      className={cn(
        'rounded-2xl border border-brand-subtle bg-surface-card p-5 sm:p-6',
        className,
      )}
    >
      {/* Assistant identity row. This is the Assistant surface, labeled as such,
          deliberately separate from any Mentoring/coaching treatment. */}
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand-hover">
          Assistant
        </p>
      </div>

      {/* The single Next Best Action heading + deterministic reason. */}
      <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-ink">
        {nextActionHeading(state)}
      </h2>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-secondary">
        {state.reason}
      </p>

      {hasAction && (
        <Link
          href={state.route as string}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
        >
          {ctaLabel(state)}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}

      {/* Due date-only callbacks, surfaced distinctly as a kept-commitment
          priority. No time of day is shown or implied. */}
      {state.dueCallbacks.length > 0 && (
        <div className="mt-5 rounded-xl border border-brand-subtle bg-brand-wash p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-hover">
            <Phone className="size-3.5" aria-hidden />
            Promised callbacks due
          </p>
          <ul className="mt-2 space-y-1.5">
            {state.dueCallbacks.map((cb) => (
              <li key={cb.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-ink">{cb.personName}</span>
                <span className="shrink-0 text-ink-supporting">
                  Promised {formatCallbackDate(cb.callbackDate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The scannable board breakdown: the same candidates handed to the
          decision, presented as rows that link into each queue. */}
      {state.availableWork.length > 0 ? (
        <div className="mt-5 border-t border-surface-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-supporting">
            On the board
          </p>
          <ul className="mt-2 space-y-1">
            {state.availableWork.map((w) => (
              <li key={w.queue}>
                <Link
                  href={w.route}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-wash"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-ink">{w.label}</span>
                    {w.kind === 'waiting' && (
                      <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                        waiting
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-semibold',
                      w.kind === 'action' ? 'text-brand-hover' : 'text-ink-supporting',
                    )}
                  >
                    {w.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2 border-t border-surface-border pt-4 text-sm text-ink-supporting">
          <CheckCircle2 className="size-4 text-status-confirmed" aria-hidden />
          The Stewardship board is clear.
        </div>
      )}
    </section>
  )
}

/** The action-first heading for the recommended next action. */
function nextActionHeading(state: DailyDirectionState): string {
  switch (state.nextActionKind) {
    case 'callback_due':
      return state.actionCount === 1
        ? 'Return a promised callback'
        : `Return ${state.actionCount} promised callbacks`
    case 'ready_to_call':
      return state.actionCount === 1 ? 'Make one call' : `Make ${state.actionCount} calls`
    case 'ready_to_email':
      return state.actionCount === 1
        ? 'Send one servicing-agent email'
        : `Send ${state.actionCount} servicing-agent emails`
    case 'research_needed':
      return 'Research missing contact information'
    case 'waiting':
      return 'Nothing to push right now'
    case 'none':
      return 'Open capacity'
  }
}

/** The CTA label linking into the recommended queue. */
function ctaLabel(state: DailyDirectionState): string {
  switch (state.nextActionKind) {
    case 'callback_due':
      return 'Open Ready to Call'
    case 'ready_to_call':
      return 'Open Ready to Call'
    case 'ready_to_email':
      return 'Open Ready to Email'
    case 'research_needed':
      return 'Open Research Needed'
    case 'waiting':
      return 'View waiting work'
    default:
      return 'Open the board'
  }
}

/**
 * Format a date-only callback date for display. Date in, date out: no time of
 * day is shown, because Right Path records none for these callbacks.
 */
function formatCallbackDate(iso: string): string {
  // iso is YYYY-MM-DD (date-only). Parse as local midnight to avoid any zone
  // shift that could change the displayed day.
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
