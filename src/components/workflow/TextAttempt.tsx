'use client'

/**
 * TextAttempt — the Hearsay-text channel Lego for the didn't-reach call flow.
 * See `.kiro/steering/ui-composition-vocabulary.md`: a self-contained Lego that
 * owns the text script display (copyable), the "Did you send the text?" Yes/No,
 * the reasons offered on No, and the history fragment it emits. A host supplies
 * the context-driven script and the availability, and reads the resolved
 * `ChannelOutcome`.
 *
 * Availability carries meaning here. Two known-before-the-call conditions gray
 * the channel out, each with its own history fragment, and neither gates
 * recording:
 *   - not a textable number (e.g. a landline)       → "No text"
 *   - the customer opted out of texting (replied STOP) → "Opted out of texting"
 * When the channel IS available, a No needs a reason. The only genuine reasons
 * left are "Chose not to" or "Other" (not-textable / opted-out are already
 * handled as grayed states, so they are never a dropdown pick).
 */

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { CallScriptCard } from '@/app/(internal)/stewardship/call/CallScriptCard'
import { ChannelUnavailable } from '@/app/(internal)/stewardship/call/ChannelUnavailable'
import {
  ChannelSection, ChannelYesNo, ChannelReasonPicker, resolveChannelOutcome,
  type ChannelOutcome, type ChannelReason,
} from './ChannelAttempt'

/** The reasons a text was not sent when texting WAS available. Extend here. */
export const TEXT_REASONS: ChannelReason[] = [
  { id: 'chose-not-to', label: 'Chose not to', fragment: 'Not texted, chose not to' },
]

/** Why the text channel is unavailable, when it is. Drives the grayed fragment. */
export type TextUnavailableReason = 'not-textable' | 'opted-out'

export interface TextDraft {
  /** true = sent (Yes), false = not sent (No), null = not yet answered. */
  sent: boolean | null
  reasonId: string | null
  otherText: string
  setSent: (v: boolean) => void
  setReasonId: (id: string | null) => void
  setOtherText: (t: string) => void
  reset: () => void
}

export function useTextDraft(): TextDraft {
  const [sent, setSentState] = useState<boolean | null>(null)
  const [reasonId, setReasonId] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  return {
    sent, reasonId, otherText,
    setSent: v => { setSentState(v); if (v) { setReasonId(null); setOtherText('') } },
    setReasonId,
    setOtherText,
    reset: () => { setSentState(null); setReasonId(null); setOtherText('') },
  }
}

export function textOutcome(
  draft: TextDraft,
  available: boolean,
  unavailableReason: TextUnavailableReason,
): ChannelOutcome {
  return resolveChannelOutcome({
    available,
    unavailableFragment: unavailableReason === 'opted-out' ? 'Opted out of texting' : 'No text',
    sent: draft.sent,
    doneFragment: 'Texted',
    skipPrefix: 'Not texted',
    reasons: TEXT_REASONS,
    reasonId: draft.reasonId,
    otherText: draft.otherText,
  })
}

export function TextAttempt({
  draft,
  scriptLabel,
  scriptBody,
  available,
  unavailableBody,
  disabled,
}: {
  draft: TextDraft
  scriptLabel: string
  scriptBody: string
  available: boolean
  unavailableBody: string
  disabled?: boolean
}) {
  return (
    <ChannelSection icon={MessageSquare} title="Text (Hearsay)">
      {available ? (
        <>
          <CallScriptCard label={scriptLabel} body={scriptBody} />
          <ChannelYesNo
            question="Did you send the text?"
            value={draft.sent}
            onChange={draft.setSent}
            disabled={disabled}
          />
          {draft.sent === false && (
            <ChannelReasonPicker
              reasons={TEXT_REASONS}
              reasonId={draft.reasonId}
              otherText={draft.otherText}
              onReasonChange={draft.setReasonId}
              onOtherTextChange={draft.setOtherText}
              disabled={disabled}
              selectId="text-reason"
              otherLabel="Why no text?"
            />
          )}
        </>
      ) : (
        <ChannelUnavailable body={unavailableBody} />
      )}
    </ChannelSection>
  )
}
