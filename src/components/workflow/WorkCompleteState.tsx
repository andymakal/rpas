'use client'

/**
 * WorkCompleteState — the shared "all caught up" panel at the end of a
 * continuous working screen (Calls Due, Introductory Emails, Servicing Access,
 * People We Can't Call, and any screen of the same shape).
 *
 * One Lego for the finish line so every working screen ends the same way: a
 * confirmation icon, a title and a sentence (the host words these; they differ
 * between "you finished a run" and "there was nothing to do"), a way back to My
 * Work, a Check again control, and a quiet marker naming the activity.
 *
 * It owns the presentation only. The host supplies the wording and what "Check
 * again" does (reset the session and reload the list).
 */

import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react'

export function WorkCompleteState({
  title,
  body,
  onCheckAgain,
  footerIcon: FooterIcon,
  footerLabel,
  backHref = '/my-work',
}: {
  title: ReactNode
  body: ReactNode
  /** Look again for newly-available work without leaving the screen. */
  onCheckAgain: () => void
  /** Icon for the quiet activity marker at the bottom. */
  footerIcon: ComponentType<{ className?: string }>
  /** Name of the activity, shown in the quiet marker. */
  footerLabel: string
  backHref?: string
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
      <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
      <div className="space-y-1">
        <p className="text-xl font-semibold text-ink">{title}</p>
        <p className="text-lg text-ink-secondary">{body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-hover"
        >
          <ArrowLeft className="size-5" aria-hidden /> Back to My Work
        </Link>
        <button
          type="button"
          onClick={onCheckAgain}
          className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong px-5 py-3 text-lg font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <RefreshCw className="size-5" aria-hidden /> Check again
        </button>
      </div>
      <p className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
        <FooterIcon className="size-4" aria-hidden /> {footerLabel}
      </p>
    </div>
  )
}
