'use client'

/**
 * Record ONE coordinated outreach attempt across every applicable channel, in a
 * single action (the unified record-attempt). This is the IPF grouping adapted:
 * a call plus the voicemail / text / email outcomes recorded together, which
 * BOTH preserves each channel's individual outcome in history AND advances the
 * workflow (and schedules the next call) without recording the activity twice.
 *
 * Queue-independent (Rule 1): the channels offered come from the customer's
 * contact_options, not the stored queue. A callable customer can be called from
 * any queue; an emailable customer can be emailed; texting rides the phone. The
 * stored queue is the recommended next step shown elsewhere, not a lock on which
 * channel the employee may use here.
 */

import { useState } from 'react'
import { Clock, PenLine } from 'lucide-react'
import { WorkflowButton } from '@/components/workflow'
import { type CallOutcome } from '@/lib/stewardship/queues'
import type { Detail } from '../types'
import { textActionAvailable } from '../shared'

type ContactChannelId = 'call' | 'voicemail' | 'text' | 'email'
type AttemptChannelOutcome = 'touch' | 'no_contact' | 'unusable'

export function RecordAttemptPanel({
  detail, busy, act,
}: {
  detail: Detail
  busy: boolean
  act: (action: unknown, successNote?: string) => void
}) {
  const opts = detail.contact_options
  // Which channels are offered, from the resolved contact options (not the
  // queue). Voicemail rides the same number as calling. Postal is form delivery,
  // handled on the form step, so it is not a contact-attempt channel here.
  const channels: { id: ContactChannelId; label: string; available: boolean }[] = [
    { id: 'call', label: 'Call', available: opts?.canCall ?? !!detail.customer.phone },
    { id: 'voicemail', label: 'Voicemail', available: opts?.canCall ?? !!detail.customer.phone },
    { id: 'text', label: 'Text (Hearsay)', available: textActionAvailable(detail) },
    { id: 'email', label: 'Email', available: opts?.canEmail ?? !!detail.customer.email },
  ]
  const offered = channels.filter(c => c.available)
  const [done, setDone] = useState<Record<ContactChannelId, boolean>>({ call: false, voicemail: false, text: false, email: false })
  // The call channel carries a workflow CallOutcome; the others carry a recorded
  // outcome (touch / no_contact / unusable) that feeds history + usability.
  const [callOutcome, setCallOutcome] = useState<CallOutcome>('voicemail')
  const [callbackWhen, setCallbackWhen] = useState('')
  const [chanOutcome, setChanOutcome] = useState<Record<Exclude<ContactChannelId, 'call'>, AttemptChannelOutcome>>({
    voicemail: 'touch', text: 'touch', email: 'touch',
  })
  const anyChecked = offered.some(c => done[c.id])
  const needCallback = done.call && callOutcome === 'callback'
  const CALL_OUTCOMES: { id: CallOutcome; label: string }[] = [
    { id: 'reached', label: 'Reached' },
    { id: 'voicemail', label: 'No answer / voicemail' },
    { id: 'bad-number', label: 'Bad number' },
    { id: 'callback', label: 'Callback later' },
    { id: 'not-interested', label: 'Not interested' },
  ]
  const OUTCOME_CHOICES: { id: AttemptChannelOutcome; label: string }[] = [
    { id: 'touch', label: 'Sent' },
    { id: 'no_contact', label: 'Not sent' },
    { id: 'unusable', label: 'Unusable' },
  ]
  function record() {
    if (!anyChecked) return
    const action: Record<string, unknown> = { type: 'record-attempt' }
    if (done.call) {
      action.call = callOutcome
      if (callOutcome === 'callback') action.callback_date = callbackWhen || null
    }
    for (const key of ['voicemail', 'text', 'email'] as const) {
      if (done[key]) action[key] = chanOutcome[key]
    }
    act(action, 'Attempt recorded. History and workflow updated.')
    setDone({ call: false, voicemail: false, text: false, email: false })
  }
  if (offered.length === 0) {
    return (
      <div className="rounded-xl border border-surface-border bg-surface-card p-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Record an attempt</p>
        <p className="mt-1 text-sm text-ink-secondary">
          No usable contact method is on file. Use Contact Research to find one before recording an attempt.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Record an attempt</p>
      <p className="mt-1 text-sm text-ink-secondary">
        Check every channel you used in this one reach-out and record its outcome. Everything is saved as a
        single attempt: the individual outcomes are kept in history, workflow progress updates, and the next
        call is scheduled when appropriate. You do not record it anywhere else.
      </p>
      <div className="mt-3 space-y-2">
        {offered.map(c => (
          <div key={c.id} className="rounded-lg border border-surface-border p-2.5">
            <label className="flex cursor-pointer items-center gap-2.5 text-base font-medium text-ink">
              <input
                type="checkbox"
                checked={done[c.id]}
                disabled={busy}
                onChange={e => setDone(d => ({ ...d, [c.id]: e.target.checked }))}
                className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500"
              />
              {c.label}
            </label>
            {done[c.id] && c.id === 'call' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CALL_OUTCOMES.map(o => (
                  <WorkflowButton key={o.id} selected={callOutcome === o.id} disabled={busy}
                    onClick={() => setCallOutcome(o.id)}>
                    {o.label}
                  </WorkflowButton>
                ))}
              </div>
            )}
            {done[c.id] && c.id !== 'call' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OUTCOME_CHOICES.map(o => (
                  <WorkflowButton key={o.id}
                    selected={chanOutcome[c.id as Exclude<ContactChannelId, 'call'>] === o.id}
                    disabled={busy}
                    onClick={() => setChanOutcome(s => ({ ...s, [c.id]: o.id }))}>
                    {o.label}
                  </WorkflowButton>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {needCallback && (
        <div className="mt-3 space-y-1.5">
          <label htmlFor="attempt-cb" className="flex items-center gap-2 text-sm font-medium text-ink">
            <Clock className="size-4 text-ink-supporting" aria-hidden /> When should we call back?
          </label>
          <input id="attempt-cb" type="date" value={callbackWhen} onChange={e => setCallbackWhen(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40" />
        </div>
      )}
      <div className="mt-3">
        <WorkflowButton icon={PenLine} selected disabled={busy || !anyChecked || (needCallback && !callbackWhen)} onClick={record}>
          {busy ? 'Recording…' : 'Record attempt'}
        </WorkflowButton>
      </div>
    </div>
  )
}
