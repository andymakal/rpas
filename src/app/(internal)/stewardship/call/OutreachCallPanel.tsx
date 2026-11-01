'use client'

/**
 * OutreachCallPanel — the guided outbound outreach (marketing) call panel. It is
 * the left-hand PANEL of the outbound call workbench (the "Make the Calls That
 * Are Due" / "Call Other Reachable Customers" screen), alongside the customer
 * contact panel and the history panels. See
 * `.kiro/steering/ui-composition-vocabulary.md` for the Lego → Panel →
 * Workbench → Workflow tiers.
 *
 * It opens with the dial control and the single question "did we reach them or
 * not" — an outbound call has exactly two outcomes — then progressively reveals
 * the next relevant section on the SAME page as the worker proceeds. The
 * post-reach choices are specific to THIS panel, not a global set (an inbound
 * call, or another workbench, would branch differently). Every terminal path
 * records exactly ONE grouped attempt and then advances to the next customer.
 */

import { useEffect, useState } from 'react'
import {
  Mail, Clock, CircleAlert, PenLine, Voicemail, MessageSquare,
  PhoneCall, PhoneOff, Check, Shuffle,
} from 'lucide-react'
import {
  ActionPanel, WorkflowButton, NextNote, CallButton, SkipForNowButton,
  CallMentorCap, TalkPathCard, CallOutcomeChoice, Divider,
} from '@/components/workflow'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
import { buildMailto, SERVICING_CALL_SCRIPTS, interpolate } from '@/lib/templates'
import { type CallSelection } from '@/lib/stewardship/customer-history'
import type { Detail, Holding } from '../types'
import { fullName, textActionAvailable, shortDate, CallContext } from '../shared'
import { ServicingFormDelivery } from '../panels/ServicingFormDelivery'
import { ChannelUnavailable } from './ChannelUnavailable'
import { CallScriptCard } from './CallScriptCard'

export type ReachChoice = null | 'reached' | 'not-reached'

/**
 * The live-call opening talk track, shown at the top of the call workbench. The
 * approved servicing-agent opening script (SERVICING_CALL_SCRIPTS.opening) with
 * the employee's and customer's first names filled in. When the employee name
 * is not resolvable it falls back to the office name ("our office") so the
 * script still reads cleanly with no unresolved placeholder.
 */
function callOpeningScript(firstName: string, senderName: string | null): string {
  return interpolate(SERVICING_CALL_SCRIPTS.opening.body, {
    first_name: firstName,
    sender_name: senderName ?? 'our office',
  })
}

/**
 * The "why you're calling" mentoring content for THIS workbench — the
 * servicing-agent outreach situation. It explains why this specific call is
 * being made on this workflow so a worker who opens the cap understands the
 * reason, not just the instruction. It is fed into the CallMentorCap Lego as
 * content; the Lego owns only display. This is the content seam: today the
 * situation's text is resolved here (first name interpolated); later the same
 * prop can be filled by a situation/ZEN-selected catalog entry without any
 * change to the Lego or the panel layout.
 */
function callMentorBody(firstName: string | null): string {
  const possessive = firstName ? `${firstName}\u2019s` : 'the customer\u2019s'
  return (
    `Our office lost access to ${possessive} life insurance policy when Allstate\u2019s life business moved to ` +
    'Everlake, because we are not listed as the servicing agent. The servicing-agent authorization simply ' +
    'restores our access to help with questions and servicing. It does not change the policy or coverage, and ' +
    'it needs a wet (ink) signature.'
  )
}

export function OutreachCallPanel({
  detail, request, busy, noteBox, act, hasNextInActivity, onSkip, onSelectionChange,
  callNote,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity: boolean
  /** Skip the open customer without recording a call, changing status, or
   * touching follow-up dates: advance to the next available customer and send
   * this one to the back of the working sequence. When supplied, a "Skip for
   * now" control is shown — available before AND during the call workflow. */
  onSkip?: () => void
  /** Report the live selection up so the history column previews the entry this
   * call will record, built dynamically as the worker proceeds. */
  onSelectionChange?: (selection: CallSelection | null) => void
  /** The optional Call Notes text, now OWNED BY THE TASK and EDITED in the
   * history column (HistoryNotesField). The panel only READS it, to fold into
   * the recorded interaction and the live preview. */
  callNote: string
}) {
  const c = detail.customer
  const name = fullName(c)
  const phone = c.phone
  // Whether the reached call has already been recorded (survives the reload that
  // record-attempt triggers). When it has, the flow resumes at the reached
  // decision with the authorization form ready, rather than restarting at the
  // reach choice.
  const reached = detail.last_call_outcome === 'reached'
  const [reach, setReach] = useState<ReachChoice>(reached ? 'reached' : null)

  // ── Didn\u2019t-reach sub-state ──────────────────────────────────────────────
  // Whether a voicemail was actually left, whether the Hearsay text was sent,
  // and whether the follow-up email was sent. Only completed communications are
  // recorded, so these gate which channels the single grouped attempt carries.
  const [voicemailLeft, setVoicemailLeft] = useState<boolean | null>(null)
  const [textSent, setTextSent] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // ── Reached sub-state ────────────────────────────────────────────────────
  // The reached outcome is one of the four UNIVERSAL call outcomes, laid out as
  // a 2x2: Advance / Decline on the top row (the clean yes/no), Defer / Divert
  // on the bottom (the "not a clean yes/no" pair). This fixed four-way set is
  // situation-INDEPENDENT; a future situation table supplies each button's LABEL
  // and its downstream action, but the four categories and their positions never
  // change (see the post-reach-outcome discussion / ui-composition-vocabulary:
  // the post-reach branch is workbench-specific). Storage stays concrete for
  // now — each category maps onto the EXISTING recorded action, so history and
  // reporting are undisturbed until the stored-disposition model is settled:
  //   Advance → the servicing-agent authorization-form delivery (form-sent)
  //   Defer   → promised-callback date capture (record-attempt call=callback)
  //   Decline → the reversible not-interested stop (record-attempt call=not-interested)
  //   Divert  → "something else is the right move" — placeholder, no action
  //             wired yet; the situation table will supply the diversions.
  const [decision, setDecision] = useState<null | 'advance' | 'decline' | 'defer' | 'divert'>(reached ? 'advance' : null)
  const [callbackWhen, setCallbackWhen] = useState('')

  // The Talk Path appears in two places and each is independently collapsible,
  // identical behavior: start collapsed, click to open, click to close, so an
  // experienced caller can leave it shut while a newer one opens it. The TOP
  // copy sits by the Call button (read before dialing); the LOWER copy sits
  // under the reach decision once Reached. Only one is ever shown at a time
  // (the top is hidden once reached), so they never both display.
  const [talkPathTopOpen, setTalkPathTopOpen] = useState(false)
  const [talkPathReachedOpen, setTalkPathReachedOpen] = useState(false)

  // ── Optional Call Notes ────────────────────────────────────────────────────
  // One free-text field, saved WITH the completed interaction (appended to the
  // recorded touch), never a separate history entry. The text is OWNED BY THE
  // TASK and edited in the history column (HistoryNotesField); this panel only
  // consumes it. `noteForAction` is the trimmed value folded into the recorded
  // action and the live preview.
  const noteForAction = callNote.trim() || null

  // Map the universal UI outcome onto the CONCRETE disposition the history layer
  // records. Storage/reporting stays concrete (see the decision-state note):
  // Advance→agreed (the reached authorization), Defer→callback, Decline→not
  // -interested. Divert has no wired action yet, so it reports no disposition
  // (null) and the preview shows a plain "Reached" until the situation table
  // gives Divert its own recorded outcomes.
  const decisionDisposition: 'agreed' | 'callback' | 'not-interested' | null =
    decision === 'advance' ? 'agreed'
    : decision === 'defer' ? 'callback'
    : decision === 'decline' ? 'not-interested'
    : null

  // Report the live selection up so the Next History Entry column previews
  // exactly what completing this call will record, combined into one concise
  // entry, updating as the worker proceeds. The reached authorization form is
  // folded in once the reached call has been recorded (reached === true), since
  // the form send is part of that one reached interaction.
  useEffect(() => {
    if (!onSelectionChange) return
    onSelectionChange({
      reach,
      voicemailLeft,
      textSent,
      emailSent,
      decision: decisionDisposition,
      callbackDate: callbackWhen || null,
      // The reached · agreed completion sends the form and records the reached
      // call together. It is NOT "sent" merely because the customer was reached
      // and agreed; the send is confirmed by the form-delivery confirm action,
      // which immediately advances to the next customer. So the preview treats
      // the form as pending (Reached · Agreed) throughout this screen and never
      // claims an unsent form was sent.
      formSent: false,
      // The chosen delivery method, so the pending preview names emailed vs
      // mailed accurately. Persisted on the detail when the worker picks it.
      formDeliveryMethod: detail.form_delivery_method ?? null,
      note: callNote.trim() || null,
    })
  }, [onSelectionChange, reach, voicemailLeft, textSent, emailSent, decisionDisposition, callbackWhen, detail.form_delivery_method, callNote])

  const nextSuffix = hasNextInActivity ? ' Next customer.' : ''

  // The CALLER identity for the scripts, from the established producer source:
  // the signed-in employee's first name ("[Employee]") and their validated
  // CALLBACK number ("[Callback Number]"). The callback number is the
  // employee's/office number, NEVER the customer's phone. Either may be absent;
  // the UI never prints an unresolved placeholder or an empty number.
  const senderName = detail.call_actor?.first_name ?? null
  const callbackPhone = detail.call_actor?.callback_phone ?? null

  // Interpolated servicing-agent scripts. The customer's first name and the
  // caller's identity fill the placeholders; nothing is left as a raw
  // placeholder. The customer-facing wording falls back to a neutral form when a
  // value is absent so a script still reads cleanly.
  const scriptVars = {
    first_name: c.first_name ?? 'there',
    sender_name: senderName ?? 'our office',
    phone: callbackPhone ?? '',
  }
  const voicemailScript = interpolate(SERVICING_CALL_SCRIPTS.voicemail.body, scriptVars)
  const textScript = interpolate(SERVICING_CALL_SCRIPTS.hearsay_text.body, scriptVars)
  const followUpMailto = buildMailto(
    c.email,
    SERVICING_CALL_SCRIPTS.follow_up_email.subject,
    interpolate(SERVICING_CALL_SCRIPTS.follow_up_email.body, scriptVars),
  )

  // Channel availability. A channel is shown as AVAILABLE only when it can
  // actually be completed; otherwise it is shown explicitly as unavailable, so
  // the worker never pretends a channel was used that could not be.
  //   - The voicemail script asks the customer to call back AT the callback
  //     number, so leaving a usable voicemail needs that number.
  //   - The Hearsay text needs a textable phone AND the callback number is not
  //     required (the text does not state it), but it does identify the caller.
  //   - The follow-up email needs a usable email.
  const canText = textActionAvailable(detail)
  const canEmail = detail.contact_options?.canEmail ?? !!c.email
  const hasCallbackNumber = !!callbackPhone

  // Record the DIDN\u2019T-REACH attempt as ONE grouping. The call channel's
  // outcome is 'voicemail' (the no-answer outcome that schedules the next call);
  // the separate voicemail CHANNEL is recorded as a completed touch ONLY when a
  // voicemail was actually left, and the text/email channels ONLY when they were
  // actually sent. So only communications actually completed are preserved.
  function recordNotReached() {
    const action: Record<string, unknown> = { type: 'record-attempt', call: 'voicemail' }
    // Record a voicemail touch only when one was actually left. When no callback
    // number resolves, the voicemail channel is unavailable (no Yes/No shown), so
    // it is never recorded as completed.
    if (callbackPhone && voicemailLeft) action.voicemail = 'touch'
    if (textSent) action.text = 'touch'
    if (emailSent) action.email = 'touch'
    if (noteForAction) action.note = noteForAction
    act(
      action,
      'Attempt recorded. Next call auto-scheduled; the customer moves to Waiting for Response.',
      { advanceToNext: true },
    )
  }

  // Bad number: a single grouped attempt recording the unusable call channel.
  function recordBadNumber() {
    act(
      { type: 'record-attempt', call: 'bad-number', note: noteForAction },
      'Bad number recorded. Moved to Contact Research.',
      { advanceToNext: true },
    )
  }

  // Reached / Didn't Reach are TOGGLES that only steer the on-screen workflow —
  // they record NOTHING. Choosing one clears the OTHER branch's downstream
  // selections so a half-made choice from the opposite outcome never leaks into
  // the new one, and re-clicking the selected outcome clears it back to the
  // undecided state. Recording happens only at each branch's explicit
  // completion (form sent, callback saved, not-interested confirmed, attempt
  // recorded), never here.
  function chooseReached() {
    if (reach === 'reached') { setReach(null); setDecision(null); setCallbackWhen(''); return }
    setReach('reached')
    // Entering Reached: drop any Didn't-Reach channel selections, collapse the
    // top Talk Path (the lower copy takes over), and start the lower Talk Path
    // collapsed so it opens only if the caller wants it.
    setVoicemailLeft(null); setTextSent(false); setEmailSent(false)
    setTalkPathTopOpen(false)
    setTalkPathReachedOpen(false)
  }
  function chooseNotReached() {
    if (reach === 'not-reached') { setReach(null); setVoicemailLeft(null); setTextSent(false); setEmailSent(false); return }
    setReach('not-reached')
    // Entering Didn't Reach: drop any Reached decision + callback draft.
    setDecision(null); setCallbackWhen('')
  }

  const talkPathBody = callOpeningScript(c.first_name ?? 'there', senderName)

  return (
    // The panel heading is rendered by CallMentorCap below (so the cap can sit
    // beside the instruction), not by ActionPanel's own heading.
    <ActionPanel>
      {noteBox}

      {/* The call instruction with the mentoring cap beside it: "Call <name>"
          plus a standalone graduation cap. If the worker is unsure WHY this
          call on this workflow, they tap the cap and the reason opens inline.
          Content is fed in (callMentorBody) — the Lego owns only display. */}
      <CallMentorCap heading={`Call ${name}`}>
        {callMentorBody(c.first_name)}
      </CallMentorCap>

      <CallContext detail={detail} />

      {/* 1. Dial + Skip share the top line as EQUAL halves (grid-cols-2) when a
          skip handler is supplied. Call is the solid teal primary — it is what
          we want the worker to do — and Skip is the quiet outline beside it,
          equal width and height, so the row reads balanced while the emphasis
          stays on calling. The CallButton Lego dials the stored number through
          the team member\u2019s configured phone (RingCentral); launching the
          dialer is not proof the call happened. With no skip handler, Call fills
          the row. */}
      {onSkip ? (
        <div className="grid grid-cols-2 items-stretch gap-2">
          <CallButton phone={phone} />
          <SkipForNowButton onSkip={onSkip} disabled={busy} className="h-14 w-full justify-center" />
        </div>
      ) : (
        <CallButton phone={phone} />
      )}

      {/* The Talk Path, collapsed, sits right under the Call button BEFORE the
          reach decision, so the worker can read what they will say before they
          dial. Reaching the customer collapses this copy and opens the one
          below the reach decision, so the talk path is never shown twice. It is
          hidden entirely once the call is reached (the lower copy takes over). */}
      {reach !== 'reached' && (
        <TalkPathCard
          body={talkPathBody}
          open={talkPathTopOpen}
          onOpenChange={setTalkPathTopOpen}
          className="mt-3"
        />
      )}

      {/* 2. With Skip moved up, this line holds only the two real outcomes of an
          outbound call — Reached and Didn\u2019t Reach — as EQUAL halves filling
          the box (two options, two halves). The opening script stays hidden
          until Reached is chosen, so the worker decides the outcome first. */}
      <Divider className="my-4" />
      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">Did you reach the customer?</p>
        <div className="grid grid-cols-2 gap-2">
          <WorkflowButton icon={PhoneCall} selected={reach === 'reached'} disabled={busy}
            className="w-full justify-center" onClick={chooseReached}>
            Reached
          </WorkflowButton>
          <WorkflowButton icon={PhoneOff} selected={reach === 'not-reached'} disabled={busy}
            className="w-full justify-center" onClick={chooseNotReached}>
            Didn&apos;t reach
          </WorkflowButton>
        </div>
      </div>

      {/* Optional Call Notes now live in the HISTORY column (HistoryNotesField),
          next to the Next History Entry preview they contribute to, so the work
          column stays focused on the call steps. The task owns the text; this
          panel only reads it (noteForAction) to fold into the recorded outcome.
          The behavior is unchanged: the note is saved WITH the completed outcome
          and nothing is recorded if no outcome is completed. */}

      {/* ── DIDN\u2019T REACH ─────────────────────────────────────────────────── */}
      {reach === 'not-reached' && (
        <><Divider className="my-4" /><div className="space-y-4">
          {/* Voicemail. The approved script is READ ALOUD, so the card shows no
              Copy (hideCopy). The script asks the customer to call back at the
              callback number, so it can only be read when that number resolves.
              Without it, the channel is shown as unavailable rather than offering
              a script with a missing number. */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
              <Voicemail className="size-4 text-ink-supporting" aria-hidden /> Voicemail
            </p>
            {hasCallbackNumber ? (
              <>
                <CallScriptCard label={SERVICING_CALL_SCRIPTS.voicemail.label} body={voicemailScript} hideCopy />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-secondary">Did you leave a voicemail?</span>
                  <WorkflowButton selected={voicemailLeft === true} disabled={busy} onClick={() => setVoicemailLeft(true)}>Yes</WorkflowButton>
                  <WorkflowButton selected={voicemailLeft === false} disabled={busy} onClick={() => setVoicemailLeft(false)}>No</WorkflowButton>
                </div>
              </>
            ) : (
              <ChannelUnavailable
                body="No callback number is set for your profile, so the voicemail script can’t name a number to call back. Ask an admin to add your phone on the Team page, then this voicemail script becomes available."
              />
            )}
          </div>

          {/* Hearsay text: the prepared script with Copy for manual sending.
              When there is no textable number, the channel is shown as
              unavailable rather than hidden or implying a text could be sent. */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
              <MessageSquare className="size-4 text-ink-supporting" aria-hidden /> Text (Hearsay)
            </p>
            {canText ? (
              <>
                <CallScriptCard label={SERVICING_CALL_SCRIPTS.hearsay_text.label} body={textScript} />
                <label className="flex cursor-pointer items-center gap-2.5 text-base font-medium text-ink">
                  <input type="checkbox" checked={textSent} disabled={busy}
                    onChange={e => setTextSent(e.target.checked)}
                    className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500" />
                  I sent this text through Hearsay
                </label>
              </>
            ) : (
              <ChannelUnavailable body="No usable mobile number on file, so a Hearsay text can’t be sent. Add or correct the phone in Contact Research to make this available." />
            )}
          </div>

          {/* Follow-up email: opens pre-composed in Outlook via mailto. When
              there is no usable email, the channel is shown as unavailable
              rather than hidden or implying an email was sent. */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
              <Mail className="size-4 text-ink-supporting" aria-hidden /> Follow-up email
            </p>
            {canEmail ? (
              <>
                <a href={followUpMailto} className="block">
                  <WorkflowButton icon={Mail}>Open prepared follow-up email</WorkflowButton>
                </a>
                <label className="flex cursor-pointer items-center gap-2.5 text-base font-medium text-ink">
                  <input type="checkbox" checked={emailSent} disabled={busy}
                    onChange={e => setEmailSent(e.target.checked)}
                    className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500" />
                  I sent this follow-up email
                </label>
              </>
            ) : (
              <ChannelUnavailable body="No usable email on file, so a follow-up email can’t be sent. Add or correct the email in Contact Research to make this available." />
            )}
          </div>

          {/* Record the whole no-reach interaction as ONE grouped attempt.
              Recording waits until the worker has answered whether a voicemail
              was left, so the attempt is honest about what was completed. */}
          <div className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
            <WorkflowButton icon={PenLine} selected disabled={busy || (hasCallbackNumber && voicemailLeft === null)} onClick={recordNotReached}>
              {busy ? 'Recording\u2026' : 'Record this attempt'}
            </WorkflowButton>
          </div>

          {/* Bad number: a distinct recorded outcome, kept out of the way. */}
          <Divider className="my-3" />
          <div>
            <p className="mb-1 text-sm text-ink-supporting">Not a working number?</p>
            <WorkflowButton icon={PhoneOff} disabled={busy} onClick={recordBadNumber}>
              Bad number
            </WorkflowButton>
          </div>
        </div></>
      )}

      {/* ── REACHED ──────────────────────────────────────────────────────────── */}
      {reach === 'reached' && (
        <><Divider className="my-4" /><div className="space-y-4">
          {/* The Talk Path is the guidance for HAVING the conversation, so it
              shows only until the caller records what the customer decided. Once
              a decision is selected (Agreed / Callback / Not interested) it is
              hidden to keep the column focused on the decision's next actions;
              clearing the decision brings it back. The "why you're calling"
              mentoring is NOT repeated here — it lives on the cap beside the
              call instruction at the top of the panel. This lower Talk Path is
              the same Lego as the top one, forced open (this is the worker's
              next step, so it opens rather than waiting for a click), and the
              top copy is collapsed whenever the call is reached, so the talk
              path is shown in exactly one place. */}
          {decision === null && (
            <TalkPathCard
              body={talkPathBody}
              open={talkPathReachedOpen}
              onOpenChange={setTalkPathReachedOpen}
            />
          )}

          {/* Capture the customer’s actual decision. Each choice toggles: picking
              the one already selected clears it, which restores the script and
              mentoring above. Clearing never un-records an already-recorded
              reached attempt (that call happened); it only reopens the choice. */}
          {/* The four universal reached-call outcomes (CallOutcomeChoice Lego):
              Advance / Decline on top, Defer / Divert below. Labels here are the
              structural PLACEHOLDERS; a situation table will later pass the real
              per-situation wording (e.g. Advance → "Agreed to authorize" on this
              servicing call, "Agreed to an appointment" on a referral) and the
              host still owns each outcome's downstream action below. */}
          <CallOutcomeChoice selected={decision} onSelect={setDecision} disabled={busy} />

          {/* Advance -> the established authorization-form process (this
              situation's Advance action). */}
          {decision === 'advance' && (
            <div className="space-y-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4">
              <p className="text-base font-semibold text-ink">Send the servicing-agent authorization form</p>
              {/* The procedural guidance that used to sit beneath the confirm
                  button now lives in the shared Mentoring disclosure at the top
                  of this form-delivery section (HOW/why, above the steps it
                  explains), leaving the action itself uncluttered. */}
              <MentorGuidance label="How recording the form works">
                Generate the form, send it (email or postal), then record it here. Recording the form sent is what
                logs the reached call and moves the customer to Waiting for Form, then advances you to the next call.
                Nothing is recorded until then, and nothing is auto-closed.
              </MentorGuidance>
              <ServicingFormDelivery
                detail={detail}
                request={request}
                name={name}
                busy={busy}
                act={act}
                confirmLabelFor={m => (m === 'postal' ? `Form mailed to customer.${nextSuffix}` : `Form sent to customer.${nextSuffix}`)}
                onConfirm={() => act(
                  // The SINGLE completion of the Agreed path: record the reached
                  // call AND the form send together, now that the form has
                  // actually gone out. `reached` folds the reached outcome +
                  // engagement into this one action, so nothing was recorded (and
                  // the customer never left available work) merely by selecting
                  // "Agreed to authorize" earlier. The optional Call Notes ride
                  // with this one interaction.
                  { type: 'form-sent', reached: true, note: noteForAction },
                  'Reached and authorization form sent. Moved to Waiting for Form.',
                  { advanceToNext: true },
                )}
              />
            </div>
          )}

          {/* Defer -> capture the promised callback DATE (date only, no clock
              time) — this situation's Defer action. */}
          {decision === 'defer' && (
            <div className="space-y-2 rounded-xl border border-surface-border bg-surface-card p-4">
              <label htmlFor="wb-cb" className="flex items-center gap-2 text-base font-medium text-ink">
                <Clock className="size-4 text-ink-supporting" aria-hidden /> Promised callback date
              </label>
              {/* Date only. Right Path records no clock time or calling window
                  for a callback yet (a separate future enhancement). */}
              <input id="wb-cb" type="date" value={callbackWhen} onChange={e => setCallbackWhen(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40" />
              <WorkflowButton icon={Check} selected disabled={busy || !callbackWhen}
                onClick={() => act(
                  { type: 'record-attempt', call: 'callback', callback_date: callbackWhen, note: noteForAction },
                  `Callback promised for ${callbackWhen ? shortDate(callbackWhen) : ''}.`,
                  { advanceToNext: true },
                )}>
                Save promised callback
              </WorkflowButton>
              <NextNote>The promised callback is saved as a customer commitment and resurfaces as a due call on that date. It outranks focus-based ordering.{nextSuffix}</NextNote>
            </div>
          )}

          {/* Decline -> the established reversible stop (this situation's
              Decline action). */}
          {decision === 'decline' && (
            <div className="space-y-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-4">
              <p className="text-base text-ink-secondary">
                Records an explicit decline. Outreach stops until someone deliberately reopens it. Nothing is
                auto-closed, and this is reversible.
              </p>
              <WorkflowButton icon={CircleAlert} selected disabled={busy}
                onClick={() => act(
                  { type: 'record-attempt', call: 'not-interested', note: noteForAction },
                  'Recorded as not interested. Outreach stopped; a human decides any next step.',
                  { advanceToNext: true },
                )}>
                Record not interested
              </WorkflowButton>
            </div>
          )}

          {/* Divert -> "something else is the right next move." PLACEHOLDER: the
              structure is here, but the actual diversions (e.g. email a quote,
              reopen as a different review, hand to another workflow) come from
              the situation table and can route into their own rules. For now it
              records nothing and wires no action, so no disposition is written
              from an unfinished branch; it only explains what Divert is for. */}
          {decision === 'divert' && (
            <div className="space-y-2 rounded-xl border border-dashed border-surface-border-strong bg-surface-muted p-4">
              <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
                <Shuffle className="size-4 text-ink-supporting" aria-hidden /> Something else is the right next move
              </p>
              <p className="text-sm text-ink-supporting">
                The customer is still engaged, but the right next step isn’t Advance, Decline, or Defer (for
                example: email a quote instead, or reopen this as a different kind of review). The specific
                diversions for this call will come from the situation table. No action is wired to Divert yet, so
                nothing is recorded from here.
              </p>
            </div>
          )}
        </div></>
      )}

    </ActionPanel>
  )
}
