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
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">{label}</h2>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
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
        empty ? 'cursor-default opacity-55' : 'hover:bg-teal-50/50',
      )}
    >
      <span className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-xl',
        empty ? 'bg-slate-200 text-slate-400'
          : tone === 'action' ? 'bg-teal-100 text-teal-700'
            : 'bg-blue-50 text-blue-600',
      )}>
        <Icon className="size-6" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold leading-tight text-slate-900">{label}</span>
        {tag && <span className="mt-1 block text-[15px] text-slate-600">{tag}</span>}
      </span>

      <span className={cn(
        'shrink-0 text-[2.5rem] font-semibold leading-none tabular-nums',
        empty ? 'text-slate-300' : 'text-slate-900',
      )}>
        {count}
      </span>

      <ChevronRight
        className={cn('size-6 shrink-0 transition-colors',
          empty ? 'text-transparent' : 'text-slate-300 group-hover:text-teal-500')}
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
        <span className="flex size-12 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
          <Icon className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{label}</h1>
        <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-teal-100 px-4 py-1 text-xl font-bold tabular-nums text-teal-800">
          {count}
        </span>
      </div>
      <p className="max-w-3xl text-xl leading-relaxed text-slate-600">{blurb}</p>
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
      className="group flex w-full items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white px-6 py-6 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/50 focus-visible:border-teal-400 focus-visible:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      <span className="min-w-0 truncate">
        <span className="text-xl font-semibold text-slate-900">{name}</span>
        <span className="px-2 text-slate-400">{'\u00b7'}</span>
        <span className="text-lg text-slate-600">{detail}</span>
      </span>
      {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      <ChevronRight
        className={cn(
          'size-6 shrink-0 text-slate-400 transition-colors group-hover:text-teal-500',
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
    <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-lg text-slate-400">
      {children}
    </p>
  )
}
