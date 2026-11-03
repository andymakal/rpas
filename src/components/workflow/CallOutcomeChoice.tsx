'use client'

/**
 * CallOutcomeChoice — the four universal reached-call outcomes Lego.
 *
 * Every call screen, once the customer is reached, resolves to exactly one of
 * four outcomes, and only these four. There is no fifth:
 *
 *   - Advance — proceed with the intent of the call.
 *   - Decline — the customer says no; outreach stops (reversibly).
 *   - Defer   — not now; follow up later.
 *   - Divert  — the customer is still engaged, but the right next move is
 *               something else (e.g. email a quote, reopen as a different review).
 *
 * They are laid out as a 2x2: the clean yes/no on the top row (Advance /
 * Decline), the not-a-clean-yes/no pair on the bottom (Defer / Divert). The four
 * categories and their positions are FIXED and situation-independent; this Lego
 * is the single control used on every call workbench.
 *
 * What VARIES per situation is (a) each button's LABEL and (b) what happens
 * after it is chosen. Per the UI composition vocabulary, this Lego owns only the
 * four-button display and the toggle behavior: a host passes the labels (a
 * situation table supplies them — e.g. Advance → "Agreed to authorize" on a
 * servicing call, "Agreed to an appointment" on a referral), the current
 * selection, and a select handler, and owns the downstream action for each
 * outcome. The Lego fetches nothing and decides nothing about what an outcome
 * means.
 *
 * Selection is a toggle: choosing the already-selected outcome clears it (the
 * host typically uses that to restore the talk path / reopen the choice).
 */

import { Check, CircleAlert, Clock, Shuffle } from 'lucide-react'
import { WorkflowButton } from './primitives'

/** The four universal reached-call outcome categories. Fixed; never extended. */
export type CallOutcomeChoiceValue = 'advance' | 'decline' | 'defer' | 'divert'

/** Per-situation labels for the four outcomes. Omit any to use the universal
 * placeholder word, so a bare caller still renders a sensible control. */
export type CallOutcomeLabels = Partial<Record<CallOutcomeChoiceValue, string>>

const DEFAULT_LABELS: Record<CallOutcomeChoiceValue, string> = {
  advance: 'Advance',
  decline: 'Decline',
  defer: 'Defer',
  divert: 'Divert',
}

export function CallOutcomeChoice({
  selected,
  onSelect,
  labels,
  heading = 'What did the customer decide?',
  disabled = false,
}: {
  /** The currently chosen outcome, or null when none is chosen yet. */
  selected: CallOutcomeChoiceValue | null
  /** Called with the chosen outcome, or null when the selected one is toggled
   * off. The host owns what each outcome does next. */
  onSelect: (value: CallOutcomeChoiceValue | null) => void
  /** Per-situation button labels; any omitted falls back to the universal word. */
  labels?: CallOutcomeLabels
  /** The section heading above the grid. */
  heading?: string
  disabled?: boolean
}) {
  const l = { ...DEFAULT_LABELS, ...labels }
  const toggle = (v: CallOutcomeChoiceValue) => onSelect(selected === v ? null : v)

  return (
    <div>
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">{heading}</p>
      {/* 2x2: Advance / Decline (the clean yes/no) on top, Defer / Divert on the
          bottom. Positions are fixed; only the labels vary by situation. */}
      <div className="grid grid-cols-2 gap-2">
        <WorkflowButton icon={Check} selected={selected === 'advance'} disabled={disabled}
          className="w-full justify-center" onClick={() => toggle('advance')}>
          {l.advance}
        </WorkflowButton>
        <WorkflowButton icon={CircleAlert} selected={selected === 'decline'} disabled={disabled}
          className="w-full justify-center" onClick={() => toggle('decline')}>
          {l.decline}
        </WorkflowButton>
        <WorkflowButton icon={Clock} selected={selected === 'defer'} disabled={disabled}
          className="w-full justify-center" onClick={() => toggle('defer')}>
          {l.defer}
        </WorkflowButton>
        <WorkflowButton icon={Shuffle} selected={selected === 'divert'} disabled={disabled}
          className="w-full justify-center" onClick={() => toggle('divert')}>
          {l.divert}
        </WorkflowButton>
      </div>
    </div>
  )
}
