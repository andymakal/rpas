'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * A light-theme copy-to-clipboard script card (voicemail / text talk tracks),
 * the same interaction the dark ScriptCard carries, retoned for the workflow
 * surface. Launching nothing — it only copies the text for the worker to paste
 * into their own voicemail greeting notes, Hearsay text, or email.
 */
export function CallScriptCard({ label, body, hideCopy = false }: { label: string; body: string; hideCopy?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-supporting">{label}</p>
        {/* Copy is the paste-into-Hearsay/email affordance. The voicemail script
            is read aloud, not pasted, so it hides Copy (hideCopy) while keeping
            the same card treatment. Every other channel keeps Copy. */}
        {!hideCopy && (
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-surface-border-strong bg-surface-card px-2 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:border-brand-ring hover:bg-brand-wash hover:text-brand-subtle-foreground"
          >
            {copied ? <><Check className="size-3 text-status-confirmed" aria-hidden /> Copied</> : <><Copy className="size-3" aria-hidden /> Copy</>}
          </button>
        )}
      </div>
      <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">{body}</p>
    </div>
  )
}
