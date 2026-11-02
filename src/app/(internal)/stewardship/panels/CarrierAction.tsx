'use client'

import { useState } from 'react'
import { Building2, Check, ShieldCheck, ShieldAlert } from 'lucide-react'
import { ActionPanel, WorkflowButton, NextNote } from '@/components/workflow'
import { isPermanent } from '@/lib/policies/product-type'
import type { Detail, Holding } from '../types'
import { shortDate, FollowUpChase } from '../shared'

export function CarrierAction({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  const [correction, setCorrection] = useState('')
  const hasCorrection = !!detail.carrier_correction
  // Carrier confirmation is recorded per policy. Split the request so the worker
  // sees, at a glance, which policies still need the carrier to confirm the
  // servicing agent and which are already done.
  const pending = request.filter(h => h.sa_status !== 'confirmed')
  const confirmed = request.filter(h => h.sa_status === 'confirmed')
  return (
    <ActionPanel heading={hasCorrection ? 'Resolve the carrier correction' : `Confirm the carrier for ${detail.customer.first_name}`}>
      {noteBox}
      {detail.submitted_at && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
          <Building2 className="size-3" aria-hidden /> Submitted {shortDate(detail.submitted_at)}
        </span>
      )}
      {hasCorrection && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
          <p className="font-semibold">Carrier correction requested</p>
          <p className="mt-1">{detail.carrier_correction}</p>
        </div>
      )}
      {/* Per-policy confirmation. The carrier confirms the servicing agent one
          policy at a time; confirming one never changes another. */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-base font-semibold text-slate-900">Confirm servicing access, policy by policy</p>
        <p className="text-sm text-slate-600">
          Record each confirmation as the carrier confirms it. Permanent policies must be confirmed before the
          1035 review can prepare for evaluation; term policies are still pursued but don&apos;t hold up that step.
        </p>
        <div className="mt-2 space-y-2">
          {pending.map(h => (
            <CarrierPolicyRow key={h.id} h={h} busy={busy}
              onConfirm={() => act(
                { type: 'carrier-confirmed', policy_id: h.id },
                `${h.policy_number} confirmed.`,
              )} />
          ))}
          {confirmed.map(h => <CarrierPolicyRow key={h.id} h={h} busy={busy} onConfirm={() => {}} />)}
          {request.length === 0 && (
            <p className="text-sm italic text-slate-400">No policies in the request.</p>
          )}
        </div>
      </div>
      {/* Record a chase on the carrier and schedule the next follow-up. */}
      <FollowUpChase detail={detail} busy={busy} act={act} label="Followed up with the carrier" />
      <div className="space-y-2 border-t border-slate-100 pt-4">
        <label htmlFor="corr" className="text-sm font-medium text-slate-700">Carrier requested a correction?</label>
        <textarea id="corr" value={correction} onChange={e => setCorrection(e.target.value)} rows={2}
          placeholder="What the carrier needs before confirming…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200" />
        <WorkflowButton disabled={busy || !correction.trim()}
          onClick={() => act({ type: 'carrier-correction', note: correction.trim() }, 'Correction recorded. Resolve it and resubmit.')}>
          Record correction
        </WorkflowButton>
      </div>
      <NextNote>
        {pending.length > 0
          ? `${pending.length} ${pending.length === 1 ? 'policy' : 'policies'} still awaiting carrier confirmation. This stays in Waiting for Carrier until every policy is confirmed; nothing is auto-closed.`
          : 'Every policy is confirmed — recording the last one finishes this servicing outreach. Confirmation does not create a review.'}
      </NextNote>
    </ActionPanel>
  )
}

/**
 * One request policy on the carrier-confirmation screen: its number, type, and
 * whether servicing access is confirmed or still required, with a per-policy
 * Confirm action for the ones still pending. A permanent/term tag is shown
 * because permanent policies gate the 1035 review's advancement while term
 * policies do not — but both are pursued here.
 */
function CarrierPolicyRow({ h, busy, onConfirm }: { h: Holding; busy: boolean; onConfirm: () => void }) {
  const done = h.sa_status === 'confirmed'
  const permanent = isPermanent(h.product_type)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {done
          ? <ShieldCheck className="size-4 text-emerald-600" aria-hidden />
          : <ShieldAlert className="size-4 text-amber-600" aria-hidden />}
        <span className="font-mono text-base text-slate-900">{h.policy_number}</span>
        <span className="text-sm text-slate-600">{h.product_type ?? 'Policy'}</span>
        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
          {permanent ? 'Permanent' : 'Term / other'}
        </span>
      </div>
      {done ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
          <Check className="size-4" aria-hidden /> Servicing agent confirmed
        </span>
      ) : (
        <WorkflowButton icon={Check} selected disabled={busy} onClick={onConfirm}>
          Confirm this policy
        </WorkflowButton>
      )}
    </div>
  )
}
