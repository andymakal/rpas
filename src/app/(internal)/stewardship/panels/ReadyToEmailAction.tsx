'use client'

/**
 * The ready-to-email task panel. Keeps the existing prepared-email + tracking
 * behavior; the one change is that opening the prepared email now first
 * generates and downloads the filled servicing-agent PDF (reusing the existing
 * /api/servicing-agent-change generator) so the worker has it ready to attach.
 */

import { Check } from 'lucide-react'
import { ActionPanel, NextNote, OperationalTag } from '@/components/workflow'
import type { Detail, Holding } from '../types'
import { ServicingFormDelivery } from './ServicingFormDelivery'

export function ReadyToEmailAction({
  detail, request, name, busy, noteBox, act, hasNextInActivity = false, onSkip,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  noteBox: React.ReactNode
  // Advancement to the next customer flows through act({ advanceToNext: true });
  // the parent task supplies the actual navigation.
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity?: boolean
  /** Skip this customer without sending/recording (Send Introductory Emails fast
   * flow). Only the introductory-EMAIL path offers it; the reached-by-phone
   * authorization branch below never does. */
  onSkip?: () => void
}) {
  // If the worker has already CALLED and REACHED this customer (recorded as an
  // attempt from the context panel), the right next step is to send the
  // servicing-agent AUTHORIZATION form directly, not an introductory email. The
  // form send advances authorization (form-sent -> Waiting for Form) and is NOT
  // the introduction, so sending it never counts as a generic intro email and
  // never falsely satisfies the introduction. Both channels remain available: a
  // worker who did not reach the customer still sends the introductory email.
  const reached = detail.last_call_outcome === 'reached'
  if (reached) {
    return (
      <ActionPanel heading={`Send ${name} the servicing-agent authorization`}>
        {noteBox}
        <OperationalTag tone="info">
          <Check className="mr-1.5 size-4" aria-hidden /> Reached by phone. Proceed directly to authorization.
        </OperationalTag>
        <ServicingFormDelivery
          detail={detail}
          request={request}
          name={name}
          busy={busy}
          act={act}
          confirmLabelFor={m => (m === 'postal' ? 'Form mailed to customer' : 'Form sent to customer')}
          onConfirm={() => act({ type: 'form-sent' }, 'Authorization form sent. Moved to Waiting for Form.')}
        />
        <NextNote>
          You reached {detail.customer.first_name} by phone, so send the authorization form now. Recording it
          moves them straight to Waiting for Form. This is the authorization form, not an introductory email.
        </NextNote>
      </ActionPanel>
    )
  }
  // The Introductory Emails activity: a first-touch send streamlined for fast,
  // continuous processing. This activity is specifically the introductory EMAIL,
  // so the channel is fixed to email (the delivery chooser is hidden below). The
  // confirm records the completed send in history, preserves the existing
  // follow-up scheduling, removes this customer from the activity, and opens the
  // next customer automatically.
  const heading = `Send an introductory email to ${name}.`
  // "— Next customer" only when another customer remains to advance to;
  // otherwise it is simply the completion confirmation.
  const nextSuffix = hasNextInActivity ? ' \u2014 Next customer' : ''
  return (
    <ActionPanel heading={heading}>
      {noteBox}
      <ServicingFormDelivery
        detail={detail}
        request={request}
        name={name}
        busy={busy}
        act={act}
        // Send Introductory Emails is specifically the email activity: fix the
        // channel to email and hide the delivery chooser. The confirm still
        // records the send and advances to the next customer.
        emailOnly
        confirmLabelFor={() => `Form attached and email sent${nextSuffix}`}
        onConfirm={() => act(
          { type: 'email-sent' },
          'Introductory email recorded.',
          { advanceToNext: true },
        )}
        // Skip for now: move to the next available customer without sending or
        // recording anything. Sends this customer to the back of the working
        // sequence; the parent client owns the cycling.
        onSkip={onSkip}
      />
    </ActionPanel>
  )
}
