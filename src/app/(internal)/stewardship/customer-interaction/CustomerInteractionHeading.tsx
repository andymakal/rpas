'use client'

import { WorkflowHeader } from '@/components/workflow'
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
 */
export function CustomerInteractionHeading() {
  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <WorkflowHeader primary="Customer Interaction" />
        {!mentorOpen && (
          <MentorCapButton
            onOpen={() => setMentorOpen(true)}
            label="Show mentoring on customer interaction"
          />
        )}
      </div>
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
