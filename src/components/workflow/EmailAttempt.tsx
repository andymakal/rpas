'use client'

/**
 * EmailAttempt — the follow-up-email channel Lego for the didn't-reach call
 * flow. See `.kiro/steering/ui-composition-vocabulary.md`: a self-contained
 * Lego that owns the "open prepared email" action, the "Did you send the
 * follow-up email?" Yes/No, the reasons offered on No, and the history fragment
 * it emits. A host supplies the context-driven mailto and the availability, and
 * reads the resolved `ChannelOutcome`.
 *
 * When there is no email address on file the channel is grayed ("No email") and
 * never gates recording. When there IS an address we expect the email to go
 * out, so a No needs a reason: "Chose not to" or "Other" (required text).
 */

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { ChannelUnavailable } from '@/app/(internal)/stewardship/call/ChannelUnavailable'
import { WorkflowButton } from './primitives'
import {
  ChannelSection, ChannelYesNo, ChannelReasonPicker, resolveChannelOutcome,
  type ChannelOutcome, type ChannelReason,
} from './ChannelAttempt'

/** The reasons a follow-up email was not sent when email WAS available. */
export const EMAIL_REASONS: ChannelReason[] = [
  { id: 'chose-not-to', label: 'Chose not to', fragment: 'Not emailed, chose not to' },
]

export interface FollowUpEmailDraft {
  /** true = sent (Yes), false = not sent (No), null = not yet answered. */
  sent: boolean | null
  reasonId: string | null
  otherText: string
  setSent: (v: boolean | null) => void
  setReasonId: (id: string | null) => void
  setOtherText: (t: string) => void
  reset: () => void
}

export function useFollowUpEmailDraft(): FollowUpEmailDraft {
  const [sent, setSentState] = useState<boolean | null>(null)
  const [reasonId, setReasonId] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  return {
    sent, reasonId, otherText,
    // Only a No carries a reason; clear it when the answer becomes Yes or unset.
    setSent: v => { setSentState(v); if (v !== false) { setReasonId(null); setOtherText('') } },
    setReasonId,
    setOtherText,
    reset: () => { setSentState(null); setReasonId(null); setOtherText('') },
  }
}

export function emailOutcome(draft: FollowUpEmailDraft, available: boolean): ChannelOutcome {
  return resolveChannelOutcome({
    available,
    unavailableFragment: 'No email',
    sent: draft.sent,
    doneFragment: 'Emailed',
    skipPrefix: 'Not emailed',
    reasons: EMAIL_REASONS,
    reasonId: draft.reasonId,
    otherText: draft.otherText,
  })
}

export function EmailAttempt({
  draft,
  mailto,
  available,
  unavailableBody,
  disabled,
}: {
  draft: FollowUpEmailDraft
  /** The pre-composed mailto: link (context-driven, built by the host). */
  mailto: string
  available: boolean
  unavailableBody: string
  disabled?: boolean
}) {
  return (
    <ChannelSection icon={Mail} title="Follow-up email">
      {available ? (
        <>
          <a href={mailto} className="block">
            <WorkflowButton icon={Mail}>Open prepared follow-up email</WorkflowButton>
          </a>
          <ChannelYesNo
            question="Did you send the follow-up email?"
            value={draft.sent}
            onChange={draft.setSent}
            disabled={disabled}
          />
          {draft.sent === false && (
            <ChannelReasonPicker
              reasons={EMAIL_REASONS}
              reasonId={draft.reasonId}
              otherText={draft.otherText}
              onReasonChange={draft.setReasonId}
              onOtherTextChange={draft.setOtherText}
              disabled={disabled}
              selectId="email-reason"
              otherLabel="Why no email?"
            />
          )}
        </>
      ) : (
        <ChannelUnavailable body={unavailableBody} />
      )}
    </ChannelSection>
  )
}
