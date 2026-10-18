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
import { GraduationCap, ChevronDown, X } from 'lucide-react'
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
  defaultOpen,
  headerStyle,
  bodyStyle,
}: {
  children: ReactNode
  /** The control's label; defaults to a generic "Mentoring tip". */
  label?: string
  className?: string
  /**
   * Optional override for the default open/closed state. Omit (the normal case)
   * to follow the global Mentoring toggle exactly, as before. When provided, the
   * disclosure seeds from this value and re-seeds whenever it changes, so a host
   * (e.g. the design playground) can force Expanded/Collapsed without a second
   * Mentoring component. The employee can still toggle this one section in
   * between. Purely presentational; the shared toggle behavior is unchanged when
   * this is not passed.
   */
  defaultOpen?: boolean
  /** Optional inline style for the header control (font-size / color overrides).
   * Presentation-only; omit for the standard look. */
  headerStyle?: React.CSSProperties
  /** Optional inline style for the body text (font-size / color overrides).
   * Presentation-only; omit for the standard look. */
  bodyStyle?: React.CSSProperties
}) {
  const { mentoring } = useMentoring()
  // The default open state follows the host override when given, else the global
  // Mentoring toggle. Seed from it and RE-SEED whenever it changes (the required
  // "reset to the selected default" behavior), while still letting the employee
  // toggle this one section in between.
  const seed = defaultOpen ?? mentoring
  const [open, setOpen] = useState(seed)
  useEffect(() => {
    setOpen(seed)
  }, [seed])

  return (
    <div className={cn('rounded-lg border border-purple-200 bg-purple-50/60', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-purple-700"
        style={headerStyle}
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
        <div className="px-3 pb-3 text-base leading-relaxed text-purple-700" style={bodyStyle}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The inline graduation-cap mentoring pattern.
//
// A large purple graduation-cap sits on an item's line; clicking it expands the
// coaching directly beneath the associated content, and closing it restores the
// cap. This is the shared implementation behind My Work's inline mentoring, now
// reused by any surface that wants the same behavior (the Contact Research
// workbench, the shared CustomerContactCard). It is DISTINCT from the
// MentorGuidance disclosure above (a bordered purple box); use the cap where a
// lightweight inline toggle beside the content reads better than a box.
//
// All three honor the global Mentoring on/off exactly like MentorGuidance: the
// open/closed DEFAULT follows the global toggle, flipping the global toggle
// re-seeds every cap to the new default, and an employee can still open or close
// one item independently between global changes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-item cap disclosure state, seeded from the GLOBAL Mentoring toggle. Global
 * ON -> expanded, global OFF -> collapsed; a global change re-seeds every cap to
 * the new default, while a worker can still toggle one item in between.
 */
export function useMentorDisclosure(): { open: boolean; setOpen: (v: boolean) => void } {
  const { mentoring } = useMentoring()
  const [open, setOpen] = useState(mentoring)
  useEffect(() => {
    setOpen(mentoring)
  }, [mentoring])
  return { open, setOpen }
}

/** The inline cap button (collapsed state): a large purple graduation-cap on the
 * item's line. Clicking it expands the coaching beneath the item. */
export function MentorCapButton({ onOpen, label = 'Show mentoring tip' }: { onOpen: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={false}
      onClick={onOpen}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-purple-500 transition-colors hover:bg-purple-100 hover:text-purple-700"
    >
      <GraduationCap className="size-8" aria-hidden />
    </button>
  )
}

/** The expanded coaching panel, rendered beneath the item. Closing it restores
 * the cap icon. */
export function MentorCapPanel({
  children, onClose, className,
}: {
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm leading-relaxed text-purple-800',
        className,
      )}
    >
      <GraduationCap className="mt-0.5 size-8 shrink-0 text-purple-500" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        aria-label="Hide mentoring tip"
        aria-expanded
        onClick={onClose}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-purple-500 transition-colors hover:bg-purple-100 hover:text-purple-700"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
