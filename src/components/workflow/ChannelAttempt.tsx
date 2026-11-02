'use client'

/**
 * ChannelAttempt — the shared plumbing behind the three didn't-reach channel
 * Legos (VoicemailAttempt, TextAttempt, EmailAttempt). See
 * `.kiro/steering/ui-composition-vocabulary.md`: each channel is a Lego that
 * owns its own logic (script display, Yes/No, reasons, the history fragment it
 * emits). A host supplies the context-driven script text and receives back the
 * channel's OUTCOME; the Lego owns everything else.
 *
 * The contract a host consumes (`ChannelOutcome`):
 *   - `status`     — 'done' (Yes), 'skipped' (No + reason), or 'unavailable'
 *                    (grayed: no number, not textable, opted out, no email).
 *   - `touch`      — whether this channel counts as ONE touch (only 'done').
 *   - `fragment`   — the concise history fragment this channel contributes to
 *                    the one grouped attempt, e.g. "Voicemail",
 *                    "No voicemail, mailbox full", "Opted out of texting".
 *   - `note`       — the free-text reason to FOLD INTO the attempt note when the
 *                    worker chose "Other" (reasons are not a structured field;
 *                    reporting is a future query over history/notes).
 *   - `complete`   — whether the worker has answered enough for this channel to
 *                    be recorded (a 'skipped' with "Other" needs typed text).
 *     An 'unavailable' channel is always complete and never gates recording.
 *
 * Reason lists are coded into each Lego as a small constant (see the per-channel
 * files). They are short and stable, so there is deliberately no reasons table:
 * adding a reason is a one-line change that drops in everywhere the Lego is
 * used. Picking a preset reason is enough to record; "Other" always requires
 * typed text before the attempt can be recorded.
 */

import type { ReactNode } from 'react'
import { WorkflowButton } from './primitives'

/** The sentinel value a reason <select> uses for the free-text "Other" branch. */
export const OTHER_REASON = '__other__' as const

export type ChannelStatus = 'done' | 'skipped' | 'unavailable'

/** What a channel Lego reports up to its host. */
export interface ChannelOutcome {
  status: ChannelStatus
  /** Only a completed ('done') channel counts as a touch. */
  touch: boolean
  /** The concise history fragment for the grouped attempt line. */
  fragment: string
  /** Free-text reason to fold into the attempt note (only for an "Other" skip). */
  note: string | null
  /** Whether the worker has answered enough for this channel to be recorded. */
  complete: boolean
}

/** A reason option offered when the worker answers "No" on an available channel. */
export interface ChannelReason {
  /** Stored/compared value. */
  id: string
  /** Shown in the dropdown. */
  label: string
  /** The history fragment when this reason is chosen, e.g. "No voicemail,
   * mailbox full". For OTHER_REASON the fragment is built from the typed text. */
  fragment: string
}

/**
 * The shared "No → why" control. Renders the reason dropdown and, when the
 * worker picks Other, a required free-text box. Pure presentation; the host owns
 * the selected reason + text state and derives the outcome with
 * `resolveChannelOutcome`.
 */
export function ChannelReasonPicker({
  reasons,
  reasonId,
  otherText,
  onReasonChange,
  onOtherTextChange,
  disabled,
  selectId,
  otherLabel = 'Add a reason',
}: {
  reasons: ChannelReason[]
  reasonId: string | null
  otherText: string
  onReasonChange: (id: string | null) => void
  onOtherTextChange: (text: string) => void
  disabled?: boolean
  /** Unique id so the label binds to this instance's select. */
  selectId: string
  otherLabel?: string
}) {
  return (
    <div className="space-y-2">
      <select
        id={selectId}
        value={reasonId ?? ''}
        disabled={disabled}
        onChange={e => onReasonChange(e.target.value || null)}
        className="w-full max-w-xs rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40 disabled:opacity-50"
      >
        <option value="">Why not?</option>
        {reasons.map(r => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
        <option value={OTHER_REASON}>Other</option>
      </select>
      {reasonId === OTHER_REASON && (
        <input
          type="text"
          value={otherText}
          disabled={disabled}
          onChange={e => onOtherTextChange(e.target.value)}
          placeholder={otherLabel}
          aria-label={otherLabel}
          className="w-full max-w-md rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40 disabled:opacity-50"
        />
      )}
    </div>
  )
}

/** The Yes/No pair shared by every channel. */
export function ChannelYesNo({
  question,
  value,
  onChange,
  disabled,
}: {
  question: string
  /** true = Yes (done), false = No (skipped), null = not yet answered. */
  value: boolean | null
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-ink-secondary">{question}</span>
      <WorkflowButton selected={value === true} disabled={disabled} onClick={() => onChange(true)}>Yes</WorkflowButton>
      <WorkflowButton selected={value === false} disabled={disabled} onClick={() => onChange(false)}>No</WorkflowButton>
    </div>
  )
}

/**
 * Derive a channel's OUTCOME from the worker's answers. This is the one place
 * the Yes/No + reason + Other-text collapse into the structured result the host
 * records, so every channel Lego resolves identically.
 *
 *   - unavailable: a grayed channel. It is always complete, never a touch, and
 *     contributes its fixed `unavailableFragment` (e.g. "No email").
 *   - Yes (sent === true): one touch, the channel's `doneFragment` ("Voicemail",
 *     "Texted", "Emailed"), complete.
 *   - No (sent === false): no touch. Requires a selected reason; Other requires
 *     typed text. The fragment is the reason's fragment (or, for Other, the
 *     skip prefix plus the typed text). Incomplete until that is satisfied.
 *   - not yet answered (sent === null): no touch, not complete.
 */
export function resolveChannelOutcome(args: {
  available: boolean
  unavailableFragment: string
  sent: boolean | null
  doneFragment: string
  /** Prefix for an Other skip fragment, e.g. "No voicemail" → "No voicemail, <text>". */
  skipPrefix: string
  reasons: ChannelReason[]
  reasonId: string | null
  otherText: string
}): ChannelOutcome {
  const { available, unavailableFragment, sent, doneFragment, skipPrefix, reasons, reasonId, otherText } = args

  if (!available) {
    return { status: 'unavailable', touch: false, fragment: unavailableFragment, note: null, complete: true }
  }
  if (sent === true) {
    return { status: 'done', touch: true, fragment: doneFragment, note: null, complete: true }
  }
  if (sent === false) {
    if (reasonId === OTHER_REASON) {
      const text = otherText.trim()
      return {
        status: 'skipped',
        touch: false,
        fragment: text ? `${skipPrefix}, ${text}` : skipPrefix,
        note: text || null,
        complete: text.length > 0,
      }
    }
    const reason = reasons.find(r => r.id === reasonId)
    return {
      status: 'skipped',
      touch: false,
      fragment: reason ? reason.fragment : skipPrefix,
      note: null,
      complete: !!reason,
    }
  }
  // Not yet answered.
  return { status: 'unavailable', touch: false, fragment: '', note: null, complete: false }
}

/** A small section wrapper: icon + title above a channel's body. */
export function ChannelSection({
  icon: Icon,
  title,
  children,
}: {
  icon: (props: { className?: string; 'aria-hidden'?: boolean }) => ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
        <Icon className="size-4 text-ink-supporting" aria-hidden /> {title}
      </p>
      {children}
    </div>
  )
}
