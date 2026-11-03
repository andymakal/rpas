'use client'

/**
 * VerifyServicingAgentCard — the self-contained "verify servicing agent" Lego.
 *
 * One policy at a time: show the policy number with a Copy button, ask "Are we
 * the servicing agent?", and commit the answer. A host supplies the current
 * policy, the remaining-to-check count, and the save/skip intent handlers; the
 * card carries NO data fetching and NO knowledge of where the policies come
 * from, so it sits on any surface (a My Work verify screen, a project surface,
 * an inbound-call lookup) unchanged.
 *
 * It is pure COMPOSITION of smaller Legos — CopyField (the policy number + Copy),
 * BinaryChoice (the Yes/No toggle), CallMentorCap (the how-to), and
 * DoneSkipActions (commit / abandon) — so every piece of behavior lives in one
 * shared place and this card only wires them together and holds the pending
 * choice. The interaction guarantees come from those Legos: Yes/No only
 * SELECTS (toggle on/off, switchable), and only Done COMMITS (grayed until a
 * choice is made), so a stray click never records a wrong answer.
 *
 * The count is stated as how many are LEFT to check (counting DOWN the
 * unverified); an empty remaining count is the finish line.
 */

import { useEffect, useState } from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { ActionPanel } from './primitives'
import { Divider } from './Divider'
import { CallMentorCap } from './CallMentorCap'
import { DoneSkipActions } from './DoneSkipActions'
import { CopyField } from './CopyField'
import { BinaryChoice } from './BinaryChoice'

export function VerifyServicingAgentCard({
  policyNumber,
  remaining,
  busy = false,
  errorText = null,
  onRecord,
  onSkip,
}: {
  /** The policy number to verify (shown large, with a Copy button). */
  policyNumber: string | null
  /** How many policies are still unverified (counts DOWN to zero). */
  remaining: number
  /** Whether a save is in flight (disables the controls). */
  busy?: boolean
  /** An error to show under the controls, or null. */
  errorText?: string | null
  /** Commit the answer for the current policy: true = we ARE the servicing
   * agent, false = we are NOT. The host persists and advances. */
  onRecord: (isServicingAgent: boolean) => void
  /** Leave the current policy unresolved and move to the next. */
  onSkip: () => void
}) {
  const [choice, setChoice] = useState<'yes' | 'no' | null>(null)

  // Clear the pending choice whenever the policy changes, so a selection never
  // carries from one policy to the next.
  useEffect(() => { setChoice(null) }, [policyNumber])

  return (
    <ActionPanel>
      {/* Title + mentoring (the how-to lives in the cap, opened on demand). */}
      <CallMentorCap heading="Verify servicing agent">
        Copy the policy number, search it in the Everlake Agent Portal Contract Look-Up, then record
        whether a contract was found. If a contract comes up we are the servicing agent; if Everlake
        can’t find it, we are not.
      </CallMentorCap>

      {/* Count DOWN: how many are still to check. */}
      <p className="text-sm font-medium text-ink-secondary">
        <span className="tabular-nums font-semibold text-ink">{remaining}</span>{' '}
        {remaining === 1 ? 'policy' : 'policies'} left to verify
      </p>

      <CopyField
        label="Policy number"
        value={policyNumber}
        mono
        className="rounded-xl border border-surface-border bg-surface-muted/40 p-4"
      />

      <Divider className="my-2" />

      <BinaryChoice
        question="Are we the servicing agent?"
        options={[
          { value: 'yes', label: 'Yes, we are', icon: CircleCheck },
          { value: 'no', label: 'No, we are not', icon: CircleX },
        ]}
        value={choice}
        onChange={setChoice}
        disabled={busy}
      />

      {/* Done commits the selected answer (grayed until a choice is made); Skip
          leaves it unresolved and moves on. */}
      <DoneSkipActions
        canComplete={choice !== null}
        busy={busy}
        onDone={() => { if (choice) onRecord(choice === 'yes') }}
        onSkip={onSkip}
      />

      {errorText && <p className="text-sm text-status-missing-strong">{errorText}</p>}
    </ActionPanel>
  )
}
