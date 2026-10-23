'use client'

/**
 * Relationship Timeline — the improved, OPT-IN presentation over Right Path's
 * one customer history (case_touches, grouped into interactions by the shared
 * `buildCustomerHistory` model). It is NOT a second history store and NOT a
 * data change: it renders exactly the same `HistoryEvent[]` the existing
 * `CustomerHistoryCard` renders, just with a presentation tuned for the active
 * conversation of a Customer Interaction.
 *
 * Why a separate component rather than restyling the shared card: the existing
 * card and its two consumers (the stewardship working screens and Contact
 * Review) must keep their current behavior. This presentation is adopted only
 * where a screen opts in, so nothing else changes.
 *
 * The presentation, per the workflow visual standard, is deliberately simple:
 *   1. A bold teal heading that names the ACTUAL event — "Email Received",
 *      "Email Sent", "Text Received", "Text Sent", "Incoming Call", "Customer
 *      Reached", "No Answer", "Voicemail Left", "Email Undeliverable",
 *      "Follow-up Scheduled", "Follow-up Completed". The heading is derived in
 *      the shared history normalization (`event.timelineHeading`), never a
 *      generic "incoming/outgoing" label; it falls back to the grouped summary
 *      for a legacy record whose direction is unknown, so no direction is
 *      invented.
 *   2. Employee name · date and time directly underneath.
 *   3. The actual message or meaningful detail, when present — with internal
 *      markers (e.g. [inbound]) and redundant channel/prefix boilerplate already
 *      removed by the normalization. Longer messages collapse behind Show more.
 *
 * No repeated customer name, no "Customer history" label per row, and no
 * redundant channel line: the heading already names the event.
 *
 * It reuses `formatHistoryTimestamp` and the `HistoryEvent` shape verbatim, so
 * the one history model remains the single source of truth.
 */

import { useState } from 'react'
import {
  MessageSquareText,
  ArrowDownLeft,
  ArrowUpRight,
  BellOff,
  PhoneCall,
  Search,
  FolderPlus,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HistoryEvent } from '@/lib/stewardship/customer-history'
import { formatHistoryTimestamp } from '@/lib/stewardship/customer-history'

/** How many events show before Show all. */
const PREVIEW_COUNT = 5

/** How many characters of a message show before it collapses behind Show more.
 * Short notes (the common case) never collapse. */
const MESSAGE_CLAMP = 160

// ─────────────────────────────────────────────────────────────────────────────
// Event heading — the bold teal, event-specific title.
// ─────────────────────────────────────────────────────────────────────────────

/** The bold teal heading text for one event: the precise, event-specific
 * heading from the normalization (`timelineHeading`), falling back to the
 * grouped summary for a legacy record whose direction/event is unknown. */
function headingFor(event: HistoryEvent): string {
  return event.timelineHeading ?? event.summary
}

/** The small affordance icon for one event, chosen to match its heading. */
function IconFor({ event }: { event: HistoryEvent }) {
  if (event.kind === 'enrollment') return <FolderPlus className="size-3.5" aria-hidden />
  if (event.kind === 'research') return <Search className="size-3.5" aria-hidden />
  if (event.kind === 'milestone') return <CalendarClock className="size-3.5" aria-hidden />
  if (event.direction === 'incoming') return <ArrowDownLeft className="size-3.5" aria-hidden />
  if (event.direction === 'automated') return <BellOff className="size-3.5" aria-hidden />
  if (event.direction === 'outgoing') return <ArrowUpRight className="size-3.5" aria-hidden />
  return <PhoneCall className="size-3.5" aria-hidden />
}

// ─────────────────────────────────────────────────────────────────────────────
// Expandable message content.
// ─────────────────────────────────────────────────────────────────────────────

function Message({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > MESSAGE_CLAMP
  const shown = !long || expanded ? text : `${text.slice(0, MESSAGE_CLAMP).trimEnd()}\u2026`

  return (
    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">
      {shown}
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-1 inline-flex items-center gap-0.5 align-baseline text-sm font-medium text-brand transition-colors hover:text-brand-hover"
        >
          {expanded ? (
            <>
              Show less <ChevronUp className="size-3.5" aria-hidden />
            </>
          ) : (
            <>
              Show more <ChevronDown className="size-3.5" aria-hidden />
            </>
          )}
        </button>
      )}
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// One timeline event.
// ─────────────────────────────────────────────────────────────────────────────

function TimelineEvent({
  event,
  actorTimeZone,
}: {
  event: HistoryEvent
  actorTimeZone: string | null
}) {
  const heading = headingFor(event)

  // The actual message content, when present: the operator's own notes on the
  // underlying communications (markers/prefix already stripped by the
  // normalization). A system description is shown only when it adds meaning
  // beyond the heading. No redundant channel line — the heading names the event.
  const notes = event.communications
    .map((c) => c.detail)
    .filter((d): d is string => !!d && d !== event.summary && d !== event.description && d !== heading)
  // A system description is shown only when it ADDS meaning beyond the heading.
  // The terse outcome restatements ("Reached the customer.", "Left a
  // voicemail.", "Bad number recorded.") simply echo a heading like "Customer
  // Reached" / "Voicemail Left", so they are suppressed; a richer description
  // (e.g. the introductory email that carried the authorization form) is kept.
  const REDUNDANT_SYSTEM = /^(Reached the customer\.?|Left a voicemail\.?|Bad number recorded\.?)$/i
  const systemLine =
    event.description &&
    event.description !== event.summary &&
    event.description !== heading &&
    !REDUNDANT_SYSTEM.test(event.description.trim())
      ? event.description
      : null
  const projectLine = event.kind === 'enrollment' ? event.projectName ?? null : null

  return (
    <li className="relative py-3 pl-8 first:pt-0 last:pb-0">
      {/* The timeline rail dot. */}
      <span
        className={cn(
          'absolute left-0 top-3 flex size-6 items-center justify-center rounded-full first:top-0',
          event.kind === 'contact' && event.direction === 'incoming'
            ? 'bg-brand-subtle text-brand-icon'
            : 'bg-surface-muted text-ink-supporting',
        )}
        aria-hidden
      >
        <IconFor event={event} />
      </span>

      {/* Bold teal heading. */}
      <p className="text-base font-bold leading-tight text-brand">{heading}</p>

      {/* Employee name and timestamp directly underneath. */}
      <p className="mt-0.5 text-sm text-ink-supporting">
        {event.by ? `${event.by} \u00b7 ` : ''}
        {formatHistoryTimestamp(event.at, actorTimeZone)}
      </p>

      {/* System description of the recorded action, when it adds meaning. */}
      {systemLine && <Message text={systemLine} />}

      {/* An enrollment names its project. */}
      {projectLine && <Message text={projectLine} />}

      {/* Communication content underneath, when present, each expandable. */}
      {notes.map((d, i) => (
        <Message key={i} text={d} />
      ))}
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Relationship Timeline.
// ─────────────────────────────────────────────────────────────────────────────

export function RelationshipTimeline({
  events,
  actorTimeZone = null,
  className,
}: {
  /** The grouped history events, newest first (from buildCustomerHistory). The
   * SAME shape the existing Customer History card consumes. */
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
      aria-label="Relationship timeline"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-5 text-brand" aria-hidden />
          <h3 className="text-[22px] font-semibold leading-tight text-ink">Relationship timeline</h3>
        </div>
        {events.length > 0 && (
          <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-sm font-semibold text-brand-subtle-foreground">
            {events.length}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-base italic text-ink-muted">No history recorded yet.</p>
      ) : (
        <>
          {/* A left rail ties the events into one timeline. Independent scroll
              on Show all so a long history never pushes the rest of the screen. */}
          <ul
            className={cn(
              'relative mt-3',
              // The vertical rail behind the dots.
              'before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-surface-border-strong',
              showAll && 'max-h-[28rem] overflow-y-auto pr-1',
            )}
          >
            {visible.map((e) => (
              <TimelineEvent key={`${e.at}-${e.kind ?? 'contact'}`} event={e} actorTimeZone={actorTimeZone} />
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
