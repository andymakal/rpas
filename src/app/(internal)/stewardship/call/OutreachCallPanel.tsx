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
  Clock, CircleAlert, PenLine,
  PhoneCall, PhoneOff, Check, Shuffle,
} from 'lucide-react'
import {
  ActionPanel, WorkflowButton, NextNote, CallButton, SkipForNowButton,
  CallMentorCap, TalkPathCard, CallOutcomeChoice, Divider,
  VoicemailAttempt, useVoicemailDraft, voicemailOutcome,
  TextAttempt, useTextDraft, textOutcome, type TextUnavailableReason,
  EmailAttempt, useFollowUpEmailDraft, emailOutcome,
  CallbackPrecisionFields, useCallbackPrecisionDraft,
} from '@/components/workflow'
import { hasExactTime, commitmentSummary, resolveDueDate } from '@/lib/calendar/callback-precision'
import { deriveCustomerZone } from '@/lib/calendar/customer-zone'
import { zoneAbbreviation, createTimeContext } from '@/lib/time'
import { buildMailto, SERVICING_CALL_SCRIPTS, interpolate } from '@/lib/templates'
import { formatPhoneDisplay } from '@/lib/contact-input'
import { type CallSelection } from '@/lib/stewardship/customer-history'
import type { Detail, Holding } from '../types'
import { fullName, textActionAvailable, shortDate, CallContext } from '../shared'
import { ServicingFormDelivery } from '../panels/ServicingFormDelivery'

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
  // Each channel is a self-contained Lego owning its own Yes/No + reason draft
  // (VoicemailAttempt / TextAttempt / EmailAttempt). The panel holds only the
  // drafts and composes the Legos; it reads each channel's resolved outcome to
  // build the one grouped attempt. Only a completed ('done') channel counts as
  // a touch; a reasoned 'skipped' records its explanation but no touch; an
  // 'unavailable' (grayed) channel records its state and never gates recording.
  const voicemailDraft = useVoicemailDraft()
  const textDraft = useTextDraft()
  const emailDraft = useFollowUpEmailDraft()
  // Bad number is a toggle at the TOP of the didn't-reach flow (immediate
  // feedback): it grays voicemail + text (you can neither leave a voicemail nor
  // text a dead number) while the follow-up email stays available (email is not
  // tied to the phone). It does NOT gate recording; the single Record this
  // attempt button still finishes, and a recorded bad number routes the
  // customer to Contact Research instead of rescheduling the next call.
  const [badNumber, setBadNumber] = useState(false)

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
  // Whether the worker has indicated the customer ALREADY has the authorization
  // form (reported up by ServicingFormDelivery). Folded into the live Next
  // History Entry preview so it reads "already has the form" rather than "to be
  // emailed", and into the recorded completion so the stored history matches.
  const [formAlreadyHeld, setFormAlreadyHeld] = useState(false)

  // The promised-callback precision draft (exact time / days×bands windows /
  // any time that day). Replaces the old date-only input. The host resolves the
  // exact case into a calendar appointment; windows/anytime record callback
  // availability on the outreach row.
  const cbDraft = useCallbackPrecisionDraft()
  // Set when an exact-time appointment was just created, so the panel can offer
  // the .ics download for the operator to attach in Outlook (the generate →
  // send → confirm contract; Right Path never sends the invite itself).
  const [apptSaving, setApptSaving] = useState(false)
  const [apptError, setApptError] = useState<string | null>(null)

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

  const nextSuffix = hasNextInActivity ? ' Next customer.' : ''

  // A short customer-zone label ("ET"/"CT"/"MT"/"PT") for the exact-time hint,
  // so an operator in another zone sees whose clock the time is on. Derived from
  // the customer's state (the same derivation the server uses to store the zone);
  // null when the state is unknown, in which case the hint is simply omitted.
  const callbackCustomerZone = deriveCustomerZone(c.state ?? null)?.timeZone ?? null
  const callbackCustomerZoneLabel = callbackCustomerZone
    ? zoneAbbreviation(callbackCustomerZone, new Date())
    : null
  // A TimeContext on the CUSTOMER clock, so the due-date resolution (the chosen
  // date, or the next matching weekday for a recurring availability) is computed
  // on the customer's calendar, not the server's.
  const callbackCtx = createTimeContext({ customerTimeZone: callbackCustomerZone })

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
  // value is absent so a script still reads cleanly. The callback number is now
  // stored as bare 10 digits (contact-input standard), so it is formatted for
  // DISPLAY here via the shared formatter — the script reads "(215) 555-0100",
  // never raw digits.
  const scriptVars = {
    first_name: c.first_name ?? 'there',
    sender_name: senderName ?? 'our office',
    phone: callbackPhone ? formatPhoneDisplay(callbackPhone) : '',
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
  // A bad number grays the phone-dependent channels: you cannot leave a
  // voicemail on, or text, a dead number. Email is independent of the phone, so
  // it stays available. The callback number governs voicemail usability (the
  // script names a number to call back), independent of the customer's phone.
  const canText = textActionAvailable(detail) && !badNumber
  const canEmail = detail.contact_options?.canEmail ?? !!c.email
  const canVoicemail = !!callbackPhone && !badNumber

  // Why the text channel is unavailable, so the grayed history reads correctly:
  // an opt-out ("Opted out of texting") vs any other not-textable reason
  // ("No text"). Bad number is a not-textable reason, not an opt-out.
  const textUnavailableReason: TextUnavailableReason =
    detail.customer.sms_opt_out === true ? 'opted-out' : 'not-textable'

  // Resolve each channel Lego's outcome once, so recording, the record-gate, and
  // the live history preview all read from the same derived values.
  const vmOut = voicemailOutcome(voicemailDraft, canVoicemail)
  const textOut = textOutcome(textDraft, canText, textUnavailableReason)
  const emailOut = emailOutcome(emailDraft, canEmail)

  // The attempt can be recorded only once every AVAILABLE channel is answered
  // enough to record: a Yes, or a No with a reason (and an "Other" reason needs
  // typed text). An unavailable (grayed) channel is always complete, so it never
  // gates. Bad number does not gate either — it is a condition, not a question.
  const channelsComplete = vmOut.complete && textOut.complete && emailOut.complete

  // Report the live selection up so the Next History Entry column previews
  // exactly what completing this call will record, combined into one concise
  // entry, updating as the worker proceeds. The didn't-reach wording comes from
  // the channel Legos (notReachedFragments), so the preview and the recorded
  // attempt never drift. The reached authorization form is folded in once the
  // reached call has been recorded, since the form send is part of that one
  // reached interaction.
  useEffect(() => {
    if (!onSelectionChange) return
    onSelectionChange({
      reach,
      badNumber,
      notReachedFragments: [vmOut.fragment, textOut.fragment, emailOut.fragment].filter(Boolean),
      decision: decisionDisposition,
      callbackDate: cbDraft.draft.date || null,
      // The rich summary (exact time, or recurring days×bands) and whether this
      // is a timed appointment, so the preview shows the time / the availability.
      callbackLabel: (() => {
        const dd = resolveDueDate(callbackCtx, cbDraft.draft)
        return commitmentSummary(cbDraft.draft, dd ? shortDate(dd) : null)
      })(),
      callbackIsAppointment: hasExactTime(cbDraft.draft),
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
      // When the customer already has the form, the preview describes the
      // agreement to sign and return it rather than a pending send.
      formAlreadyHeld,
      note: callNote.trim() || null,
    })
  }, [
    onSelectionChange, reach, badNumber,
    vmOut.fragment, textOut.fragment, emailOut.fragment,
    decisionDisposition, cbDraft.draft, callbackCtx, detail.form_delivery_method, formAlreadyHeld, callNote,
  ])

  // Fold any channel reason text ("Other") into the attempt note alongside the
  // optional Call Notes, so the explanation rides with the one recorded
  // interaction. Reasons are not a structured field; reporting is a future query.
  function composedNote(): string | null {
    const parts = [noteForAction, vmOut.note, textOut.note, emailOut.note].filter(Boolean)
    return parts.length ? parts.join(' \u00b7 ') : null
  }

  // Record the DIDN\u2019T-REACH attempt as ONE grouping. When the number is bad
  // the call channel is 'bad-number' (routes to Contact Research); otherwise it
  // is 'voicemail' (the no-answer call outcome that schedules the next call).
  // A channel is recorded as a completed touch ONLY when its outcome is 'done'.
  function recordNotReached() {
    const action: Record<string, unknown> = {
      type: 'record-attempt',
      call: badNumber ? 'bad-number' : 'voicemail',
    }
    if (vmOut.touch) action.voicemail = 'touch'
    if (textOut.touch) action.text = 'touch'
    if (emailOut.touch) action.email = 'touch'
    const note = composedNote()
    if (note) action.note = note
    act(
      action,
      badNumber
        ? 'Bad number recorded. Moved to Contact Research.'
        : 'Attempt recorded. Next call auto-scheduled; the customer moves to Waiting for Response.',
      { advanceToNext: true },
    )
  }

  // Save a promised callback at the drafted precision. Three shapes:
  //   - exact:   create a calendar appointment (owned by the acting producer, so
  //              it is their My Work appointment) via the calendar route, which
  //              also returns an .ics for the operator to attach in Outlook; then
  //              record the callback on the outreach row so the promise shows as
  //              a due call. The appointment carries the exact time; the outreach
  //              row keeps the date for the Calls Due surface.
  //   - windows: record the callback on the date, carrying the days×bands
  //              availability so a future surface can honor the window.
  //   - anytime: the established date-only promised callback.
  // The outreach record keeps working exactly as before (record-attempt
  // call=callback); only the exact case additionally creates the appointment.
  async function saveCallback() {
    const cb = cbDraft.draft
    setApptError(null)

    if (hasExactTime(cb)) {
      setApptSaving(true)
      try {
        const res = await fetch('/api/calendar/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: c.id,
            date: cb.date,
            clock: cb.clock,
            source_type: 'stewardship_outreach',
            source_id: detail.id,
            location: phone ? formatPhoneDisplay(phone) : undefined,
            notes: noteForAction ?? undefined,
          }),
        })
        const json = await res.json()
        if (!res.ok) {
          setApptError(json.error ?? 'Could not save the appointment.')
          setApptSaving(false)
          return
        }
        // Hand the operator the .ics to attach in Outlook (generate → send →
        // confirm; Right Path never sends it). A data: href triggers download
        // without navigating away.
        if (json.data?.ics) {
          const a = document.createElement('a')
          a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(json.data.ics)}`
          a.download = json.data.ics_filename ?? 'appointment.ics'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
      } catch {
        setApptError('Could not reach the server to save the appointment.')
        setApptSaving(false)
        return
      }
      setApptSaving(false)
    }

    // Record the promised callback on the outreach row so the customer surfaces
    // as a due call. The due DATE is the chosen date (specific-date mode) or the
    // NEXT matching weekday (recurring mode), resolved on the customer clock. The
    // exact case also created the appointment above; recurring/bands carry their
    // days×bands availability on action_context for the surface that honors it.
    const dueDate = resolveDueDate(callbackCtx, cb)
    const action: Record<string, unknown> = {
      type: 'record-attempt',
      call: 'callback',
      callback_date: dueDate,
      note: noteForAction,
    }
    if (cb.timeMode === 'bands' || cb.whenMode === 'recurring') {
      action.callback_windows = {
        whenMode: cb.whenMode,
        days: cb.days,
        bands: cb.bands,
      }
    }
    const summary = commitmentSummary(cb, dueDate ? shortDate(dueDate) : null)
    act(
      action,
      hasExactTime(cb)
        ? `Appointment set for ${summary}. Calendar invite downloaded to send in Outlook.`
        : `Callback promised: ${summary ?? 'recorded'}.`,
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
  function resetNotReached() {
    voicemailDraft.reset(); textDraft.reset(); emailDraft.reset(); setBadNumber(false)
  }
  function chooseReached() {
    if (reach === 'reached') { setReach(null); setDecision(null); setApptError(null); return }
    setReach('reached')
    // Entering Reached: drop any Didn't-Reach channel drafts, collapse the top
    // Talk Path (the lower copy takes over), and start the lower Talk Path
    // collapsed so it opens only if the caller wants it.
    resetNotReached()
    setTalkPathTopOpen(false)
    setTalkPathReachedOpen(false)
  }
  function chooseNotReached() {
    if (reach === 'not-reached') { setReach(null); resetNotReached(); return }
    setReach('not-reached')
    // Entering Didn't Reach: drop any Reached decision.
    setDecision(null); setApptError(null)
  }

  // The situation content comes from the resolved (project type, phase) catalog
  // when the GET route supplied it (detail.call_context), and falls back to the
  // panel's built-in servicing-agent wording otherwise. This is the content
  // seam the panel was built around: the Legos and the layout are unchanged;
  // only the source of the reason / talk path moves from local constants to the
  // catalog. The catalog values arrive already interpolated with the caller and
  // customer identity by the resolver, so no further filling happens here.
  const resolvedReason = detail.call_context?.reason ?? callMentorBody(c.first_name)
  const talkPathBody = detail.call_context?.talkPath ?? callOpeningScript(c.first_name ?? 'there', senderName)

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
        {resolvedReason}
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
          {/* Bad number sits FIRST, as immediate feedback: the moment the worker
              knows the number is dead, marking it grays the phone-dependent
              channels below (voicemail + text) so they don't ask questions that
              can't apply, while the follow-up email stays available. It is a
              toggle, not a separate record action — the single Record this
              attempt button below still finishes, and a recorded bad number
              routes the customer to Contact Research. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink-secondary">Is this a working number?</span>
            <WorkflowButton selected={!badNumber} disabled={busy} onClick={() => setBadNumber(false)}>Yes</WorkflowButton>
            <WorkflowButton icon={PhoneOff} selected={badNumber} disabled={busy} onClick={() => setBadNumber(true)}>Bad number</WorkflowButton>
          </div>

          {/* The three didn't-reach channel Legos. Each owns its own script,
              Yes/No, reasons, and the history fragment it emits; the panel only
              composes them and reads their resolved outcomes. Scripts are passed
              in (context-driven), so the same Legos serve any call workbench. */}
          <VoicemailAttempt
            draft={voicemailDraft}
            scriptLabel={SERVICING_CALL_SCRIPTS.voicemail.label}
            scriptBody={voicemailScript}
            available={canVoicemail}
            unavailableBody={
              badNumber
                ? 'This number is marked bad, so a voicemail can’t be left. The follow-up email below is still available.'
                : 'No callback number is set for your profile, so the voicemail script can’t name a number to call back. Ask an admin to add your phone on the Team page, then this voicemail script becomes available.'
            }
            disabled={busy}
          />

          <TextAttempt
            draft={textDraft}
            scriptLabel={SERVICING_CALL_SCRIPTS.hearsay_text.label}
            scriptBody={textScript}
            available={canText}
            unavailableBody={
              badNumber
                ? 'This number is marked bad, so a Hearsay text can’t be sent. The follow-up email below is still available.'
                : detail.customer.sms_opt_out === true
                  ? 'The customer opted out of texting, so a Hearsay text can’t be sent.'
                  : 'No usable mobile number on file, so a Hearsay text can’t be sent. Add or correct the phone in Contact Research to make this available.'
            }
            disabled={busy}
          />

          <EmailAttempt
            draft={emailDraft}
            mailto={followUpMailto}
            available={canEmail}
            unavailableBody="No usable email on file, so a follow-up email can’t be sent. Add or correct the email in Contact Research to make this available."
            disabled={busy}
          />

          {/* Record the whole no-reach interaction as ONE grouped attempt.
              Grayed until every AVAILABLE channel is answered enough to record
              (a Yes, or a No with a reason; an "Other" reason needs typed text),
              so the attempt is honest about what was completed. */}
          <div className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
            <WorkflowButton icon={PenLine} selected disabled={busy || !channelsComplete} onClick={recordNotReached}>
              {busy ? 'Recording\u2026' : 'Record this attempt'}
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
              {/* The delivery unit renders its own heading + cap coaching now
                  (caller-supplied text), so the whole "send this form" block is
                  one self-contained unit reusable for any form. */}
              <ServicingFormDelivery
                heading="Send the servicing-agent authorization form"
                coaching={
                  'Generate the form, send it (email or postal), then record it here. Recording the form sent is what ' +
                  'logs the reached call and moves the customer to Waiting for Form, then advances you to the next call. ' +
                  'Nothing is recorded until then, and nothing is auto-closed.'
                }
                detail={detail}
                request={request}
                name={name}
                busy={busy}
                act={act}
                confirmLabelFor={(m, alreadyHasForm) =>
                  alreadyHasForm
                    // The customer already had the form, so the step was making
                    // sure they understand what to do, not sending anything.
                    ? `Customer understands what to do. Mark complete.${nextSuffix}`
                    : m === 'postal'
                      ? `Form mailed to customer.${nextSuffix}`
                      : `Form sent to customer.${nextSuffix}`
                }
                onAlreadyHeldChange={setFormAlreadyHeld}
                onConfirm={(_m, alreadyHeld) => act(
                  // The SINGLE completion of the Agreed path: record the reached
                  // call AND the form step together. `reached` folds the reached
                  // outcome + engagement into this one action, so nothing was
                  // recorded (and the customer never left available work) merely
                  // by selecting "Agreed to authorize" earlier. `alreadyHeld`
                  // records the accurate history: the customer already had the
                  // form and agreed to return it, rather than us sending one. The
                  // optional Call Notes ride with this one interaction.
                  { type: 'form-sent', reached: true, alreadyHeld, note: noteForAction },
                  alreadyHeld
                    ? 'Reached. Customer already has the form and agreed to return it. Moved to Waiting for Form.'
                    : 'Reached and authorization form sent. Moved to Waiting for Form.',
                  { advanceToNext: true },
                )}
              />
            </div>
          )}

          {/* Defer -> capture the promised callback at the precision the customer
              gave: an EXACT time (becomes an appointment on the caller's My Work,
              with a calendar invite to send in Outlook), a set of availability
              WINDOWS (days × time bands), or ANY TIME that day. This situation's
              Defer action. */}
          {decision === 'defer' && (
            <div className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
              <p className="flex items-center gap-2 text-base font-medium text-ink">
                <Clock className="size-4 text-ink-supporting" aria-hidden /> Promised callback
              </p>
              <CallbackPrecisionFields
                api={cbDraft}
                busy={busy || apptSaving}
                idPrefix="wb-cb"
                customerZoneLabel={callbackCustomerZoneLabel}
              />
              {apptError && (
                <p className="text-sm text-status-missing-strong">{apptError}</p>
              )}
              <WorkflowButton icon={Check} selected disabled={busy || apptSaving || cbDraft.validation.status !== 'valid'}
                onClick={saveCallback}>
                {apptSaving ? 'Saving\u2026' : hasExactTime(cbDraft.draft) ? 'Save appointment' : 'Save promised callback'}
              </WorkflowButton>
              <NextNote>
                {hasExactTime(cbDraft.draft)
                  ? 'The exact time is saved as an appointment on your My Work and a calendar invite downloads for you to send in Outlook. The customer also surfaces as a due call on that date.'
                  : cbDraft.draft.whenMode === 'recurring'
                    ? 'The promised callback is saved as a customer commitment and resurfaces as a due call on the next matching day, and on each matching day after, until it is worked.'
                    : 'The promised callback is saved as a customer commitment and resurfaces as a due call on that date. It outranks focus-based ordering.'}
                {nextSuffix}
              </NextNote>
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
