'use client'

/**
 * Error boundary for the internal (operator-facing) app.
 *
 * WHY THIS EXISTS: several internal screens read from the database in their
 * server components. When a read fails (for example the running database is
 * missing a table or column the app expects), the correct behavior is to show
 * a visible, honest error — NOT a page that silently renders empty lists or
 * missing records, which would read as "there is no data" and hide a real
 * fault. Server components that detect a query error throw; this boundary turns
 * that throw into a clear operator-facing message with a retry.
 *
 * It deliberately does not expose internals beyond a short message, and offers
 * a retry (which re-runs the failed server render) and a link back home.
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function InternalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the failure in logs for diagnosis; the UI stays concise.
    console.error('Internal screen failed to render:', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-status-missing-soft text-status-missing-strong">
        <AlertTriangle className="size-7" aria-hidden />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink-heading">This screen could not be loaded</h1>
        <p className="text-base text-ink-supporting">
          Something went wrong loading this data, so it is not being shown. This
          is a loading error, not an empty record: existing data is not missing.
          Please retry; if it keeps happening, report it rather than assuming the
          records are gone.
        </p>
        {error.digest && (
          <p className="text-xs text-ink-muted">Reference: {error.digest}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-ink-supporting transition-colors hover:bg-surface-muted hover:text-ink"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
