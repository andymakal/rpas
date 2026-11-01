'use client'

import { PenLine } from 'lucide-react'
import type { Holding } from '../types'

/**
 * The high-prominence directive to manually attach the servicing-agent
 * authorization form in Outlook before sending. Right Path does not yet carry
 * the carrier's form inside the app, so this is stated plainly rather than
 * pretending the system supplies it. High-contrast amber because it changes what
 * the worker must do (per the workflow contrast standard — operational, not
 * incidental).
 */
export function FormAttachmentDirective({ request }: { request: Holding[] }) {
  return (
    <div className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
      <p className="flex items-start gap-3 text-xl font-bold leading-snug text-amber-900">
        <PenLine className="mt-1 size-6 shrink-0" aria-hidden />
        Attach the servicing-agent authorization form in Outlook before you send.
      </p>
      <p className="text-lg leading-relaxed text-amber-900">
        The email states a form is attached, but it is not attached automatically. Attach the approved
        authorization form for the carrier on this account. If you do not have the correct form, obtain it
        before sending. Do not send without it.
      </p>
      {request.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-white/70 p-4">
          <p className="text-sm font-bold uppercase tracking-wide text-amber-900">One form covers</p>
          {request.map(h => (
            <div key={h.id} className="flex items-center gap-2 text-lg text-slate-900">
              <span className="font-mono">{h.policy_number}</span>
              <span className="text-base text-slate-600">{h.product_type ?? 'Policy'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
