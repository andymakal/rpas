'use client'

/**
 * VerifyServicingAgentCard — the self-contained "verify servicing agent" Lego.
 *
 * One policy at a time: show the policy number with a Copy button, ask "Are we
 * the servicing agent?", and commit the answer. It is a reusable Lego (per the
 * ui-composition-vocabulary standard): a host supplies the current policy, the
 * remaining-to-check count, and the save/skip intent handlers; the Lego owns all
 * of its own behavior — copy-to-clipboard, the Yes/No selection, the commit
 * gating, and the mentoring. It carries NO data fetching and NO knowledge of
 * where the policies come from, so it can sit on any surface (a My Work verify
 * screen, a project surface, an inbound-call lookup) unchanged.
 *
 * Interaction rules (deliberate, so a stray click never records a wrong answer):
 *   - Yes / No are TOGGLES: clicking selects, clicking the selected one clears,
 *     and the choice is freely switchable. Nothing is recorded by selecting.
 *   - Done is the only commit, and it is disabled until a choice is made.
 *   - Skip leaves the policy unresolved and asks the host for the next one.
 *
 * The count is stated as how many are LEFT to check (counting DOWN the
 * unverified), not how many are done — the operator's question is "how many
 * more", and an empty remaining count is the finish line.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, CircleCheck, CircleX } from 'lucide-react'
import { WorkflowButton, ActionPanel } from './primitives'
import { Divider } from './Divider'
import { CallMentorCap } from './CallMentorCap'
import { DoneSkipActions } from './DoneSkipActions'

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
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  // Clear the pending choice whenever the policy changes, so a selection never
  // carries from one policy to the next.
  useEffect(() => { setChoice(null); setCopied(false) }, [policyNumber])

  const copyNumber = useCallback((value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <ActionPanel>
      {/* Title + mentoring. The how-to lives in the cap, opened on demand. */}
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

      {/* Policy number + Copy. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-supporting">
            Policy number
          </p>
          <span className="font-mono text-2xl font-semibold text-ink">{policyNumber ?? '—'}</span>
        </div>
        <WorkflowButton
          icon={copied ? Check : Copy}
          selected={copied}
          onClick={() => copyNumber(policyNumber ?? '')}
          disabled={!policyNumber}
        >
          {copied ? 'Copied' : 'Copy'}
        </WorkflowButton>
      </div>

      <Divider className="my-2" />

      {/* The question. Yes/No are toggles: nothing commits here. */}
      <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">
        Are we the servicing agent?
      </p>
      <div className="grid grid-cols-2 gap-2">
        <WorkflowButton
          icon={CircleCheck}
          selected={choice === 'yes'}
          disabled={busy}
          className="w-full justify-center"
          onClick={() => setChoice((c) => (c === 'yes' ? null : 'yes'))}
        >
          Yes, we are
        </WorkflowButton>
        <WorkflowButton
          icon={CircleX}
          selected={choice === 'no'}
          disabled={busy}
          className="w-full justify-center"
          onClick={() => setChoice((c) => (c === 'no' ? null : 'no'))}
        >
          No, we are not
        </WorkflowButton>
      </div>

      {/* Done commits the selected answer (grayed until a choice is made); Skip
          leaves it unresolved and moves on. The shared Done/Skip Lego carries
          this behavior identically everywhere. */}
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
