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

/** The persistent Mentoring on/off control, shown in the shared top header.
 * Reads/writes the shared context so it stays in sync with the coaching notes
 * pages render. A light pill carrying the purple Mentor identity. The `variant`
 * prop is kept for future placements; today only the header pill is used. */
export function MentorToggle({ variant = 'pill' }: { variant?: 'pill' }) {
  const { mentoring, setMentoring } = useMentoring()
  void variant

  return (
    <button
      type="button"
      role="switch"
      aria-checked={mentoring}
      onClick={() => setMentoring(!mentoring)}
      title={mentoring ? 'Mentoring is on — coaching tips are shown' : 'Mentoring is off'}
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
        'flex items-start gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-base leading-relaxed text-purple-700',
        className,
      )}
    >
      <GraduationCap className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
