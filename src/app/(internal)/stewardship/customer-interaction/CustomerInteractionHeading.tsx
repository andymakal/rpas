'use client'

import { useEffect, useRef } from 'react'
import { WorkflowPageHeader, WorkflowBackLink } from '@/components/workflow'
import {
  MentorCapButton, MentorCapPanel, useMentorDisclosure,
} from '@/lib/mentoring/MentorUi'

/**
 * The Customer Interaction page heading: the "Customer Interaction" title with
 * the inline graduation-cap mentoring beside it, living in the fixed page
 * heading band (it does not scroll with the work area). Clicking the cap expands
 * the coaching directly beneath the title; the cap/panel follow the global
 * Mentoring toggle like every other inline cap. Kept as its own client component
 * so the server page can render the title + cap together in the fixed heading.
 *
 * When the panel is open, the first scroll of the work area collapses it (and
 * restores the cap so mentoring can be reopened). Scrolling stopping does NOT
 * reopen it. This reuses WorkflowPage's existing scroll container (the sibling
 * `overflow-y-auto` work area) rather than adding any new scroll plumbing.
 */
export function CustomerInteractionHeading() {
  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()
  const headingRef = useRef<HTMLDivElement>(null)

  // While the panel is open, collapse it the moment the employee starts
  // scrolling the work area. The scroll container is WorkflowPage's existing
  // `overflow-y-auto` work area, a sibling of this fixed heading within the
  // shared WorkflowSurface. The listener is only attached while open and is a
  // one-shot close, so it never reopens the panel when scrolling stops.
  useEffect(() => {
    if (!mentorOpen) return
    const heading = headingRef.current
    if (!heading) return

    // Walk up from this heading to the WorkflowSurface (the ancestor that holds
    // both the fixed heading band and the scrolling work area), then take that
    // work area — the one `overflow-y-auto` scroller WorkflowPage renders.
    let scroller: HTMLElement | null = null
    for (let el = heading.parentElement; el; el = el.parentElement) {
      const found = el.querySelector<HTMLElement>(':scope > .overflow-y-auto')
      if (found) { scroller = found; break }
    }
    if (!scroller) return

    const onScroll = () => setMentorOpen(false)
    scroller.addEventListener('scroll', onScroll, { passive: true, once: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [mentorOpen, setMentorOpen])

  return (
    <div ref={headingRef} className="space-y-3">
      <WorkflowPageHeader
        title="Customer Interaction"
        back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        actions={
          !mentorOpen ? (
            <MentorCapButton
              onOpen={() => setMentorOpen(true)}
              label="Show mentoring on customer interaction"
            />
          ) : undefined
        }
      />
      {mentorOpen && (
        <MentorCapPanel
          className="text-[18px] leading-relaxed"
          onClose={() => setMentorOpen(false)}
        >
          <span className="block space-y-2">
            <span className="block">Find a customer in the list or search by name.</span>
            <span className="block">Customers with follow-ups due appear first.</span>
            <span className="block">Open the customer to record a call, email, or text.</span>
            <span className="block">Add important conversation notes and set a follow-up date when needed.</span>
            <span className="block">When finished, return to Conversations.</span>
          </span>
        </MentorCapPanel>
      )}
    </div>
  )
}
