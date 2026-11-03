'use client'

import { Mail, Phone, Clock, ExternalLink, FileText, MailX } from 'lucide-react'
import { ActionPanel, PrimaryAction, WorkflowButton, NextNote } from '@/components/workflow'
import type { Detail } from '../types'
import { shortDate } from '../shared'

export function WaitingForResponseAction({
  detail, busy, noteBox, act,
}: {
  detail: Detail
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  // This waiting state is reached two ways: after the initial email (awaiting a
  // reply) or after a voicemail (awaiting a callback). Frame the screen for the
  // channel actually in play so the copy is honest. Either way, when
  // follow_up_due lapses the item resurfaces to Ready to Call automatically.
  const afterVoicemail = detail.last_call_outcome === 'voicemail'
  return (
    <ActionPanel heading={afterVoicemail
      ? `Awaiting ${detail.customer.first_name}\u2019s callback`
      : `Check for ${detail.customer.first_name}\u2019s reply`}>
      {noteBox}
      <div className="flex flex-wrap items-center gap-2">
        {afterVoicemail ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
            <Phone className="size-3" aria-hidden /> Voicemail left
          </span>
        ) : detail.email_sent_at && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
            <Mail className="size-3" aria-hidden /> Sent {shortDate(detail.email_sent_at)}
          </span>
        )}
        {detail.follow_up_due && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
            <Clock className="size-3" aria-hidden /> Next attempt {shortDate(detail.follow_up_due)}
          </span>
        )}
      </div>
      {/* Check the reply in the team member's own Outlook (email path only). */}
      {!afterVoicemail && (
        <a href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer" className="block">
          <PrimaryAction icon={ExternalLink} label="Open inbox in Outlook" />
        </a>
      )}
      <div className="space-y-2 border-t border-slate-100 pt-4">
        <p className="text-base font-semibold text-slate-700">When the customer engages</p>
        {/* The signed form may come straight back — the introductory email
            already carried it. Record the RETURN without logging a second
            mailing. Only shown on the email path. */}
        {!afterVoicemail && (
          <WorkflowButton icon={FileText} selected disabled={busy}
            onClick={() => act({ type: 'form-returned' }, 'Signed form received. Moved to Waiting for Form.')}>
            Signed form returned (no re-send)
          </WorkflowButton>
        )}
        <WorkflowButton icon={FileText} disabled={busy}
          onClick={() => act({ type: 'form-sent' }, 'Form sent. Moved to Waiting for Form.')}>
          {afterVoicemail ? 'Form sent to customer' : 'Re-sent the form to the customer'}
        </WorkflowButton>
        {!afterVoicemail && (
          <WorkflowButton icon={MailX} disabled={busy}
            onClick={() => act({ type: 'email-bounced' },
              detail.customer.phone ? 'Bounce recorded. Moved to Ready to Call.' : 'Bounce recorded. Moved to Research Needed.')}>
            Email bounced
          </WorkflowButton>
        )}
      </div>
      <NextNote>
        {afterVoicemail
          ? 'When the next-attempt date passes with no callback, this customer moves back to Ready to Call automatically. There is no attempt limit; nothing is auto-closed.'
          : 'When the follow-up date passes with no response, this customer moves to Ready to Call automatically. Nothing is auto-closed.'}
      </NextNote>
    </ActionPanel>
  )
}
