'use client'

/**
 * DoneSkipActions — the shared "Done / Skip for now" action pair.
 *
 * One Lego for the pattern that recurs across worklist tasks: a primary Done
 * that COMMITS whatever the task has captured (grayed until the task says it is
 * ready), beside a quiet Skip that CANCELS the pending input and advances to the
 * next item. The behavior is identical everywhere it is used — Done records,
 * Skip abandons and moves on — so a surface wires it in one line instead of
 * re-writing the two buttons and their gating each time.
 *
 * It owns only the two controls and their enabled/disabled treatment; the host
 * owns what "commit" and "skip" actually do and when Done is allowed
 * (`canComplete`). Labels default to "Done" / "Skip for now" but are
 * overridable for surfaces whose verb differs (e.g. "Record" / "Skip customer").
 */

import { SkipForward, PenLine } from 'lucide-react'
import { WorkflowButton } from './primitives'

export function DoneSkipActions({
  canComplete,
  busy = false,
  doneLabel = 'Done',
  busyLabel = 'Saving…',
  skipLabel = 'Skip for now',
  onDone,
  onSkip,
}: {
  /** Whether Done is allowed yet (the host decides readiness). Done is grayed
   * until this is true, so a stray click can never commit nothing. */
  canComplete: boolean
  /** A save is in flight: both controls disable and Done shows the busy label. */
  busy?: boolean
  doneLabel?: string
  busyLabel?: string
  skipLabel?: string
  /** Commit the captured input. Only reachable when canComplete and not busy. */
  onDone: () => void
  /** Abandon the pending input and advance to the next item. */
  onSkip: () => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <WorkflowButton
        icon={PenLine}
        selected
        disabled={busy || !canComplete}
        className="w-full justify-center"
        onClick={onDone}
      >
        {busy ? busyLabel : doneLabel}
      </WorkflowButton>
      <WorkflowButton
        icon={SkipForward}
        disabled={busy}
        className="w-full justify-center"
        onClick={onSkip}
      >
        {skipLabel}
      </WorkflowButton>
    </div>
  )
}
