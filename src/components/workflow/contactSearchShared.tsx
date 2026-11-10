'use client'

/**
 * Shared internals for the contact-search source Legos (GatewaySearchSource,
 * FastPeopleSearchSource) and the ContactSearch subassembly that composes them.
 * Not a public component — the barrel exports the sources and the subassembly,
 * not this. Kept in one place so the copy-to-clipboard behavior, the compact
 * value row, and the bare-cap section header are identical across every source.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import { WorkflowButton } from './primitives'
import { MentorCapButton, MentorCapPanel, useMentorDisclosure } from '@/lib/mentoring/MentorUi'

/** Copy-to-clipboard with a transient "Copied" confirmation, keyed so only the
 * control that fired shows the confirmed state. One hook per source. */
export function useCopyField() {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = useCallback((field: string, value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(field)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(null), 2000)
  }, [])
  return { copied, copy }
}

/** A compact value + its small Copy button, sitting together on one line. */
export function ValueRow({
  field, display, copied, onCopy, mono = false, disabled = false,
}: {
  field: string
  display: string
  copied: string | null
  onCopy: (field: string, value: string) => void
  mono?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={mono
        ? 'font-mono text-lg font-semibold text-ink'
        : 'text-lg font-semibold text-ink'}>{display || 'Unknown'}</span>
      <WorkflowButton
        size="sm"
        icon={copied === field ? Check : Copy}
        selected={copied === field}
        onClick={() => onCopy(field, display)}
        disabled={disabled}
      >
        {copied === field ? 'Copied' : 'Copy'}
      </WorkflowButton>
    </div>
  )
}

/** A source's title with its own bare mentoring cap (just the cap, no label —
 * the standard inline pattern). Each source has its own disclosure, so the caps
 * open independently. */
export function SourceHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { open, setOpen } = useMentorDisclosure()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {title}
        {!open && <MentorCapButton size="text-lg" onOpen={() => setOpen(true)} />}
      </div>
      {open && <MentorCapPanel onClose={() => setOpen(false)}>{children}</MentorCapPanel>}
    </div>
  )
}

/** The outer bubble each source renders inside, so every source looks identical. */
export function SourceCard({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-muted/40 p-3">
      {children}
    </div>
  )
}
