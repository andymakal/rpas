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
import { ArrowRight, Phone, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AssistantPanel } from './panels'
import type { DailyDirectionState } from '@/lib/daily-direction/types'

/**
 * The rich Daily Direction briefing for the Stewardship board. Leads with the
 * single Next Best Action and its reason, offers a direct link into the
 * recommended queue, and shows the scannable board breakdown underneath.
 */
export function DailyDirectionBriefing({
  state,
}: {
  state: DailyDirectionState
}) {
  // A single-destination verdict (research_needed / waiting) exposes one route.
  // The 'outreach' verdict deliberately exposes NO single route: calls, emails,
  // and due callbacks are equally eligible, so the UI offers them as co-equal
  // choices instead of a ranked "the next action" button.
  const singleRoute = state.route != null && state.nextActionKind !== 'none'
  const isOutreach = state.nextActionKind === 'outreach'

  return (
    // Built on the shared AssistantPanel shell in its compact density, so the
    // board-top Assistant inherits the canonical teal identity row, heading
    // scale, and spacing from the design system rather than overriding them.
    // The panel owns the "Assistant" label and the heading; everything below is
    // the ready DailyDirectionState the composition resolved.
    <AssistantPanel density="compact" heading={nextActionHeading(state)}>
      {/* The deterministic reason: a plain statement of available work. */}
      <p className="max-w-prose text-base leading-relaxed text-ink-secondary">
        {state.reason}
      </p>

      {/* Single-destination verdicts (research / waiting) get one CTA. */}
      {singleRoute && !isOutreach && (
        <Link href={state.route as string} className={ctaClass}>
          {ctaLabel(state)}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}

      {/* Outreach: equally-eligible options, presented side by side with no
          ranking. Each opens its own queue. */}
      {isOutreach && state.outreachOptions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {state.outreachOptions.map((o) => (
            <Link key={o.queue} href={o.route} className={ctaClass}>
              Open {o.label}
              <span className="rounded-full bg-brand-foreground/20 px-2 text-sm">{o.count}</span>
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      {/* Due date-only callbacks, surfaced distinctly as due work. No time of
          day is shown or implied. Each links into the Ready to Call queue where
          that customer is worked, so the recommendation is directly reachable. */}
      {state.dueCallbacks.length > 0 && (
        <div className="rounded-xl border border-brand-subtle bg-brand-wash p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-brand-hover">
            <Phone className="size-4" aria-hidden />
            Promised callbacks due
          </p>
          <ul className="mt-2 space-y-0.5">
            {state.dueCallbacks.map((cb) => (
              <li key={cb.id}>
                <Link
                  href={cb.route}
                  className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-base hover:bg-surface-card"
                >
                  <span className="font-medium text-ink">{cb.personName}</span>
                  <span className="shrink-0 text-ink-supporting">
                    Promised {formatCallbackDate(cb.callbackDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The scannable board breakdown: the same candidates handed to the
          decision, presented as rows that link into each queue. */}
      {state.availableWork.length > 0 ? (
        <div className="border-t border-surface-border pt-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">
            On the board
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {state.availableWork.map((w) => (
              <li key={w.queue}>
                <Link
                  href={w.route}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-base hover:bg-brand-wash"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-ink">{w.label}</span>
                    {w.kind === 'waiting' && (
                      <span className="text-xs uppercase tracking-wide text-ink-muted">
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
        <div className="flex items-center gap-2 border-t border-surface-border pt-4 text-base text-ink-supporting">
          <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
          The Stewardship board is clear.
        </div>
      )}
    </AssistantPanel>
  )
}

/** Shared teal CTA treatment for the Assistant's links, so every call to action
 * reads identically. Driven by brand tokens, never a per-link restyle. */
const ctaClass =
  'inline-flex w-fit items-center gap-2 rounded-lg bg-brand px-4 py-2 text-base font-semibold ' +
  'text-brand-foreground transition-colors hover:bg-brand-hover'

/** The action-first heading for the recommended next action. */
function nextActionHeading(state: DailyDirectionState): string {
  switch (state.nextActionKind) {
    case 'outreach':
      // Equally-eligible outreach: do not name one channel as "the" action.
      return 'Outreach is ready'
    case 'research_needed':
      return 'Research missing contact information'
    case 'waiting':
      return 'Nothing to push right now'
    case 'none':
      return 'Open capacity'
  }
}

/** The CTA label for a SINGLE-destination verdict (research / waiting). The
 * outreach verdict renders its own co-equal option buttons, not this CTA. */
function ctaLabel(state: DailyDirectionState): string {
  switch (state.nextActionKind) {
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
