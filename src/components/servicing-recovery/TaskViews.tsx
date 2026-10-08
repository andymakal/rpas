'use client'

/**
 * Per-queue actionable task views for the 1035 Workflow. STORYBOOK-ONLY.
 *
 * Opening a customer from a queue shows ONLY the current actionable task for
 * that queue. No future workflow steps, no Fact Finder, no application
 * questions. Each view carries a compact customer header, the relevant
 * holdings, and the specific action for that queue. Transitions are described
 * in plain language and reflected as local prototype state, never written to a
 * database or API.
 */

import { useMemo, useState } from 'react'
import {
  Send, Check, Phone, PhoneCall, Mail, Clock, Search, Building2,
  ArrowRight, FileText, CircleAlert, PhoneForwarded, ExternalLink,
  Pencil, Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type CallOutcome,
  type CallReason,
  type ResearchReason,
  type WorkItem,
  contextHoldings,
  formatDob,
  fullName,
  hasUsableEmail,
  personName,
  preferredPhoneField,
  requestHoldings,
  requiredSigners as resolveSigners,
  routineContactPerson,
  shortDate,
} from './data'
import {
  HoldingsPanel, RoutineContact, RequiredSigners, ScriptBlock, ContactFacts,
  ViewFullCustomer,
} from './parts'
import {
  TaskShell as SharedTaskShell,
  SlimTaskHeader,
  ActionPanel,
  PrimaryAction,
  WorkflowButton,
  NextNote,
  OperationalTag,
} from '@/components/workflow'

// ─────────────────────────────────────────────────────────────────────────────
// Shared task shell — one coherent pattern for every 1035 task view.
//
// A SLIM, navigation-only header (back-to-queues, View full customer) over a
// two-column body:
//   LEFT  — the current action/task (what to do now).
//   RIGHT — the supporting customer context (identity, routine contact,
//           required signers, holdings).
// Stacks to one column on narrower screens. There is no old full-width
// customer-detail header: the customer is not named in the header, and the
// action heading identifies both the action and the customer (e.g. "Call
// Stephen Remy"). Every task view uses this one shell.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Task-first 1035 shell: a SLIM, navigation-only header (back-to-queues, View
 * full customer) over the shared two-column body. The customer is not named in
 * the header; the action heading identifies both the action and the customer.
 * The action dominates the left; the customer's durable facts live in the
 * right context, never repeated above the task.
 */
function SlimTaskShell({
  item, onBack, action, context,
}: {
  item: WorkItem
  onBack?: () => void
  action: React.ReactNode
  context: React.ReactNode
}) {
  return (
    <SharedTaskShell
      header={
        <SlimTaskHeader
          onBack={onBack}
          escapeHatch={<ViewFullCustomer item={item} />}
        />
      }
      action={action}
      context={context}
    />
  )
}

/** Left-column context: routine contact and required signers. */
function ContactAndSigners({ item }: { item: WorkItem }) {
  const routinePerson = useMemo(() => routineContactPerson(item), [item])
  const signers = useMemo(() => resolveSigners(item), [item])
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <RoutineContact item={item} routinePerson={routinePerson} />
      <RequiredSigners signers={signers} />
    </div>
  )
}

/** Left-column context: the holdings for this request plus context holdings. */
function HoldingsContext({ item }: { item: WorkItem }) {
  const request = useMemo(() => requestHoldings(item), [item])
  const context = useMemo(() => contextHoldings(item), [item])
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <HoldingsPanel item={item} request={request} context={context} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ready to Email
// ─────────────────────────────────────────────────────────────────────────────

export function ReadyToEmailTask({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  const request = useMemo(() => requestHoldings(item), [item])
  const routinePerson = useMemo(() => routineContactPerson(item), [item])
  const signers = useMemo(() => resolveSigners(item), [item])
  const [sent, setSent] = useState(false)

  const toFirst = routinePerson?.firstName ?? item.firstName

  // Routine contact and required signer are distinct. The recipient only
  // reviews-and-signs when they are themselves a required signer. Otherwise the
  // email asks them to route the form to the signer(s). We never present
  // another person's email as a signer's own.
  const recipientIsSigner = !!routinePerson && signers.some(s => s.id === routinePerson.id)
  const signerNames = signers.map(personName).join(' and ')
  const signersWithoutEmail = signers.filter(s => !hasUsableEmail(s.contact))

  // Every policy in the current servicing-agent request is included; there is
  // no optional selection, and relationship-context holdings are never added.
  const requestCount = request.length

  // The prepared email reflects WHO is being emailed and WHO must sign.
  const preparedEmail = recipientIsSigner
    ? `Hi ${toFirst}, this is your Right Path servicing agent. Please review and sign the attached servicing-agent form, which covers ${requestCount} of your holdings. Reply here with any questions.`
    : `Hi ${toFirst}, this is your Right Path servicing agent. Attached is the servicing-agent form covering ${requestCount} ${requestCount === 1 ? 'holding' : 'holdings'}. It must be signed by ${signerNames}. Please help us get it to ${signers.length > 1 ? 'them' : signerNames} for signature, and let us know the best way to reach ${signers.length > 1 ? 'them' : signerNames} directly. Reply here with any questions.`

  const context = (
    <>
      <ContactFacts item={item} />
      <ContactAndSigners item={item} />
      <HoldingsContext item={item} />
    </>
  )

  const action = (
    <ActionPanel heading={`Email ${fullName(item)}`}>
      {/* One horizontal action row: launch the external email on the left,
          confirm it was actually sent on the right. Launching is not sending;
          "Email sent" is the explicit human confirmation that moves this
          customer to Waiting for Response. */}
      {!sent ? (
        <div className="flex flex-wrap items-stretch gap-3">
          <div className="flex-[3] basis-56">
            <PrimaryAction
              icon={ExternalLink}
              label="Open prepared email"
              onClick={() => console.log('[prototype] open prepared email for', item.id)}
            />
          </div>
          <div className="flex flex-[2] basis-40">
            <WorkflowButton
              icon={Check}
              onClick={() => setSent(true)}
              className="h-14 w-full justify-center rounded-xl text-lg"
            >
              Email sent
            </WorkflowButton>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
          <Check className="size-5" aria-hidden /> Sent. Moved to Waiting for Response.
        </div>
      )}

      {/* When the routine contact is not the required signer, state that plainly
          and flag any signer who has no usable email. We do not invent a fix:
          the worker sees exactly what is missing and what must happen next. */}
      {!recipientIsSigner && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            <span className="font-semibold">{toFirst}</span> is the routine contact, not the required signer.
            This form must be signed by <span className="font-semibold">{signerNames}</span>.
          </p>
          {signersWithoutEmail.length > 0 && (
            <p className="flex items-start gap-2">
              <OperationalTag tone="blocked" className="shrink-0 px-3 py-1 text-sm">
                No signer email
              </OperationalTag>
              <span>
                {signersWithoutEmail.map(personName).join(' and ')} {signersWithoutEmail.length > 1 ? 'have' : 'has'} no
                usable email, so the form cannot be e-signed as addressed. Use this outreach to reach the signer and
                capture a usable email or arrange another way to sign.
              </span>
            </p>
          )}
        </div>
      )}

      {/* Supporting detail for the action above. Visually lighter than the
          heading and the primary action. */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        {/* The prepared email is collapsed by default: the worker reviews and
            sends the real email in the external app, so the preview does not
            need permanent screen space. */}
        <details className="group rounded-lg border border-slate-200 bg-slate-50">
          {/* The disclosure label and the preview are task-critical: the worker
              reviews this exact wording before sending. High-contrast, not pale
              gray. */}
          <summary className="flex cursor-pointer items-center gap-1.5 p-3 text-xs font-semibold uppercase tracking-wide text-slate-700 select-none">
            <span className="transition-transform group-open:rotate-90" aria-hidden>{'\u25B8'}</span>
            Prepared email
          </summary>
          <div className="border-t border-slate-200 p-4 text-base leading-relaxed text-slate-900">
            {preparedEmail}
          </div>
        </details>

        {/* The attachment area is a directive, not a status line and not an
            optional selection: attach the form for exactly these request
            policies. No checkboxes; context holdings are never listed here. */}
        {/* The attachment directive is critical operational information: it
            tells the worker exactly which policies the form must cover. It must
            read as important, never as pale incidental metadata. */}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileText className="size-4 text-slate-600" aria-hidden />
            Attach the servicing-agent form for:
          </p>
          <div className="space-y-1.5">
            {request.map(h => (
              <div key={h.id} className="flex items-center gap-2 text-base text-slate-900">
                <span className="font-mono">{h.policyNumber}</span>
                <span className="text-sm text-slate-600">{h.productType}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ActionPanel>
  )

  return <SlimTaskShell item={item} onBack={onBack} action={action} context={context} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Ready to Call
// ─────────────────────────────────────────────────────────────────────────────

const CALL_REASON_COPY: Record<CallReason, { label: string; line: string }> = {
  'no-email':      { label: 'No email on file', line: 'There is no email for this customer, so we are calling.' },
  'email-bounced': { label: 'Email bounced',    line: 'The emailed outreach bounced, so we are calling the phone on file.' },
  'no-response':   { label: 'No response',      line: 'The follow-up window lapsed with no response, so we are calling.' },
  'callback-due':  { label: 'Callback due',     line: 'The customer asked us to call back and that date is here.' },
}

const CALL_OUTCOMES: { id: CallOutcome; label: string }[] = [
  { id: 'reached',        label: 'Reached' },
  { id: 'voicemail',      label: 'Voicemail' },
  { id: 'bad-number',     label: 'Bad number' },
  { id: 'not-interested', label: 'Not interested' },
  { id: 'callback',       label: 'Callback later' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Confirm contact details — the actionable, field-level confirmation that
// appears ONLY after a call is Reached. The passive "while you have them"
// checklist is gone: this gives the worker somewhere to record each answer.
//
// Verification stays FIELD-LEVEL: the worker confirms or corrects each fact on
// its own. Nothing marks the whole customer verified. In the prototype the
// actions log their intent; no field is written to a DB or API.
// ─────────────────────────────────────────────────────────────────────────────

type FieldAction = { label: string; icon: typeof Check; variant?: 'default' | 'outline' }

function ConfirmField({
  label, value, empty, confirmed, onConfirm, actions, onAction,
}: {
  label: string
  value: React.ReactNode
  empty?: boolean
  confirmed: boolean
  onConfirm: () => void
  actions: FieldAction[]
  onAction: (label: string) => void
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs uppercase tracking-wide text-slate-600">{label}</p>
          <p className={cn('text-base', empty ? 'italic text-slate-400' : 'text-slate-900')}>{value}</p>
        </div>
        {confirmed && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
            <Check className="size-3" aria-hidden /> Confirmed
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <WorkflowButton icon={Check} size="sm" selected={confirmed} onClick={onConfirm}>
          Confirm
        </WorkflowButton>
        {actions.map(a => (
          <WorkflowButton key={a.label} icon={a.icon} size="sm" onClick={() => onAction(a.label)}>
            {a.label}
          </WorkflowButton>
        ))}
      </div>
    </div>
  )
}

function ConfirmContactDetails({ item }: { item: WorkItem }) {
  // Field-level confirmation state. Each fact is confirmed on its own; the
  // customer is never marked verified as a whole.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  // Who handles routine communication. This is the one durable relationship
  // concept the worker can set or change during the call, so it is shown here
  // editable: always the current routine contact plus a Change action, even
  // when it is the customer themselves. Changing it never touches the
  // customer's own email/phone (confirmed above), policy ownership, or the
  // required signers (shown separately in context).
  const routinePerson = useMemo(() => routineContactPerson(item), [item])
  const mark = (key: string) => setConfirmed(prev => ({ ...prev, [key]: true }))
  const act = (key: string) => (label: string) => {
    console.log(`[prototype] ${label} ${key} for`, item.id)
    // Changing/correcting/adding is a human edit elsewhere; it does not count
    // as a confirmation here.
    setConfirmed(prev => ({ ...prev, [key]: false }))
  }

  const email = item.contact.email
  const phone = preferredPhoneField(item.contact)
  const phoneLabel = item.contact.preferredPhone === 'work' ? 'Work phone' : 'Best phone'
  const emailEmpty = !email.value || email.status === 'not-found'
  const phoneEmpty = !phone.value || phone.status === 'not-found'
  const dobMissing = item.dob.precision === 'unknown'
  const addr = [item.address.line1, [item.address.city, item.address.state].filter(Boolean).join(', '), item.address.zip]
    .filter(Boolean).join(' \u00b7 ')

  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="flex items-center gap-2 text-base font-medium text-emerald-900">
        <PhoneCall className="size-5" aria-hidden /> Reached. Confirm the durable record with them, field by field.
      </p>

      <div className="space-y-2">
        <ConfirmField
          label={phoneLabel}
          value={phoneEmpty ? 'Not on file' : phone.value}
          empty={phoneEmpty}
          confirmed={!!confirmed.phone}
          onConfirm={() => mark('phone')}
          actions={[{ label: 'Change', icon: Pencil }]}
          onAction={act('phone')}
        />
        <ConfirmField
          label="Email"
          value={emailEmpty ? 'Not on file' : email.value}
          empty={emailEmpty}
          confirmed={!!confirmed.email}
          onConfirm={() => mark('email')}
          actions={emailEmpty ? [{ label: 'Add', icon: Plus }] : [{ label: 'Change', icon: Pencil }]}
          onAction={act('email')}
        />
        <ConfirmField
          label="Date of birth"
          value={formatDob(item.dob)}
          empty={dobMissing}
          confirmed={!!confirmed.dob}
          onConfirm={() => mark('dob')}
          actions={[{ label: 'Correct', icon: Pencil }]}
          onAction={act('dob')}
        />
        <ConfirmField
          label="Mailing address"
          value={addr || 'Not on file'}
          empty={!addr}
          confirmed={!!confirmed.address}
          onConfirm={() => mark('address')}
          actions={[{ label: 'Correct', icon: Pencil }]}
          onAction={act('address')}
        />
      </div>

      {/* Routine contact is a durable, changeable workflow concept, not one of
          the customer's own facts above. Shown editable so the worker can route
          routine communication to a linked person (e.g. a spouse) without
          overwriting the customer's own email/phone, policy ownership, or the
          required signers. */}
      <div className="rounded-lg border border-emerald-100 bg-white p-3">
        <RoutineContact
          item={item}
          routinePerson={routinePerson}
          editable
          onChange={() => console.log('[prototype] change routine contact', item.id)}
        />
      </div>

      <NextNote>Each field is confirmed on its own. Confirming here does not mark the whole customer verified. Routine contact is a separate, changeable preference and does not change who must sign.</NextNote>
    </div>
  )
}

export function ReadyToCallTask({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  const routinePerson = useMemo(() => routineContactPerson(item), [item])
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [formSent, setFormSent] = useState(false)
  const [callbackWhen, setCallbackWhen] = useState('')

  const reason = item.callReason ?? 'no-email'
  const reasonCopy = CALL_REASON_COPY[reason]
  const toPhone = routinePerson ? preferredPhoneField(routinePerson.contact).value : null
  const toName = routinePerson ? personName(routinePerson) : fullName(item)

  const context = (
    <>
      <ContactFacts item={item} />
      <ContactAndSigners item={item} />
      <HoldingsContext item={item} />
    </>
  )

  const action = (
    <ActionPanel heading={`Call ${fullName(item)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
          <CircleAlert className="size-3.5" aria-hidden /> {reasonCopy.label}
        </span>
        {reason === 'callback-due' && item.callbackDate && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600">
            <Clock className="size-3.5" aria-hidden /> Callback {shortDate(item.callbackDate)}
          </span>
        )}
      </div>

      {/* The one prominent primary action. Opening it launches the existing
          RingCentral / external-call behavior (prototype: logged). */}
      <PrimaryAction
        icon={Phone}
        label={toPhone ? `Call ${toPhone}` : 'No phone on file'}
        disabled={!toPhone}
        onClick={() => console.log('[prototype] launch call (RingCentral):', toPhone)}
      />
      {routinePerson && routinePerson.id !== item.id && (
        <p className="-mt-2 text-base text-slate-700">Routine contact: {personName(routinePerson)}</p>
      )}

      {/* The call script sits directly below the call action. */}
      <ScriptBlock
        label="Call script"
        text={`Hi, may I speak with ${toName}? This is your Right Path servicing agent calling about ${fullName(item)}'s policies. We are confirming the servicing agent on the account so we can keep helping you. Do you have a couple of minutes?`}
      />

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Record the call outcome</p>
        <div className="flex flex-wrap gap-2">
          {CALL_OUTCOMES.map(o => (
            <WorkflowButton
              key={o.id}
              selected={outcome === o.id}
              onClick={() => { setOutcome(o.id); setFormSent(false) }}
            >
              {outcome === o.id && <Check className="size-4" aria-hidden />}
              {o.label}
            </WorkflowButton>
          ))}
        </div>
      </div>

      {/* Reached: the actionable field-level confirmation, then send the form.
          This replaces the old passive checklist. */}
      {outcome === 'reached' && (
        <div className="space-y-3">
          <ConfirmContactDetails item={item} />
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="flex items-center gap-2 text-base text-emerald-800">
              <Send className="size-4" aria-hidden /> Send or resend the servicing-agent form.
            </p>
            {!formSent ? (
              <WorkflowButton icon={Send} selected onClick={() => setFormSent(true)}>
                Send the form
              </WorkflowButton>
            ) : (
              <p className="flex items-center gap-2 text-base text-emerald-800">
                <Check className="size-4" aria-hidden /> Form sent. Moved to Waiting for Form.
              </p>
            )}
            <NextNote>Reached and form sent moves this customer to Waiting for Form. Nothing is auto-closed.</NextNote>
          </div>
        </div>
      )}

      {/* Bad number routes to Research Needed. */}
      {outcome === 'bad-number' && (
        <OutcomeNote tone="warn">
          Bad number. This customer moves to Research Needed to find usable contact information.
        </OutcomeNote>
      )}

      {/* Callback later captures the callback timing. */}
      {outcome === 'callback' && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <label htmlFor="callback-when" className="flex items-center gap-2 text-base font-medium text-slate-800">
            <Clock className="size-4 text-slate-600" aria-hidden /> When should we call back?
          </label>
          <input
            id="callback-when"
            type="date"
            value={callbackWhen}
            onChange={e => setCallbackWhen(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
          <NextNote>
            {callbackWhen
              ? `Callback set for ${shortDate(callbackWhen)}. This customer stays in Ready to Call and resurfaces then.`
              : 'Pick a date. This customer stays in Ready to Call and resurfaces on the callback date.'}
          </NextNote>
        </div>
      )}

      {/* Voicemail records the outcome only. */}
      {outcome === 'voicemail' && (
        <OutcomeNote tone="neutral">Voicemail left. Try again on the next pass. Nothing is closed.</OutcomeNote>
      )}

      {/* Not interested is an explicit human disposition. */}
      {outcome === 'not-interested' && (
        <OutcomeNote tone="neutral">Recorded as not interested. No further outreach. A human decides any next step.</OutcomeNote>
      )}
    </ActionPanel>
  )

  return <SlimTaskShell item={item} onBack={onBack} action={action} context={context} />
}

function OutcomeNote({ tone, children }: { tone: 'warn' | 'neutral'; children: React.ReactNode }) {
  return (
    <div className={cn(
      'rounded-lg border p-4 text-base',
      tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600',
    )}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Research Needed
// ─────────────────────────────────────────────────────────────────────────────

const RESEARCH_REASON_COPY: Record<ResearchReason, string> = {
  'no-contact':      'No usable email or phone was on file at intake.',
  'bad-number':      'The only phone on file turned out to be a bad number.',
  'bounce-no-phone': 'The email bounced and there is no usable phone.',
}

export function ResearchNeededTask({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  const [found, setFound] = useState<'email' | 'phone' | 'nothing' | null>(null)

  const reason = item.researchReason ?? 'no-contact'

  const context = (
    <>
      <ContactFacts item={item} />
      <ContactAndSigners item={item} />
      <HoldingsContext item={item} />
    </>
  )

  const action = (
    <ActionPanel heading={`Find contact for ${fullName(item)}`}>
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
        <Search className="size-5" aria-hidden /> {RESEARCH_REASON_COPY[reason]}
      </div>

      <div>
        <p className="mb-2 text-base font-medium text-slate-800">Record what research found</p>
        <div className="flex flex-col gap-2">
          <WorkflowButton
            icon={found === 'email' ? Check : undefined}
            size="lg"
            selected={found === 'email'}
            onClick={() => setFound('email')}
            className="h-12 justify-start gap-2 rounded-xl text-base"
          >
            Found an email
          </WorkflowButton>
          <WorkflowButton
            icon={found === 'phone' ? Check : undefined}
            size="lg"
            selected={found === 'phone'}
            onClick={() => setFound('phone')}
            className="h-12 justify-start gap-2 rounded-xl text-base"
          >
            Found a phone, no email
          </WorkflowButton>
          <WorkflowButton
            icon={found === 'nothing' ? Check : undefined}
            size="lg"
            selected={found === 'nothing'}
            onClick={() => setFound('nothing')}
            className="h-12 justify-start gap-2 rounded-xl text-base"
          >
            Nothing usable yet
          </WorkflowButton>
        </div>
      </div>

      {found === 'email' && (
        <OutcomeNote tone="neutral">
          An email was found. This customer moves to Ready to Email.
        </OutcomeNote>
      )}
      {found === 'phone' && (
        <OutcomeNote tone="neutral">
          A phone was found and there is no email. This customer moves to Ready to Call.
        </OutcomeNote>
      )}
      {found === 'nothing' && (
        <OutcomeNote tone="warn">
          Nothing usable was found. This customer stays in Research Needed until a human decides what to do.
        </OutcomeNote>
      )}
    </ActionPanel>
  )

  return <SlimTaskShell item={item} onBack={onBack} action={action} context={context} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Waiting for Response
// ─────────────────────────────────────────────────────────────────────────────

export function WaitingForResponseTask({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  const context = (
    <>
      <ContactFacts item={item} />
      <ContactAndSigners item={item} />
      <HoldingsContext item={item} />
    </>
  )

  const action = (
    <ActionPanel heading={`Check for ${item.firstName}\u2019s reply`}>
      <div className="flex flex-wrap items-center gap-2">
        {item.emailSentDate && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
            <Mail className="size-3" aria-hidden /> Sent {shortDate(item.emailSentDate)}
          </span>
        )}
        {item.followUpDueDate && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
            <Clock className="size-3" aria-hidden /> Follow-up due {shortDate(item.followUpDueDate)}
          </span>
        )}
      </div>

      <PrimaryAction
        icon={ExternalLink}
        label="Open inbox"
        onClick={() => console.log('[prototype] launch inbox for', item.id)}
      />

      <div className="space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700">What happens from here</p>
        <ul className="space-y-1">
          <li>Signed form returned, so submit it to the carrier and move to Waiting for Carrier.</li>
          <li>Customer responds but the form is still outstanding, so move to Waiting for Form.</li>
          <li>Follow-up becomes due with no response, so move to Ready to Call.</li>
          <li>Email bounces, so move to Ready to Call when a phone exists, or Research Needed when it does not.</li>
        </ul>
      </div>
    </ActionPanel>
  )

  return <SlimTaskShell item={item} onBack={onBack} action={action} context={context} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Waiting for Form
// ─────────────────────────────────────────────────────────────────────────────

export function WaitingForFormTask({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  const request = useMemo(() => requestHoldings(item), [item])
  const signers = useMemo(() => resolveSigners(item), [item])
  const [coveredIds, setCoveredIds] = useState<string[]>(request.map(h => h.id))
  const [submitted, setSubmitted] = useState(false)

  const covered = request.filter(h => coveredIds.includes(h.id))

  function toggle(id: string) {
    setCoveredIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const context = (
    <>
      <ContactFacts item={item} />
      <ContactAndSigners item={item} />
      <HoldingsContext item={item} />
    </>
  )

  const action = (
    <ActionPanel heading={`Follow up on ${item.firstName}\u2019s form`}>
      <p className="text-sm text-slate-600">
        The form has been sent. When the signed form returns, confirm the signatures and submit it to
        the carrier. One form can cover several policy numbers.
      </p>

      {!submitted ? (
        <div className="space-y-3">
          <PrimaryAction
            icon={Building2}
            label="Signatures present, submit to carrier"
            disabled={covered.length === 0}
            onClick={() => setSubmitted(true)}
          />
          <NextNote>
            Submitting moves this customer to Waiting for Carrier. If follow-up becomes due before the
            form returns, the customer moves to Ready to Call. There is no separate Forms Received queue.
          </NextNote>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
          <Check className="size-5" aria-hidden />
          Submitted covering {covered.length} of {request.length} holdings. Moved to Waiting for Carrier.
        </div>
      )}

      {/* Supporting detail: which holdings the returned form covers. */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Confirm which holdings the signed form covers
          {signers.length > 1 ? ` (${signers.length} signers required)` : ''}
        </p>
        <HoldingsPanel
          item={item} request={request} context={[]}
          selectableRequest selectedIds={coveredIds} onToggle={toggle}
        />
      </div>
    </ActionPanel>
  )

  return <SlimTaskShell item={item} onBack={onBack} action={action} context={context} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Waiting for Carrier
// ─────────────────────────────────────────────────────────────────────────────

export function WaitingForCarrierTask({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  const [resolution, setResolution] = useState<'confirmed' | 'resubmitted' | null>(null)

  const hasCorrection = !!item.carrierCorrection

  const context = (
    <>
      <ContactFacts item={item} />
      <ContactAndSigners item={item} />
      <HoldingsContext item={item} />
    </>
  )

  const needsCorrection = hasCorrection && resolution !== 'resubmitted'

  const action = (
    <ActionPanel heading={needsCorrection ? 'Resolve the carrier correction' : 'Check carrier status'}>
      <div className="flex flex-wrap items-center gap-2">
        {item.submittedDate && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
            <Building2 className="size-3" aria-hidden /> Submitted {shortDate(item.submittedDate)}
          </span>
        )}
      </div>

      {needsCorrection ? (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-base font-medium text-amber-900">
            <CircleAlert className="size-5" aria-hidden /> Carrier requested a correction
          </p>
          <p className="text-sm text-amber-900">{item.carrierCorrection}</p>
          <PrimaryAction
            icon={PhoneForwarded}
            label="Correct and resubmit"
            onClick={() => setResolution('resubmitted')}
          />
          <NextNote>
            A correction is actionable work within this stage. The customer stays in Waiting for Carrier
            rather than moving to a new permanent queue.
          </NextNote>
        </div>
      ) : resolution !== 'confirmed' ? (
        <div className="space-y-3">
          {resolution === 'resubmitted' && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
              <Check className="size-4 text-emerald-600" aria-hidden /> Corrected and resubmitted. Still awaiting the carrier.
            </div>
          )}
          <PrimaryAction
            icon={Check}
            label="Carrier confirmed servicing agent"
            onClick={() => setResolution('confirmed')}
          />
          <NextNote>
            On confirmation the customer exits the 1035 Workflow and is handed off to the Review workflow.
            There is no Complete queue.
          </NextNote>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
          <ArrowRight className="size-5" aria-hidden />
          Confirmed. {fullName(item)} has left the 1035 Workflow and moved into the Review workflow.
        </div>
      )}
    </ActionPanel>
  )

  return <SlimTaskShell item={item} onBack={onBack} action={action} context={context} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher: open the right task view for a customer's current queue.
// ─────────────────────────────────────────────────────────────────────────────

export function TaskForItem({ item, onBack }: { item: WorkItem; onBack?: () => void }) {
  switch (item.queue) {
    case 'ready-to-email':       return <ReadyToEmailTask item={item} onBack={onBack} />
    case 'ready-to-call':        return <ReadyToCallTask item={item} onBack={onBack} />
    case 'research-needed':      return <ResearchNeededTask item={item} onBack={onBack} />
    case 'waiting-for-response': return <WaitingForResponseTask item={item} onBack={onBack} />
    case 'waiting-for-form':     return <WaitingForFormTask item={item} onBack={onBack} />
    case 'waiting-for-carrier':  return <WaitingForCarrierTask item={item} onBack={onBack} />
  }
}
