'use client'

/**
 * People We Can't Call — the action panel for an active outreach customer with
 * NO usable phone. Two things in one place:
 *
 *   1. RESEARCH FOR A PHONE FIRST (the first line of defense): the shared
 *      Gateway look-up plus the other phone-finding sources. If the worker finds
 *      a number, they save it on the Customer Contact card (center column);
 *      saving reloads the task, the customer now HAS a phone, and the parent
 *      task flips to the guided call flow so the worker calls right here — they
 *      are never silently dropped back into the queue.
 *
 *   2. REACH BY MAIL (when no phone can be found): generate the authorization
 *      email + form AND the postal packet (two PDFs: a cover letter for
 *      letterhead and the form for plain paper), so the form reaches the
 *      customer by every route at once (the hardest-to-reach customers; postal
 *      is slow, so it starts immediately rather than after an email cadence).
 *
 * The form generation, the email body, and the postal packet all reuse the
 * existing ServicingFormDelivery unit; this panel only arranges the research +
 * delivery for the no-phone context. Recording the send advances to the next
 * customer via the standard email-sent transition.
 */

import { Search, ExternalLink, PhoneOff } from 'lucide-react'
import { ActionPanel, OperationalTag, NextNote, GatewayLookup } from '@/components/workflow'
import type { Detail, Holding } from '../types'
import { fullName } from '../shared'
import { ServicingFormDelivery } from './ServicingFormDelivery'

/**
 * Additional phone-finding sources beyond Gateway (the lookup sites Angie
 * shared: search by the customer's name and mailing address for a number).
 * Kept as data so the specific sites can be edited without touching the panel;
 * add `{ label, href }` entries as the exact URLs are confirmed.
 */
const PHONE_LOOKUP_SOURCES: { label: string; href: string }[] = [
  // e.g. { label: 'TruePeopleSearch', href: 'https://www.truepeoplesearch.com/' },
]

export function UnableToCallAction({
  detail, request, name, busy, act, hasNextInActivity = false, onSkip,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity?: boolean
  /** Skip this customer without sending/recording; send to the back of the
   * session's working sequence. */
  onSkip?: () => void
}) {
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
        <PhoneOff className="size-5" aria-hidden /> No phone number on file, so this customer cannot be called.
      </div>

      {/* 1. Research for a phone first. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          <Search className="size-4" aria-hidden /> First, look for a phone number
        </div>
        <GatewayLookup
          lastName={detail.customer.last_name}
          fallbackName={fullName(detail.customer)}
          policyNumbers={policyNumbers}
        />
        {PHONE_LOOKUP_SOURCES.length > 0 && (
          <div className="rounded-xl border border-surface-border bg-surface-card p-3">
            <p className="mb-2 text-sm text-ink-supporting">
              Also try these by the customer&apos;s name and mailing address:
            </p>
            <ul className="space-y-1">
              {PHONE_LOOKUP_SOURCES.map(s => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-base font-medium text-brand transition-colors hover:text-brand-hover"
                  >
                    <ExternalLink className="size-4" aria-hidden /> {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <OperationalTag tone="info">
          Found a number? Add it on the Customer Contact card. The customer becomes callable and this
          screen hands you straight into the call so you can try it now.
        </OperationalTag>
      </div>

      {/* 2. No phone found — reach by mail. The form rides every email, and the
          postal packet (cover letter + form) goes at the same time. */}
      <div className="space-y-2 border-t border-surface-border pt-4">
        <div className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          If no phone can be found, send the authorization
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
          // Recording the send uses the standard email-sent transition: it logs
          // the send, schedules the cadence follow-up, and advances to the next
          // customer. (Postal records the same send with the chosen method.)
          onConfirm={() => act(
            { type: 'email-sent' },
            'Authorization sent. Scheduled the follow-up.',
            { advanceToNext: true },
          )}
          onSkip={onSkip}
        />
      </div>

      <NextNote>
        These customers have no phone, so calling is blocked. Look for a number first (a found number
        drops them back into calling); otherwise send the authorization by email and postal mail
        together. The form rides every email. Recording the send schedules the follow-up and moves
        you to the next customer.
      </NextNote>
    </ActionPanel>
  )
}
