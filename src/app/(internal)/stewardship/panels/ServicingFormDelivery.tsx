'use client'

/**
 * Form-delivery unit — the reusable "send a form to the customer, email or
 * postal" box. It renders its OWN heading with the graduation-cap coaching, the
 * delivery chooser (email / postal), the generate-or-already-has pair, the
 * attach/print directive, and the single confirm, as one self-contained unit.
 *
 * The VISIBLE TEXT is caller-supplied so the same unit serves any form: pass the
 * `heading` ("Send the servicing-agent authorization form", or later "Send the
 * beneficiary change form"), the cap `coaching`, and the `directiveFormName`
 * used in the "Attach the <form> in Outlook" directive. The caller also supplies
 * what the confirm fires (`onConfirm`) and its label (`confirmLabelFor`), since
 * the resulting transition differs by context.
 *
 * DEFERRED generalization: the email body, the PDF generator endpoint, the
 * Everlake carrier filter, and the `Detail`/`Holding` shape are still
 * servicing-agent-specific (that is why this file still lives under stewardship
 * `panels/` rather than `src/components/workflow`). When a genuinely different
 * form (e.g. a beneficiary change) needs this unit, widen those seams against
 * that real second caller and move the file into the shared workflow layer then
 * — not speculatively now.
 *
 * Choosing a channel persists it (set-delivery-method), so the form-sent /
 * email-sent touch the server records reflects the delivery method accurately.
 */

import { type ReactNode, useEffect, useState } from 'react'
import { Check, CircleAlert, ExternalLink, FileText, FileCheck, SkipForward } from 'lucide-react'
import { WorkflowButton, CallMentorCap } from '@/components/workflow'
import { buildMailto } from '@/lib/templates'
import type { Detail, Holding } from '../types'
import {
  streetLine, saEmailBody, saFollowUpEmailBody, SA_SUBJECT, openMailto,
  EVERLAKE_CARRIER_PATTERN,
} from '../shared'
import { FormAttachmentDirective } from './FormAttachmentDirective'

export function ServicingFormDelivery({
  heading, coaching, directiveFormName = 'servicing-agent authorization form',
  detail, request, name, busy, act, confirmLabelFor, onConfirm,
  onAlreadyHeldChange, onMethodChange, onGeneratedChange,
  emailOnly = false, onSkip,
}: {
  /** The unit's heading, rendered with the graduation-cap coaching beside it.
   * Caller-supplied so the same unit titles any form it sends. Omit to render no
   * heading (a caller that supplies its own heading above the unit). */
  heading?: ReactNode
  /** The cap coaching revealed beside the heading. Only used when `heading` is
   * given. Omit for a heading with no cap. */
  coaching?: ReactNode
  /** The form name used in the "Attach the <form> in Outlook before you send"
   * directive. Defaults to the servicing-agent authorization form. */
  directiveFormName?: string
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  /** Confirm-button label, given the chosen method and whether the customer
   * already had the form (so the wording can reflect "sent" vs "they already
   * have it"). */
  confirmLabelFor: (method: 'email' | 'postal', alreadyHasForm: boolean) => string
  /** Fires the queue transition once the worker confirms. `alreadyHeld` is true
   * when the customer already had the form (nothing was sent), so the caller can
   * record the accurate history. */
  onConfirm: (method: 'email' | 'postal', alreadyHeld: boolean) => void
  /** Reports the live "already has the form" choice up so a host preview (the
   * Next history entry) can describe the agreement accurately before confirm.
   * Optional — callers without a live preview can omit it. */
  onAlreadyHeldChange?: (alreadyHeld: boolean) => void
  /** Reports the live delivery method up so a host preview reflects the chosen
   * channel immediately — including the initial default (email) BEFORE the
   * worker clicks anything. Without this the host would only learn the method
   * from the persisted row, so the pre-selected default would not show in the
   * preview until a click round-tripped it. Optional. */
  onMethodChange?: (method: 'email' | 'postal') => void
  /** Reports whether the form has been GENERATED-and-opened yet, so a host
   * preview can flip from the pending "to be emailed/mailed" wording to the
   * past-tense "emailed/mailed" wording the confirm will actually record. The
   * agent must see the real recorded text BEFORE confirming, not a pending
   * string that silently changes on confirm. Generating is the point we assume
   * the form went out; backing out (skip, switching channel) reverts it.
   * Optional. */
  onGeneratedChange?: (generated: boolean) => void
  /** Email-only mode (Send Introductory Emails): fix the channel to email and
   * hide the delivery chooser. */
  emailOnly?: boolean
  /** When supplied (Send Introductory Emails fast flow), render a "Skip for now"
   * control beneath the confirm. It moves to the next available customer WITHOUT
   * sending or recording anything and sends this one to the back of the working
   * sequence. It is always enabled (not gated on form generation), since
   * skipping is explicitly the "do nothing with this one yet" path. */
  onSkip?: () => void
}) {
  const [preparing, setPreparing] = useState(false)
  const [prepError, setPrepError] = useState<string | null>(null)
  const [generated, setGenerated] = useState(false)
  // The escape hatch from the generate-then-send step: the customer already has
  // the form (e.g. it rode the introductory email), so there is nothing to
  // generate. Marking it satisfies the confirm gate exactly as a generation
  // does, so the worker can go straight to recording it sent. Choosing to
  // generate instead clears it, so the two paths never both read as taken.
  const [alreadyHasForm, setAlreadyHasForm] = useState(false)
  // The confirm step is reachable once the form is either freshly generated OR
  // already in the customer's hands.
  const readyToConfirm = generated || alreadyHasForm
  // Report the "already has the form" choice up so a host's live preview (the
  // Next history entry) describes the agreement accurately before confirm. One
  // place to report it, so every path that changes alreadyHasForm (the toggle,
  // chooseMethod's reset, prepareAndOpen's reset) stays in sync automatically.
  useEffect(() => {
    onAlreadyHeldChange?.(alreadyHasForm)
  }, [alreadyHasForm, onAlreadyHeldChange])
  // Report whether the form has been generated-and-opened, so the host preview
  // flips to the past-tense wording the confirm will record. One place to
  // report it, so it stays in sync however `generated` changes (generate sets
  // it; switching channel resets it).
  useEffect(() => {
    onGeneratedChange?.(generated)
  }, [generated, onGeneratedChange])
  // In email-only mode the channel is fixed to email (no chooser). Otherwise it
  // starts from the persisted delivery method and the worker can switch it.
  const [method, setMethod] = useState<'email' | 'postal'>(
    emailOnly ? 'email' : (detail.form_delivery_method ?? 'email'),
  )
  // Report the live method up so a host preview reflects the chosen channel
  // immediately, including the initial default before any click. One place to
  // report it, so it stays in sync however method changes.
  useEffect(() => {
    onMethodChange?.(method)
  }, [method, onMethodChange])
  const customerHasAddress = !!(streetLine(detail.customer) && detail.customer.city && detail.customer.state && detail.customer.zip)

  const everlake = request.filter(h => h.carrier && EVERLAKE_CARRIER_PATTERN.test(h.carrier))
  const formPolicies = everlake.length > 0 ? everlake : request
  const contractNumbers = formPolicies.map(h => h.policy_number).filter(Boolean)
  const canGenerate = contractNumbers.length > 0

  // The introductory activity (emailOnly) sends the full-explanation
  // introductory email; every other caller reaches this component AFTER a live
  // conversation (reached-by-phone, the guided-call "Agreed to authorize"), so
  // it uses the shorter "as we discussed" form-delivery body instead of
  // repeating the Everlake explanation the customer already heard.
  const emailBody = emailOnly
    ? saEmailBody(detail.customer.first_name)
    : saFollowUpEmailBody(detail.customer.first_name)
  const mailto = buildMailto(detail.customer.email, SA_SUBJECT, emailBody)

  function chooseMethod(next: 'email' | 'postal') {
    if (next === method) return
    setMethod(next)
    setPrepError(null)
    // Switching channels invalidates a prior generation and the "already has it"
    // shortcut (a postal packet is not an emailed form, and vice versa), so the
    // worker re-affirms readiness on the new channel.
    setGenerated(false)
    setAlreadyHasForm(false)
    act({ type: 'set-delivery-method', method: next })
  }

  async function prepareAndOpen() {
    setPrepError(null)
    // Generating is the primary path; it supersedes the "already has it"
    // shortcut if that was chosen first.
    setAlreadyHasForm(false)
    if (canGenerate) {
      setPreparing(true)
      try {
        const params = new URLSearchParams()
        params.set('customer_id', detail.customer.id)
        params.set('owner_name', name)
        params.set('contracts', contractNumbers.join(','))
        if (method === 'postal') params.set('delivery', 'postal')
        const res = await fetch(`/api/servicing-agent-change?${params.toString()}`)
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? 'Could not generate the servicing-agent form.')
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const safe = name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
        a.download = `${safe || 'Customer'}-Servicing-Agent-Change${method === 'postal' ? '-Postal-Packet' : ''}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setGenerated(true)
      } catch (err) {
        setPrepError(err instanceof Error ? err.message : 'Could not generate the servicing-agent form.')
        setPreparing(false)
        return
      }
      setPreparing(false)
    }
    if (method === 'email') openMailto(mailto)
  }

  const genLabel = preparing
    ? (method === 'postal' ? 'Preparing packet\u2026' : 'Preparing form\u2026')
    : (method === 'postal' ? 'Generate Postal Packet' : 'Generate Form & Open Email')

  return (
    <div className="space-y-3">
      {/* The unit's own heading with the graduation-cap coaching beside it, so
          the whole "send this form" unit is one self-contained block. Caller-
          supplied text; omit `heading` to render none (a caller placing its own
          heading above). */}
      {heading != null && (
        coaching != null
          ? <CallMentorCap heading={heading}>{coaching}</CallMentorCap>
          : <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      )}
      {/* Delivery channel chooser. Operational, so it is prominent. Hidden in
          email-only mode (Send Introductory Emails), which is fixed to email. */}
      {!emailOnly && (
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Delivery</p>
          {/* Email / Postal is a pick-one-or-the-other choice, so it uses the
              same 50/50 split as the reach and decision choices above: two equal
              halves filling the row. */}
          <div className="grid grid-cols-2 gap-2">
            <WorkflowButton selected={method === 'email'} disabled={busy || preparing}
              onClick={() => chooseMethod('email')} className="w-full justify-center">
              {method === 'email' && <Check className="size-4" aria-hidden />}
              Email
            </WorkflowButton>
            <WorkflowButton selected={method === 'postal'} disabled={busy || preparing}
              onClick={() => chooseMethod('postal')} className="w-full justify-center">
              {method === 'postal' && <Check className="size-4" aria-hidden />}
              Postal mail
            </WorkflowButton>
          </div>
          {method === 'postal' && !customerHasAddress && (
            <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-3 text-sm text-status-attention-strong">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>No complete mailing address on file. Add one on the customer record before generating a postal packet.</span>
            </div>
          )}
        </div>
      )}

      {/* Generate-and-send vs the customer already has it: two paths to the same
          next step, so they sit as a 50/50 split like the Delivery choice above.
          Generate stays the teal-emphasized recommended action on the left; the
          "already has it" escape hatch is the neutral option on the right (it
          commonly rode the introductory email), and selecting it fills teal to
          show it is the chosen path. Either one enables the confirm below. */}
      <div className="grid grid-cols-2 gap-2">
        <WorkflowButton
          icon={ExternalLink}
          selected={!alreadyHasForm}
          onClick={prepareAndOpen}
          disabled={preparing || !canGenerate || (method === 'postal' && !customerHasAddress)}
          className="h-14 w-full justify-center text-lg"
        >
          {genLabel}
        </WorkflowButton>
        <WorkflowButton
          icon={alreadyHasForm ? Check : FileCheck}
          selected={alreadyHasForm}
          disabled={busy || preparing}
          onClick={() => setAlreadyHasForm(v => !v)}
          className="h-14 w-full justify-center text-lg"
        >
          {method === 'postal' ? 'Already has packet' : 'Already has form'}
        </WorkflowButton>
      </div>
      {!canGenerate && (
        <p className="text-sm text-ink-supporting">No request policy numbers to put on the form yet.</p>
      )}
      {prepError && (
        <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-3 text-sm text-status-attention-strong">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{prepError}</span>
        </div>
      )}
      {/* The attach/print directives speak to the GENERATE-then-send path. When
          the customer already has the form there is nothing to attach or print,
          so the directive is suppressed and only the confirm remains. */}
      {!alreadyHasForm && (method === 'email' ? (
        <FormAttachmentDirective request={formPolicies} formName={directiveFormName} />
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-3 text-sm text-status-attention-strong">
          <FileText className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>The packet includes a cover letter addressed to the customer and the authorization form. Print it, enclose a return envelope, and mail it.</span>
        </div>
      ))}
      {/* The single completion. Full width since it is the one confirm for the
          whole section. Its wording depends on the path: a form we just sent
          ("Form sent to customer") vs one the customer already had, where the
          action was making sure they understand what to do, not sending. */}
      <WorkflowButton
        icon={Check}
        selected
        disabled={busy || !readyToConfirm}
        onClick={() => onConfirm(method, alreadyHasForm)}
        className="w-full justify-center"
      >
        {confirmLabelFor(method, alreadyHasForm)}
      </WorkflowButton>
      {/* Skip for now (Send Introductory Emails fast flow): move to the next
          available customer without sending or recording anything. Sits beneath
          the confirm as a quiet secondary action and is always available, since
          skipping is the deliberate "not this one yet" path. */}
      {onSkip && (
        <WorkflowButton
          icon={SkipForward}
          disabled={busy}
          onClick={onSkip}
          className="w-full justify-center"
        >
          Skip for now
        </WorkflowButton>
      )}
    </div>
  )
}
