'use client'

/**
 * VoicemailAttempt — the voicemail channel Lego for the didn't-reach call flow.
 * See `.kiro/steering/ui-composition-vocabulary.md`: a self-contained Lego that
 * owns the voicemail script display, the "Did you leave a voicemail?" Yes/No,
 * the reasons offered on No, and the history fragment it emits. A host supplies
 * the context-driven script text and a draft, and reads the resolved
 * `ChannelOutcome`; the Lego owns everything else.
 *
 * A landline is deliberately NOT a reason here: a landline can still carry an
 * answering machine, so it never prevents leaving a voicemail. Landline affects
 * the TEXT channel, not this one.
 *
 * The reason list below is the single place to extend: add one entry and it
 * appears in the dropdown and reads correctly in history everywhere this Lego
 * is used. "Other" opens a required free-text box (see ChannelAttempt).
 */

import { useState } from 'react'
import { Voicemail } from 'lucide-react'
import { CallScriptCard } from '@/app/(internal)/stewardship/call/CallScriptCard'
import { ChannelUnavailable } from '@/app/(internal)/stewardship/call/ChannelUnavailable'
import {
  ChannelSection, ChannelYesNo, ChannelReasonPicker, resolveChannelOutcome,
  type ChannelOutcome, type ChannelReason,
} from './ChannelAttempt'

/** The reasons a voicemail was not left. Extend here; drops in everywhere. */
export const VOICEMAIL_REASONS: ChannelReason[] = [
  { id: 'mailbox-full',    label: 'Mailbox full',        fragment: 'No voicemail, mailbox full' },
  { id: 'mailbox-not-set', label: 'Mailbox not set up',  fragment: 'No voicemail, mailbox not set up' },
  { id: 'chose-not-to',    label: 'Chose not to',        fragment: 'No voicemail, chose not to' },
]

export interface VoicemailDraft {
  /** true = left (Yes), false = not left (No), null = not yet answered. */
  left: boolean | null
  reasonId: string | null
  otherText: string
  setLeft: (v: boolean | null) => void
  setReasonId: (id: string | null) => void
  setOtherText: (t: string) => void
  reset: () => void
}

export function useVoicemailDraft(): VoicemailDraft {
  const [left, setLeftState] = useState<boolean | null>(null)
  const [reasonId, setReasonId] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  return {
    left, reasonId, otherText,
    // Only a No carries a reason; clear any stale reason when the answer becomes
    // Yes or is toggled back to unset, so the outcome stays coherent.
    setLeft: v => { setLeftState(v); if (v !== false) { setReasonId(null); setOtherText('') } },
    setReasonId,
    setOtherText,
    reset: () => { setLeftState(null); setReasonId(null); setOtherText('') },
  }
}

/** Resolve the draft (plus availability) into the outcome the host records. */
export function voicemailOutcome(draft: VoicemailDraft, available: boolean): ChannelOutcome {
  return resolveChannelOutcome({
    available,
    unavailableFragment: 'No voicemail',
    sent: draft.left,
    doneFragment: 'Voicemail',
    skipPrefix: 'No voicemail',
    reasons: VOICEMAIL_REASONS,
    reasonId: draft.reasonId,
    otherText: draft.otherText,
  })
}

/**
 * The voicemail channel UI. When the channel is unavailable (no callback number
 * for the caller, so the script can't name a number to call back) it shows the
 * explicit unavailable treatment and records nothing. Otherwise it shows the
 * read-aloud script (no Copy) and the Yes/No, revealing the reason picker on No.
 */
export function VoicemailAttempt({
  draft,
  scriptLabel,
  scriptBody,
  available,
  unavailableBody,
  disabled,
}: {
  draft: VoicemailDraft
  scriptLabel: string
  scriptBody: string
  available: boolean
  unavailableBody: string
  disabled?: boolean
}) {
  return (
    <ChannelSection icon={Voicemail} title="Voicemail">
      {available ? (
        <>
          <CallScriptCard label={scriptLabel} body={scriptBody} hideCopy />
          <ChannelYesNo
            question="Did you leave a voicemail?"
            value={draft.left}
            onChange={draft.setLeft}
            disabled={disabled}
          />
          {draft.left === false && (
            <ChannelReasonPicker
              reasons={VOICEMAIL_REASONS}
              reasonId={draft.reasonId}
              otherText={draft.otherText}
              onReasonChange={draft.setReasonId}
              onOtherTextChange={draft.setOtherText}
              disabled={disabled}
              selectId="vm-reason"
              otherLabel="Why no voicemail?"
            />
          )}
        </>
      ) : (
        <ChannelUnavailable body={unavailableBody} />
      )}
    </ChannelSection>
  )
}
