'use client'

import { useState } from 'react'
import { FileText, Building2, Check, PenLine } from 'lucide-react'
import { ActionPanel, PrimaryAction, NextNote } from '@/components/workflow'
import type { Detail, Holding } from '../types'
import { shortDate, FollowUpChase } from '../shared'
import { FormCoverage } from './FormCoverage'

export function FormAction({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  const received = !!detail.form_received_at
  // Step 1: the signed form has not been recorded received yet.
  if (!received) {
    return (
      <ActionPanel heading={`Follow up on ${detail.customer.first_name}\u2019s form`}>
        {noteBox}
        <p className="text-sm text-slate-600">
          The servicing-agent form has been sent. First, record when the signed form comes back. One
          form can cover several policy numbers.
        </p>
        <PrimaryAction
          icon={FileText}
          label="Signed form received"
          disabled={busy}
          onClick={() => act({ type: 'form-received' }, 'Form receipt recorded. Confirm the policies and signer below, then submit to the carrier.')}
        />
        {/* Record a chase on the outstanding signature and schedule the next. */}
        <FollowUpChase detail={detail} busy={busy} act={act} label="Followed up on the signature" />
        <NextNote>
          Recording receipt does not submit anything. After it is recorded, you confirm the applicable
          policies and required signer, then Submit to carrier becomes available.
        </NextNote>
      </ActionPanel>
    )
  }
  // Step 2: form received — confirm policies and that the required signatures
  // are present, then submit.
  return <FormConfirmAndSubmit detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
}

function FormConfirmAndSubmit({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  // Signer identity is not derivable from durable data, so the worker must
  // affirmatively confirm the signatures on the RETURNED form before submitting.
  const [signaturesConfirmed, setSignaturesConfirmed] = useState(false)
  return (
    <ActionPanel heading={`Confirm and submit ${detail.customer.first_name}\u2019s form`}>
      {noteBox}
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="size-4" aria-hidden /> Signed form received{detail.form_received_at ? ` ${shortDate(detail.form_received_at)}` : ''}.
      </div>
      <FormCoverage request={request} />
      <RequiredSignatureConfirm
        request={request}
        confirmed={signaturesConfirmed}
        onToggle={() => setSignaturesConfirmed(v => !v)}
      />
      <PrimaryAction
        icon={Building2}
        label="Submit to carrier"
        disabled={busy || request.length === 0 || !signaturesConfirmed}
        onClick={() => act({ type: 'submit-to-carrier' }, 'Submitted. Moved to Waiting for Carrier.')}
      />
      <NextNote>Submitting moves {detail.customer.first_name} to Waiting for Carrier. There is no separate Forms Received queue.</NextNote>
    </ActionPanel>
  )
}

function RequiredSignatureConfirm({
  request, confirmed, onToggle,
}: {
  request: Holding[]
  confirmed: boolean
  onToggle: () => void
}) {
  // Insured names from the request policies are the only signer-adjacent facts
  // we hold; they are shown as context, not asserted as the required signers.
  const insuredNames = Array.from(
    new Set(request.map(h => h.insured_name).filter((n): n is string => !!n)),
  )
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <PenLine className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          The required signer(s) for this form are not known from our records. Determine who must sign
          from the returned form and the policy ownership, and confirm every required signature is
          present before submitting.
        </span>
      </p>
      {insuredNames.length > 0 && (
        <p className="text-sm text-slate-700">
          Insured on the request policies: {insuredNames.join(', ')} (context only, not necessarily the signer).
        </p>
      )}
      <label className="mt-1 flex cursor-pointer items-start gap-2 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={onToggle}
          className="mt-0.5 size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500"
        />
        I have verified every required signature is present on the returned form.
      </label>
    </div>
  )
}
