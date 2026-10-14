'use client'

/**
 * Shared Mentoring UI: the persistent toggle and the small purple coaching note.
 *
 * The Mentor identity is purple (GraduationCap), deliberately distinct from the
 * teal Assistant, so a worker can tell "what to do" (Assistant) from "how to do
 * it" (Mentor) at a glance. These are the single shared implementations used by
 * the app chrome (Sidebar toggle) and by pages that render coaching notes.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { GraduationCap, ChevronDown } from 'lucide-react'
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
        // Match IPF's Mentoring indicator exactly:
        //   ON  = dark purple fill, white text.
        //   OFF = pale purple fill, purple border + purple text.
        mentoring
          ? 'border-purple-600 bg-purple-600 text-white'
          : 'border-purple-300 bg-purple-50 text-purple-700',
      )}
    >
      <GraduationCap className="size-3.5" aria-hidden />
      Mentoring {mentoring ? 'on' : 'off'}
      <span
        className={cn(
          'ml-0.5 inline-flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors',
          mentoring ? 'bg-white/40' : 'bg-purple-300',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'size-2.5 rounded-full transition-transform',
            mentoring ? 'translate-x-2.5 bg-white' : 'bg-purple-600',
          )}
        />
      </span>
    </button>
  )
}

/** One line of Mentor guidance: small purple contextual coaching on HOW to
 * approach the work. The CALLER decides whether to render it; it pairs an icon
 * with text so it never relies on color alone. Used as the body of a
 * MentorGuidance disclosure, and still available standalone. */
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

/**
 * A collapsible section of Mentor guidance, mirroring the IPF GuidanceCard
 * disclosure (guidance-context + GuidanceCard): wherever mentoring content
 * exists, its own purple control is ALWAYS visible — the global toggle no longer
 * hides the content outright, it only sets the DEFAULT open/closed state.
 *
 * Behavior (the corrected Mentoring model):
 *   - The individual purple control renders whenever there is content, global on
 *     or off. Global OFF never removes the control, only collapses the body.
 *   - Default open state follows the global Mentoring toggle: ON -> expanded,
 *     OFF -> collapsed.
 *   - The employee can expand or collapse this one section independently of the
 *     global setting.
 *   - Changing the global toggle RESETS every section to the new default. That
 *     reset is achieved by keying the local open-state to the global value, so
 *     a global change re-seeds each section from the new default while leaving
 *     the employee's within-mode choices intact until the next global change.
 *
 * This adds no new data and changes no workflow; it is purely how existing
 * coaching content discloses.
 */
export function MentorGuidance({
  children,
  label = 'Mentoring tip',
  className,
}: {
  children: ReactNode
  /** The control's label; defaults to a generic "Mentoring tip". */
  label?: string
  className?: string
}) {
  const { mentoring } = useMentoring()
  // Seed the open state from the global default, and RE-SEED whenever the global
  // toggle changes (the required "reset to the selected default" behavior),
  // while still letting the employee toggle this one section in between.
  const [open, setOpen] = useState(mentoring)
  useEffect(() => {
    setOpen(mentoring)
  }, [mentoring])

  return (
    <div className={cn('rounded-lg border border-purple-200 bg-purple-50/60', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-purple-700"
      >
        <span className="flex items-center gap-1.5">
          <GraduationCap className="size-4 shrink-0" aria-hidden />
          {label}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && (
        <div className="px-3 pb-3 text-base leading-relaxed text-purple-700">
          {children}
        </div>
      )}
    </div>
  )
}
