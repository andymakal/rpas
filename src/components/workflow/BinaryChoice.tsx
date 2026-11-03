'use client'

/**
 * BinaryChoice — a two-option selectable row (the Yes/No, Reached/Didn't-reach
 * shape). One Lego for the recurring two-way toggle so its fiddly selection
 * behavior lives in one place:
 *   - exactly one option selected at a time;
 *   - clicking the selected option CLEARS it (back to no choice);
 *   - freely switchable between the two;
 *   - selecting commits NOTHING — it only reports the current choice to the
 *     host, which decides what (if anything) happens next.
 *
 * It owns ONLY the selection presentation and toggle logic. The option VALUES
 * are domain-specific (the host passes them) and the downstream action is the
 * host's — that is deliberately not this Lego's concern, so it stays reusable
 * across verify (yes/no), the call panel (reached/didn't-reach), and anywhere
 * else a two-way choice appears. Controlled: the host holds the selected value.
 */

import type { ComponentType } from 'react'
import { WorkflowButton } from './primitives'

export interface BinaryOption<T extends string> {
  value: T
  label: string
  /** Optional leading icon (a lucide icon component). */
  icon?: ComponentType<{ className?: string }>
}

export function BinaryChoice<T extends string>({
  question,
  options,
  value,
  onChange,
  disabled = false,
}: {
  /** The prompt shown above the two options (e.g. "Are we the servicing agent?").
   * Omit for a bare two-button row. */
  question?: string
  /** Exactly two options. The first renders left, the second right. */
  options: readonly [BinaryOption<T>, BinaryOption<T>]
  /** The currently selected value, or null when nothing is chosen. */
  value: T | null
  /** Report the new selection: the chosen value, or null when the selected one
   * was clicked again (toggled off). Nothing is committed here. */
  onChange: (next: T | null) => void
  disabled?: boolean
}) {
  const [a, b] = options
  return (
    <div className="space-y-2">
      {question && (
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">{question}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <WorkflowButton
          icon={a.icon}
          selected={value === a.value}
          disabled={disabled}
          className="w-full justify-center"
          onClick={() => onChange(value === a.value ? null : a.value)}
        >
          {a.label}
        </WorkflowButton>
        <WorkflowButton
          icon={b.icon}
          selected={value === b.value}
          disabled={disabled}
          className="w-full justify-center"
          onClick={() => onChange(value === b.value ? null : b.value)}
        >
          {b.label}
        </WorkflowButton>
      </div>
    </div>
  )
}
