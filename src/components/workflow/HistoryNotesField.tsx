'use client'

/**
 * HistoryNotesField — the one shared "add optional prose to the history entry
 * being recorded" Lego.
 *
 * A single free-text field whose only job is to ADD to the history event the
 * current action will record. It is generic: it is not call-specific, so any
 * workflow that records a history event and wants the operator to attach extra
 * words reuses it with the same label and treatment. The host owns the value
 * and when the field appears (typically once there is actually something going
 * into history); the Lego owns the label, the attention treatment, and layout.
 *
 * It is NOT a standalone history entry: the note the operator types here is
 * saved WITH the completed action's one history event, and nothing is saved if
 * the action is never completed. That persistence rule lives with the host; the
 * Lego only captures the text.
 */

import { StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'

export function HistoryNotesField({
  value,
  onChange,
  label = 'Additional notes for history',
  placeholder = 'Anything extra worth recording. The event itself is logged automatically.',
  disabled = false,
  idPrefix = 'history-note',
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** Field label. Defaults to the generic wording; a caller may pass a more
   * specific one, but the default is intentionally not call-specific. */
  label?: string
  placeholder?: string
  disabled?: boolean
  idPrefix?: string
  className?: string
}) {
  const id = `${idPrefix}-input`
  return (
    // Soft AMBER attention treatment so the optional note draws the eye in the
    // history column without reading as an error (that would be a hard red /
    // status-missing). Uses the amber `status-known` tone, the real token for
    // this color (there is no `status-attention-*` token).
    <section
      className={cn(
        'rounded-2xl border border-status-known-border bg-status-known-soft p-4 font-workflow',
        className,
      )}
    >
      <label
        htmlFor={id}
        className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-status-known-strong"
      >
        <StickyNote className="size-4" aria-hidden /> {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
        placeholder={placeholder}
        className="w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
      />
    </section>
  )
}
