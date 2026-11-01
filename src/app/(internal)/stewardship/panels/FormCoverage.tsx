'use client'

import { FileText } from 'lucide-react'
import type { Holding } from '../types'

/** The "one servicing-agent form covers these policies" summary, shown on the
 * form-confirm and servicing-access submit panels. */
export function FormCoverage({ request }: { request: Holding[] }) {
  if (request.length === 0) return null
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <FileText className="size-4 text-slate-600" aria-hidden />
        One servicing-agent form covers:
      </p>
      <div className="space-y-1.5">
        {request.map(h => (
          <div key={h.id} className="flex items-center gap-2 text-base text-slate-900">
            <span className="font-mono">{h.policy_number}</span>
            <span className="text-sm text-slate-600">{h.product_type ?? 'Policy'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
