'use client'

/**
 * Stewardship / capture outreach — durable UI.
 *
 * Three views: a queue board, a queue list, and a task screen. Unlike the
 * servicing-recovery prototype (in-memory fixtures), this is wired to the
 * /api/stewardship routes, so queue placement and operational state survive a
 * refresh. The look reuses the shared workflow component layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Mail, Phone, Search, Inbox, FileText, Building2, Check, ExternalLink,
  Clock, CircleAlert, Play, PenLine, MailX, Hand, UserCheck,
  ShieldCheck, ShieldAlert, Copy, Voicemail, MessageSquare, PhoneCall, PhoneOff,
} from 'lucide-react'
import {
  WorkflowPage, WorkflowHeader,
  QueueSection, QueueRow, QueueListHeader, CustomerQueueCard, QueueEmptyState,
  TaskShell, SlimTaskHeader, ContextHeader, type ContextField,
  ActionPanel, PrimaryAction, WorkflowButton, NextNote, OperationalTag,
  CustomerContactCard, type CustomerContact, GatewayLookup,
  PolicySummaryList, type PolicySummary,
  CustomerHistoryCard, NextHistoryEntry,
} from '@/components/workflow'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
import {
  QUEUE_META, OUTREACH_QUEUES,
  type OutreachQueue, type CallOutcome,
} from '@/lib/stewardship/queues'
import {
  describeNextHistoryEntry,
  describeCallSelection,
  describeIntroEmailSelection,
  type HistoryEvent,
  type WorkflowActivity,
  type NextHistoryEntryPreview,
  type CallSelection,
} from '@/lib/stewardship/customer-history'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import { isPermanent } from '@/lib/policies/product-type'
import { buildMailto, SCRIPTS, interpolate } from '@/lib/templates'
import type { AgencyOption } from './page'

/**
 * Rank for sorting a queue list: a customer with a due promised callback
 * (callback-due reason, date on/before today on the ACTOR's calendar) sorts to
 * the top (0) so a customer the Assistant recommends by callback is immediately
 * visible within the destination queue. Everything else keeps its existing
 * order (1). Presentation only; no workflow state changes. The actor zone comes
 * from the server (detected per employee); null falls back to the time module's
 * last resort.
 */
function dueCallbackRank(
  it: { call_reason: string | null; callback_date: string | null },
  actorTimeZone: string | null,
): number {
  return it.call_reason === 'callback-due' && isCallbackDue(it.callback_date, actorTimeZone) ? 0 : 1
}

const SA_SUBJECT = 'Regarding Your Life Insurance Policy'

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
function saEmailBody(firstName: string): string {
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
  form_received_at: string | null
  submitted_at: string | null
  carrier_correction: string | null
  prereview_id: string
  customer: Customer
  // True when a waiting item's (signature/carrier) follow-up window has lapsed,
  // so the board can flag it as a due chase. Set by the board route.
  follow_up_due_now?: boolean
  // The derived call action population this item belongs to (callability-based,
  // not its stored queue): 'calls-due' | 'available-to-call' | null. Set by the
  // board route so a population view lists exactly the counted customers.
  call_population?: 'calls-due' | 'available-to-call' | null
  // Whether this item is in the first-touch introductory-email population (the
  // untouched subset of Ready to Email). Set by the board route so the
  // introductory-email population view lists exactly the counted customers.
  is_intro_email?: boolean
  // Research Needed only: true when every still-missing contact method has been
  // researched unsuccessfully. The item stays in the queue (not dropped), sorts
  // below outstanding research, and shows "Research unsuccessful — Try again".
  // Set by the board route.
  research_unsuccessful?: boolean
  // Optional soft-lease claim (shared by default; the board is never filtered
  // by it). Reused from the IPF queue-owned-until-claimed model.
  claimed_by_producer_id?: string | null
  claimed_by_name?: string | null
  is_mine?: boolean
  // A DERIVED (virtual) onboarding item: the member needs servicing access but
  // has no recorded outreach row yet. id/prereview_id are null until an operator
  // acts; the first action materializes the durable record (see materialize()).
  virtual?: boolean
  customer_id?: string
}

/** A derived population a My Work link can open on the board: the two call
 * populations, plus the first-touch introductory-email subset of Ready to Email. */
type OpenPopulation = 'calls-due' | 'available-to-call' | 'introductory-emails'

const POPULATION_META: Record<OpenPopulation, { label: string; blurb: string }> = {
  'calls-due': {
    label: 'Calls Due',
    blurb: 'Customers with a scheduled call that has come due: a promised callback or an automatic retry.',
  },
  'available-to-call': {
    label: 'Available to Call',
    blurb: 'Customers with a usable phone who can be called now, not on a scheduled due date.',
  },
  'introductory-emails': {
    label: 'Introductory emails',
    blurb: 'First-touch customers in Ready to Email: send the introductory servicing-agent email that carries the authorization form.',
  },
}

type Holding = {
  id: string
  policy_number: string
  carrier: string
  product_type: string | null
  face_amount: number | null
  cash_value_amount: number | null
  issue_date: string | null
  coverage_status: string
  insured_name: string | null
  sa_status: string
  sa_form_sent_at: string | null
  in_request: boolean
}

type Detail = BoardItem & {
  form_received_at: string | null
  phone_verified_at: string | null
  email_verified_at: string | null
  address_verified_at: string | null
  form_delivery_method: 'email' | 'postal' | null
  refused_at: string | null
  customer: Customer & {
    date_of_birth: string | null
    street: string | null
    address_line1: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  source_agency_id: string | null
  holdings: Holding[]
  /** The available contact actions for this customer, decided by ZEN from the
   * real contact facts. Call / text / email are independent and simultaneous;
   * postal supports form delivery; needsResearch when no usable method exists. */
  contact_options?: {
    canCall: boolean
    canText: boolean
    canEmail: boolean
    canPostal: boolean
    needsResearch: boolean
  } | null
  /** Grouped outreach-attempt counts (individual communications preserved,
   * grouped into attempts). */
  outreach_attempts?: number
  call_attempts?: number
  /** The Nonresponsive recommendation when ZEN has flagged the run, else null.
   * A recommendation only: outreach is never auto-stopped. */
  nonresponsive?: {
    label: string
    attempts: number
    recommendation: string
  } | null
  /** Signer identity is not derivable from durable data; always false today. */
  signer_identity_known: boolean
  /** The active 1035 project whose consolidated Contact Research task owns this
   * customer. The Research Needed task links here instead of hosting its own
   * correction screen, so contact research is one surface. Null when not in an
   * active 1035 project. */
  contact_research_project_id?: string | null
  /** The display customer history (grouped interactions, newest first) for the
   * working-screen Customer History card. Display only; supplied by the GET
   * route from the durable case_touches log. */
  customer_history?: HistoryEvent[]
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

/**
 * The mailing street line for a customer. Real data stores it in `street`;
 * `address_line1` exists but is empty in practice. Prefer street, fall back to
 * address_line1.
 */
function streetLine(c: { street?: string | null; address_line1?: string | null }): string {
  return (c.street ?? c.address_line1 ?? '').trim()
}

/** Whether a scheduled follow-up date is due (on/before now). */
function followUpLapsed(followUpDue: string | null): boolean {
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
function FollowUpChase({
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

function currency(n: number | null) {
  if (n == null) return '\u2014'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function StewardshipClient({
  agencies,
  project = null,
  initialQueue = null,
  initialCustomerId = null,
  initialItemId = null,
  actorTimeZone = null,
}: {
  agencies: AgencyOption[]
  /** When set, the whole screen is scoped to this project. */
  project?: { id: string; name: string } | null
  /** When set (via the ?queue= param, e.g. from the Assistant), the board opens
   * directly on this queue's list instead of the queue board. */
  initialQueue?: OutreachQueue | null
  /** When set (via the ?customer_id= param, e.g. from a project work view), the
   * board opens that one customer's outreach task directly once it loads, so a
   * per-customer link lands on the actual task rather than the whole board. */
  initialCustomerId?: string | null
  /** When set (via the ?item_id= param), open this exact outreach task directly.
   * Unlike customer_id this does not depend on the item appearing on the board,
   * so a suppressed (e.g. refused) item is still reachable to reopen. */
  initialItemId?: string | null
  /** The signed-in employee's detected IANA timezone, used to judge date-only
   * callback due on the actor's calendar for the queue-list sort. */
  actorTimeZone?: string | null
}) {
  const [items, setItems] = useState<BoardItem[]>([])
  const [counts, setCounts] = useState<Record<OutreachQueue, number>>(
    Object.fromEntries(OUTREACH_QUEUES.map(q => [q, 0])) as Record<OutreachQueue, number>,
  )
  // Research Needed split: outstanding (still to do, drives the tile count) and
  // unsuccessful (researched, nothing found — kept visible for a deliberate
  // retry). Reported by the board route so the two are never conflated.
  const [researchCounts, setResearchCounts] = useState<{ outstanding: number; unsuccessful: number }>(
    { outstanding: 0, unsuccessful: 0 },
  )
  const [loading, setLoading] = useState(true)
  const [openQueue, setOpenQueue] = useState<OutreachQueue | null>(initialQueue)
  const [openItemId, setOpenItemId] = useState<string | null>(initialItemId)
  // When materializing a derived (virtual) onboarding item on first action, the
  // customer id being materialized (so its card can show a brief busy state).
  const [materializingCustomerId, setMaterializingCustomerId] = useState<string | null>(null)
  // A derived call population view (opened from a My Work "Calls Due" /
  // "Available to Call" link). When set, the board shows exactly that
  // population's customers, fetched from the server with the population filter.
  const [openPopulation, setOpenPopulation] = useState<OpenPopulation | null>(null)
  const [populationItems, setPopulationItems] = useState<BoardItem[]>([])
  const [populationLoading, setPopulationLoading] = useState(false)
  // Claiming (optional soft lease) is only shown on the actionable outreach
  // queues. claimBusy tracks the row currently being claimed/released; claimMsg
  // surfaces an eligibility/conflict message from the claim endpoint.
  const [claimBusy, setClaimBusy] = useState<string | null>(null)
  const [claimMsg, setClaimMsg] = useState<string | null>(null)

  // Respond to the ?queue= param changing WHILE on this page. The Assistant's
  // links (which share this page) are client-side navigations that do not
  // remount this component, so initialQueue alone would not react to them. We
  // watch the live param and open the matching queue list when it changes to a
  // valid queue. We track the last-applied value so this only fires on an
  // actual param change, never fighting the user's in-app queue navigation.
  const searchParams = useSearchParams()
  const queueParam = searchParams.get('queue')
  const lastAppliedQueueParam = useRef<string | null>(initialQueue)
  useEffect(() => {
    if (queueParam === lastAppliedQueueParam.current) return
    lastAppliedQueueParam.current = queueParam
    if (queueParam && (OUTREACH_QUEUES as readonly string[]).includes(queueParam)) {
      setOpenItemId(null)
      setOpenPopulation(null)
      setOpenQueue(queueParam as OutreachQueue)
    }
  }, [queueParam])

  // Respond to the ?population= param (a My Work Calls Due / Available to Call
  // link). Opens the derived population view, which lists exactly the customers
  // the population counted, fetched server-side with the population filter so
  // the counted and opened sets always match.
  const populationParam = searchParams.get('population')
  const lastAppliedPopulationParam = useRef<string | null>(null)
  useEffect(() => {
    if (populationParam === lastAppliedPopulationParam.current) return
    lastAppliedPopulationParam.current = populationParam
    if (
      populationParam === 'calls-due' ||
      populationParam === 'available-to-call' ||
      populationParam === 'introductory-emails'
    ) {
      setOpenItemId(null)
      setOpenQueue(null)
      setOpenPopulation(populationParam)
    }
  }, [populationParam])

  // Per-customer deep link: when a ?customer_id= param is present (a project
  // work view opening a specific customer's task), open that customer's actual
  // outreach task once the board has loaded. The board item carries the
  // customer id, so we resolve the open stewardship_outreach row for that
  // customer and open its task directly. Applied once per customer-id value so
  // it never fights the worker's in-app navigation afterward.
  const customerParam = searchParams.get('customer_id') ?? initialCustomerId
  const lastAppliedCustomerParam = useRef<string | null>(null)
  useEffect(() => {
    if (!customerParam || items.length === 0) return
    if (customerParam === lastAppliedCustomerParam.current) return
    const match = items.find((it) => it.customer.id === customerParam)
    if (match) {
      lastAppliedCustomerParam.current = customerParam
      setOpenQueue(null)
      setOpenItemId(match.id)
    }
  }, [customerParam, items])

  const loadBoard = useCallback(async () => {
    setLoading(true)
    try {
      // In project scope, ask the board for only this project's work; counts
      // come back already scoped from the API.
      const url = project ? `/api/stewardship?project_id=${encodeURIComponent(project.id)}` : '/api/stewardship'
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok) {
        setItems(json.data.items as BoardItem[])
        setCounts(json.data.counts as Record<OutreachQueue, number>)
        if (json.data.research_counts) {
          setResearchCounts(json.data.research_counts as { outstanding: number; unsuccessful: number })
        }
      }
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => { void loadBoard() }, [loadBoard])

  // Fetch the opened call population from the server (which applies the SAME
  // callability + due derivation My Work counts with), so the list is exactly
  // the counted customers regardless of their stored queue.
  const loadPopulation = useCallback(async (population: OpenPopulation) => {
    setPopulationLoading(true)
    try {
      const params = new URLSearchParams({ population })
      if (project) params.set('project_id', project.id)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok) setPopulationItems(json.data.items as BoardItem[])
    } finally {
      setPopulationLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (openPopulation) void loadPopulation(openPopulation)
  }, [openPopulation, loadPopulation])

  const claim = useCallback(async (outreachId: string, release: boolean) => {
    setClaimBusy(outreachId); setClaimMsg(null)
    try {
      const res = await fetch('/api/stewardship/claim', {
        method: release ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_id: outreachId }),
      })
      const json = await res.json()
      if (!res.ok) { setClaimMsg(json.error ?? 'Could not update the claim.'); return }
      await loadBoard()
      if (openPopulation) await loadPopulation(openPopulation)
    } catch {
      setClaimMsg('Network error.')
    } finally {
      setClaimBusy(null)
    }
  }, [loadBoard, openPopulation, loadPopulation])

  // Materialize a DERIVED (virtual) onboarding item into a durable record on an
  // operator's FIRST action, then return its outreach id. This is the only
  // board path that creates a record, and it fires on an explicit action
  // (opening or claiming the item) — never on a page read.
  const materialize = useCallback(async (customerId: string): Promise<string | null> => {
    setMaterializingCustomerId(customerId); setClaimMsg(null)
    try {
      const res = await fetch('/api/stewardship/ensure-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      })
      const json = await res.json()
      if (!res.ok) { setClaimMsg(json.error ?? 'Could not start onboarding for this customer.'); return null }
      return json.data.outreach_id as string
    } catch {
      setClaimMsg('Network error.')
      return null
    } finally {
      setMaterializingCustomerId(null)
    }
  }, [])

  // Open an item's task screen. A real item opens directly; a derived (virtual)
  // item is first materialized (create-on-first-action), then opened.
  const openItem = useCallback(async (it: BoardItem) => {
    if (it.virtual) {
      const outreachId = it.customer_id ? await materialize(it.customer_id) : null
      if (!outreachId) return
      await loadBoard()
      setOpenItemId(outreachId)
      return
    }
    setOpenItemId(it.id)
  }, [materialize, loadBoard])

  // Claim an item. A derived (virtual) item is materialized first (claiming is a
  // real operator action and may create the record), then claimed.
  const claimItem = useCallback(async (it: BoardItem, release: boolean) => {
    let outreachId = it.id
    if (it.virtual) {
      const created = it.customer_id ? await materialize(it.customer_id) : null
      if (!created) return
      outreachId = created
    }
    await claim(outreachId, release)
  }, [claim, materialize])

  if (openItemId) {
    // The ordered list of OTHER customers in the same activity, so the task
    // screen can advance to the next one (used by Introductory Emails' fast
    // "Next customer" flow). Prefer the opened intro-email population; otherwise
    // fall back to the open Ready to Email queue list. Only real (non-virtual)
    // items can be opened directly, so virtuals are excluded here.
    const activitySource =
      openPopulation === 'introductory-emails'
        ? populationItems.slice().sort((a, b) => dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone))
        : openQueue === 'ready-to-email'
          ? items.filter(i => i.queue === 'ready-to-email').sort((a, b) => dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone))
          : []
    const siblingIds = activitySource
      .map(it => it.id)
      .filter((id): id is string => !!id && id !== openItemId)

    const advanceToNext = () => {
      const nextId = siblingIds[0] ?? null
      if (nextId) {
        setOpenItemId(nextId)
      } else {
        // Last customer in the activity: fall back to the activity list.
        setOpenItemId(null)
      }
      void loadBoard()
      if (openPopulation) void loadPopulation(openPopulation)
    }

    return (
      <StewardshipTask
        key={openItemId}
        itemId={openItemId}
        hasNextInActivity={siblingIds.length > 0}
        onAdvanceToNext={advanceToNext}
        onBack={() => {
          setOpenItemId(null)
          void loadBoard()
          if (openPopulation) void loadPopulation(openPopulation)
        }}
      />
    )
  }

  // A derived call population view (Calls Due / Available to Call). Lists exactly
  // the customers the server derived for this population, so the counted and
  // opened sets match and a callable customer appears here even when their
  // stored queue is Ready to Email. Due items are shown first.
  if (openPopulation) {
    const meta = POPULATION_META[openPopulation]
    const popItems = populationItems
      .slice()
      .sort((a, b) => dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone))
    return (
      <WorkflowPage>
        <QueueListHeader
          icon={openPopulation === 'introductory-emails' ? Mail : Phone}
          label={meta.label}
          count={popItems.length}
          blurb={meta.blurb}
          onBack={() => setOpenPopulation(null)}
        />
        {claimMsg && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="mt-5 space-y-3">
          {populationLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : popItems.length === 0 ? (
            <QueueEmptyState>No customers in this population right now.</QueueEmptyState>
          ) : (
            popItems.map(it => (
              <CustomerQueueCard
                key={it.id ?? `virtual:${it.customer_id}`}
                name={fullName(it.customer)}
                detail={queueDetail(it)}
                trailing={
                  <div className="flex items-center gap-2">
                    {queueTag(it)}
                    <ClaimControl
                      item={it}
                      busy={claimBusy === it.id || (it.virtual === true && materializingCustomerId === it.customer_id)}
                      onClaim={() => claimItem(it, false)}
                      onRelease={() => claimItem(it, true)}
                    />
                  </div>
                }
                onOpen={() => void openItem(it)}
              />
            ))
          )}
        </div>
      </WorkflowPage>
    )
  }

  if (openQueue) {
    const meta = QUEUE_META[openQueue]
    // Due callbacks (a customer we promised to call back on or before today)
    // are surfaced at the TOP of the list, so a customer the Assistant
    // recommends by callback is immediately visible and reachable within the
    // destination queue. This is a presentation sort only; it changes no
    // workflow state and no queue placement. "Today" is judged on the business
    // calendar, matching the Assistant.
    //
    // In Research Needed, outstanding research (still to do) sorts ABOVE research
    // that already came up empty ("Research unsuccessful — Try again"), so the
    // actionable work leads and the already-researched holdovers trail without
    // being removed from the queue.
    const queueItems = items
      .filter(i => i.queue === openQueue)
      .sort((a, b) => {
        if (openQueue === 'research-needed') {
          const ra = a.research_unsuccessful ? 1 : 0
          const rb = b.research_unsuccessful ? 1 : 0
          if (ra !== rb) return ra - rb
        }
        return dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone)
      })
    // Research Needed carries a split count in its header so outstanding and
    // unsuccessful are distinguished at a glance; every other queue shows its
    // plain list length.
    const headerBlurb = openQueue === 'research-needed'
      ? `${researchCounts.outstanding} still to research${researchCounts.unsuccessful > 0 ? ` · ${researchCounts.unsuccessful} researched, nothing found` : ''}`
      : meta.blurb
    return (
      <WorkflowPage>
        <QueueListHeader
          icon={QUEUE_ICON[openQueue]}
          label={meta.label}
          count={queueItems.length}
          blurb={headerBlurb}
          onBack={() => setOpenQueue(null)}
        />
        {claimMsg && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="mt-5 space-y-3">
          {queueItems.length === 0 ? (
            <QueueEmptyState>No customers in this queue.</QueueEmptyState>
          ) : (
            queueItems.map(it => (
              <CustomerQueueCard
                key={it.id ?? `virtual:${it.customer_id}`}
                name={fullName(it.customer)}
                detail={queueDetail(it)}
                trailing={
                  <div className="flex items-center gap-2">
                    {queueTag(it)}
                    <ClaimControl
                      item={it}
                      busy={claimBusy === it.id || (it.virtual === true && materializingCustomerId === it.customer_id)}
                      onClaim={() => claimItem(it, false)}
                      onRelease={() => claimItem(it, true)}
                    />
                  </div>
                }
                onOpen={() => void openItem(it)}
              />
            ))
          )}
        </div>
      </WorkflowPage>
    )
  }

  return (
    <WorkflowPage>
      {project ? (
        <WorkflowHeader
          primary={`Stewardship — ${project.name}`}
          secondary="Capture outreach scoped to this project's population. Queues and lists below show only this project's work."
        />
      ) : (
        <WorkflowHeader
          primary="Stewardship"
          secondary="Capture outreach — confirm servicing access on each customer's policies."
        />
      )}

      {project
        ? <ProjectOnboardingNote project={project} />
        : <StartCapture agencies={agencies} onStarted={loadBoard} />}

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

      {loading && <p className="mt-4 text-sm text-ink-supporting">Loading board…</p>}
    </WorkflowPage>
  )
}

function queueDetail(it: BoardItem): string {
  switch (it.queue) {
    case 'ready-to-call': return it.call_reason ? callReasonLabel(it.call_reason) : 'Ready to call'
    case 'research-needed': return it.research_unsuccessful ? 'Researched — nothing found yet' : 'Needs usable contact'
    case 'waiting-for-response': return it.follow_up_due ? `Follow-up ${shortDate(it.follow_up_due)}` : 'Awaiting reply'
    case 'waiting-for-form': return 'Form sent'
    case 'waiting-for-carrier': return it.carrier_correction ? 'Carrier correction needed' : 'Submitted to carrier'
    default: return 'Ready to email'
  }
}

function queueTag(it: BoardItem) {
  // A researched-not-found customer stays in Research Needed, flagged so the
  // worker sees it is a deliberate retry (not fresh outstanding work). Opening
  // it returns to the same research task.
  if (it.queue === 'research-needed' && it.research_unsuccessful) {
    return <OperationalTag tone="info">Research unsuccessful — Try again</OperationalTag>
  }
  if (it.queue === 'waiting-for-carrier' && it.carrier_correction) {
    return <OperationalTag tone="exception">Correction</OperationalTag>
  }
  // A lapsed signature/carrier follow-up is an actionable chase — flag it.
  if (it.follow_up_due_now) {
    return <OperationalTag tone="reason">Follow-up due</OperationalTag>
  }
  if (it.queue === 'ready-to-call' && it.call_reason === 'callback-due') {
    return <OperationalTag tone="reason">Callback due</OperationalTag>
  }
  return null
}

/**
 * The optional claim control for a shared outreach item (ported from the IPF
 * queue-owned-until-claimed model). Work is shared by default, so an unclaimed
 * item offers Claim; the holder sees "Yours" with a Release; another worker's
 * claim is shown read-only. Clicks do not open the item (stopPropagation), so
 * claiming is distinct from opening the customer work.
 */
function ClaimControl({
  item, busy, onClaim, onRelease,
}: {
  item: BoardItem
  busy: boolean
  onClaim: () => void
  onRelease: () => void
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  if (item.is_mine) {
    return (
      <span className="inline-flex items-center gap-2" onClick={stop}>
        <span className="inline-flex items-center gap-1 rounded-full border border-tag-info-border bg-tag-info-fill px-2.5 py-1 text-xs font-semibold text-tag-info-text">
          <UserCheck className="size-3.5" aria-hidden /> Yours
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onRelease}
          className="text-xs font-medium text-ink-supporting underline-offset-2 hover:text-ink-secondary hover:underline disabled:opacity-50"
        >
          {busy ? '…' : 'Release'}
        </button>
      </span>
    )
  }

  if (item.claimed_by_producer_id) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-muted px-2.5 py-1 text-xs text-ink-supporting"
        onClick={stop}
        title={`Claimed by ${item.claimed_by_name ?? 'another team member'}`}
      >
        <UserCheck className="size-3.5" aria-hidden />
        {item.claimed_by_name ?? 'Claimed'}
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { stop(e); onClaim() }}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-ring bg-brand-wash px-3 py-1 text-xs font-semibold text-brand-hover hover:bg-brand-subtle hover:text-brand-foreground disabled:opacity-50"
    >
      <Hand className="size-3.5" aria-hidden />
      {busy ? 'Claiming…' : 'Claim'}
    </button>
  )
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

type CustomerSearchResult = { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }

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
    <section className="rounded-2xl border border-brand-subtle bg-surface-card p-5">
      <h2 className="text-base font-semibold text-ink">Start capture for a book</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Creates a stewardship work item for each customer in the selected agency that is not already
        in progress. Each item routes to Ready to Email, Ready to Call, or Research Needed based on
        the contact information on file.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={agencyId}
          onChange={e => setAgencyId(e.target.value)}
          className="rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
        >
          <option value="">Select an agency / book…</option>
          {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <WorkflowButton icon={Play} selected disabled={!agencyId || busy} onClick={start}>
          {busy ? 'Starting…' : 'Start capture'}
        </WorkflowButton>
        {result && <span className="text-sm font-medium text-ink-secondary">{result}</span>}
      </div>

      <StartSingleCustomer onStarted={onStarted} />
    </section>
  )
}

/**
 * Start onboarding for ONE customer. Same capture flow as the book/project
 * paths, scoped to a single customer resolved by name search. Reuses the shared
 * /api/customers/search endpoint and the customer_id branch of
 * /api/stewardship/start.
 */
function StartSingleCustomer({ onStarted }: { onStarted: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Debounced name/phone search once the query is at least 2 characters.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
        const json = await res.json()
        if (!cancelled && res.ok) setResults((json.data ?? []) as CustomerSearchResult[])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  async function startOne(c: CustomerSearchResult) {
    setBusyId(c.id); setResult(null)
    try {
      const res = await fetch('/api/stewardship/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: c.id }),
      })
      const json = await res.json()
      if (res.ok) {
        const name = `${c.first_name} ${c.last_name}`.trim()
        if (json.data.started > 0) {
          setResult(`Started onboarding for ${name}.`)
        } else if (json.data.skipped > 0) {
          setResult(`${name} is already in progress.`)
        } else {
          setResult(`${name} has no known policy to onboard.`)
        }
        setQ(''); setResults([])
        onStarted()
      } else {
        setResult(json.error ?? 'Could not start onboarding.')
      }
    } catch {
      setResult('Network error.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-5 border-t border-surface-border pt-5">
      <h3 className="text-sm font-semibold text-ink">Or start one customer</h3>
      <p className="mt-1 text-sm text-ink-secondary">
        Search by name or phone to begin onboarding a single customer. Every policy we know they hold
        goes into the servicing-agent request.
      </p>
      <div className="mt-3 max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search customer…"
            className="w-full rounded-lg border border-surface-border-strong bg-surface-card py-2 pl-9 pr-3 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
          />
        </div>
        {q.trim().length >= 2 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-surface-border">
            {searching && results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink-muted">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink-muted">No matches.</p>
            ) : (
              results.map(c => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => startOne(c)}
                  className="flex w-full items-center justify-between gap-3 border-b border-surface-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-muted disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-ink">{c.first_name} {c.last_name}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-hover">
                    <Play className="size-3.5" aria-hidden /> {busyId === c.id ? 'Starting…' : 'Start'}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        {result && <p className="mt-2 text-sm font-medium text-ink-secondary">{result}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Work Project — begin stewardship work for a project's population. Reuses the
// same capture flow and the same /api/stewardship/start endpoint, scoped by
// project_id instead of an agency book. Customers already in open stewardship
// work are reused, not duplicated.
// ─────────────────────────────────────────────────────────────────────────────

// Servicing Agent Onboarding is objective-driven: every member of this project
// is accounted for automatically by MEMBERSHIP, so there is no manual "start"
// step. Opening this board ensures each member has an onboarding record (adding
// only the missing ones; existing work and history are preserved and never
// duplicated), then shows the work. This note replaces the former "Work
// project" button, which is obsolete.
function ProjectOnboardingNote({ project }: { project: { id: string; name: string } }) {
  return (
    <section className="rounded-2xl border border-brand-subtle bg-surface-card p-5">
      <h2 className="text-base font-semibold text-ink">Servicing Agent Onboarding</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Every customer in {project.name} is automatically in Servicing Agent Onboarding — no manual
        start is needed. Each customer&apos;s available work (call, email, text, research, follow-up)
        is surfaced from their current contact information, outreach history, and the applicable
        rules. Existing outreach is preserved; nothing is duplicated.
      </p>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Task screen — one outreach item, dispatched by queue.
// ─────────────────────────────────────────────────────────────────────────────

export function StewardshipTask({
  itemId, onBack, hasNextInActivity = false, onAdvanceToNext, hideBackHeader = false, forceCall = false,
}: {
  itemId: string
  onBack: () => void
  /** Whether another customer remains in this activity to advance to. */
  hasNextInActivity?: boolean
  /** Open the next customer in this activity (Introductory Emails fast flow). */
  onAdvanceToNext?: () => void
  /** Suppress the task's own "All queues" back header AND its outer page wrapper.
   * Used only by the dedicated Send Introductory Emails direct working screen,
   * which supplies its own WorkflowPage + "Back to My Work" navigation. Every
   * other Stewardship use leaves this false, keeping the original "All queues"
   * back button and page chrome unchanged. */
  hideBackHeader?: boolean
  /** Drive the guided CALL flow regardless of the item's stored queue. Used by
   * the Call Reachable Customers workbench: a callable customer may sit in Ready
   * to Email (callable but not yet emailed), so the workbench forces the call
   * flow rather than the stored-queue action. Also switches the right-side
   * context to the shared Customer Contact card (verify/correct inline) and
   * hides the separate record-an-attempt panel, since the guided flow IS the
   * recording. Every other caller leaves this false, so their behavior is
   * unchanged. */
  forceCall?: boolean
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Live Next History Entry preview, built from the selections the worker is
  // making in the guided call flow. The action column owns the selections and
  // reports them up here; the history column renders the preview. null means
  // the worker has not yet chosen enough to record anything (no reach decision),
  // so the preview is hidden until the work can generate a history event.
  const [callSelection, setCallSelection] = useState<CallSelection | null>(null)
  // Reset the live preview whenever the open item changes, so a stale selection
  // from a prior customer never leaks onto the next one.
  useEffect(() => { setCallSelection(null) }, [itemId])

  const load = useCallback(async () => {
    const res = await fetch(`/api/stewardship/${itemId}`, { cache: 'no-store' })
    const json = await res.json()
    if (res.ok) setDetail(json.data as Detail)
  }, [itemId])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (
    action: unknown,
    successNote?: string,
    opts?: { advanceToNext?: boolean },
  ) => {
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
        // Carrier confirmed: the outreach row is gone and the customer has left
        // outreach for the documentation layer. Return to the board.
        onBack()
        return
      }
      // Introductory Emails fast flow: a successful send removes this customer
      // from the activity, so instead of reloading the (now departed) item we
      // open the next customer in the activity. Falls back to the activity list
      // when this was the last one.
      if (opts?.advanceToNext) {
        if (onAdvanceToNext) onAdvanceToNext()
        else onBack()
        return
      }
      if (successNote) setNote(successNote)
      await load()
    } catch {
      setNote('Network error.')
    } finally {
      setBusy(false)
    }
  }, [itemId, load, onBack, onAdvanceToNext])

  // The direct Send Introductory Emails screen hosts its own WorkflowPage and
  // "Back to My Work" nav, so there the task renders chromeless (no outer page
  // wrapper, no "All queues" header). Every other Stewardship caller gets the
  // original page chrome and the "All queues" back header, unchanged.
  const Chrome = hideBackHeader
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : WorkflowPage

  if (!detail) {
    return (
      <Chrome>
        {!hideBackHeader && <SlimTaskHeader onBack={onBack} />}
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      </Chrome>
    )
  }

  const request = detail.holdings.filter(h => h.in_request)
  const context = detail.holdings.filter(h => !h.in_request)

  // The three working screens (Send Introductory Emails, the guided Calling
  // workbench, and Contact Research) use the shared Customer Contact card, so
  // they also get the working-screen THREE-COLUMN layout: current work and
  // actions on the left, the customer context (contact card + policy summary)
  // in the center, and the customer history (with the Next History Entry
  // preview) on the right. Every other stewardship caller keeps the original
  // two-column action/context layout, so their behavior is unchanged.
  const introEmail = isIntroductoryEmailActivity(detail)
  const research = detail.queue === 'research-needed'
  const isWorkingScreen = introEmail || research || forceCall

  return (
    <Chrome>
      <TaskShell
        header={hideBackHeader ? null : <SlimTaskHeader onBack={onBack} backLabel="All queues" />}
        action={
          <TaskAction
            detail={detail} request={request} busy={busy} note={note} act={act}
            hasNextInActivity={hasNextInActivity} forceCall={forceCall}
            onCallSelectionChange={setCallSelection}
          />
        }
        context={
          <StewardshipContextPanel
            detail={detail} request={request} context={context} busy={busy} act={act}
            setDetail={setDetail} forceCall={forceCall} withHistoryColumn={isWorkingScreen}
          />
        }
        history={isWorkingScreen
          ? <StewardshipHistoryColumn detail={detail} forceCall={forceCall} callSelection={callSelection} />
          : undefined}
      />
    </Chrome>
  )
}

/**
 * The right-hand history column for the working screens: the Next History Entry
 * preview (what completing this work will record) above the Customer History.
 * Completing the work records the entry automatically, so the preview tells the
 * worker what will be logged rather than asking them to log it. History is the
 * grouped customer history supplied by the GET route (display only).
 */
function StewardshipHistoryColumn({
  detail, forceCall, callSelection,
}: {
  detail: Detail
  forceCall: boolean
  /** The live call-flow selection, when a guided call is in progress. Drives the
   * dynamic preview; null on the other working screens or before a reach
   * decision. */
  callSelection: CallSelection | null
}) {
  const activity = resolveWorkflowActivity(detail, forceCall)
  // The preview is built DYNAMICALLY from the live selection where the screen
  // makes one (the guided call flow, the intro email), so it reflects exactly
  // what completing the open work will record, combined into one concise entry.
  // The calling flow only generates an event once a reach decision is made, so
  // before that the preview is withheld.
  const preview: NextHistoryEntryPreview | null =
    activity === 'calling'
      ? (callSelection
          ? describeCallSelection(callSelection, { customerName: detail.customer.first_name })
          : null)
      : activity === 'introductory-email'
        ? describeIntroEmailSelection({ formIncluded: true })
        : describeNextHistoryEntry(activity, { customerName: detail.customer.first_name })
  return (
    <>
      {/* The card owns its single heading; blank until there is something to
          record (the calling flow before a reach decision passes null). */}
      <NextHistoryEntry preview={preview} />
      <CustomerHistoryCard events={detail.customer_history ?? []} />
    </>
  )
}

/** Resolve which workflow activity a working screen is performing, so the Next
 * History Entry preview describes the right recorded outcome. The guided call
 * workbench (forceCall) is calling; Research Needed is contact research; an
 * untouched Ready-to-Email first touch is the introductory email. */
function resolveWorkflowActivity(detail: Detail, forceCall: boolean): WorkflowActivity {
  if (forceCall) return 'calling'
  if (detail.queue === 'research-needed') return 'contact-research'
  if (isIntroductoryEmailActivity(detail)) return 'introductory-email'
  return 'record-attempt'
}

/** Map a holding onto the read-only Policy Summary shape. */
function holdingToPolicySummary(h: Holding): PolicySummary {
  return {
    id: h.id,
    policy_number: h.policy_number,
    product_type: h.product_type,
    face_amount: h.face_amount,
    issue_date: h.issue_date,
    cash_value_amount: h.cash_value_amount,
    carrier: h.carrier,
  }
}

/**
 * The Introductory Emails activity: a Ready to Email item the worker has NOT
 * reached by phone, so the next step is the first-touch introductory email that
 * carries the authorization form. This screen is streamlined for fast,
 * continuous processing (send, record, next customer), so the right-panel
 * verification and attempt-recording tools — which belong to the call/research
 * activities — are intentionally hidden here. They remain available on every
 * other activity.
 */
function isIntroductoryEmailActivity(detail: Detail): boolean {
  return detail.queue === 'ready-to-email' && detail.last_call_outcome !== 'reached'
}

/**
 * The right-side context panel for an outreach task. Always shows the customer
 * information and the servicing request/policy information. The customer-
 * verified contact box and the record-an-attempt panel are shown on every
 * activity EXCEPT Introductory Emails, which is streamlined for fast sending;
 * both capabilities stay fully available on the call and research activities.
 */
function StewardshipContextPanel({
  detail, request, context, busy, act, setDetail, forceCall = false, withHistoryColumn = false,
}: {
  detail: Detail
  request: Holding[]
  context: Holding[]
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  setDetail: React.Dispatch<React.SetStateAction<Detail | null>>
  /** The Call Reachable Customers workbench: show the shared Customer Contact
   * card (verify/correct inline on the Reached path) and hide the separate
   * record-an-attempt panel, because the guided call flow IS the recording. */
  forceCall?: boolean
  /** On the three working screens, history moves to its own third column, so
   * the center context column shows the contact card + the read-only Policy
   * Summary beneath it (replacing the raw holdings list). Every other caller
   * keeps the original holdings context. */
  withHistoryColumn?: boolean
}) {
  const introEmail = isIntroductoryEmailActivity(detail)
  // Research Needed is the second 1035 contact-gathering activity: like
  // Introductory Emails and project Contact Review, its contact surface is the
  // one shared editable Customer Contact card (identity, email, phone, mailing
  // address, each with status, edit, and customer-verified control), replacing
  // the former separate contact summary, mailing-address block, and verification
  // checkboxes. The research capture + routing stays in the left ActionPanel.
  const research = detail.queue === 'research-needed'
  // The calling workbench also uses the shared card: verifying/correcting a
  // phone, email, or mailing address is part of a reached call, and the card is
  // the one editable contact surface across the app.
  const useCard = introEmail || research || forceCall

  // Policy Summary on the working screens replaces the raw holdings list in the
  // center column. Summarize the servicing-request policies when the request
  // names them, otherwise all known holdings, so the worker still sees the
  // customer's policy facts. Existing policy data only; nothing invented.
  const summaryPolicies = (request.length > 0 ? request : context).map(holdingToPolicySummary)

  return (
    <>
      {useCard ? (
        // Writes straight to the customer record via the shared route and keeps
        // the surrounding task in sync through onChange.
        <StewardshipCustomerContact detail={detail} setDetail={setDetail} />
      ) : (
        <CustomerContext detail={detail} busy={busy} act={act} showVerification />
      )}
      {/* The record-an-attempt tool belongs to the general call/research view,
          not the fast-send Introductory Emails flow, the find-contact Research
          flow (which records no contact attempt), nor the guided calling
          workbench (whose Reached/Didn't Reach flow IS the single recording). */}
      {!introEmail && !research && !forceCall && <RecordAttemptPanel detail={detail} busy={busy} act={act} />}
      {withHistoryColumn ? (
        // Working-screen center column: the read-only Policies card beneath the
        // contact card (it owns its single "Policies" heading). Holdings-as-
        // context is replaced by it here; the request/other-holdings distinction
        // is preserved by summarizing the request policies first.
        <PolicySummaryList policies={summaryPolicies} />
      ) : (
        <HoldingsContext request={request} context={context} />
      )}
    </>
  )
}

/**
 * The Introductory Emails contact surface: the shared CustomerContactCard bound
 * to this outreach item's customer. Maps the stewardship Detail onto the card's
 * customer shape and folds any saved/verified change back into the task's Detail
 * so the rest of the screen (and the Introductory Emails fast flow) stays
 * consistent without a reload. The card itself persists to the shared
 * /api/customers/[id]/contact route.
 */
function StewardshipCustomerContact({
  detail, setDetail,
}: {
  detail: Detail
  setDetail: React.Dispatch<React.SetStateAction<Detail | null>>
}) {
  const c = detail.customer
  const customer: CustomerContact = {
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    street: c.street,
    address_line1: c.address_line1,
    city: c.city,
    state: c.state,
    zip: c.zip,
    email_verified_at: detail.email_verified_at,
    phone_verified_at: detail.phone_verified_at,
    address_verified_at: detail.address_verified_at,
  }
  return (
    <CustomerContactCard
      customer={customer}
      onChange={(u) => setDetail(prev => prev ? {
        ...prev,
        email_verified_at: u.email_verified_at,
        phone_verified_at: u.phone_verified_at,
        address_verified_at: u.address_verified_at,
        customer: {
          ...prev.customer,
          // Name is not edited by this card; keep the existing (non-null) values.
          email: u.email,
          phone: u.phone,
          street: u.street,
          address_line1: u.address_line1 ?? prev.customer.address_line1,
          city: u.city,
          state: u.state,
          zip: u.zip,
        },
      } : prev)}
    />
  )
}

/**
 * The per-queue task action. Dispatches to the queue-specific panel. Each panel
 * owns its own copy, controls, and transitions; the dispatcher only routes.
 */
function TaskAction({
  detail, request, busy, note, act, hasNextInActivity = false, forceCall = false,
  onCallSelectionChange,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  note: string | null
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity?: boolean
  /** Force the guided call flow regardless of the stored queue (the Call
   * Reachable Customers workbench). */
  forceCall?: boolean
  /** Report the live guided-call selection up so the history column can preview
   * the entry that completing the call will record. */
  onCallSelectionChange?: (selection: CallSelection | null) => void
}) {
  const name = fullName(detail.customer)

  const noteBox = note && (
    <div className="flex items-center gap-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4 text-base text-status-confirmed-strong">
      <Check className="size-5" aria-hidden /> {note}
    </div>
  )

  // A refused item shows a stop state and a deliberate Reopen; outreach stays
  // suppressed everywhere else until it is reopened here.
  if (detail.refused_at) {
    return <RefusedAction detail={detail} busy={busy} noteBox={noteBox} act={act} />
  }

  // The Nonresponsive recommendation (ZEN-flagged after enough unsuccessful
  // outreach attempts) is shown ABOVE the normal action, never instead of it:
  // outreach is not stopped, the queue is unchanged, and the worker still acts.
  // It recommends reconsidering contact information, method, or timing, and
  // leaves the decision to the person.
  const banner = detail.nonresponsive ? (
    <NonresponsiveNotice nonresponsive={detail.nonresponsive} />
  ) : null

  const panel = (() => {
    // The Call Reachable Customers workbench forces the guided call flow for any
    // callable customer, regardless of their stored queue (a callable customer
    // may sit in Ready to Email, having never been emailed). The workbench owns
    // the whole guided flow INCLUDING the reached authorization-form step, so it
    // stays in control even after the reached call is recorded; it only hands
    // off by advancing to the next customer once the form is sent.
    if (forceCall) {
      return (
        <CallAction
          detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
          workbench hasNextInActivity={hasNextInActivity}
          onSelectionChange={onCallSelectionChange}
        />
      )
    }
    switch (detail.queue) {
      case 'ready-to-email':
        return (
          <ReadyToEmailAction
            detail={detail} request={request} name={name} busy={busy} noteBox={noteBox} act={act}
            hasNextInActivity={hasNextInActivity}
          />
        )
      case 'ready-to-call':
        return (
          <CallAction
            detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
            workbench={forceCall} hasNextInActivity={hasNextInActivity}
            onSelectionChange={onCallSelectionChange}
          />
        )
      case 'research-needed':
        return <ResearchAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
      case 'waiting-for-response':
        return <WaitingForResponseAction detail={detail} busy={busy} noteBox={noteBox} act={act} />
      case 'waiting-for-form':
        return <FormAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
      case 'waiting-for-carrier':
        return <CarrierAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
      default:
        return null
    }
  })()

  if (!banner) return panel
  return (
    <div className="space-y-4">
      {banner}
      {panel}
    </div>
  )
}

/**
 * The Nonresponsive — Review Contact Strategy recommendation. A prominent but
 * non-blocking banner: it explains that enough outreach attempts have not
 * reached the customer and recommends reconsidering the contact information,
 * the communication method, or the timing. It never stops outreach and offers
 * no terminal action; the worker decides whether to continue, change approach,
 * defer, or stop.
 */
function NonresponsiveNotice({
  nonresponsive,
}: {
  nonresponsive: { label: string; attempts: number; recommendation: string }
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
      <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">{nonresponsive.label}</p>
        <p className="text-sm">{nonresponsive.recommendation}</p>
      </div>
    </div>
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
const EVERLAKE_CARRIER_PATTERN = /everlake|allstate/i

/**
 * Shared servicing-agent form delivery control. Used wherever the authorization
 * form is produced and sent — from Ready to Email AND after a reached call —
 * so the two paths behave identically: a delivery chooser (email / postal),
 * generation of the filled PDF (postal adds a cover page), the matching
 * directive, and a confirm button. The caller supplies what the confirm button
 * fires and its label, since the resulting queue transition differs by context.
 * Choosing a channel persists it (set-delivery-method), so the form-sent /
 * email-sent touch the server records reflects the delivery method accurately.
 */
function ServicingFormDelivery({
  detail, request, name, busy, act, confirmLabelFor, onConfirm, emailOnly = false,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  /** Confirm-button label, given the chosen method. */
  confirmLabelFor: (method: 'email' | 'postal') => string
  /** Fires the queue transition once the worker confirms the form went out. */
  onConfirm: (method: 'email' | 'postal') => void
  /** Email-only mode: the Send Introductory Emails activity is specifically for
   * emailing the introductory form, so it hides the Email/Postal delivery
   * chooser and fixes the channel to email. The shared generate/attach/confirm
   * behavior is otherwise identical. Every OTHER caller leaves this false and
   * keeps the full delivery chooser, so postal stays available elsewhere. */
  emailOnly?: boolean
}) {
  const [preparing, setPreparing] = useState(false)
  const [prepError, setPrepError] = useState<string | null>(null)
  const [generated, setGenerated] = useState(false)
  // In email-only mode the channel is fixed to email (no chooser). Otherwise it
  // starts from the persisted delivery method and the worker can switch it.
  const [method, setMethod] = useState<'email' | 'postal'>(
    emailOnly ? 'email' : (detail.form_delivery_method ?? 'email'),
  )
  const customerHasAddress = !!(streetLine(detail.customer) && detail.customer.city && detail.customer.state && detail.customer.zip)

  const everlake = request.filter(h => h.carrier && EVERLAKE_CARRIER_PATTERN.test(h.carrier))
  const formPolicies = everlake.length > 0 ? everlake : request
  const contractNumbers = formPolicies.map(h => h.policy_number).filter(Boolean)
  const canGenerate = contractNumbers.length > 0

  const mailto = buildMailto(detail.customer.email, SA_SUBJECT, saEmailBody(detail.customer.first_name))

  function chooseMethod(next: 'email' | 'postal') {
    if (next === method) return
    setMethod(next)
    setPrepError(null)
    act({ type: 'set-delivery-method', method: next })
  }

  async function prepareAndOpen() {
    setPrepError(null)
    if (canGenerate) {
      setPreparing(true)
      try {
        const params = new URLSearchParams()
        params.set('customer_id', detail.customer.id)
        params.set('owner_name', name)
        params.set('contracts', contractNumbers.join(','))
        if (method === 'postal') params.set('delivery', 'postal')
        const res = await fetch(`/api/servicing-agent-change?${params.toString()}`)
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? 'Could not generate the servicing-agent form.')
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const safe = name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
        a.download = `${safe || 'Customer'}-Servicing-Agent-Change${method === 'postal' ? '-Postal-Packet' : ''}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setGenerated(true)
      } catch (err) {
        setPrepError(err instanceof Error ? err.message : 'Could not generate the servicing-agent form.')
        setPreparing(false)
        return
      }
      setPreparing(false)
    }
    if (method === 'email') window.location.href = mailto
  }

  const genLabel = preparing
    ? (method === 'postal' ? 'Preparing packet\u2026' : 'Preparing form\u2026')
    : (method === 'postal' ? 'Generate Postal Packet' : 'Generate Form & Open Email')

  return (
    <div className="space-y-3">
      {/* Delivery channel chooser. Operational, so it is prominent. Hidden in
          email-only mode (Send Introductory Emails), which is fixed to email. */}
      {!emailOnly && (
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Delivery</p>
          <div className="flex flex-wrap gap-2">
            <WorkflowButton selected={method === 'email'} disabled={busy || preparing} onClick={() => chooseMethod('email')}>
              {method === 'email' && <Check className="size-4" aria-hidden />}
              Email
            </WorkflowButton>
            <WorkflowButton selected={method === 'postal'} disabled={busy || preparing} onClick={() => chooseMethod('postal')}>
              {method === 'postal' && <Check className="size-4" aria-hidden />}
              Postal mail
            </WorkflowButton>
          </div>
          {method === 'postal' && !customerHasAddress && (
            <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-3 text-sm text-status-attention-strong">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>No complete mailing address on file. Add one on the customer record before generating a postal packet.</span>
            </div>
          )}
        </div>
      )}

      <PrimaryAction
        icon={ExternalLink}
        label={genLabel}
        onClick={prepareAndOpen}
        disabled={preparing || !canGenerate || (method === 'postal' && !customerHasAddress)}
      />
      {!canGenerate && (
        <p className="text-sm text-ink-supporting">No request policy numbers to put on the form yet.</p>
      )}
      {prepError && (
        <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-3 text-sm text-status-attention-strong">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{prepError}</span>
        </div>
      )}
      {method === 'email' ? (
        <FormAttachmentDirective request={formPolicies} />
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-3 text-sm text-status-attention-strong">
          <FileText className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>The packet includes a cover letter addressed to the customer and the authorization form. Print it, enclose a return envelope, and mail it.</span>
        </div>
      )}
      <WorkflowButton
        icon={Check}
        selected
        disabled={busy || !generated}
        onClick={() => onConfirm(method)}
      >
        {confirmLabelFor(method)}
      </WorkflowButton>
    </div>
  )
}

/**
 * The ready-to-email task panel. Keeps the existing prepared-email + tracking
 * behavior; the one change is that opening the prepared email now first
 * generates and downloads the filled servicing-agent PDF (reusing the existing
 * /api/servicing-agent-change generator) so the worker has it ready to attach.
 */
function ReadyToEmailAction({
  detail, request, name, busy, noteBox, act, hasNextInActivity = false,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  noteBox: React.ReactNode
  // Advancement to the next customer flows through act({ advanceToNext: true });
  // the parent task supplies the actual navigation.
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity?: boolean
}) {
  // If the worker has already CALLED and REACHED this customer (recorded as an
  // attempt from the context panel), the right next step is to send the
  // servicing-agent AUTHORIZATION form directly, not an introductory email. The
  // form send advances authorization (form-sent -> Waiting for Form) and is NOT
  // the introduction, so sending it never counts as a generic intro email and
  // never falsely satisfies the introduction. Both channels remain available: a
  // worker who did not reach the customer still sends the introductory email.
  const reached = detail.last_call_outcome === 'reached'

  if (reached) {
    return (
      <ActionPanel heading={`Send ${name} the servicing-agent authorization`}>
        {noteBox}
        <OperationalTag tone="info">
          <Check className="mr-1.5 size-4" aria-hidden /> Reached by phone. Proceed directly to authorization.
        </OperationalTag>
        <ServicingFormDelivery
          detail={detail}
          request={request}
          name={name}
          busy={busy}
          act={act}
          confirmLabelFor={m => (m === 'postal' ? 'Form mailed to customer' : 'Form sent to customer')}
          onConfirm={() => act({ type: 'form-sent' }, 'Authorization form sent. Moved to Waiting for Form.')}
        />
        <NextNote>
          You reached {detail.customer.first_name} by phone, so send the authorization form now. Recording it
          moves them straight to Waiting for Form. This is the authorization form, not an introductory email.
        </NextNote>
      </ActionPanel>
    )
  }

  // The Introductory Emails activity: a first-touch send streamlined for fast,
  // continuous processing. This activity is specifically the introductory EMAIL,
  // so the channel is fixed to email (the delivery chooser is hidden below). The
  // confirm records the completed send in history, preserves the existing
  // follow-up scheduling, removes this customer from the activity, and opens the
  // next customer automatically.
  const heading = `Send an introductory email to ${name}.`
  // "— Next customer" only when another customer remains to advance to;
  // otherwise it is simply the completion confirmation.
  const nextSuffix = hasNextInActivity ? ' \u2014 Next customer' : ''

  return (
    <ActionPanel heading={heading}>
      {noteBox}
      <ServicingFormDelivery
        detail={detail}
        request={request}
        name={name}
        busy={busy}
        act={act}
        // Send Introductory Emails is specifically the email activity: fix the
        // channel to email and hide the delivery chooser. The confirm still
        // records the send and advances to the next customer.
        emailOnly
        confirmLabelFor={() => `Form attached and email sent${nextSuffix}`}
        onConfirm={() => act(
          { type: 'email-sent' },
          'Introductory email recorded.',
          { advanceToNext: true },
        )}
      />
    </ActionPanel>
  )
}

/**
 * A customer who explicitly declined. Outreach is stopped and the item no longer
 * surfaces on the board; this screen (reached from the customer record) states
 * the stop and offers a deliberate Reopen. Nothing is auto-closed.
 */
function RefusedAction({
  detail, busy, noteBox, act,
}: {
  detail: Detail
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  return (
    <ActionPanel heading={`${detail.customer.first_name} declined`}>
      {noteBox}
      <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-4 text-base text-status-attention-strong">
        <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          This customer explicitly declined further servicing-agent outreach
          {detail.refused_at ? ` on ${shortDate(detail.refused_at)}` : ''}. Outreach is stopped: they do
          not appear on the board or in anyone&apos;s work until reopened. Nothing was closed.
        </span>
      </div>
      <WorkflowButton icon={Play} selected disabled={busy}
        onClick={() => act({ type: 'reopen' }, 'Reopened. The customer returns to active outreach.')}>
        Reopen outreach
      </WorkflowButton>
      <NextNote>
        Reopening clears the refusal and returns the customer to active outreach. Only do this on a
        deliberate decision to re-engage.
      </NextNote>
    </ActionPanel>
  )
}

function WaitingForResponseAction({
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

/**
 * A light-theme copy-to-clipboard script card (voicemail / text talk tracks),
 * the same interaction the dark ScriptCard carries, retoned for the workflow
 * surface. Launching nothing — it only copies the text for the worker to paste
 * into their own voicemail greeting notes, Hearsay text, or email.
 */
function CallScriptCard({ label, body }: { label: string; body: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-supporting">{label}</p>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-surface-border-strong bg-surface-card px-2 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:border-brand-ring hover:bg-brand-wash hover:text-brand-subtle-foreground"
        >
          {copied ? <><Check className="size-3 text-status-confirmed" aria-hidden /> Copied</> : <><Copy className="size-3" aria-hidden /> Copy</>}
        </button>
      </div>
      <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">{body}</p>
    </div>
  )
}

/**
 * The live-call opening talk track, shown at the top of the call workbench. It
 * is a short, honest script keyed to the servicing-agent reason, matching the
 * approved introductory-email wording. Static prose (no sender/LSP variable the
 * calling context carries), so it reads cleanly without unresolved placeholders.
 */
function callOpeningScript(firstName: string): string {
  return [
    `Hi, is this ${firstName}? This is Allstate Financial Services calling about your life insurance policy.`,
    'When Allstate\u2019s life insurance business moved to Everlake, our office lost access to policies unless we\u2019re listed as the servicing agent, and we\u2019re not currently listed on yours.',
    'I\u2019d like to restore that access so we can keep helping you with questions and servicing. It doesn\u2019t change your policy or coverage in any way. Do you have a couple of minutes?',
  ].join('\n\n')
}

/**
 * The guided calling flow. Two modes:
 *
 *   - Board task (workbench=false): the established compact outcome recorder for
 *     a Ready to Call item opened from the board. Unchanged behavior.
 *   - Workbench (workbench=true): the Call Reachable Customers single-page
 *     guided flow. It opens with the customer name, phone, and a short opening
 *     script, then two choices — Reached / Didn\u2019t Reach — each progressively
 *     revealing the next relevant section on the same page. Every path records
 *     exactly ONE grouped attempt (the unified record-attempt), preserving only
 *     communications actually completed, applying the established transition and
 *     follow-up scheduling, and then advancing to the next customer.
 *
 * Both modes use the SAME record-attempt action, outcome vocabulary, callback
 * persistence, and transitions — there is a single recording path.
 */
function CallAction({
  detail, request, busy, noteBox, act, workbench = false, hasNextInActivity = false,
  onSelectionChange,
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
  /** Report the live guided-call selection up for the history-column preview. */
  onSelectionChange?: (selection: CallSelection | null) => void
}) {
  if (workbench) {
    return (
      <CallWorkbenchAction
        detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
        hasNextInActivity={hasNextInActivity}
        onSelectionChange={onSelectionChange}
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
      {detail.call_reason && (
        <OperationalTag tone="reason">
          <CircleAlert className="mr-1.5 size-4" aria-hidden /> {callReasonLabel(detail.call_reason)}
        </OperationalTag>
      )}
      {/* Established call behavior: a tel: link dials via the team member's
          configured phone (RingCentral). Launching the dialer is not proof the
          call happened — the worker records the outcome below. */}
      {phone ? (
        <a href={`tel:${phone}`} className="block">
          <PrimaryAction icon={Phone} label={`Call ${phone}`} />
        </a>
      ) : (
        <PrimaryAction icon={Phone} label="No phone on file" disabled />
      )}
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
            confirmLabelFor={m => (m === 'postal' ? 'Form mailed to customer' : 'Form sent to customer')}
            onConfirm={() => act({ type: 'form-sent' }, 'Form sent. Moved to Waiting for Form.')}
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

/** The reach decision in the guided workbench: not chosen yet, reached, or not. */
type ReachChoice = null | 'reached' | 'not-reached'

/**
 * The Call Reachable Customers guided single-page flow. Opens with the opening
 * script and the two choices, and progressively reveals the next section on the
 * SAME page as the worker proceeds. Every terminal path records exactly ONE
 * grouped attempt and then advances to the next customer.
 */
function CallWorkbenchAction({
  detail, request, busy, noteBox, act, hasNextInActivity, onSelectionChange,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity: boolean
  /** Report the live selection up so the history column previews the entry this
   * call will record, built dynamically as the worker proceeds. */
  onSelectionChange?: (selection: CallSelection | null) => void
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
  const [decision, setDecision] = useState<null | 'agreed' | 'callback' | 'not-interested'>(reached ? 'agreed' : null)
  const [callbackWhen, setCallbackWhen] = useState('')

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
      decision,
      callbackDate: callbackWhen || null,
      formSent: reached && decision === 'agreed',
    })
  }, [onSelectionChange, reach, voicemailLeft, textSent, emailSent, decision, callbackWhen, reached])

  const nextSuffix = hasNextInActivity ? ' Next customer.' : ''

  // Interpolated scripts. The calling context does not carry the sender/LSP
  // identity the way the email templates do, so those variables resolve to the
  // customer-facing content only; interpolate leaves unknown keys intact, and we
  // supply first_name + phone so the common placeholders fill.
  const scriptVars = { first_name: c.first_name ?? 'there', phone: phone ?? '' }
  const voicemailScript = interpolate(SCRIPTS.voicemail.body, scriptVars)
  const textScript = interpolate(
    (voicemailLeft ? SCRIPTS.post_voicemail_text : SCRIPTS.first_attempt_text).body,
    scriptVars,
  )
  const followUpMailto = buildMailto(c.email, SA_SUBJECT, saEmailBody(c.first_name))

  // Record the DIDN\u2019T-REACH attempt as ONE grouping. The call channel's
  // outcome is 'voicemail' (the no-answer outcome that schedules the next call);
  // the separate voicemail CHANNEL is recorded as a completed touch ONLY when a
  // voicemail was actually left, and the text/email channels ONLY when they were
  // actually sent. So only communications actually completed are preserved.
  function recordNotReached() {
    const action: Record<string, unknown> = { type: 'record-attempt', call: 'voicemail' }
    if (voicemailLeft) action.voicemail = 'touch'
    if (textSent) action.text = 'touch'
    if (emailSent) action.email = 'touch'
    act(
      action,
      'Attempt recorded. Next call auto-scheduled; the customer moves to Waiting for Response.',
      { advanceToNext: true },
    )
  }

  // Bad number: a single grouped attempt recording the unusable call channel.
  function recordBadNumber() {
    act(
      { type: 'record-attempt', call: 'bad-number' },
      'Bad number recorded. Moved to Contact Research.',
      { advanceToNext: true },
    )
  }

  return (
    <ActionPanel heading={`Call ${name}`}>
      {noteBox}
      {detail.call_reason && (
        <OperationalTag tone="reason">
          <CircleAlert className="mr-1.5 size-4" aria-hidden /> {callReasonLabel(detail.call_reason)}
        </OperationalTag>
      )}

      {/* 1. Name + phone. A tel: link dials via the team member\u2019s configured
          phone; launching the dialer is not proof the call happened. */}
      {phone ? (
        <a href={`tel:${phone}`} className="block">
          <PrimaryAction icon={Phone} label={`Call ${phone}`} />
        </a>
      ) : (
        <PrimaryAction icon={Phone} label="No phone on file" disabled />
      )}

      {/* 2. A short, relevant opening script. */}
      <CallScriptCard label="Opening script" body={callOpeningScript(c.first_name ?? 'there')} />

      {/* 3. Two choices — Reached / Didn\u2019t Reach. */}
      <div className="border-t border-surface-divider pt-4">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">Did you reach the customer?</p>
        <div className="flex flex-wrap gap-2">
          <WorkflowButton icon={PhoneCall} selected={reach === 'reached'} disabled={busy}
            onClick={() => setReach('reached')}>
            Reached
          </WorkflowButton>
          <WorkflowButton icon={PhoneOff} selected={reach === 'not-reached'} disabled={busy}
            onClick={() => setReach('not-reached')}>
            Didn&apos;t reach
          </WorkflowButton>
        </div>
      </div>

      {/* ── DIDN\u2019T REACH ─────────────────────────────────────────────────── */}
      {reach === 'not-reached' && (
        <div className="space-y-4 border-t border-surface-divider pt-4">
          {/* Voicemail script, always shown to read. */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
              <Voicemail className="size-4 text-ink-supporting" aria-hidden /> Voicemail
            </p>
            <CallScriptCard label={SCRIPTS.voicemail.label} body={voicemailScript} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-secondary">Did you leave a voicemail?</span>
              <WorkflowButton selected={voicemailLeft === true} disabled={busy} onClick={() => setVoicemailLeft(true)}>Yes</WorkflowButton>
              <WorkflowButton selected={voicemailLeft === false} disabled={busy} onClick={() => setVoicemailLeft(false)}>No</WorkflowButton>
            </div>
          </div>

          {/* Prepared Hearsay text with Copy; mark it sent only when actually sent. */}
          {(detail.contact_options?.canText ?? !!phone) && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
                <MessageSquare className="size-4 text-ink-supporting" aria-hidden /> Text (Hearsay)
              </p>
              <CallScriptCard
                label={voicemailLeft ? SCRIPTS.post_voicemail_text.label : SCRIPTS.first_attempt_text.label}
                body={textScript}
              />
              <label className="flex cursor-pointer items-center gap-2.5 text-base font-medium text-ink">
                <input type="checkbox" checked={textSent} disabled={busy}
                  onChange={e => setTextSent(e.target.checked)}
                  className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500" />
                I sent this text through Hearsay
              </label>
            </div>
          )}

          {/* Prepared follow-up email via mailto; mark it sent only when sent. */}
          {(detail.contact_options?.canEmail ?? !!c.email) && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
                <Mail className="size-4 text-ink-supporting" aria-hidden /> Follow-up email
              </p>
              <a href={followUpMailto} className="block">
                <WorkflowButton icon={Mail}>Open prepared follow-up email</WorkflowButton>
              </a>
              <label className="flex cursor-pointer items-center gap-2.5 text-base font-medium text-ink">
                <input type="checkbox" checked={emailSent} disabled={busy}
                  onChange={e => setEmailSent(e.target.checked)}
                  className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500" />
                I sent this follow-up email
              </label>
            </div>
          )}

          {/* Record the whole no-reach interaction as ONE grouped attempt.
              Recording waits until the worker has answered whether a voicemail
              was left, so the attempt is honest about what was completed. */}
          <div className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
            <WorkflowButton icon={PenLine} selected disabled={busy || voicemailLeft === null} onClick={recordNotReached}>
              {busy ? 'Recording\u2026' : 'Record this attempt'}
            </WorkflowButton>
            <NextNote>
              Everything you completed is saved as one attempt: the call, the voicemail only if you left one,
              and the text and email only if you marked them sent. The next call is scheduled automatically and
              the customer moves to Waiting for Response.{nextSuffix}
            </NextNote>
          </div>

          {/* Bad number: a distinct recorded outcome, kept out of the way. */}
          <div className="border-t border-surface-divider pt-3">
            <p className="mb-1 text-sm text-ink-supporting">Not a working number?</p>
            <WorkflowButton icon={PhoneOff} disabled={busy} onClick={recordBadNumber}>
              Bad number
            </WorkflowButton>
          </div>
        </div>
      )}

      {/* ── REACHED ──────────────────────────────────────────────────────────── */}
      {reach === 'reached' && (
        <div className="space-y-4 border-t border-surface-divider pt-4">
          {/* Reason for calling + the servicing-agent authorization explanation. */}
          <div className="rounded-xl border border-surface-border bg-surface-muted p-4 text-base leading-relaxed text-ink-secondary">
            <p className="mb-1 font-semibold text-ink">Why you&apos;re calling</p>
            <p>
              Our office lost access to {c.first_name ? `${c.first_name}\u2019s` : 'the customer\u2019s'} life insurance
              policy when Allstate\u2019s life business moved to Everlake, because we are not listed as the servicing
              agent. The servicing-agent authorization simply restores our access to help with questions and
              servicing. It does not change the policy or coverage, and it needs a wet (ink) signature.
            </p>
          </div>

          <NextNote>
            Confirm or correct the customer&apos;s phone, email, and mailing address on the right as you speak,
            then capture their decision below.
          </NextNote>

          {/* Capture the customer\u2019s actual decision. */}
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">What did the customer decide?</p>
            <div className="flex flex-wrap gap-2">
              <WorkflowButton icon={Check} selected={decision === 'agreed'} disabled={busy}
                onClick={() => {
                  setDecision('agreed')
                  // Record the reached call as ONE attempt; the form step then
                  // appears (last_call_outcome becomes 'reached' after reload).
                  if (!reached) act({ type: 'record-attempt', call: 'reached' }, 'Reached. Send the authorization form below.')
                }}>
                Agreed to authorize
              </WorkflowButton>
              <WorkflowButton icon={Clock} selected={decision === 'callback'} disabled={busy}
                onClick={() => setDecision('callback')}>
                Wants a callback
              </WorkflowButton>
              <WorkflowButton icon={CircleAlert} selected={decision === 'not-interested'} disabled={busy}
                onClick={() => setDecision('not-interested')}>
                Not interested
              </WorkflowButton>
            </div>
          </div>

          {/* Agreed -> the established authorization-form process. */}
          {decision === 'agreed' && (
            <div className="space-y-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4">
              <p className="text-base font-semibold text-ink">Send the servicing-agent authorization form</p>
              <ServicingFormDelivery
                detail={detail}
                request={request}
                name={name}
                busy={busy}
                act={act}
                confirmLabelFor={m => (m === 'postal' ? `Form mailed to customer.${nextSuffix}` : `Form sent to customer.${nextSuffix}`)}
                onConfirm={() => act(
                  { type: 'form-sent' },
                  'Authorization form sent. Moved to Waiting for Form.',
                  { advanceToNext: true },
                )}
              />
              <NextNote>Generate the form, send it (email or postal), then record it here. That moves the customer to Waiting for Form and advances you to the next call. Nothing is auto-closed.</NextNote>
            </div>
          )}

          {/* Callback -> capture the promised DATE (date only, no clock time). */}
          {decision === 'callback' && (
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
                  { type: 'record-attempt', call: 'callback', callback_date: callbackWhen },
                  `Callback promised for ${callbackWhen ? shortDate(callbackWhen) : ''}.`,
                  { advanceToNext: true },
                )}>
                Save promised callback
              </WorkflowButton>
              <NextNote>The promised callback is saved as a customer commitment and resurfaces as a due call on that date. It outranks focus-based ordering.{nextSuffix}</NextNote>
            </div>
          )}

          {/* Not interested -> the established reversible stop. */}
          {decision === 'not-interested' && (
            <div className="space-y-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-4">
              <p className="text-base text-ink-secondary">
                Records an explicit decline. Outreach stops until someone deliberately reopens it. Nothing is
                auto-closed, and this is reversible.
              </p>
              <WorkflowButton icon={CircleAlert} selected disabled={busy}
                onClick={() => act(
                  { type: 'record-attempt', call: 'not-interested' },
                  'Recorded as not interested. Outreach stopped; a human decides any next step.',
                  { advanceToNext: true },
                )}>
                Record not interested
              </WorkflowButton>
            </div>
          )}
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

  // Carrier confirmation is recorded per policy. Split the request so the worker
  // sees, at a glance, which policies still need the carrier to confirm the
  // servicing agent and which are already done.
  const pending = request.filter(h => h.sa_status !== 'confirmed')
  const confirmed = request.filter(h => h.sa_status === 'confirmed')

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

      {/* Per-policy confirmation. The carrier confirms the servicing agent one
          policy at a time; confirming one never changes another. */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-base font-semibold text-slate-900">Confirm servicing access, policy by policy</p>
        <p className="text-sm text-slate-600">
          Record each confirmation as the carrier confirms it. Permanent policies must be confirmed before the
          1035 review can prepare for evaluation; term policies are still pursued but don&apos;t hold up that step.
        </p>
        <div className="mt-2 space-y-2">
          {pending.map(h => (
            <CarrierPolicyRow key={h.id} h={h} busy={busy}
              onConfirm={() => act(
                { type: 'carrier-confirmed', policy_id: h.id },
                `${h.policy_number} confirmed.`,
              )} />
          ))}
          {confirmed.map(h => <CarrierPolicyRow key={h.id} h={h} busy={busy} onConfirm={() => {}} />)}
          {request.length === 0 && (
            <p className="text-sm italic text-slate-400">No policies in the request.</p>
          )}
        </div>
      </div>

      {/* Record a chase on the carrier and schedule the next follow-up. */}
      <FollowUpChase detail={detail} busy={busy} act={act} label="Followed up with the carrier" />

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
      <NextNote>
        {pending.length > 0
          ? `${pending.length} ${pending.length === 1 ? 'policy' : 'policies'} still awaiting carrier confirmation. This stays in Waiting for Carrier until every policy is confirmed; nothing is auto-closed.`
          : 'Every policy is confirmed — recording the last one finishes this servicing outreach. Confirmation does not create a review.'}
      </NextNote>
    </ActionPanel>
  )
}

/**
 * One request policy on the carrier-confirmation screen: its number, type, and
 * whether servicing access is confirmed or still required, with a per-policy
 * Confirm action for the ones still pending. A permanent/term tag is shown
 * because permanent policies gate the 1035 review's advancement while term
 * policies do not — but both are pursued here.
 */
function CarrierPolicyRow({ h, busy, onConfirm }: { h: Holding; busy: boolean; onConfirm: () => void }) {
  const done = h.sa_status === 'confirmed'
  const permanent = isPermanent(h.product_type)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {done
          ? <ShieldCheck className="size-4 text-emerald-600" aria-hidden />
          : <ShieldAlert className="size-4 text-amber-600" aria-hidden />}
        <span className="font-mono text-base text-slate-900">{h.policy_number}</span>
        <span className="text-sm text-slate-600">{h.product_type ?? 'Policy'}</span>
        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
          {permanent ? 'Permanent' : 'Term / other'}
        </span>
      </div>
      {done ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
          <Check className="size-4" aria-hidden /> Servicing agent confirmed
        </span>
      ) : (
        <WorkflowButton icon={Check} selected disabled={busy} onClick={onConfirm}>
          Confirm this policy
        </WorkflowButton>
      )}
    </div>
  )
}

function ResearchAction({
  detail, request,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  // One policy number from the servicing request pairs with the last name for
  // the shared Gateway look-up, exactly like the consolidated Contact Research
  // task the worker is sent to.
  const policyNumber = request.map(h => h.policy_number).find(p => p && p.trim().length > 0) ?? null

  // Research Needed is no longer a separate correction screen. Contact research
  // is ONE consolidated surface: the project Contact Research task. From the
  // shared board this task hands the worker to that single screen for THIS
  // customer, so the look-up, the found-value capture, and the "nothing usable"
  // outcome all happen in one place (and a replacement value recalculates work
  // the same way everywhere). The customer's active 1035 project owns that task.
  const contactResearchHref = detail.contact_research_project_id
    ? `/projects/${detail.contact_research_project_id}/contact-review?customer_id=${encodeURIComponent(detail.customer.id)}`
    : null

  return (
    <ActionPanel heading={`Find contact for ${fullName(detail.customer)}`}>
      {/* Mentoring (HOW) sits immediately ABOVE the instructions it explains —
          the Gateway look-up and the hand-off below — never at the bottom. Its
          own purple control is always shown; the global toggle only sets its
          default open/closed state. */}
      <MentorGuidance label="How to find a match">
        Search Gateway with the customer&apos;s last name and policy number together — the policy
        number is the surest way to land on the right record. If the policy number finds nothing,
        try the last name alone, then confirm the date of birth before you save any email or phone.
        One usable method is enough to move forward; you do not need both.
      </MentorGuidance>

      <div className="flex items-center gap-2 rounded-xl border border-status-missing-border bg-status-missing-soft p-4 text-base text-status-missing-strong">
        <Search className="size-5" aria-hidden /> Usable contact information is missing or has failed.
      </div>

      {/* The shared Gateway look-up — last name + policy number with Copy
          buttons, identical to the consolidated Contact Research task. */}
      <GatewayLookup
        lastName={detail.customer.last_name}
        fallbackName={fullName(detail.customer)}
        policyNumber={policyNumber}
      />

      {/* Hand off to the ONE consolidated Contact Research task. The capture,
          the "nothing usable" outcome, and the save-and-recalculate all live
          there now, so there is a single contact-research surface rather than a
          duplicate board screen. */}
      {contactResearchHref ? (
        <a href={contactResearchHref} className="block">
          <PrimaryAction icon={ExternalLink} label="Open Contact Research for this customer" />
        </a>
      ) : (
        <OperationalTag tone="info">
          This customer is not in an active 1035 project, so there is no Contact Research task to
          open. Add them to the 1035 project to research their contact information.
        </OperationalTag>
      )}

      <NextNote>
        Contact Research is one screen. Opening it takes you to this customer&apos;s task, where you
        enter the email or phone Gateway shows (saved field by field to the customer record,
        clearing that value&apos;s prior verification and recalculating available work), or record
        that nothing usable was found. The customer is never closed; anyone whose details later turn
        up returns automatically, and you can always research again.
      </NextNote>
    </ActionPanel>
  )
}

function FormAction({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  const received = !!detail.form_received_at

  // Step 1: the signed form has not been recorded received yet.
  if (!received) {
    return (
      <ActionPanel heading={`Follow up on ${detail.customer.first_name}\u2019s form`}>
        {noteBox}
        <p className="text-sm text-slate-600">
          The servicing-agent form has been sent. First, record when the signed form comes back. One
          form can cover several policy numbers.
        </p>
        <PrimaryAction
          icon={FileText}
          label="Signed form received"
          disabled={busy}
          onClick={() => act({ type: 'form-received' }, 'Form receipt recorded. Confirm the policies and signer below, then submit to the carrier.')}
        />
        {/* Record a chase on the outstanding signature and schedule the next. */}
        <FollowUpChase detail={detail} busy={busy} act={act} label="Followed up on the signature" />
        <NextNote>
          Recording receipt does not submit anything. After it is recorded, you confirm the applicable
          policies and required signer, then Submit to carrier becomes available.
        </NextNote>
      </ActionPanel>
    )
  }

  // Step 2: form received — confirm policies and that the required signatures
  // are present, then submit.
  return <FormConfirmAndSubmit detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
}

function FormConfirmAndSubmit({
  detail, request, busy, noteBox, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  // Signer identity is not derivable from durable data, so the worker must
  // affirmatively confirm the signatures on the RETURNED form before submitting.
  const [signaturesConfirmed, setSignaturesConfirmed] = useState(false)

  return (
    <ActionPanel heading={`Confirm and submit ${detail.customer.first_name}\u2019s form`}>
      {noteBox}
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="size-4" aria-hidden /> Signed form received{detail.form_received_at ? ` ${shortDate(detail.form_received_at)}` : ''}.
      </div>

      <FormCoverage request={request} />
      <RequiredSignatureConfirm
        request={request}
        confirmed={signaturesConfirmed}
        onToggle={() => setSignaturesConfirmed(v => !v)}
      />

      <PrimaryAction
        icon={Building2}
        label="Submit to carrier"
        disabled={busy || request.length === 0 || !signaturesConfirmed}
        onClick={() => act({ type: 'submit-to-carrier' }, 'Submitted. Moved to Waiting for Carrier.')}
      />
      <NextNote>Submitting moves {detail.customer.first_name} to Waiting for Carrier. There is no separate Forms Received queue.</NextNote>
    </ActionPanel>
  )
}

function RequiredSignatureConfirm({
  request, confirmed, onToggle,
}: {
  request: Holding[]
  confirmed: boolean
  onToggle: () => void
}) {
  // Insured names from the request policies are the only signer-adjacent facts
  // we hold; they are shown as context, not asserted as the required signers.
  const insuredNames = Array.from(
    new Set(request.map(h => h.insured_name).filter((n): n is string => !!n)),
  )

  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <PenLine className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          The required signer(s) for this form are not known from our records. Determine who must sign
          from the returned form and the policy ownership, and confirm every required signature is
          present before submitting.
        </span>
      </p>
      {insuredNames.length > 0 && (
        <p className="text-sm text-slate-700">
          Insured on the request policies: {insuredNames.join(', ')} (context only, not necessarily the signer).
        </p>
      )}
      <label className="mt-1 flex cursor-pointer items-start gap-2 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={onToggle}
          className="mt-0.5 size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500"
        />
        I have verified every required signature is present on the returned form.
      </label>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Context panels
// ─────────────────────────────────────────────────────────────────────────────

function CustomerContext({
  detail, busy, act, showVerification = true,
}: {
  detail: Detail
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  /** Whether to show the customer-verified contact checkboxes. Hidden on the
   *  Introductory Emails activity, where verification is not part of the task. */
  showVerification?: boolean
}) {
  const c = detail.customer
  // The complete mailing address, as separate lines so it stays legible and is
  // never truncated (street on one line; city, state, ZIP on the next). It is
  // shown in a dedicated block below the compact header fields, because the
  // header's field cells truncate to a single line by design.
  const street = streetLine(c)
  const cityStateZip = [[c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ')
  const addrLines = [street, cityStateZip].filter(Boolean)
  const hasAddress = addrLines.length > 0
  // A customer-verified value reads as green ("confirmed"); on file but
  // unverified reads as amber ("on file, not confirmed"); missing reads red.
  const fieldStatus = (present: boolean, verifiedAt: string | null) =>
    verifiedAt ? { tone: 'confirmed' as const, label: 'Customer verified' }
      : present ? { tone: 'known' as const, label: 'On file' }
      : { tone: 'missing' as const, label: 'Missing' }
  const emailS = fieldStatus(!!c.email, detail.email_verified_at)
  const phoneS = fieldStatus(!!c.phone, detail.phone_verified_at)
  const addrS = fieldStatus(hasAddress, detail.address_verified_at)
  const fields: ContextField[] = [
    {
      label: 'Email', value: c.email ?? 'Not on file', empty: !c.email,
      statusTone: emailS.tone, statusIcon: Mail, statusLabel: emailS.label,
    },
    {
      label: 'Phone', value: c.phone ?? 'Not on file', empty: !c.phone,
      statusTone: phoneS.tone, statusIcon: Phone, statusLabel: phoneS.label,
    },
    {
      // Compact summary in the header grid; the full address is shown in full
      // below so it is never truncated.
      label: 'Address', value: hasAddress ? 'See below' : 'Not on file', empty: !hasAddress,
      statusTone: addrS.tone, statusIcon: Building2, statusLabel: addrS.label,
    },
  ]
  return (
    <>
      <ContextHeader eyebrow="Stewardship" title={fullName(c)} fields={fields} />
      {/* Complete mailing address, legible and on multiple lines. */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          <Building2 className="size-4 text-ink-supporting" aria-hidden /> Mailing address
        </p>
        {hasAddress ? (
          <address className="mt-2 not-italic text-base leading-relaxed text-ink">
            {addrLines.map((line, i) => (
              <span key={i} className="block">{line}</span>
            ))}
          </address>
        ) : (
          <p className="mt-2 text-base italic text-ink-muted">No mailing address on file.</p>
        )}
      </div>
      {showVerification && <ContactVerification detail={detail} busy={busy} act={act} />}
    </>
  )
}

/**
 * Simple customer-verified checkboxes for phone, email, and address. Checking a
 * box records that the customer confirmed that value is correct (a distinct fact
 * from the value merely being on file). It never changes the queue. A box is
 * disabled when there is no value on file to verify.
 */
function ContactVerification({
  detail, busy, act,
}: {
  detail: Detail
  busy: boolean
  act: (action: unknown, successNote?: string) => void
}) {
  const c = detail.customer
  const hasAddress = !!(streetLine(c) && c.city && c.state && c.zip)
  const rows: { field: 'phone' | 'email' | 'address'; label: string; present: boolean; verifiedAt: string | null }[] = [
    { field: 'phone', label: 'Phone', present: !!c.phone, verifiedAt: detail.phone_verified_at },
    { field: 'email', label: 'Email', present: !!c.email, verifiedAt: detail.email_verified_at },
    { field: 'address', label: 'Mailing address', present: hasAddress, verifiedAt: detail.address_verified_at },
  ]
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">Customer-verified contact</p>
      <p className="mt-1 text-sm text-ink-secondary">
        Check each value the customer confirms is correct. This records a verification, separate from the
        value simply being on file.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map(r => (
          <label
            key={r.field}
            className={`flex items-center gap-2.5 text-base font-medium ${r.present ? 'cursor-pointer text-ink' : 'cursor-not-allowed text-ink-muted'}`}
          >
            <input
              type="checkbox"
              checked={!!r.verifiedAt}
              disabled={busy || !r.present}
              onChange={e => act(
                { type: 'verify-contact', field: r.field, verified: e.target.checked },
                e.target.checked ? `${r.label} marked customer-verified.` : `${r.label} verification cleared.`,
              )}
              className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
            />
            <span>{r.label} {r.present ? '' : <span className="text-sm font-normal text-ink-muted">(nothing on file)</span>}</span>
            {r.verifiedAt && <Check className="size-4 text-emerald-600" aria-hidden />}
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * Record ONE outreach attempt across multiple channels at once. A single attempt
 * often touches the customer by call AND Hearsay text AND email together; the
 * worker checks the channels they ACTUALLY completed and gives each an optional
 * outcome. Only checked channels are recorded (each becomes its own history
 * entry) — nothing is logged for a channel left unchecked. Writes to the
 * customer's history via /api/stewardship/[id]/touch; never changes the queue.
 */
type ContactChannelId = 'call' | 'voicemail' | 'text' | 'email'
type AttemptChannelOutcome = 'touch' | 'no_contact' | 'unusable'

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
function RecordAttemptPanel({
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
    { id: 'text', label: 'Text (Hearsay)', available: opts?.canText ?? !!detail.customer.phone },
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

function HoldingsContext({ request, context }: { request: Holding[]; context: Holding[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">In this servicing request</p>
        <div className="mt-2 space-y-2">
          {request.length === 0
            ? <p className="text-sm italic text-slate-400">No policies in the request.</p>
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

/**
 * The required "attach the authorization form" step for the servicing-agent
 * outreach. The prepared email says a form is attached; a mailto cannot attach
 * one, so the worker must attach the approved servicing-agent authorization
 * form in Outlook before sending. Right Path does not yet carry the carrier's
 * form inside the app, so this is stated plainly rather than pretending the
 * system supplies it. High-contrast amber because it changes what the worker
 * must do (per the workflow contrast standard — operational, not incidental).
 */
function FormAttachmentDirective({ request }: { request: Holding[] }) {
  return (
    <div className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
      <p className="flex items-start gap-3 text-xl font-bold leading-snug text-amber-900">
        <PenLine className="mt-1 size-6 shrink-0" aria-hidden />
        Attach the servicing-agent authorization form in Outlook before you send.
      </p>
      <p className="text-lg leading-relaxed text-amber-900">
        The email states a form is attached, but it is not attached automatically. Attach the approved
        authorization form for the carrier on this account. If you do not have the correct form, obtain it
        before sending. Do not send without it.
      </p>
      {request.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-white/70 p-4">
          <p className="text-sm font-bold uppercase tracking-wide text-amber-900">One form covers</p>
          {request.map(h => (
            <div key={h.id} className="flex items-center gap-2 text-lg text-slate-900">
              <span className="font-mono">{h.policy_number}</span>
              <span className="text-base text-slate-600">{h.product_type ?? 'Policy'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
