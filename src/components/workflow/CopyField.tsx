'use client'

/**
 * CopyField — a labeled value with a Copy button and a transient "Copied"
 * confirmation. The one place the copy-to-clipboard behavior lives, so any
 * surface that needs a copyable value (a policy number, a last name, a full
 * name, an address, a Gateway search term) drops this in rather than
 * re-implementing the clipboard write and the 2-second confirmation each time.
 *
 * Behavior only: it owns the clipboard write and the copied flag; the host
 * supplies the label and the value. An empty/absent value disables Copy and
 * renders a dash, so a missing value never looks copyable.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { WorkflowButton } from './primitives'

export function CopyField({
  label,
  value,
  mono = false,
  size = 'lg',
  className,
}: {
  /** The small uppercase label above the value (e.g. "Policy number"). */
  label: string
  /** The value shown and copied. Empty/null disables Copy and shows a dash. */
  value: string | null | undefined
  /** Render the value in a monospace face (good for policy numbers / ids). */
  mono?: boolean
  /** Value text size: 'lg' (default, prominent) or 'md'. */
  size?: 'lg' | 'md'
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const text = (value ?? '').trim()
  const hasValue = text.length > 0

  const copy = useCallback(() => {
    if (!hasValue) return
    void navigator.clipboard.writeText(text)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }, [hasValue, text])

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-supporting">{label}</p>
        <span
          className={[
            mono ? 'font-mono' : '',
            size === 'lg' ? 'text-2xl' : 'text-lg',
            'font-semibold text-ink',
          ].join(' ')}
        >
          {hasValue ? text : '—'}
        </span>
      </div>
      <WorkflowButton
        icon={copied ? Check : Copy}
        selected={copied}
        onClick={copy}
        disabled={!hasValue}
      >
        {copied ? 'Copied' : 'Copy'}
      </WorkflowButton>
    </div>
  )
}
