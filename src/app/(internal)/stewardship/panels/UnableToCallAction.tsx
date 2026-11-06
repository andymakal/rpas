'use client'

/**
 * People We Can't Call — the action panel for an active outreach customer with
 * NO usable phone. The worker is walked through two GATED steps so the search
 * genuinely happens first:
 *
 *   STEP 1 — SEARCH for the customer (the shared ContactSearch Lego: Gateway +
 *   Fast People Search). It looks for ANY missing detail — a phone, an email, a
 *   mailing address — not only a phone. If the worker finds a PHONE and saves it
 *   on the Customer Contact card, the customer becomes callable and the task
 *   hands off to the guided call flow right here (handled by the parent). If
 *   they find an email or address instead, saving it on the card keeps them
 *   reachable. When nothing new turns up, the worker confirms that and step 2
 *   unlocks.
 *
 *   STEP 2 — SEND THE AUTHORIZATION by email and postal mail together (Option
 *   B): the form rides every email, and the postal packet goes at the same time.
 *   Hidden until step 1 is acknowledged, so searching is not skipped.
 *
 * The form generation, email body, and postal packet reuse ServicingFormDelivery.
 */

import { useState } from 'react'
import { Search, PhoneOff, Check } from 'lucide-react'
import { ActionPanel, OperationalTag, NextNote, ContactSearch, WorkflowButton } from '@/components/workflow'
import type { Detail, Holding } from '../types'
import { fullName } from '../shared'
import { ServicingFormDelivery } from './ServicingFormDelivery'

export function UnableToCallAction({
  detail, request, name, busy, act, hasNextInActivity = false, onSkip,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity?: boolean
  onSkip?: () => void
}) {
  // The hard gate: step 2 (send by mail) stays hidden until the worker confirms
  // the search turned up nothing new, so the search is never skipped.
  const [searchedNothingFound, setSearchedNothingFound] = useState(false)

  const policyNumbers =
    detail.gateway_policy_numbers && detail.gateway_policy_numbers.length > 0
      ? detail.gateway_policy_numbers
      : Array.from(
          new Set(request.map(h => (h.policy_number ?? '').trim()).filter(p => p.length > 0)),
        )

  const nextSuffix = hasNextInActivity ? ' \u2014 Next customer' : ''

  return (
    <ActionPanel heading={`Reach ${fullName(detail.customer)} — no phone on file`}>
      <div className="flex items-center gap-2 rounded-xl border border-status-missing-border bg-status-missing-soft p-4 text-base text-status-missing-strong">
        <PhoneOff className="size-5" aria-hidden /> No phone number on file, so this customer cannot be called yet.
      </div>

      {/* STEP 1 — search. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          <Search className="size-4" aria-hidden /> Step 1 — search for the customer
        </div>
        <ContactSearch
          lastName={detail.customer.last_name}
          firstName={detail.customer.first_name}
          fallbackName={fullName(detail.customer)}
          policyNumbers={policyNumbers}
          city={detail.customer.city}
          state={detail.customer.state}
        />
        <OperationalTag tone="info">
          Found a phone, email, or address? Add it on the Customer Contact card. A phone makes the
          customer callable and hands you straight into the call.
        </OperationalTag>

        {/* The gate to step 2. Confirming that the search found nothing new
            unlocks the send-by-mail step below. */}
        {!searchedNothingFound && (
          <WorkflowButton
            icon={Check}
            onClick={() => setSearchedNothingFound(true)}
            disabled={busy}
            className="w-full justify-center"
          >
            Searched — nothing new found
          </WorkflowButton>
        )}
      </div>

      {/* STEP 2 — send by mail. Gated: only after the search is acknowledged. */}
      {searchedNothingFound && (
        <div className="space-y-2 border-t border-surface-border pt-4">
          <div className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">
            Step 2 — send the authorization by email and postal mail
          </div>
          <ServicingFormDelivery
            heading="Send the servicing-agent authorization form"
            detail={detail}
            request={request}
            name={name}
            busy={busy}
            act={act}
            confirmLabelFor={(m, alreadyHeld) =>
              alreadyHeld
                ? `Customer already has the form. Mark sent${nextSuffix}`
                : m === 'postal' ? `Form mailed to customer${nextSuffix}` : `Form attached and email sent${nextSuffix}`
            }
            onConfirm={() => act(
              { type: 'email-sent' },
              'Authorization sent. Scheduled the follow-up.',
              { advanceToNext: true },
            )}
            onSkip={onSkip}
          />
        </div>
      )}

      <NextNote>
        These customers have no phone, so calling is blocked. Search for them first — a phone drops
        them back into calling, and an email or address keeps them reachable. If nothing new turns
        up, send the authorization by email and postal mail together; the form rides every email.
        Recording the send schedules the follow-up and moves you to the next customer.
      </NextNote>
    </ActionPanel>
  )
}
