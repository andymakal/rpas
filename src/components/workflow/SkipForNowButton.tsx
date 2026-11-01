'use client'

/**
 * SkipForNowButton — the one shared "do nothing and move to the next" Lego.
 *
 * "Skip for now" means exactly one thing everywhere it appears: record nothing,
 * change no status, touch no follow-up date, send this item to the back of the
 * working sequence, and advance to the next one. The label and the meaning are
 * fixed here so no surface reinvents either. The host supplies the advance
 * handler (`onSkip`); the Lego owns the label, icon, and treatment.
 */

import { SkipForward } from 'lucide-react'
import { WorkflowButton } from './primitives'

export function SkipForNowButton({
  onSkip,
  disabled,
  className,
}: {
  onSkip: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <WorkflowButton icon={SkipForward} disabled={disabled} onClick={onSkip} className={className}>
      Skip for now
    </WorkflowButton>
  )
}
