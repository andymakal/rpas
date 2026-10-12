'use client'

/**
 * Shared Mentoring UI: the persistent toggle and the small purple coaching note.
 *
 * The Mentor identity is purple (GraduationCap), deliberately distinct from the
 * teal Assistant, so a worker can tell "what to do" (Assistant) from "how to do
 * it" (Mentor) at a glance. These are the single shared implementations used by
 * the app chrome (Sidebar toggle) and by pages that render coaching notes.
 */

import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMentoring } from './MentoringProvider'

/** The persistent Mentoring on/off control. Reads/writes the shared context, so
 * it can live in the app chrome and stay in sync with coaching notes on pages.
 * `variant='sidebar'` suits the dark sidebar footer; `variant='pill'` is the
 * light standalone pill. */
export function MentorToggle({ variant = 'pill' }: { variant?: 'pill' | 'sidebar' }) {
  const { mentoring, setMentoring } = useMentoring()

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={mentoring}
        onClick={() => setMentoring(!mentoring)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          mentoring
            ? 'bg-purple-500/15 text-purple-200'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
        )}
        title={mentoring ? 'Mentoring is on — coaching tips are shown' : 'Mentoring is off'}
      >
        <GraduationCap className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Mentor</span>
        <span
          className={cn(
            'inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors',
            mentoring ? 'bg-purple-500' : 'bg-slate-700',
          )}
          aria-hidden
        >
          <span className={cn('size-3 rounded-full bg-white transition-transform', mentoring && 'translate-x-3')} />
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={mentoring}
      onClick={() => setMentoring(!mentoring)}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        mentoring
          ? 'border-purple-200 bg-purple-50 text-purple-700'
          : 'border-surface-border bg-surface-card text-ink-supporting hover:border-purple-200 hover:text-purple-700',
      )}
    >
      <GraduationCap className="size-3.5" aria-hidden />
      Mentor {mentoring ? 'on' : 'off'}
      <span
        className={cn(
          'ml-0.5 inline-flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors',
          mentoring ? 'bg-purple-500' : 'bg-surface-border-strong',
        )}
        aria-hidden
      >
        <span className={cn('size-2.5 rounded-full bg-white transition-transform', mentoring && 'translate-x-2.5')} />
      </span>
    </button>
  )
}

/** One line of Mentor guidance: small purple contextual coaching on HOW to
 * approach the work. The CALLER decides whether to render it (only when
 * mentoring is on); it pairs an icon with text so it never relies on color
 * alone. */
export function MentorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs leading-relaxed text-purple-700',
        className,
      )}
    >
      <GraduationCap className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
