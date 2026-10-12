'use client'

/**
 * Shared top header for every internal page.
 *
 * A slim, light bar that spans the content area above the scrolling page body.
 * It carries app-wide, page-independent controls — today, the persistent
 * Mentoring on/off. Mentoring is the purple "how to do it" coaching layer,
 * deliberately distinct from the teal Assistant ("what to do next"); placing its
 * toggle in the shared header makes it available everywhere without touching any
 * page's content or the Assistant itself.
 */

import { MentorToggle } from '@/lib/mentoring/MentorUi'

export function InternalHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-end gap-3 border-b border-surface-border bg-workflow-surface/95 px-4 backdrop-blur sm:px-6">
      <MentorToggle variant="pill" />
    </header>
  )
}
