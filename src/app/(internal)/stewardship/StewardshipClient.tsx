'use client'

/**
 * Stewardship / capture outreach — durable UI.
 *
 * Three views: a queue board, a queue list, and a task screen. Unlike the
 * servicing-recovery prototype (in-memory fixtures), this is wired to the
 * /api/stewardship routes, so queue placement and operational state survive a
 * refresh. The look reuses the shared workflow component layer.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Mail, Phone, Search, Inbox, FileText, Building2, Check, ExternalLink,
  Clock, CircleAlert, Play,
} from 'lucide-react'
import {
  WorkflowPage, WorkflowHeader,
  QueueSection, QueueRow, QueueListHeader, CustomerQueueCard, QueueEmptyState,
  TaskShell, SlimTaskHeader, ContextHeader, type ContextField,
  ActionPanel, PrimaryAction, WorkflowButton, NextNote, OperationalTag,
} from '@/components/workflow'
import {
  QUEUE_META, OUTREACH_QUEUES,
  type OutreachQueue, type CallOutcome,
} from '@/lib/stewardship/queues'
import type { AgencyOption } from './page'

type Customer = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }

type BoardItem = {
  id: string
  queue: OutreachQueue
  call_reason: string | null
  research_reason: string | null
  last_call_outcome: string | null
  callback_date: string | null
  email_sent_at: string | null
  follow_up_due: string | null
  submitted_at: string | null
  carrier_correction: string | null
  prereview_id: string
  customer: Customer
}

type Holding = {
  id: string
  policy_number: string
  carrier: string
  product_type: string | null
  face_amount: number | null
  cash_value_amount: number | null
  coverage_status: string
  insured_name: string | null
  sa_status: string
  sa_form_sent_at: string | null
  in_request: boolean
}

type Detail = BoardItem & {
  customer: Customer & {
    date_of_birth: string | null
    address_line1: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  source_agency_id: string | null
  holdings: Holding[]
}

const QUEUE_ICON: Record<OutreachQueue, typeof Mail> = {
  'ready-to-email': Mail,
  'ready-to-call': Phone,
  'research-needed': Search,
  'waiting-for-response': Inbox,
  'waiting-for-form': FileText,
  'waiting-for-carrier': Building2,
}

const QUEUE_GROUPS: { label: string; queues: OutreachQueue[] }[] = [
  { label: 'Outreach', queues: ['ready-to-email', 'ready-to-call'] },
  { label: 'Quiet / exception work', queues: ['research-needed'] },
  { label: 'Waiting', queues: ['waiting-for-response', 'waiting-for-form', 'waiting-for-carrier'] },
]

function fullName(c: Customer) {
  return `${c.first_name} ${c.last_name}`.trim()
}

function currency(n: number | null) {
  if (n == null) return '\u2014'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function StewardshipClient({ agencies }: { agencies: AgencyOption[] }) {
  const [items, setItems] = useState<BoardItem[]>([])
  const [counts, setCounts] = useState<Record<OutreachQueue, number>>(
    Object.fromEntries(OUTREACH_QUEUES.map(q => [q, 0])) as Record<OutreachQueue, number>,
  )
  const [loading, setLoading] = useState(true)
  const [openQueue, setOpenQueue] = useState<OutreachQueue | null>(null)
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  const loadBoard = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stewardship', { cache: 'no-store' })
      const json = await res.json()
      if (res.ok) {
        setItems(json.data.items as BoardItem[])
        setCounts(json.data.counts as Record<OutreachQueue, number>)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadBoard() }, [loadBoard])

  if (openItemId) {
    return (
      <StewardshipTask
        itemId={openItemId}
        onBack={() => { setOpenItemId(null); void loadBoard() }}
      />
    )
  }

  if (openQueue) {
    const meta = QUEUE_META[openQueue]
    const queueItems = items.filter(i => i.queue === openQueue)
    return (
      <WorkflowPage>
        <QueueListHeader
          icon={QUEUE_ICON[openQueue]}
          label={meta.label}
          count={queueItems.length}
          blurb={meta.blurb}
          onBack={() => setOpenQueue(null)}
        />
        <div className="mt-5 space-y-3">
          {queueItems.length === 0 ? (
            <QueueEmptyState>No customers in this queue.</QueueEmptyState>
          ) : (
            queueItems.map(it => (
              <CustomerQueueCard
                key={it.id}
                name={fullName(it.customer)}
                detail={queueDetail(it)}
                trailing={queueTag(it)}
                onOpen={() => setOpenItemId(it.id)}
              />
            ))
          )}
        </div>
      </WorkflowPage>
    )
  }

  return (
    <WorkflowPage>
      <WorkflowHeader
        primary="Stewardship"
        secondary="Capture outreach — confirm servicing access on each customer's permanent policies."
      />

      <StartCapture agencies={agencies} onStarted={loadBoard} />

      <div className="mt-6 space-y-6">
        {QUEUE_GROUPS.map(group => (
          <QueueSection key={group.label} label={group.label}>
            {group.queues.map(q => (
              <QueueRow
                key={q}
                icon={QUEUE_ICON[q]}
                label={QUEUE_META[q].label}
                tag={QUEUE_META[q].blurb}
                count={counts[q] ?? 0}
                tone={QUEUE_META[q].kind}
                onOpen={() => setOpenQueue(q)}
              />
            ))}
          </QueueSection>
        ))}
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading board…</p>}
    </WorkflowPage>
  )
}

function queueDetail(it: BoardItem): string {
  switch (it.queue) {
    case 'ready-to-call': return it.call_reason ? callReasonLabel(it.call_reason) : 'Ready to call'
    case 'research-needed': return 'Needs usable contact'
    case 'waiting-for-response': return it.follow_up_due ? `Follow-up ${shortDate(it.follow_up_due)}` : 'Awaiting reply'
    case 'waiting-for-form': return 'Form sent'
    case 'waiting-for-carrier': return it.carrier_correction ? 'Carrier correction needed' : 'Submitted to carrier'
    default: return 'Ready to email'
  }
}

function queueTag(it: BoardItem) {
  if (it.queue === 'waiting-for-carrier' && it.carrier_correction) {
    return <OperationalTag tone="exception">Correction</OperationalTag>
  }
  if (it.queue === 'ready-to-call' && it.call_reason === 'callback-due') {
    return <OperationalTag tone="reason">Callback due</OperationalTag>
  }
  return null
}

function callReasonLabel(r: string): string {
  switch (r) {
    case 'no-email': return 'No email'
    case 'email-bounced': return 'Email bounced'
    case 'no-response': return 'No response'
    case 'callback-due': return 'Callback due'
    default: return 'Ready to call'
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Start Capture — begin stewardship work for a selected agency book.
// ─────────────────────────────────────────────────────────────────────────────

function StartCapture({ agencies, onStarted }: { agencies: AgencyOption[]; onStarted: () => void }) {
  const [agencyId, setAgencyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function start() {
    if (!agencyId) return
    setBusy(true); setResult(null)
    try {
      const res = await fetch('/api/stewardship/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_id: agencyId }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult(`Started ${json.data.started} customer${json.data.started === 1 ? '' : 's'}` +
          (json.data.skipped ? `, skipped ${json.data.skipped} already in progress.` : '.'))
        onStarted()
      } else {
        setResult(json.error ?? 'Could not start capture.')
      }
    } catch {
      setResult('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-teal-100 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Start capture for a book</h2>
      <p className="mt-1 text-sm text-slate-600">
        Creates a stewardship work item for each customer in the selected agency that is not already
        in progress. Each item routes to Ready to Email, Ready to Call, or Research Needed based on
        the contact information on file.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={agencyId}
          onChange={e => setAgencyId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
        >
          <option value="">Select an agency / book…</option>
          {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <WorkflowButton icon={Play} selected disabled={!agencyId || busy} onClick={start}>
          {busy ? 'Starting…' : 'Start capture'}
        </WorkflowButton>
        {result && <span className="text-sm font-medium text-slate-700">{result}</span>}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Task screen — one outreach item, dispatched by queue.
// ─────────────────────────────────────────────────────────────────────────────

function StewardshipTask({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/stewardship/${itemId}`, { cache: 'no-store' })
    const json = await res.json()
    if (res.ok) setDetail(json.data as Detail)
  }, [itemId])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (action: unknown, successNote?: string) => {
    setBusy(true); setNote(null)
    try {
      const res = await fetch(`/api/stewardship/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) { setNote(json.error ?? 'Action failed.'); return }
      if (json.completed_outreach) {
        setNote('Carrier confirmed. Servicing access confirmed; customer moves to documentation.')
      } else if (successNote) {
        setNote(successNote)
      }
      await load()
    } catch {
      setNote('Network error.')
    } finally {
      setBusy(false)
    }
  }, [itemId, load])

  if (!detail) {
    return (
      <WorkflowPage>
        <SlimTaskHeader onBack={onBack} />
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      </WorkflowPage>
    )
  }

  const request = detail.holdings.filter(h => h.in_request)
  const context = detail.holdings.filter(h => !h.in_request)

  return (
    <WorkflowPage>
      <TaskShell
        header={<SlimTaskHeader onBack={onBack} backLabel="All queues" />}
        action={
          <TaskAction detail={detail} request={request} busy={busy} note={note} act={act} />
        }
        context={
          <>
            <CustomerContext detail={detail} />
            <HoldingsContext request={request} context={context} />
          </>
        }
      />
    </WorkflowPage>
  )
}

function TaskAction({
  detail, request, busy, note, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  note: string | null
  act: (action: unknown, successNote?: string) => void
}) {
  const name = fullName(detail.customer)

  const noteBox = note && (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
      <Check className="size-5" aria-hidden /> {note}
    </div>
  )

  switch (detail.queue) {
    case 'ready-to-email':
      return (
        <ActionPanel heading={`Email ${name}`}>
          {noteBox}
          <PrimaryAction
            icon={ExternalLink}
            label="Open prepared email"
            onClick={() => window.open(`mailto:${detail.customer.email ?? ''}`)}
          />
          <WorkflowButton
            icon={Check}
            selected
            disabled={busy}
            onClick={() => act({ type: 'email-sent' }, 'Email sent. Moved to Waiting for Response.')}
          >
            Email sent
          </WorkflowButton>
          <FormCoverage request={request} />
          <NextNote>Sending moves {detail.customer.first_name} to Waiting for Response. Nothing is auto-closed.</NextNote>
        </ActionPanel>
      )

    case 'ready-to-call':
      return <CallAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />

    case 'research-needed':
      return (
        <ActionPanel heading={`Find contact for ${name}`}>
          {noteBox}
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
            <Search className="size-5" aria-hidden /> Usable contact information is missing or has failed.
          </div>
          <div className="flex flex-col gap-2">
            <WorkflowButton size="lg" disabled={busy} className="h-12 justify-start"
              onClick={() => act({ type: 'research-found', found: 'email' }, 'Email found. Moved to Ready to Email.')}>
              Found an email
            </WorkflowButton>
            <WorkflowButton size="lg" disabled={busy} className="h-12 justify-start"
              onClick={() => act({ type: 'research-found', found: 'phone' }, 'Phone found. Moved to Ready to Call.')}>
              Found a phone, no email
            </WorkflowButton>
            <WorkflowButton size="lg" disabled={busy} className="h-12 justify-start"
              onClick={() => act({ type: 'research-found', found: 'nothing' }, 'Recorded. Stays in Research Needed.')}>
              Nothing usable yet
            </WorkflowButton>
          </div>
          <NextNote>Nothing is auto-closed. An item with no usable contact stays here until a human decides.</NextNote>
        </ActionPanel>
      )

    case 'waiting-for-response':
      return (
        <ActionPanel heading={`Check for ${detail.customer.first_name}\u2019s reply`}>
          {noteBox}
          <div className="flex flex-wrap items-center gap-2">
            {detail.email_sent_at && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
                <Mail className="size-3" aria-hidden /> Sent {shortDate(detail.email_sent_at)}
              </span>
            )}
            {detail.follow_up_due && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                <Clock className="size-3" aria-hidden /> Follow-up due {shortDate(detail.follow_up_due)}
              </span>
            )}
          </div>
          <PrimaryAction icon={ExternalLink} label="Open inbox" onClick={() => window.open('https://mail.google.com', '_blank')} />
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-700">When the customer engages</p>
            <WorkflowButton icon={FileText} disabled={busy}
              onClick={() => act({ type: 'form-sent' }, 'Form sent. Moved to Waiting for Form.')}>
              Form sent to customer
            </WorkflowButton>
          </div>
          <NextNote>If the follow-up lapses with no response, re-engage by phone from Ready to Call. Nothing is auto-closed.</NextNote>
        </ActionPanel>
      )

    case 'waiting-for-form':
      return (
        <ActionPanel heading={`Follow up on ${detail.customer.first_name}\u2019s form`}>
          {noteBox}
          <p className="text-sm text-slate-600">
            When the signed form returns, confirm the signatures and submit it to the carrier. One form
            can cover several policy numbers.
          </p>
          <FormCoverage request={request} />
          <PrimaryAction
            icon={Building2}
            label="Signatures present, submit to carrier"
            disabled={busy || request.length === 0}
            onClick={() => act({ type: 'submit-to-carrier' }, 'Submitted. Moved to Waiting for Carrier.')}
          />
          <NextNote>Submitting moves {detail.customer.first_name} to Waiting for Carrier. There is no separate Forms Received queue.</NextNote>
        </ActionPanel>
      )

    case 'waiting-for-carrier':
      return <CarrierAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
  }
}

function CallAction({
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
      {detail.call_reason && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
          <CircleAlert className="size-3.5" aria-hidden /> {callReasonLabel(detail.call_reason)}
        </span>
      )}
      <PrimaryAction
        icon={Phone}
        label={phone ? `Call ${phone}` : 'No phone on file'}
        disabled={!phone}
        onClick={() => window.open(`tel:${phone ?? ''}`)}
      />
      <div className="border-t border-slate-100 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Record the call outcome</p>
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map(o => (
            <WorkflowButton
              key={o.id}
              selected={outcome === o.id}
              disabled={busy}
              onClick={() => {
                setOutcome(o.id)
                if (o.id !== 'callback') {
                  act(
                    { type: 'call-outcome', outcome: o.id },
                    o.id === 'bad-number' ? 'Bad number. Moved to Research Needed.'
                      : o.id === 'reached' ? 'Reached. Send the servicing-agent form below.'
                      : o.id === 'not-interested' ? 'Recorded as not interested. No further outreach; a human decides any next step.'
                      : 'Voicemail recorded. Try again on the next pass.',
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
          <FormCoverage request={request} />
          <WorkflowButton icon={FileText} selected disabled={busy}
            onClick={() => act({ type: 'form-sent' }, 'Form sent. Moved to Waiting for Form.')}>
            Send the form
          </WorkflowButton>
          <NextNote>Reached and form sent moves this customer to Waiting for Form. Nothing is auto-closed.</NextNote>
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
            onClick={() => act({ type: 'call-outcome', outcome: 'callback', callback_date: callbackWhen }, `Callback set for ${callbackWhen ? shortDate(callbackWhen) : ''}.`)}>
            Set callback
          </WorkflowButton>
          <NextNote>The customer stays in Ready to Call and resurfaces on the callback date.</NextNote>
        </div>
      )}
    </ActionPanel>
  )
}

function CarrierAction({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  const [correction, setCorrection] = useState('')
  const hasCorrection = !!detail.carrier_correction

  return (
    <ActionPanel heading={hasCorrection ? 'Resolve the carrier correction' : `Confirm the carrier for ${detail.customer.first_name}`}>
      {noteBox}
      {detail.submitted_at && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
          <Building2 className="size-3" aria-hidden /> Submitted {shortDate(detail.submitted_at)}
        </span>
      )}
      {hasCorrection && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
          <p className="font-semibold">Carrier correction requested</p>
          <p className="mt-1">{detail.carrier_correction}</p>
        </div>
      )}
      <FormCoverage request={request} />
      <PrimaryAction
        icon={Check}
        label="Carrier confirmed servicing agent"
        disabled={busy}
        onClick={() => act({ type: 'carrier-confirmed' })}
      />
      <div className="space-y-2 border-t border-slate-100 pt-4">
        <label htmlFor="corr" className="text-sm font-medium text-slate-700">Carrier requested a correction?</label>
        <textarea id="corr" value={correction} onChange={e => setCorrection(e.target.value)} rows={2}
          placeholder="What the carrier needs before confirming…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200" />
        <WorkflowButton disabled={busy || !correction.trim()}
          onClick={() => act({ type: 'carrier-correction', note: correction.trim() }, 'Correction recorded. Resolve it and resubmit.')}>
          Record correction
        </WorkflowButton>
      </div>
      <NextNote>Carrier confirmation confirms servicing access and moves the customer to documentation. It does not create a review.</NextNote>
    </ActionPanel>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Context panels
// ─────────────────────────────────────────────────────────────────────────────

function CustomerContext({ detail }: { detail: Detail }) {
  const c = detail.customer
  const addr = [c.address_line1, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' \u00b7 ')
  const fields: ContextField[] = [
    {
      label: 'Email', value: c.email ?? 'Not on file', empty: !c.email,
      statusTone: c.email ? 'known' : 'missing', statusIcon: Mail, statusLabel: c.email ? 'On file' : 'Missing',
    },
    {
      label: 'Phone', value: c.phone ?? 'Not on file', empty: !c.phone,
      statusTone: c.phone ? 'known' : 'missing', statusIcon: Phone, statusLabel: c.phone ? 'On file' : 'Missing',
    },
    {
      label: 'Address', value: addr || 'Not on file', empty: !addr,
      statusTone: addr ? 'known' : 'missing', statusIcon: Building2, statusLabel: addr ? 'On file' : 'Missing',
    },
  ]
  return <ContextHeader eyebrow="Stewardship" title={fullName(c)} fields={fields} />
}

function HoldingsContext({ request, context }: { request: Holding[]; context: Holding[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">In this servicing request</p>
        <div className="mt-2 space-y-2">
          {request.length === 0
            ? <p className="text-sm italic text-slate-400">No permanent policies in the request.</p>
            : request.map(h => <HoldingRow key={h.id} h={h} />)}
        </div>
      </div>
      {context.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Other holdings (context only)</p>
          <div className="mt-2 space-y-2">
            {context.map(h => <HoldingRow key={h.id} h={h} muted />)}
          </div>
        </div>
      )}
    </div>
  )
}

function HoldingRow({ h, muted }: { h: Holding; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <span className={muted ? 'font-mono text-slate-600' : 'font-mono text-slate-900'}>{h.policy_number}</span>
        <span className="px-1.5 text-slate-400">{'\u00b7'}</span>
        <span className={muted ? 'text-slate-500' : 'text-slate-700'}>{h.product_type ?? 'Policy'}</span>
        {h.insured_name && <span className="ml-1 text-slate-500">({h.insured_name})</span>}
      </div>
      <span className="shrink-0 text-slate-500">{currency(h.face_amount)}</span>
    </div>
  )
}

function FormCoverage({ request }: { request: Holding[] }) {
  if (request.length === 0) return null
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <FileText className="size-4 text-slate-600" aria-hidden />
        One servicing-agent form covers:
      </p>
      <div className="space-y-1.5">
        {request.map(h => (
          <div key={h.id} className="flex items-center gap-2 text-base text-slate-900">
            <span className="font-mono">{h.policy_number}</span>
            <span className="text-sm text-slate-600">{h.product_type ?? 'Policy'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
