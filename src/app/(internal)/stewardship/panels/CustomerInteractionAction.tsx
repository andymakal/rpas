'use client'

/**
 * Customer Interaction — the action column for the active-conversation stage
 * between routine calling and Servicing Access. It records the conversation
 * across email, phone, and text — both an INCOMING response from the customer
 * and an OUTGOING reply — and lets the employee set a FOLLOW-UP commitment and
 * date WITHOUT placing a phone call. A due follow-up surfaces here as actionable.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Mail, Phone, MessageSquare, Inbox, ExternalLink, Clock, Check, FileText, Hand, ArrowLeft,
} from 'lucide-react'
import { ActionPanel, WorkflowButton, Divider } from '@/components/workflow'
import { ServicingFormDelivery } from './ServicingFormDelivery'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import { type InteractionSelection } from '@/lib/stewardship/customer-history'
import type { Detail, Holding } from '../types'
import { fullName, FollowUpChase } from '../shared'

const INTERACTION_CHANNELS: { id: 'email' | 'call' | 'text'; label: string; icon: typeof Mail }[] = [
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'call', label: 'Phone', icon: Phone },
  { id: 'text', label: 'Text', icon: MessageSquare },
]

export function CustomerInteractionAction({
  detail, request, busy, note, act, reload, onAdvanceToNext, onSelectionChange,
}: {
  detail: Detail
  /** The request policies the authorization form covers. */
  request: Holding[]
  busy: boolean
  note: string | null
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  /** Reload the task detail (history + engagement) after a touch-route record,
   * which does not go through `act`. */
  reload: () => Promise<void>
  /** Return to the relationship list (Back to Conversations, and after a
   * resolved outcome). Never advances to another customer. */
  onAdvanceToNext?: () => void
  /** Report the single action the worker is preparing up to the history column,
   * so the Next History Entry preview shows what completing it will record. */
  onSelectionChange?: (selection: InteractionSelection | null) => void
}) {
  const name = fullName(detail.customer)
  const [channel, setChannel] = useState<'email' | 'call' | 'text'>('email')
  const [incoming, setIncoming] = useState(true)
  const [automated, setAutomated] = useState(false)
  const [notes, setNotes] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [recBusy, setRecBusy] = useState(false)
  const [localNote, setLocalNote] = useState<string | null>(null)
  // Which resolve action, if any, the worker is actively engaging (hovering or
  // focusing). A transient intent signal so the preview can show what recording
  // the signed authorization / a refusal WILL log, without staging or changing
  // the single-click commit. Cleared on leave/blur.
  const [resolveIntent, setResolveIntent] = useState<'authorization' | 'refusal' | null>(null)
  // The action group the employee is CURRENTLY working on, tracked by recency of
  // interaction (not a fixed priority), so the Next History Entry preview
  // follows what they are doing right now: it becomes 'communication' when they
  // touch a direction/channel/note control and 'follow-up' when they engage the
  // follow-up date, each on the most recent interaction. This is what makes the
  // preview switch to the follow-up after a communication was composed, and back
  // to the communication if they return to editing it. Null until the first
  // interaction, where the default compose preview applies.
  const [activeGroup, setActiveGroup] = useState<'communication' | 'form' | 'follow-up' | null>(null)
  // Live state of the (re)send-the-form unit, reported up by ServicingFormDelivery
  // so the preview describes exactly what confirming will record. `formKey` remounts
  // the unit after a send so it can be used again (a second resend) from a clean state.
  const [formMethod, setFormMethod] = useState<'email' | 'postal'>(detail.form_delivery_method ?? 'email')
  const [formAlreadyHeld, setFormAlreadyHeld] = useState(false)
  const [formGenerated, setFormGenerated] = useState(false)
  const [formKey, setFormKey] = useState(0)

  // Awaiting the signed authorization: the form was SENT but not yet returned
  // (waiting-for-form with no recorded receipt). Such a customer is still in
  // Customer Interaction, and their follow-up is the signature chase carried on
  // follow_up_due.
  const awaitingSignature = detail.queue === 'waiting-for-form' && !detail.form_received_at

  // A due follow-up surfaces prominently so it is visible and actionable within
  // Customer Interaction. Pre-authorization: a promised callback date on/before
  // today. Awaiting signature: a follow_up_due that has lapsed. Either way the
  // date shown is the promised/next-chase date.
  const callbackDue = isCallbackDue(detail.callback_date, null)
  const signatureFollowUpDue =
    awaitingSignature && !!detail.follow_up_due && new Date(detail.follow_up_due).getTime() <= Date.now()
  const followUpDue = callbackDue || signatureFollowUpDue
  const followUpDueDate = awaitingSignature
    ? (detail.follow_up_due ? detail.follow_up_due.slice(0, 10) : null)
    : (detail.callback_date ?? null)

  const recordCommunication = useCallback(async () => {
    setRecBusy(true)
    setLocalNote(null)
    try {
      const res = await fetch(`/api/stewardship/${detail.id}/touch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touch_type: channel,
          notes: notes.trim() || undefined,
          direction: incoming ? 'incoming' : 'outgoing',
          automated: incoming ? automated : false,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setLocalNote(json?.error ?? 'Could not record the communication.'); return }
      setNotes('')
      setAutomated(false)
      setLocalNote(
        incoming
          ? (json?.data?.engaged ? 'Incoming response recorded. Customer marked engaged.' : 'Incoming response recorded.')
          : 'Outgoing reply recorded.',
      )
      // Refresh the task so the history column and any engagement reflect it.
      await reload()
    } catch {
      setLocalNote('Network error recording the communication.')
    } finally {
      setRecBusy(false)
    }
  }, [detail.id, channel, notes, incoming, automated, reload])

  // Report the SINGLE action the worker is preparing up to the history column,
  // so the Next History Entry preview reflects it. Exactly one action is
  // previewed; independent actions are never combined, and nothing is ever
  // described as already recorded. The previewed action FOLLOWS what the worker
  // is doing right now, chosen by recency of interaction rather than a fixed
  // priority:
  //   1. A resolve button being engaged (hover/focus) wins while engaged.
  //   2. Otherwise the group the worker most recently interacted with
  //      (activeGroup): the follow-up when they are working the follow-up date,
  //      the communication when they are composing it.
  //   3. Before any interaction, the panel's primary action — the default
  //      compose selection.
  // So composing a communication, then entering a follow-up date, moves the
  // preview to the follow-up; returning to the communication moves it back.
  const directionOf = (): 'incoming' | 'automated' | 'outgoing' =>
    !incoming ? 'outgoing' : automated ? 'automated' : 'incoming'
  const communicationPreview = (): InteractionSelection => ({
    kind: 'communication', direction: directionOf(), channel, note: notes.trim() || null,
  })
  useEffect(() => {
    if (!onSelectionChange) return
    if (resolveIntent) {
      onSelectionChange({ kind: resolveIntent })
      return
    }
    if (activeGroup === 'follow-up') {
      onSelectionChange({ kind: 'follow-up', date: followUpDate || null })
      return
    }
    if (activeGroup === 'form') {
      onSelectionChange({ kind: 'form', method: formMethod, alreadyHeld: formAlreadyHeld, generated: formGenerated })
      return
    }
    if (activeGroup === 'communication') {
      onSelectionChange(communicationPreview())
      return
    }
    // Before any interaction: the panel's primary action is recording a
    // communication, so preview that default compose selection.
    onSelectionChange(communicationPreview())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectionChange, resolveIntent, activeGroup, incoming, automated, channel, notes, followUpDate, formMethod, formAlreadyHeld, formGenerated])

  const ChannelIcon = INTERACTION_CHANNELS.find(c => c.id === channel)?.icon ?? Mail
  const noteBox = (note || localNote) && (
    <div className="flex items-center gap-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4 text-base text-status-confirmed-strong">
      <Check className="size-5" aria-hidden /> {localNote ?? note}
    </div>
  )

  return (
    <ActionPanel heading={`Work ${name}\u2019s conversation`}>
      {/* Collapsible Mentoring at the top of the working column (the purple
          Mentor identity, distinct from the teal Assistant). It carries the
          coaching that explains how to work the conversation — the guidance
          that previously sat at the bottom of this column — so the explanatory
          text now lives in Mentoring rather than as a trailing note. */}
      <MentorGuidance label="Mentoring on this conversation">
        Record incoming responses and outgoing replies, add conversation notes, and set the next
        follow-up you promised. Keep working toward the signed servicing-agent authorization: when
        it comes back, record it to hand off to Servicing Access. A refusal stops outreach
        (reversible if the customer re-engages). Everything you record is saved to the
        customer&apos;s history; leaving the conversation records nothing.
      </MentorGuidance>

      {noteBox}

      {/* A due follow-up, surfaced as actionable within Customer Interaction.
          "Mark follow-up done" completes it so it no longer shows overdue; the
          next due follow-up only reappears when one is scheduled below. */}
      {followUpDue && followUpDueDate && (
        <div className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <p className="text-base font-semibold">Follow-up due</p>
              <p className="text-sm">
                {awaitingSignature
                  ? `A follow-up on ${name}\u2019s outstanding signed authorization was due ${followUpDueDate}. Reach out and record the interaction below, mark it done, and schedule the next follow-up if the form is still pending.`
                  : `You promised to follow up with ${name} on ${followUpDueDate}. Reach out and record the interaction below, mark it done, and set the next follow-up if the conversation continues.`}
              </p>
            </div>
          </div>
          <WorkflowButton
            icon={Check}
            selected={false}
            disabled={busy || recBusy}
            onClick={() => act({ type: 'complete-follow-up' }, 'Follow-up completed. It will not show overdue unless you schedule another.')}
          >
            Mark follow-up done
          </WorkflowButton>
        </div>
      )}

      {/* Record the conversation — incoming or outgoing, by email, phone, or
          text. No guided telephone flow required. Any interaction within this
          group marks the communication as the action being worked on, so the
          Next History Entry preview follows it (focus or pointer-down, captured
          so it also covers the buttons, textarea, and checkbox). */}
      <div
        className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4"
        onFocusCapture={() => setActiveGroup('communication')}
        onPointerDownCapture={() => setActiveGroup('communication')}
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Record the conversation</p>

        {/* Direction. */}
        <div className="flex flex-wrap gap-2">
          <WorkflowButton icon={Inbox} selected={incoming} disabled={recBusy || busy} onClick={() => setIncoming(true)}>
            Incoming from customer
          </WorkflowButton>
          <WorkflowButton icon={ExternalLink} selected={!incoming} disabled={recBusy || busy} onClick={() => setIncoming(false)}>
            Outgoing reply
          </WorkflowButton>
        </div>

        {/* Channel. */}
        <div className="flex flex-wrap gap-2">
          {INTERACTION_CHANNELS.map(c => (
            <WorkflowButton key={c.id} icon={c.icon} selected={channel === c.id} disabled={recBusy || busy} onClick={() => setChannel(c.id)}>
              {c.label}
            </WorkflowButton>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={incoming ? 'What did the customer say?' : 'What did you reply?'}
          rows={2}
          className="w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
        />

        {incoming && (
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={automated}
              disabled={recBusy || busy}
              onChange={e => setAutomated(e.target.checked)}
              className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500"
            />
            This is an automated reply (out-of-office, delivery receipt) — not a genuine response
          </label>
        )}

        <WorkflowButton icon={ChannelIcon} selected disabled={recBusy || busy} onClick={() => void recordCommunication()}>
          {recBusy ? 'Recording…' : incoming ? 'Record incoming response' : 'Record outgoing reply'}
        </WorkflowButton>
      </div>

      {/* Send (or re-send) the servicing-agent authorization form. The customer
          may have lost the introductory email, or replied "yes, send it" by
          voicemail/email/text, so the same form-delivery unit used on the call
          screen is available here at any point in the conversation. Confirming
          records the send in Customer History (form-sent) and leaves the
          customer on this screen; for a customer already waiting on the signed
          form it only logs the send and never moves them backward. */}
      <div
        className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
        onFocusCapture={() => setActiveGroup('form')}
        onPointerDownCapture={() => setActiveGroup('form')}
      >
        <ServicingFormDelivery
          key={formKey}
          heading="Send the servicing-agent authorization form"
          detail={detail}
          request={request}
          name={name}
          busy={busy || recBusy}
          act={act}
          onMethodChange={setFormMethod}
          onAlreadyHeldChange={setFormAlreadyHeld}
          onGeneratedChange={setFormGenerated}
          confirmLabelFor={(m, alreadyHeld) =>
            alreadyHeld
              ? 'Customer already has the form. Mark complete'
              : m === 'postal' ? 'Form mailed to customer' : 'Form sent to customer'
          }
          onConfirm={(_m, alreadyHeld) => {
            void Promise.resolve(
              act(
                { type: 'form-sent', alreadyHeld },
                alreadyHeld
                  ? 'Customer already has the form. Recorded in history.'
                  : 'Form sent. Recorded in history.',
              ),
            ).then(() => setFormKey(k => k + 1))
          }}
        />
      </div>

      {/* Set a follow-up commitment and date — no phone call required. Engaging
          this group marks the follow-up as the action being worked on, so the
          Next History Entry preview follows it even after a communication was
          composed (and switches back when the worker returns to the
          communication). */}
      <div
        className="space-y-2 rounded-xl border border-surface-border bg-surface-card p-4"
        onFocusCapture={() => setActiveGroup('follow-up')}
        onPointerDownCapture={() => setActiveGroup('follow-up')}
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Set a follow-up</p>
        <p className="text-sm text-ink-secondary">
          Promise to follow up on a date. It surfaces as a due follow-up here when the date arrives.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ci-followup" className="flex items-center gap-2 text-sm font-medium text-ink">
            <Clock className="size-4 text-ink-supporting" aria-hidden /> Follow-up date
          </label>
          <input
            id="ci-followup"
            type="date"
            value={followUpDate}
            onChange={e => setFollowUpDate(e.target.value)}
            className="rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
          />
          <WorkflowButton
            icon={Check}
            selected
            disabled={busy || recBusy || !followUpDate}
            onClick={() => {
              act({ type: 'set-follow-up', follow_up_date: followUpDate }, 'Follow-up recorded. It will surface when due.')
              setFollowUpDate('')
            }}
          >
            Set follow-up
          </WorkflowButton>
        </div>
      </div>

      {/* Direct outcomes that move the customer OUT of Customer Interaction,
          both reusing existing transitions and the existing handoff/history. */}
      <div className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Resolve the conversation</p>

        {/* Chase the signature. The form went out but has not come back, so the
            follow-up on the signature belongs here, in the conversation, BEFORE
            the signed authorization is recorded as received. Recording a chase
            keeps the customer here and schedules the next follow-up. */}
        {awaitingSignature && (
          <FollowUpChase detail={detail} busy={busy || recBusy} act={act} label="Followed up on the signature" />
        )}

        {/* Record receipt of the signed authorization → Servicing Access. Uses
            form-received when the form was already sent (waiting-for-form), else
            form-returned (the form came back from any conversation stage). Both
            record receipt in history and move the customer into the existing
            Servicing Access workflow. */}
        <div
          className="space-y-1.5"
          onMouseEnter={() => setResolveIntent('authorization')}
          onMouseLeave={() => setResolveIntent(null)}
          onFocusCapture={() => setResolveIntent('authorization')}
          onBlurCapture={() => setResolveIntent(null)}
        >
          <p className="text-sm text-ink-secondary">
            The signed authorization came back? Record receipt to move {name} into Servicing Access.
          </p>
          <WorkflowButton
            icon={FileText}
            selected={false}
            disabled={busy || recBusy}
            onClick={() =>
              act(
                { type: awaitingSignature ? 'form-received' : 'form-returned' },
                'Signed authorization recorded. Moving to Servicing Access.',
                { advanceToNext: true },
              )
            }
          >
            Record signed authorization received
          </WorkflowButton>
        </div>

        {/* Record an explicit customer refusal → stop outreach (reversible). The
            refuse transition is channel-agnostic, so a refusal by email or text
            is recorded without a placed call. */}
        <Divider className="my-3" />
        <div
          className="space-y-1.5"
          onMouseEnter={() => setResolveIntent('refusal')}
          onMouseLeave={() => setResolveIntent(null)}
          onFocusCapture={() => setResolveIntent('refusal')}
          onBlurCapture={() => setResolveIntent(null)}
        >
          <p className="text-sm text-ink-secondary">
            {name} declined? Stop outreach. This is reversible if they re-engage later.
          </p>
          <WorkflowButton
            icon={Hand}
            selected={false}
            disabled={busy || recBusy}
            onClick={() =>
              act(
                { type: 'refuse' },
                'Customer refusal recorded. Outreach stopped.',
                { advanceToNext: true },
              )
            }
          >
            Record customer refusal
          </WorkflowButton>
        </div>
      </div>

      {/* Return to the relationship list when the conversation is handled for
          now. The customer stays in Customer Interaction until the signed
          authorization arrives or they refuse; this never records anything and
          never auto-opens another customer — it simply goes back to the list. */}
      {onAdvanceToNext && (
        <WorkflowButton icon={ArrowLeft} selected={false} disabled={busy || recBusy} onClick={onAdvanceToNext}>
          Back to Conversations
        </WorkflowButton>
      )}
    </ActionPanel>
  )
}
