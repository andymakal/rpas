'use client'

import { CircleAlert } from 'lucide-react'

/**
 * An explicitly UNAVAILABLE communication channel in the Didn't Reach workflow.
 * Shown in place of a channel's script/action when the contact information it
 * needs is missing, so the worker sees the channel exists but cannot be used —
 * never a hidden channel and never an implication that it was sent.
 */
export function ChannelUnavailable({ body }: { body: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-surface-border-strong bg-surface-muted p-3 text-sm text-ink-supporting">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{body}</p>
    </div>
  )
}
