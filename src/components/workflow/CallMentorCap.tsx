'use client'

/**
 * CallMentorCap — the inline "why am I doing this call" mentoring Lego.
 *
 * A standalone purple graduation cap that sits right next to the call
 * instruction (the customer-name heading, e.g. "Call Linda Koenig"). The cap is
 * JUST the cap: no label beside it. If the worker is not sure why they are
 * calling, they tap the cap and the mentoring opens inline directly beneath the
 * heading; tapping the open panel closes it back to the cap. This is the
 * "here's why this call, on this workflow" affordance, right at the instruction.
 *
 * Content is fed in (the mentoring body) and this Lego owns only the
 * presentation and the cap's open/close behavior. The body is workbench- and
 * situation-specific (a servicing-agent outreach explains one thing; a
 * mortgage-protection call explains another), so the host passes the resolved
 * content in. The same Lego serves every call workbench and, later, a
 * situation-selected explanation, with no change here.
 *
 * It reuses the shared cap primitives so it honors the global Mentoring toggle
 * exactly like every other mentoring surface: global ON seeds it open, global
 * OFF seeds it closed, and the worker can still toggle this one in between.
 */

import { type ReactNode } from 'react'
import { MentorCapButton, MentorCapPanel, useMentorDisclosure } from '@/lib/mentoring/MentorUi'

export function CallMentorCap({
  heading,
  children,
}: {
  /** The call instruction the cap sits beside, e.g. "Call Linda Koenig". */
  heading: ReactNode
  /** The mentoring content revealed when the cap is opened. */
  children: ReactNode
}) {
  const { open, setOpen } = useMentorDisclosure()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{heading}</h2>
        {!open && <MentorCapButton size="text-lg" onOpen={() => setOpen(true)} label="Why you're calling" />}
      </div>
      {open && <MentorCapPanel onClose={() => setOpen(false)}>{children}</MentorCapPanel>}
    </div>
  )
}
