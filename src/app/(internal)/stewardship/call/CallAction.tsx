'use client'

/**
 * The guided calling flow. Two modes:
 *
 *   - Board task (workbench=false): the established compact outcome recorder for
 *     a Ready to Call item opened from the board. Unchanged behavior.
 *   - Workbench (workbench=true): the Call Reachable Customers single-page
 *     guided flow (OutreachCallPanel). Both modes use the SAME record-attempt
 *     action, outcome vocabulary, callback persistence, and transitions — there
 *     is a single recording path.
 */

import { useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { ActionPanel, WorkflowButton, NextNote, CallButton } from '@/components/workflow'
import { type CallOutcome } from '@/lib/stewardship/queues'
import { type CallSelection } from '@/lib/stewardship/customer-history'
import type { Detail, Holding } from '../types'
import { fullName, shortDate, CallContext } from '../shared'
import { ServicingFormDelivery } from '../panels/ServicingFormDelivery'
import { OutreachCallPanel } from './OutreachCallPanel'

export function CallAction({
  detail, request, busy, noteBox, act, workbench = false, hasNextInActivity = false,
  onSkip, onSelectionChange, callNote = '',
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  /** Render the Call Reachable Customers guided single-page flow with
   * auto-advance. False keeps the established compact board outcome recorder. */
  workbench?: boolean
  /** Whether another customer remains in the workbench to advance to (affects
   * the confirmation wording on terminal outcomes). */
  hasNextInActivity?: boolean
  /** Skip the open customer WITHOUT recording a call, changing status, or
   * touching follow-up dates: move to the next available customer and send this
   * one to the back of the working sequence (the calling workbench). When
   * supplied, the workbench shows a "Skip for now" control. */
  onSkip?: () => void
  /** Report the live guided-call selection up for the history-column preview. */
  onSelectionChange?: (selection: CallSelection | null) => void
  /** The optional Call Notes text (task-owned, edited in the history column);
   * the workbench panel reads it to fold into the recorded outcome. */
  callNote?: string
}) {
  if (workbench) {
    return (
      <OutreachCallPanel
        detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
        hasNextInActivity={hasNextInActivity}
        onSkip={onSkip}
        onSelectionChange={onSelectionChange}
        callNote={callNote}
      />
    )
  }
  return <CallBoardAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
}

/**
 * The established compact Ready-to-Call outcome recorder (board task). Preserved
 * verbatim so the board calling experience is unchanged.
 */
function CallBoardAction({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(detail.last_call_outcome as CallOutcome | null)
  const [callbackWhen, setCallbackWhen] = useState('')
  const phone = detail.customer.phone
  const OUTCOMES: { id: CallOutcome; label: string }[] = [
    { id: 'reached', label: 'Reached' },
    { id: 'voicemail', label: 'Voicemail' },
    { id: 'bad-number', label: 'Bad number' },
    { id: 'not-interested', label: 'Not interested' },
    { id: 'callback', label: 'Callback later' },
  ]
  return (
    <ActionPanel heading={`Call ${fullName(detail.customer)}`}>
      {noteBox}
      <CallContext detail={detail} />
      {/* Established call behavior via the shared CallButton Lego: dials the
          stored number through the team member's configured phone (RingCentral).
          Launching the dialer is not proof the call happened — the worker
          records the outcome below. */}
      <CallButton phone={phone} />
      <div className="border-t border-slate-100 pt-4">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">Record the call outcome</p>
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map(o => (
            <WorkflowButton
              key={o.id}
              selected={outcome === o.id}
              disabled={busy}
              onClick={() => {
                setOutcome(o.id)
                if (o.id !== 'callback') {
                  // One coordinated attempt (call channel only). Uses the unified
                  // record-attempt so a quick call recorded here produces the same
                  // single grouping as the multi-channel attempt panel, never a
                  // second recording path.
                  act(
                    { type: 'record-attempt', call: o.id },
                    o.id === 'bad-number' ? 'Bad number. Moved to Research Needed.'
                      : o.id === 'reached' ? 'Reached. Send the servicing-agent form below.'
                      : o.id === 'not-interested' ? 'Recorded as not interested. No further outreach; a human decides any next step.'
                      : 'Voicemail recorded. Next call auto-scheduled.',
                  )
                }
              }}
            >
              {outcome === o.id && <Check className="size-4" aria-hidden />}
              {o.label}
            </WorkflowButton>
          ))}
        </div>
      </div>
      {outcome === 'reached' && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-base font-semibold text-slate-900">Send the servicing-agent form</p>
          <ServicingFormDelivery
            detail={detail}
            request={request}
            name={fullName(detail.customer)}
            busy={busy}
            act={act}
            confirmLabelFor={(m, alreadyHeld) =>
              alreadyHeld
                ? 'Customer already has the form. Mark complete'
                : m === 'postal' ? 'Form mailed to customer' : 'Form sent to customer'
            }
            onConfirm={(_m, alreadyHeld) => act(
              { type: 'form-sent', alreadyHeld },
              alreadyHeld
                ? 'Customer already has the form. Moved to Waiting for Form.'
                : 'Form sent. Moved to Waiting for Form.',
            )}
          />
          <NextNote>Generate the form, send it (email or postal), then record it here. Reached and form sent moves this customer to Waiting for Form. Nothing is auto-closed.</NextNote>
        </div>
      )}
      {outcome === 'callback' && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <label htmlFor="cb" className="flex items-center gap-2 text-base font-medium text-slate-800">
            <Clock className="size-4 text-slate-600" aria-hidden /> When should we call back?
          </label>
          <input id="cb" type="date" value={callbackWhen} onChange={e => setCallbackWhen(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200" />
          <WorkflowButton icon={Check} selected disabled={busy || !callbackWhen}
            onClick={() => act({ type: 'record-attempt', call: 'callback', callback_date: callbackWhen }, `Callback set for ${callbackWhen ? shortDate(callbackWhen) : ''}.`)}>
            Set callback
          </WorkflowButton>
          <NextNote>The customer stays in Ready to Call and resurfaces on the callback date.</NextNote>
        </div>
      )}
    </ActionPanel>
  )
}
