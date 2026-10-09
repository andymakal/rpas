'use client'

/**
 * Right Path workflow queue components.
 *
 * Reusable queue-board and queue-list building blocks: the grouped queue
 * section with its label, the compact queue row (board), and the one-line
 * customer card (queue list). Generic and prop-driven so any workflow can reuse
 * them; the 1035 prototype supplies the data and icons.
 */

import type { ComponentType, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type IconType = ComponentType<{ className?: string }>

// ─────────────────────────────────────────────────────────────────────────────
// QueueSection — a labelled group of queue rows on the board.
// ─────────────────────────────────────────────────────────────────────────────

export function QueueSection({
  label, children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">{label}</h2>
      <div className="divide-y divide-surface-divider overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
        {children}
      </div>
    </section>
  )
}

/**
 * A compact board queue row: inline icon, queue name with a short supporting
 * phrase below, a prominent count, and a navigation arrow. Zero-count rows stay
 * visible but subdued and non-interactive.
 */
export function QueueRow({
  icon: Icon,
  label,
  tag,
  count,
  tone = 'action',
  onOpen,
}: {
  icon: IconType
  label: string
  /** Optional supporting phrase below the heading. Omit when the heading alone carries the meaning. */
  tag?: string
  count: number
  /** 'action' queues use teal; 'waiting' queues use the pale-blue surface. */
  tone?: 'action' | 'waiting'
  onOpen?: () => void
}) {
  const empty = count === 0
  return (
    <button
      type="button"
      disabled={empty}
      onClick={onOpen}
      aria-label={`${label}, ${count} ${count === 1 ? 'customer' : 'customers'}.${tag ? ` ${tag}` : ''}`}
      className={cn(
        'group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors',
        empty ? 'cursor-default opacity-55' : 'hover:bg-brand-wash/50',
      )}
    >
      <span className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-xl',
        empty ? 'bg-slate-200 text-ink-muted'
          : tone === 'action' ? 'bg-brand-subtle text-brand-icon'
            : 'bg-tag-info-surface text-tag-info-icon',
      )}>
        <Icon className="size-6" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold leading-tight text-ink">{label}</span>
        {tag && <span className="mt-1 block text-[15px] text-ink-supporting">{tag}</span>}
      </span>

      <span className={cn(
        'shrink-0 text-[2.5rem] font-semibold leading-none tabular-nums',
        empty ? 'text-surface-border-strong' : 'text-ink',
      )}>
        {count}
      </span>

      <ChevronRight
        className={cn('size-6 shrink-0 transition-colors',
          empty ? 'text-transparent' : 'text-surface-border-strong group-hover:text-teal-500')}
        aria-hidden
      />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// QueueListHeader — the heading atop an opened queue list.
// ─────────────────────────────────────────────────────────────────────────────

export function QueueListHeader({
  icon: Icon, label, count, blurb, onBack, backLabel = 'All queues',
}: {
  icon: IconType
  label: string
  count: number
  blurb: ReactNode
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <div className="space-y-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          {'\u2190'} {backLabel}
        </button>
      )}
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-brand-subtle text-brand-icon">
          <Icon className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{label}</h1>
        <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-brand-subtle px-4 py-1 text-xl font-bold tabular-nums text-brand-subtle-foreground">
          {count}
        </span>
      </div>
      <p className="max-w-3xl text-xl leading-relaxed text-ink-supporting">{blurb}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomerQueueCard — a one-line, full-width customer card in a queue list.
//
// Distinct rounded card, clearly visible border, full-card hover/focus, entire
// card clickable, arrow at the far right. An optional trailing slot carries a
// prominent operational tag (reason/status) before the arrow.
// ─────────────────────────────────────────────────────────────────────────────

export function CustomerQueueCard({
  name, detail, trailing, onOpen,
}: {
  name: string
  /** The secondary line content (e.g. "3 holdings in request"). Readable, not pale. */
  detail: ReactNode
  /** Optional prominent tag (e.g. an OperationalTag) shown before the arrow. */
  trailing?: ReactNode
  onOpen?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-2xl border-2 border-surface-border bg-surface-card px-6 py-6 text-left transition-colors hover:border-teal-400 hover:bg-brand-wash/50 focus-visible:border-teal-400 focus-visible:bg-brand-wash/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      <span className="min-w-0 truncate">
        <span className="text-xl font-semibold text-ink">{name}</span>
        <span className="px-2 text-ink-muted">{'\u00b7'}</span>
        <span className="text-lg text-ink-supporting">{detail}</span>
      </span>
      {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      <ChevronRight
        className={cn(
          'size-6 shrink-0 text-ink-muted transition-colors group-hover:text-teal-500',
          trailing ? 'ml-3' : 'ml-auto',
        )}
        aria-hidden
      />
    </button>
  )
}

/** Shared empty-state line for a queue list with no customers. */
export function QueueEmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-surface-border bg-surface-card p-10 text-center text-lg text-ink-muted">
      {children}
    </p>
  )
}
