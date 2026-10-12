'use client'

/**
 * Bob's light-theme workflow header.
 *
 * A slim light bar that spans the content area above the scrolling page body on
 * Bob's workflow pages ONLY (opted in per route via WorkflowChrome). It carries
 * the page-independent chrome controls:
 *
 * All controls are left-aligned, in order:
 *   1. a collapse toggle for the navy sidebar,
 *   2. a personalized time-of-day greeting (resolved on the actor's clock,
 *      passed in from the server),
 *   3. sign out, and
 *   4. the prominent Mentoring on/off control (the purple "how to do it" layer,
 *      deliberately distinct from the teal Assistant).
 *
 * It never renders on Andy's dark pages, so those keep their original layout.
 */

import { PanelLeftClose, PanelLeftOpen, LogOut } from 'lucide-react'
import { MentorToggle } from '@/lib/mentoring/MentorUi'
import { useSidebarCollapse } from '@/components/layout/SidebarCollapseProvider'
import { useSignOut } from '@/components/layout/use-sign-out'

export function InternalHeader({ greeting }: { greeting: string }) {
  const { collapsed, toggle } = useSidebarCollapse()
  const handleSignOut = useSignOut()

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-surface-border bg-workflow-surface/95 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="inline-flex size-8 items-center justify-center rounded-md border border-surface-border bg-surface-card text-ink-supporting transition-colors hover:border-brand/40 hover:text-brand"
      >
        {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
      </button>

      <p className="truncate text-base font-semibold text-ink">{greeting}</p>

      <button
        type="button"
        onClick={handleSignOut}
        title="Sign out"
        className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 py-1 text-xs font-semibold text-ink-supporting transition-colors hover:border-brand/40 hover:text-brand"
      >
        <LogOut className="size-3.5" aria-hidden />
        Sign out
      </button>

      <MentorToggle variant="pill" />
    </header>
  )
}
