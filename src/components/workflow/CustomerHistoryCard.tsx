'use client'

/**
 * Customer History — a reusable card over Right Path's existing customer
 * history (case_touches, grouped into interactions by the shared history
 * model). It is NOT a second history store; it displays what the one history
 * system already records.
 *
 * It shows the five most recent interactions newest first, with Show All and
 * its own independent scroll so a long history never pushes the rest of the
 * screen around. Each event reads as what happened, who recorded it, and when
 * (MM/DD/YYYY, h:mm AM/PM). Several communications from one interaction are
 * grouped into one event, while the underlying communications stay available.
 *
 * Above the history it renders the Next History Entry preview: what completing
 * the current work will record. Completing the work records it automatically,
 * so the worker never logs the same activity by hand; the optional notes field
 * is only for anything extra the worker wants attached, not for re-logging the
 * activity.
 *
 * Visually it matches the shared Customer Contact card: the same light section
 * shell, tokens, and heading treatment.
 */

import { useState } from 'react'
import { History, ChevronDown, ChevronUp, CheckCircle2, PhoneCall, Search, FolderPlus, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HistoryEvent } from '@/lib/stewardship/customer-history'
import { formatHistoryTimestamp } from '@/lib/stewardship/customer-history'
import type { NextHistoryEntryPreview } from '@/lib/stewardship/customer-history'

/** How many events show before Show All. */
const PREVIEW_COUNT = 5

// ─────────────────────────────────────────────────────────────────────────────
// Next History Entry preview — what completing the current work will record.
// ─────────────────────────────────────────────────────────────────────────────

export function NextHistoryEntry({
  preview,
  className,
}: {
  /** The concise entry being built, or null when there is nothing to record
   * yet. When null the card shows its heading with a blank state. */
  preview: NextHistoryEntryPreview | null
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-brand-subtle bg-surface-card p-4 font-workflow',
        className,
      )}
      aria-label="Next history entry"
    >
      {/* The single heading for this card — the column no longer repeats it
          above. Matches the Customer Contact card's heading treatment. */}
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-brand" aria-hidden />
        <h3 className="text-[22px] font-semibold leading-tight text-ink">Next history entry</h3>
      </div>

      {/* The concise entry being built, plus the system-generated description
          line it will record — kept consistent with what Customer History will
          actually display. Blank until there is something to record. */}
      {preview?.summary ? (
        <>
          <p className="mt-2 text-base font-medium text-ink">{preview.summary}</p>
          {preview.description && (
            <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
              {preview.description}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-base italic text-ink-muted">Nothing to record yet.</p>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// One history event (one grouped interaction).
// ─────────────────────────────────────────────────────────────────────────────

function HistoryEventRow({
  event,
  actorTimeZone,
}: {
  event: HistoryEvent
  actorTimeZone: string | null
}) {
  const extraDetails = event.communications
    .map((c) => c.detail)
    .filter((d): d is string => !!d && d !== event.summary && d !== event.description)

  const isResearch = event.kind === 'research'
  const isEnrollment = event.kind === 'enrollment'
  // A Customer Interaction workflow milestone (follow-up scheduled/completed,
  // refusal): an administrative outreach event, NOT a telephone call, so it
  // gets its own neutral affordance and never the phone icon.
  const isMilestone = event.kind === 'milestone'

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
            // Enrollment is a project membership event (its own affordance);
            // research and workflow milestones are internal/administrative; a
            // reached contact reads as confirmed; every other contact is a
            // neutral touch.
            isEnrollment || isResearch || isMilestone
              ? 'bg-surface-muted text-ink-supporting'
              : event.reached
                ? 'bg-status-confirmed-fill text-status-confirmed-foreground'
                : 'bg-surface-muted text-ink-supporting',
          )}
          aria-hidden
        >
          {isEnrollment ? (
            <FolderPlus className="size-3" />
          ) : isResearch ? (
            <Search className="size-3" />
          ) : isMilestone ? (
            <CalendarClock className="size-3" />
          ) : (
            <PhoneCall className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-ink">{event.summary}</p>
          <p className="mt-0.5 text-sm text-ink-supporting">
            {event.by ? `${event.by} \u00b7 ` : ''}
            {formatHistoryTimestamp(event.at, actorTimeZone)}
          </p>
          {/* The system-generated description of what the recorded action was,
              shown under the summary/attribution line so the entry explains
              what actually happened. Generated automatically from the recorded
              touch; blank when the recorded information does not support one. */}
          {event.description && (
            <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{event.description}</p>
          )}
          {/* An enrollment names the project it added the customer to. */}
          {isEnrollment && event.projectName && (
            <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{event.projectName}</p>
          )}
          {/* The underlying communications' notes, preserved, when they add
              detail beyond the one-line summary. */}
          {extraDetails.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {extraDetails.map((d, i) => (
                <li key={i} className="text-sm leading-relaxed text-ink-secondary">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer History card.
// ─────────────────────────────────────────────────────────────────────────────

export function CustomerHistoryCard({
  events,
  actorTimeZone = null,
  className,
}: {
  /** The grouped history events, newest first (from buildCustomerHistory). */
  events: HistoryEvent[]
  actorTimeZone?: string | null
  className?: string
}) {
  const [showAll, setShowAll] = useState(false)

  const hasMore = events.length > PREVIEW_COUNT
  const visible = showAll ? events : events.slice(0, PREVIEW_COUNT)

  return (
    <section
      className={cn(
        'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
        className,
      )}
      aria-label="Customer history"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="size-5 text-ink-supporting" aria-hidden />
          <h3 className="text-[22px] font-semibold leading-tight text-ink">Customer history</h3>
        </div>
        {events.length > 0 && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-sm font-medium text-ink-supporting">
            {events.length}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-base italic text-ink-muted">No history recorded yet.</p>
      ) : (
        <>
          {/* Independent scroll: the history scrolls within the card so a long
              history never pushes the rest of the screen. When collapsed the
              five-event preview fits without scrolling; Show All enables the
              scroll region. */}
          <ul
            className={cn(
              'mt-3 divide-y divide-surface-border-strong',
              showAll && 'max-h-[28rem] overflow-y-auto pr-1',
            )}
          >
            {visible.map((e) => (
              <HistoryEventRow key={e.at} event={e} actorTimeZone={actorTimeZone} />
            ))}
          </ul>

          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 inline-flex items-center gap-1.5 text-base font-medium text-brand transition-colors hover:text-brand-hover"
            >
              {showAll ? (
                <>
                  <ChevronUp className="size-4" aria-hidden /> Show recent
                </>
              ) : (
                <>
                  <ChevronDown className="size-4" aria-hidden /> Show all {events.length}
                </>
              )}
            </button>
          )}
        </>
      )}
    </section>
  )
}
