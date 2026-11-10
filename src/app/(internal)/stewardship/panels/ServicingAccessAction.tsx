'use client'

/**
 * Servicing Access — the signed-authorization stage: upload the signed form,
 * record receipt, prepare + confirm the carrier email (the submit-to-carrier
 * transition), run the seven-day carrier follow-up, and record per-policy
 * carrier confirmation. When every request policy is confirmed, the existing
 * handoff sends the customer straight to determination. Chasing the customer
 * for the signature is NOT done here: it belongs to Customer Interaction, before
 * the signed authorization is recorded as received.
 */

import { useRef, useState } from 'react'
import { Check, FileText, Building2, Mail, CircleAlert, Upload, Download, Loader2 } from 'lucide-react'
import {
  ActionPanel, WorkflowButton, PrimaryAction, NextNote, ExternalActionConfirm,
} from '@/components/workflow'
import {
  carrierEmailSubject, carrierEmailMessage, uniqueCarriers, resolveCarrierRecipient,
} from '@/lib/stewardship/carrier-email'
import { buildMailto } from '@/lib/templates'
import type { Detail, Holding } from '../types'
import { fullName, shortDate, openMailto } from '../shared'
import { FormCoverage } from './FormCoverage'
import { CarrierAction } from './CarrierAction'

export function ServicingAccessAction({
  detail, request, busy, note, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  note: string | null
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
}) {
  const name = fullName(detail.customer)
  const noteBox = note && (
    <div className="flex items-center gap-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4 text-base text-status-confirmed-strong">
      <Check className="size-5" aria-hidden /> {note}
    </div>
  )
  // Stage within servicing access, derived from the SAME durable facts the
  // transitions use. Waiting for Carrier means the form is submitted and the
  // carrier confirmation is outstanding; otherwise the request is pre-submission
  // (receipt + upload + prepare-and-send the carrier email).
  const awaitingCarrier = detail.queue === 'waiting-for-carrier'
  return (
    <ActionPanel heading={awaitingCarrier
      ? `Confirm servicing access for ${name}`
      : `Process ${name}\u2019s signed authorization`}>
      {noteBox}
      {/* Step 1 — save the signed authorization into the existing repository. */}
      <AuthorizationUpload detail={detail} busy={busy} />
      {awaitingCarrier ? (
        // Step 4+ — the existing per-policy carrier-confirmation flow (with the
        // seven-day carrier follow-up chase), reused verbatim.
        <CarrierAction detail={detail} request={request} busy={busy} noteBox={null} act={act} />
      ) : (
        // Steps 2-3 — record receipt (if not yet), then prepare the carrier
        // email and confirm it sent (which is the submit-to-carrier transition).
        <ServicingAccessSubmit detail={detail} request={request} name={name} busy={busy} act={act} />
      )}
    </ActionPanel>
  )
}

/**
 * Save the signed servicing-agent authorization into Right Path's existing
 * document repository (the shared rightpath-documents bucket + policy_documents
 * table) via the stewardship authorization route. Upload, replace, and
 * open/download of the stored form; uploading records a receipt in Customer
 * History on the server. This is the task's "upload and save the signed form"
 * step; it adds no new storage system.
 */
function AuthorizationUpload({
  detail, busy,
}: {
  detail: Detail
  busy: boolean
}) {
  const [onFile, setOnFile] = useState(!!detail.authorization_on_file)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  async function upload(file: File) {
    setErr(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(`/api/stewardship/${detail.id}/authorization`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(json.error ?? 'Upload failed.'); return }
      setOnFile(true)
    } catch {
      setErr('Network error during upload.')
    } finally {
      setUploading(false)
    }
  }
  async function openStored() {
    setErr(null)
    setOpening(true)
    try {
      const res = await fetch(`/api/stewardship/${detail.id}/authorization`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(json.error ?? 'Could not open the saved authorization.'); return }
      if (json?.data?.url) window.open(json.data.url as string, '_blank', 'noopener')
    } catch {
      setErr('Network error opening the saved authorization.')
    } finally {
      setOpening(false)
    }
  }
  return (
    <div className={`space-y-2 rounded-xl border p-4 ${onFile ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <FileText className="size-4 text-slate-600" aria-hidden /> Signed authorization
      </p>
      {onFile ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-800">
          <Check className="size-4" aria-hidden /> Saved to the customer&apos;s documents.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Upload the signed servicing-agent authorization to save it in the customer&apos;s documents.
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = '' }}
      />
      <div className="flex flex-wrap gap-2">
        <WorkflowButton
          icon={uploading ? Loader2 : Upload}
          disabled={busy || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Uploading\u2026' : (onFile ? 'Replace signed form' : 'Upload signed form')}
        </WorkflowButton>
        {onFile && (
          <WorkflowButton
            icon={opening ? Loader2 : Download}
            disabled={busy || opening}
            onClick={() => void openStored()}
          >
            {opening ? 'Opening\u2026' : 'Open saved form'}
          </WorkflowButton>
        )}
      </div>
      {err && <p className="text-sm text-rose-700">{err}</p>}
      <NextNote>Saved to the customer&apos;s documents and recorded in their history. Signature verification is not required here.</NextNote>
    </div>
  )
}

/**
 * Record receipt (if not yet recorded), then prepare the carrier email and
 * confirm it sent. "Email Sent" is the existing submit-to-carrier transition:
 * it moves the customer to Waiting for Carrier and starts the existing
 * seven-day carrier follow-up. The employee attaches the signed form and sends
 * the email manually from the opened draft; launching is not completion.
 */
function ServicingAccessSubmit({
  detail, request, name, busy, act,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  act: (action: unknown, successNote?: string) => void
}) {
  const received = !!detail.form_received_at
  // Which action records receipt depends on where the customer currently sits.
  // A customer already in Waiting for Form (reached through the normal funnel,
  // form sent) records receipt with form-received. A customer still earlier in
  // the pre-authorization funnel — the signed authorization simply ARRIVED
  // (returned from the introductory email, or opened via the find-a-customer
  // search) — advances to Waiting for Form AND records receipt in one step via
  // form-returned, which is valid from anywhere in the funnel. Either way
  // form_received_at ends up set, after which Submit to carrier is available.
  const receiptAction = detail.queue === 'waiting-for-form'
    ? { type: 'form-received' as const }
    : { type: 'form-returned' as const }
  // The appropriate carrier(s) and the request's policy numbers for the carrier
  // email. Carriers come from the request policies (existing data, nothing
  // invented); the email asks the carrier to process the authorization.
  const carriers = uniqueCarriers(request.map(h => h.carrier))
  const policyNumbers = request.map(h => h.policy_number).filter(Boolean)
  // The recipient is resolved from existing carrier contact information only.
  // Right Path stores no carrier email addresses today, so this is empty and the
  // draft opens with a blank To: the employee fills in. We never invent an
  // address. (When carrier addresses are later stored, pass them here and the
  // draft is pre-addressed automatically.)
  const carrierRecipient = resolveCarrierRecipient(carriers)
  const carrierMailto = buildMailto(
    carrierRecipient ?? '',
    carrierEmailSubject(carriers),
    carrierEmailMessage({ carriers, policyNumbers, customerName: name }),
  )
  if (!received) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          First record that the signed form came back. One form can cover several policy numbers.
        </p>
        <PrimaryAction
          icon={FileText}
          label="Record authorization received"
          disabled={busy}
          onClick={() => act(receiptAction, 'Receipt recorded. Prepare the carrier email below.')}
        />
        <NextNote>Recording receipt does not submit anything. After it is recorded, prepare the carrier email and confirm it sent.</NextNote>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="size-4" aria-hidden /> Authorization received{detail.form_received_at ? ` ${shortDate(detail.form_received_at)}` : ''}.
      </div>
      <FormCoverage request={request} />
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Building2 className="size-4 text-slate-600" aria-hidden /> Prepare carrier email
        </p>
        <p className="text-sm text-slate-600">
          Opens a prepared email to {carriers.length > 0 ? carriers.join(', ') : 'the carrier'} asking them to
          process the authorization. Attach the signed form, send it, then confirm below.
        </p>
        {carrierRecipient ? (
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <Mail className="size-4 shrink-0 text-slate-500" aria-hidden />
            Prefilled recipient: <span className="font-medium text-slate-900">{carrierRecipient}</span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              No carrier email address is on file, so the draft opens with the recipient blank. Add
              {carriers.length === 1 ? ` ${carriers[0]}\u2019s` : ' the carrier\u2019s'} email address before sending.
            </span>
          </p>
        )}
        <ExternalActionConfirm
          launchIcon={Mail}
          launchLabel="Prepare carrier email"
          confirmLabel="Email Sent"
          confirmedNote="Submitted to the carrier. Waiting for Carrier, with the seven-day follow-up started."
          hint="Confirming Email Sent submits the authorization and starts the seven-day carrier follow-up."
          onLaunch={() => { openMailto(carrierMailto) }}
          onConfirmed={() => act(
            { type: 'submit-to-carrier' },
            'Submitted. Moved to Waiting for Carrier; seven-day follow-up started.',
          )}
        />
      </div>
      <NextNote>
        Email Sent is the submission: {name} moves to Waiting for Carrier and the seven-day carrier follow-up
        begins. Carrier confirmations are recorded there; once every policy is confirmed, {name} goes straight
        to determination.
      </NextNote>
    </div>
  )
}
