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
export function FormAttachmentDirective({
  request,
  formName = 'servicing-agent authorization form',
}: {
  request: Holding[]
  /** The name of the form being attached, so this directive serves any form the
   * delivery unit sends (e.g. "beneficiary change form"), not only the
   * servicing-agent authorization. Defaults to the servicing-agent form. */
  formName?: string
}) {
  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3.5">
      <p className="flex items-start gap-2 text-base font-bold leading-snug text-amber-900">
        <PenLine className="mt-0.5 size-5 shrink-0" aria-hidden />
        Attach the {formName} in Outlook before you send.
      </p>
      <p className="text-sm leading-relaxed text-amber-900">
        The email states a form is attached, but it is not attached automatically. Attach the approved
        authorization form for the carrier on this account. If you do not have the correct form, obtain it
        before sending. Do not send without it.
      </p>
      {request.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-white/70 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900">One form covers</p>
          {request.map(h => (
            <div key={h.id} className="flex items-center gap-2 text-sm text-slate-900">
              <span className="font-mono">{h.policy_number}</span>
              <span className="text-xs text-slate-600">{h.product_type ?? 'Policy'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
