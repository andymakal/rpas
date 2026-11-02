'use client'

/**
 * Stewardship / capture outreach — shared helpers and small shared components.
 *
 * Extracted verbatim from `StewardshipClient.tsx`. These are the cross-cutting
 * pieces used by multiple panels (the guided-call panel, the queue action
 * panels, the servicing-access and interaction columns). Keeping them here lets
 * each panel live in its own file and import the SAME helper rather than copying
 * it. Client module: some helpers touch the DOM (openMailto), and the small
 * components render workflow Legos.
 */

import { Clock } from 'lucide-react'
import { WorkflowButton, NextNote, CallContextCard } from '@/components/workflow'
import { canTextGivenFacts } from '@/lib/sms-availability'
import type { Customer, Detail } from './types'

/**
 * Open a mailto: draft WITHOUT navigating the single-page app.
 *
 * Assigning `window.location.href = 'mailto:…'` starts a top-level navigation to
 * the mail scheme. When the OS hands off to a mail client the current page is
 * usually kept, but in environments where the handoff stalls (no default mail
 * handler, or a Chromium state that leaves the aborted navigation pending) Right
 * Path is left unresponsive — the worker cannot get back to My Work. Triggering
 * the draft through a transient anchor click (the SAME technique the form PDF
 * download already uses) lets the browser invoke the handler while the SPA keeps
 * running, so the "Back to My Work" link always works afterward. Guarded for SSR.
 */
export function openMailto(mailto: string): void {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  a.href = mailto
  // No target/_blank: a mailto opened in a new tab leaves an empty tab behind in
  // some browsers; a same-document anchor click hands off and keeps the SPA.
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const SA_SUBJECT = 'Regarding Your Life Insurance Policy'

/**
 * The servicing-agent outreach email (approved version).
 *
 * Formatting: each paragraph is a single line with no manual line breaks inside
 * it, so Outlook wraps the text naturally. Paragraphs are separated by one blank
 * line. The customer's first name personalizes the greeting.
 *
 * Honesty about the attachment: a mailto cannot carry a file, so the body never
 * claims the form is already attached. It tells the customer the authorization
 * form is attached by the sender, and the UI makes attaching it a required,
 * explicit step before the worker records the email as sent. Nothing here sends
 * mail or marks it sent — the worker always does both. No closing or signature:
 * Outlook supplies the standard signature.
 */
export function saEmailBody(firstName: string): string {
  return [
    `Hi ${firstName},`,
    '',
    'We\'re reaching out regarding your life insurance policy.',
    '',
    'When Allstate\'s life insurance business transitioned to Everlake, our office lost access to policies unless we were specifically listed as the servicing agent. We are not currently listed as the servicing agent on your policy.',
    '',
    'We\'d like to restore that access so we can continue helping you with questions or servicing needs.',
    '',
    'We\'ve attached a servicing-agent authorization form and completed as much of it as possible. Signing this form does not change your policy or coverage. It simply allows us to access your policy information and assist you when needed.',
    '',
    'To restore access, please print the form, sign it in ink (a wet signature is required), and scan and email it back to us or return it by mail. If you have additional policies, there\'s space on the form to include them.',
    '',
    'We\'re systematically restoring access to these policies. If you have any questions or specific concerns about yours right now, please let us know. We\'d be happy to discuss them with you.',
  ].join('\n')
    // Trailing blank paragraph (two CRLFs) so the worker can drop their Outlook
    // signature at the bottom without first pressing Enter. Wording is unchanged.
    + '\r\n\r\n'
}

/**
 * The servicing-agent form-delivery email AFTER a live conversation.
 *
 * This is the email that accompanies the authorization form once we have
 * already spoken with the customer (the reached-by-phone and the guided-call
 * "Agreed to authorize" paths). It deliberately does NOT repeat the
 * introductory Everlake explanation, since that was covered on the call; it
 * opens with "As we discussed" and goes straight to the form and what to do
 * with it. The INTRODUCTORY outreach email (Send Introductory Emails) keeps its
 * own full-explanation body in `saEmailBody` and is unchanged.
 *
 * Same formatting conventions as `saEmailBody`: one line per paragraph (Outlook
 * wraps), a blank line between paragraphs, and a trailing blank paragraph so the
 * worker's Outlook signature drops in cleanly. A mailto cannot carry a file, so
 * the body says the form is attached and the UI still makes attaching it an
 * explicit, required step before the send is recorded.
 */
export function saFollowUpEmailBody(firstName: string): string {
  return [
    `Hi ${firstName},`,
    '',
    'As we discussed, I\'ve attached the servicing-agent authorization form and completed as much of it as possible. Signing this form does not change your policy or coverage. It simply allows our office to access your policy information and assist you when needed.',
    '',
    'Please print the form, sign it in ink (a wet signature is required), and scan and email it back to us or return it by mail. If you have additional policies, there\'s space on the form to include them.',
  ].join('\n')
    // Trailing blank paragraph (two CRLFs) so the worker can drop their Outlook
    // signature at the bottom without first pressing Enter.
    + '\r\n\r\n'
}

export function fullName(c: Customer) {
  return `${c.first_name} ${c.last_name}`.trim()
}

/**
 * Whether the Hearsay text / text channel may be offered for this customer.
 *
 * The AUTHORITATIVE answer is `detail.contact_options.canText`, recomputed
 * server-side from the customer's current saved facts and customer-wide,
 * value-scoped recorded failures (and Do Not Text), and refreshed after every
 * card save. This is the single source of truth and is used whenever it is
 * present.
 *
 * The `?? ` branch is ONLY a conservative fallback for the brief window before
 * the task detail has loaded (contact_options null). In that window we must
 * never offer texting to a customer the card shows as restricted, so the
 * fallback subtracts the two customer-level text restrictions the card itself
 * displays (Do Not Text + Text Undeliverable for the number on file) via the
 * SAME `canTextGivenFacts` resolver the card uses. It is a fallback, not a
 * second availability decision: once contact_options arrives it governs.
 */
export function textActionAvailable(detail: Detail): boolean {
  if (detail.contact_options) return detail.contact_options.canText
  const phone = detail.customer.phone?.trim()
  if (!phone) return false
  return canTextGivenFacts({
    smsOptOut: detail.customer.sms_opt_out === true,
    textUndeliverable: detail.customer.text_undeliverable === true,
  })
}

/**
 * The mailing street line for a customer. Real data stores it in `street`;
 * `address_line1` exists but is empty in practice. Prefer street, fall back to
 * address_line1.
 */
export function streetLine(c: { street?: string | null; address_line1?: string | null }): string {
  return (c.street ?? c.address_line1 ?? '').trim()
}

/** Whether a scheduled follow-up date is due (on/before now). */
export function followUpLapsed(followUpDue: string | null): boolean {
  if (!followUpDue) return false
  return new Date(followUpDue.length === 10 ? followUpDue + 'T00:00:00' : followUpDue).getTime() <= Date.now()
}

/**
 * The "record a follow-up, schedule the next" control for a waiting item
 * (awaiting the signed form or carrier confirmation). Prominent once the chase
 * is due; otherwise shows when the next follow-up is scheduled. Recording a
 * follow-up keeps the item in its waiting queue and rolls the next-chase date
 * forward — there is no attempt limit.
 */
export function FollowUpChase({
  detail, busy, act, label,
}: {
  detail: Detail
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  label: string
}) {
  const due = followUpLapsed(detail.follow_up_due)
  return (
    <div className={`space-y-2 rounded-xl border p-4 ${due ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <Clock className={`size-4 ${due ? 'text-amber-600' : 'text-slate-500'}`} aria-hidden />
        <p className={`text-base font-semibold ${due ? 'text-amber-900' : 'text-slate-700'}`}>
          {due ? 'Follow-up due' : (detail.follow_up_due ? `Next follow-up ${shortDate(detail.follow_up_due)}` : 'No follow-up scheduled')}
        </p>
      </div>
      <WorkflowButton icon={Clock} selected={due} disabled={busy}
        onClick={() => act({ type: 'record-follow-up' }, 'Follow-up recorded. Next one scheduled.')}>
        {label}
      </WorkflowButton>
      <NextNote>Records the chase in history and schedules the next follow-up. Nothing is auto-closed; there is no attempt limit.</NextNote>
    </div>
  )
}

export function currency(n: number | null) {
  if (n == null) return '\u2014'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Guided-call presentation — the call number and a one-line reason the customer
// is due for contact.
//
// Presentation only: it reads the EXISTING recorded call-attempt count
// (detail.call_attempts, grouped phone attempts in the current onboarding run)
// and the durable reason/date facts the GET route already supplies. It creates
// no counter and changes no cadence, history, or routing. Opening a screen does
// not advance anything — the count moves only when a call is recorded.
// ─────────────────────────────────────────────────────────────────────────────

const CALL_ORDINALS = [
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth',
  'Ninth', 'Tenth',
]

/**
 * The call number label for the call about to be placed. The first call after
 * the introductory email is Call 1, so the label is the existing recorded call
 * count + 1. Beyond the named ordinals it falls back to "Nth Outreach Call".
 */
function callNumberLabel(callAttempts: number | undefined): string {
  const next = (callAttempts ?? 0) + 1
  const ordinal = CALL_ORDINALS[next - 1]
  if (ordinal) return `${ordinal} Outreach Call`
  return `${next}th Outreach Call`
}

/**
 * A one-line explanation of WHY the customer is due for contact, built from the
 * durable records. A customer-promised callback is distinguished from an
 * automatic follow-up call: 'callback-due' is a commitment the customer made
 * (shown with its promised date); 'no-response' is an automatic cadence retry
 * after an unsuccessful previous call. Returns null when there is nothing
 * meaningful to add beyond the call number.
 */
function callReasonLine(detail: {
  call_reason: string | null
  email_sent_at: string | null
  follow_up_due: string | null
  callback_date: string | null
  last_call_outcome: string | null
}): string | null {
  switch (detail.call_reason) {
    case 'callback-due':
      return detail.callback_date
        ? `Promised callback due ${shortDate(detail.callback_date)}.`
        : 'Promised callback due.'
    case 'no-response':
      // Automatic follow-up. Distinguish the first call after the introductory
      // email (no prior call outcome) from a retry after an unsuccessful call.
      if (detail.last_call_outcome === 'voicemail') {
        return 'Previous call unsuccessful. Scheduled follow-up due.'
      }
      return detail.email_sent_at
        ? `Introductory email sent ${shortDate(detail.email_sent_at)}. No response yet.`
        : 'Follow-up window lapsed with no response.'
    case 'email-bounced':
      return 'The introductory email bounced, so we are calling the phone on file.'
    case 'no-email':
      return 'No email on file, so we are reaching out by phone.'
    default:
      return null
  }
}

/**
 * The guided-call context block: the call number ("First Outreach Call", …) and
 * a one-line reason the customer is due for contact. Shared by both guided
 * calling modes (board recorder and workbench) so they read identically.
 * Presentation only.
 */
// Maps the internal task detail to the presentational CallContextCard Lego: the
// reason/number logic (which knows the Detail shape) stays here; the Lego owns
// only how the tag + line look.
export function CallContext({ detail }: { detail: Detail }) {
  return (
    <CallContextCard
      label={callNumberLabel(detail.call_attempts)}
      reason={callReasonLine(detail)}
    />
  )
}

/**
 * Everlake/Allstate carriers whose fixed life/annuity contracts the ALL2018-4
 * servicing-agent form applies to. The stewardship outreach workflow exists for
 * exactly this scenario, but a customer's request can in principle include
 * other-carrier policies; we only auto-fill the carrier form with the policies
 * it actually covers. Matched case-insensitively as a substring of the holding
 * carrier string.
 */
export const EVERLAKE_CARRIER_PATTERN = /everlake|allstate/i
