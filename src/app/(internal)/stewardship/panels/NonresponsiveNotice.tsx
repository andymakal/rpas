'use client'

import { CircleAlert } from 'lucide-react'

/**
 * The Nonresponsive — Review Contact Strategy recommendation. A prominent but
 * non-blocking banner: it explains that enough outreach attempts have not
 * reached the customer and recommends reconsidering the contact information,
 * the communication method, or the timing. It never stops outreach and offers
 * no terminal action; the worker decides whether to continue, change approach,
 * defer, or stop.
 */
export function NonresponsiveNotice({
  nonresponsive,
}: {
  nonresponsive: { label: string; attempts: number; recommendation: string }
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
      <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">{nonresponsive.label}</p>
        <p className="text-sm">{nonresponsive.recommendation}</p>
      </div>
    </div>
  )
}
