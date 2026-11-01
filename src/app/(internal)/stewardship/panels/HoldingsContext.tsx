'use client'

import type { Holding } from '../types'
import { currency } from '../shared'

/** The legacy holdings context list (non-working-screen context column): the
 * policies in this servicing request, plus other holdings shown for context. */
export function HoldingsContext({ request, context }: { request: Holding[]; context: Holding[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">In this servicing request</p>
        <div className="mt-2 space-y-2">
          {request.length === 0
            ? <p className="text-sm italic text-slate-400">No policies in the request.</p>
            : request.map(h => <HoldingRow key={h.id} h={h} />)}
        </div>
      </div>
      {context.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Other holdings (context only)</p>
          <div className="mt-2 space-y-2">
            {context.map(h => <HoldingRow key={h.id} h={h} muted />)}
          </div>
        </div>
      )}
    </div>
  )
}

function HoldingRow({ h, muted }: { h: Holding; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <span className={muted ? 'font-mono text-slate-600' : 'font-mono text-slate-900'}>{h.policy_number}</span>
        <span className="px-1.5 text-slate-400">{'\u00b7'}</span>
        <span className={muted ? 'text-slate-500' : 'text-slate-700'}>{h.product_type ?? 'Policy'}</span>
        {h.insured_name && <span className="ml-1 text-slate-500">({h.insured_name})</span>}
      </div>
      <span className="shrink-0 text-slate-500">{currency(h.face_amount)}</span>
    </div>
  )
}
