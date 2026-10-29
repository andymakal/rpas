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
  Upload, Download, Loader2, SkipForward, StickyNote, ArrowLeft,
} from 'lucide-react'
import {
  WorkflowPage, WorkflowPageHeader,
  QueueSection, QueueRow, QueueListHeader, CustomerQueueCard, QueueEmptyState,
  TaskShell, SlimTaskHeader, ContextHeader, type ContextField,
  ActionPanel, PrimaryAction, WorkflowButton, NextNote, OperationalTag,
  ExternalActionConfirm, SpokenScriptCard,
  CustomerContactCard, GatewayLookup,
  PolicySummaryList, type PolicySummary,
  CustomerHistoryCard, NextHistoryEntry,
} from '@/components/workflow'
import { CustomerSearch } from '@/components/CustomerSearch'
import {
  carrierEmailSubject, carrierEmailMessage, uniqueCarriers, resolveCarrierRecipient,
} from '@/lib/stewardship/carrier-email'
import { type EmailAvailability } from '@/lib/email-availability'
import { canTextGivenFacts } from '@/lib/sms-availability'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
import {
  QUEUE_META, OUTREACH_QUEUES,
  type OutreachQueue, type CallOutcome,
} from '@/lib/stewardship/queues'
import {
  describeNextHistoryEntry,
  describeCallSelection,
  describeIntroEmailSelection,
  describeInteractionSelection,
  type HistoryEvent,
  type WorkflowActivity,
  type NextHistoryEntryPreview,
  type CallSelection,
  type InteractionSelection,
} from '@/lib/stewardship/customer-history'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import { isPermanent } from '@/lib/policies/product-type'
import { buildMailto, SERVICING_CALL_SCRIPTS, interpolate } from '@/lib/templates'
import { formatPhoneDisplay } from '@/lib/contact-input'
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
function openMailto(mailto: string): void {
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
function saFollowUpEmailBody(firstName: string): string {
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
    email_availability: EmailAvailability | null
    contact_alert: string | null
    /** Durable Do Not Text opt-out, for the shared card's texting status. */
    sms_opt_out?: boolean
    /** Whether the number on file has a recorded text-delivery failure. */
    text_undeliverable?: boolean
    /** Best-available-precision age (reused project age logic); null unknown. */
    customer_age?: number | null
    /** True when the age came from the masked policy fallback (approximate). */
    customer_age_approximate?: boolean
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
  /** The signed-in employee as the CALLER for the guided calling scripts: their
   * first name (fills "[Employee]") and their validated CALLBACK number (fills
   * "[Callback Number]", the office/employee number — never the customer's).
   * Either field may be null when not resolvable or the employee has no usable
   * callback number; the workbench then shows the callback-dependent channels as
   * unavailable rather than an unresolved placeholder. Supplied by the GET route
   * from the established producer source. */
  call_actor?: { first_name: string | null; callback_phone: string | null } | null
  /** The active 1035 project whose consolidated Contact Research task owns this
   * customer. The Research Needed task links here instead of hosting its own
   * correction screen, so contact research is one surface. Null when not in an
   * active 1035 project. */
  contact_research_project_id?: string | null
  /** Every distinct policy number on file for the customer (service policies +
   * associated cases, de-duplicated), for the shared Search Gateway look-up.
   * Supplied by the GET route; empty when the customer has none. */
  gateway_policy_numbers?: string[]
  /** The display customer history (grouped interactions, newest first) for the
   * working-screen Customer History card. Display only; supplied by the GET
   * route from the durable case_touches log. */
  customer_history?: HistoryEvent[]
  /** Whether the signed servicing-agent authorization is uploaded/saved for this
   * servicing request (servicing-access working screen). Supplied by the GET
   * route from the shared document repository (policy_documents). */
  authorization_on_file?: boolean
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
function textActionAvailable(detail: Detail): boolean {
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
      <WorkflowPage
        heading={
          <QueueListHeader
            icon={openPopulation === 'introductory-emails' ? Mail : Phone}
            label={meta.label}
            count={popItems.length}
            blurb={meta.blurb}
            onBack={() => setOpenPopulation(null)}
          />
        }
      >
        {claimMsg && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="space-y-3">
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
      <WorkflowPage
        heading={
          <QueueListHeader
            icon={QUEUE_ICON[openQueue]}
            label={meta.label}
            count={queueItems.length}
            blurb={headerBlurb}
            onBack={() => setOpenQueue(null)}
          />
        }
      >
        {claimMsg && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="space-y-3">
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
    <WorkflowPage
      heading={project ? (
        <WorkflowPageHeader
          title={`Stewardship — ${project.name}`}
          secondary="Capture outreach scoped to this project's population. Queues and lists below show only this project's work."
        />
      ) : (
        <WorkflowPageHeader
          title="Stewardship"
          secondary="Capture outreach — confirm servicing access on each customer's policies."
        />
      )}
    >
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
function CallContext({ detail }: { detail: Detail }) {
  const line = callReasonLine(detail)
  return (
    <div className="space-y-1">
      <OperationalTag tone="reason">
        <CircleAlert className="mr-1.5 size-4" aria-hidden /> {callNumberLabel(detail.call_attempts)}
      </OperationalTag>
      {line && <p className="text-sm text-ink-secondary">{line}</p>}
    </div>
  )
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
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

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
        <CustomerSearch<CustomerSearchResult>
          placeholder="Search customer…"
          ariaLabel="Search a customer to start onboarding"
          busyId={busyId}
          onSelect={startOne}
          renderRow={(c, { busy, select }) => (
            <button
              type="button"
              disabled={busy}
              onClick={select}
              className="flex w-full items-center justify-between gap-3 border-b border-surface-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-muted disabled:opacity-50"
            >
              <span className="text-sm font-medium text-ink">{c.first_name} {c.last_name}</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-hover">
                <Play className="size-3.5" aria-hidden /> {busy ? 'Starting…' : 'Start'}
              </span>
            </button>
          )}
        />
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
  itemId, onBack, hasNextInActivity = false, onAdvanceToNext, onSkip, onComplete, hideBackHeader = false, forceCall = false,
  forceServicingAccess = false, forceCustomerInteraction = false,
}: {
  itemId: string
  onBack: () => void
  /** Whether another customer remains in this activity to advance to. */
  hasNextInActivity?: boolean
  /** Open the next customer in this activity (Introductory Emails fast flow). */
  onAdvanceToNext?: () => void
  /** Skip the open customer WITHOUT sending or recording anything: move to the
   * next available customer and send this one to the back of the working
   * sequence (Send Introductory Emails fast flow). When supplied, the intro-
   * email send panel shows a "Skip for now" control beneath the confirm. The
   * skip never touches a business record — no history, no status change. */
  onSkip?: () => void
  /** Called when the whole servicing request COMPLETES (every request policy
   * confirmed): the outreach row is gone and the customer has advanced out of
   * outreach. Carries the customer id and, when the customer belongs to an
   * active review-preparation project, that project id — so the caller can open
   * Operations Preparation for this customer immediately. When omitted the task
   * falls back to onBack (the board/default behavior is unchanged). */
  onComplete?: (info: { customerId: string | null; operationsPrepProjectId: string | null }) => void
  /** Drive the SERVICING ACCESS working screen: the signed-authorization stage
   * of the workflow (upload the signed form, prepare the carrier email, send +
   * confirm, run the 7-day carrier follow-up, record carrier confirmation).
   * Renders the three-column working layout and the servicing-access action
   * column regardless of whether the item sits in waiting-for-form or
   * waiting-for-carrier. Every other caller leaves this false, so their behavior
   * is unchanged. A confirmed-and-complete servicing request advances the
   * customer into Operations Preparation via the existing handoff. */
  forceServicingAccess?: boolean
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
  /** Drive the CUSTOMER INTERACTION working screen: the active-conversation
   * stage between routine calling and Servicing Access. Renders the established
   * three-column working layout (customer contact + policies in the center,
   * communication history on the right) with a dedicated interaction action
   * column — record an incoming response or outgoing reply by email, phone, or
   * text, and set a follow-up commitment + date, all WITHOUT the guided
   * telephone-calling flow. Due follow-ups surface here as actionable. Every
   * other caller leaves this false, so their behavior is unchanged. */
  forceCustomerInteraction?: boolean
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

  // The action column reports its live selection up through this callback on
  // every render (via an effect in CallWorkbenchAction), each time with a FRESH
  // object literal. Writing that straight into state would re-render this task
  // on every report, which re-runs the action subtree and re-fires the report —
  // a churn loop that never lets the guided-call buttons settle, so clicks
  // appear dead. Gate the write to actual changes: compare the incoming
  // selection field-by-field against the current one and bail out (return the
  // same reference, so React skips the re-render) when nothing changed. Stable
  // identity (useCallback with no deps, functional update) so the child effect's
  // dependency on it never itself triggers churn.
  const reportCallSelection = useCallback((next: CallSelection | null) => {
    setCallSelection((prev) => (sameCallSelection(prev, next) ? prev : next))
  }, [])

  // The live Customer Interaction selection: the single action the worker is
  // preparing in the interaction action column (a communication being composed,
  // a follow-up date, or a staged authorization/refusal). Reported up the SAME
  // way the guided call flow reports its selection, and gated to real changes so
  // a fresh object literal on every render never churns the subtree.
  const [interactionSelection, setInteractionSelection] = useState<InteractionSelection | null>(null)
  useEffect(() => { setInteractionSelection(null) }, [itemId])
  const reportInteractionSelection = useCallback((next: InteractionSelection | null) => {
    setInteractionSelection((prev) => (sameInteractionSelection(prev, next) ? prev : next))
  }, [])

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
      // A send must never be reported as complete (or advance the fast flow)
      // unless the server confirms the required history was recorded. The
      // email-sent path returns an explicit `recorded` flag; when it is present
      // and false, the send did not persist its history, so we surface the
      // server's message and stop here rather than claim success. Actions that
      // do not carry this flag are unaffected (recorded is undefined).
      if (json.recorded === false) {
        setNote(json.error ?? 'The send could not be recorded. Please try again.')
        return
      }
      if (json.completed_outreach) {
        // Every request policy is confirmed: the outreach row is gone and the
        // customer has advanced out of outreach. When a completion handler is
        // supplied (the servicing-access screen), hand it the customer and the
        // Operations Preparation project so it can open Operations Preparation
        // for this customer immediately. Otherwise fall back to the default
        // back navigation (the board behavior is unchanged).
        if (onComplete) {
          onComplete({
            customerId: (json.customer_id as string | null) ?? null,
            operationsPrepProjectId: (json.operations_prep_project_id as string | null) ?? null,
          })
        } else {
          onBack()
        }
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
  }, [itemId, load, onBack, onAdvanceToNext, onComplete])

  // The direct Send Introductory Emails screen hosts its own WorkflowPage and
  // "Back to My Work" nav, so there the task renders chromeless (no outer page
  // wrapper, no "All queues" header). Every other Stewardship caller gets the
  // original page chrome and the "All queues" back header, unchanged.
  //
  // Chrome is a STABLE module-level component chosen by a prop, never one
  // created during render. A component created inside render gets a fresh
  // identity each pass, so React would unmount and REMOUNT the whole task
  // subtree on every re-render — resetting the guided-call flow's state and
  // making the Reached/Didn't-Reach buttons lose what the worker just did. A
  // stable component keeps the subtree mounted across re-renders.

  if (!detail) {
    return (
      <TaskChrome chromeless={hideBackHeader}>
        {!hideBackHeader && <SlimTaskHeader onBack={onBack} />}
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      </TaskChrome>
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
  const isWorkingScreen = introEmail || research || forceCall || forceServicingAccess || forceCustomerInteraction

  return (
    <TaskChrome chromeless={hideBackHeader}>
      <TaskShell
        header={hideBackHeader ? null : <SlimTaskHeader onBack={onBack} backLabel="All queues" />}
        action={
          forceServicingAccess ? (
            <ServicingAccessAction
              detail={detail} request={request} busy={busy} note={note} act={act}
            />
          ) : forceCustomerInteraction ? (
            <CustomerInteractionAction
              detail={detail} busy={busy} note={note} act={act} reload={load}
              onAdvanceToNext={onAdvanceToNext}
              onSelectionChange={reportInteractionSelection}
            />
          ) : (
            <TaskAction
              detail={detail} request={request} busy={busy} note={note} act={act}
              hasNextInActivity={hasNextInActivity} forceCall={forceCall}
              onSkip={onSkip}
              onCallSelectionChange={reportCallSelection}
            />
          )
        }
        context={
          <StewardshipContextPanel
            detail={detail} request={request} context={context} busy={busy} act={act}
            setDetail={setDetail} reload={load} forceCall={forceCall}
            forceCustomerInteraction={forceCustomerInteraction}
            withHistoryColumn={isWorkingScreen}
            // The guided call's live reach decision, lifted through the SAME
            // callSelection channel the history column already uses. Drives the
            // center column's Reached behavior: open the contact card in edit
            // mode and show the yellow verify-contact instruction above it.
            reached={callSelection?.reach === 'reached'}
          />
        }
        history={isWorkingScreen
          ? <StewardshipHistoryColumn
              detail={detail} forceCall={forceCall} callSelection={callSelection}
              interactionSelection={interactionSelection}
              forceServicingAccess={forceServicingAccess}
              forceCustomerInteraction={forceCustomerInteraction}
            />
          : undefined}
      />
    </TaskChrome>
  )
}

/**
 * Stable page chrome for a Stewardship task. `chromeless` renders the children
 * bare (the direct working screens supply their own WorkflowPage + "Back to My
 * Work" nav); otherwise the original WorkflowPage wrapper is used. Declared once
 * at module level — NOT created inside StewardshipTask's render — so the task
 * subtree is never remounted (and its guided-call state never reset) just
 * because the parent re-rendered.
 */
function TaskChrome({ chromeless, children }: { chromeless: boolean; children: React.ReactNode }) {
  if (chromeless) return <>{children}</>
  return <WorkflowPage>{children}</WorkflowPage>
}

/**
 * The right-hand history column for the working screens: the Next History Entry
 * preview (what completing this work will record) above the Customer History.
 * Completing the work records the entry automatically, so the preview tells the
 * worker what will be logged rather than asking them to log it. History is the
 * grouped customer history supplied by the GET route (display only).
 */
/**
 * Field-by-field equality for the live call selection, so the parent only
 * re-renders when the worker's guided-call choices actually change rather than
 * on every render-phase report from the action column. Covers every field the
 * reporter sets; a null on either side only matches another null.
 */
function sameCallSelection(a: CallSelection | null, b: CallSelection | null): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return (
    a.reach === b.reach &&
    a.voicemailLeft === b.voicemailLeft &&
    a.textSent === b.textSent &&
    a.emailSent === b.emailSent &&
    a.badNumber === b.badNumber &&
    a.decision === b.decision &&
    a.callbackDate === b.callbackDate &&
    a.formSent === b.formSent &&
    a.formDeliveryMethod === b.formDeliveryMethod &&
    a.note === b.note
  )
}

/**
 * Field-by-field equality for the live Customer Interaction selection, so the
 * task only re-renders when the prepared action actually changes rather than on
 * every render-phase report from the interaction action column. Different kinds
 * never match; within a kind every field is compared.
 */
function sameInteractionSelection(a: InteractionSelection | null, b: InteractionSelection | null): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'communication' && b.kind === 'communication') {
    return a.direction === b.direction && a.channel === b.channel && (a.note ?? null) === (b.note ?? null)
  }
  if (a.kind === 'follow-up' && b.kind === 'follow-up') {
    return (a.date ?? null) === (b.date ?? null)
  }
  // 'authorization' and 'refusal' carry no fields.
  return true
}

function StewardshipHistoryColumn({
  detail, forceCall, callSelection, interactionSelection = null, forceServicingAccess = false, forceCustomerInteraction = false,
}: {
  detail: Detail
  forceCall: boolean
  /** The live call-flow selection, when a guided call is in progress. Drives the
   * dynamic preview; null on the other working screens or before a reach
   * decision. */
  callSelection: CallSelection | null
  /** The live Customer Interaction selection: the single action the worker is
   * preparing (a communication, a follow-up, or a staged authorization /
   * refusal). Drives the dynamic Next History Entry preview; null before the
   * worker prepares anything. */
  interactionSelection?: InteractionSelection | null
  /** The servicing-access working screen, so the preview names the servicing
   * step this work will record (receipt / submission / confirmation). */
  forceServicingAccess?: boolean
  /** The Customer Interaction working screen. It shows the shared Next History
   * Entry preview (built from the single prepared action) above the one shared
   * Customer History card. */
  forceCustomerInteraction?: boolean
}) {
  // Customer Interaction uses the ONE shared history presentation, the same
  // Next History Entry preview + Customer History card every other working
  // screen uses, over the SAME customer history. The preview is built from the
  // single action the worker is preparing (never a combination); until they
  // prepare something it is blank. Completing that action records exactly the
  // previewed entry.
  if (forceCustomerInteraction) {
    return (
      <>
        <NextHistoryEntry preview={describeInteractionSelection(interactionSelection)} />
        <CustomerHistoryCard events={detail.customer_history ?? []} />
      </>
    )
  }
  const activity = resolveWorkflowActivity(detail, forceCall, forceServicingAccess)
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
        : activity === 'servicing-access'
          ? describeServicingAccessStep(detail)
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
function resolveWorkflowActivity(
  detail: Detail,
  forceCall: boolean,
  forceServicingAccess = false,
): WorkflowActivity {
  if (forceServicingAccess) return 'servicing-access'
  if (forceCall) return 'calling'
  if (detail.queue === 'research-needed') return 'contact-research'
  if (isIntroductoryEmailActivity(detail)) return 'introductory-email'
  return 'record-attempt'
}

/**
 * The Next History Entry preview for the servicing-access working screen, built
 * from where the servicing request currently stands: before carrier submission
 * the next recorded entry is the submission; in Waiting for Carrier it is the
 * carrier confirmation. Concise, matching the history vocabulary.
 */
function describeServicingAccessStep(detail: Detail): NextHistoryEntryPreview {
  if (detail.queue === 'waiting-for-carrier') {
    return { summary: 'Servicing Access Confirmed' }
  }
  if (detail.form_received_at) {
    return { summary: 'Submitted to Carrier' }
  }
  return { summary: 'Authorization Received' }
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
  detail, request, context, busy, act, setDetail, reload, forceCall = false, forceCustomerInteraction = false, withHistoryColumn = false, reached = false,
}: {
  detail: Detail
  request: Holding[]
  context: Holding[]
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  setDetail: React.Dispatch<React.SetStateAction<Detail | null>>
  /** Reload the task detail from the server. The Customer Contact Card calls it
   * after a save so the authoritative contact_options (call / text / email /
   * postal) are recomputed from the saved facts via the one established
   * server path, keeping the workflow's available actions in step with the card
   * without a page refresh and without a second availability calculation. */
  reload: () => Promise<void> | void
  /** The Call Reachable Customers workbench: show the shared Customer Contact
   * card (verify/correct inline on the Reached path) and hide the separate
   * record-an-attempt panel, because the guided call flow IS the recording. */
  forceCall?: boolean
  /** The Customer Interaction working screen: show the shared Customer Contact
   * card so contact facts stay visible while handling the conversation, and hide
   * the generic record-an-attempt panel because the interaction action column
   * owns recording (incoming/outgoing email, phone, text, and follow-up). */
  forceCustomerInteraction?: boolean
  /** On the three working screens, history moves to its own third column, so
   * the center context column shows the contact card + the read-only Policy
   * Summary beneath it (replacing the raw holdings list). Every other caller
   * keeps the original holdings context. */
  withHistoryColumn?: boolean
  /** The guided call reached the customer. On the calling workbench this opens
   * the contact card in edit mode and shows a prominent verify-contact
   * instruction above it, so the caller corrects/verifies phone, email, and
   * mailing address during the live conversation. */
  reached?: boolean
}) {
  const introEmail = isIntroductoryEmailActivity(detail)
  // Research Needed is the second 1035 contact-gathering activity: like
  // Introductory Emails and project Contact Review, its contact surface is the
  // one shared editable Customer Contact card (identity, email, phone, mailing
  // address, each with status, edit, and customer-verified control), replacing
  // the former separate contact summary, mailing-address block, and verification
  // checkboxes. The research capture + routing stays in the left ActionPanel.
  const research = detail.queue === 'research-needed'
  // The shared Customer Contact card is the ONE standard contact surface across
  // every stewardship working screen (Introductory Emails, Make Due Calls, Call
  // Reachable Customers, Customer Interaction, Servicing Access, Research
  // Needed). It is always the card now — the legacy read-only CustomerContext is
  // no longer used — so contact information looks and behaves identically
  // everywhere. The card runs in the approved Overview/Edit presentation and
  // starts COLLAPSED (compact overview) on every surface EXCEPT Find Missing
  // Contact Information (Research Needed), which starts EXPANDED for immediate
  // contact research and editing.
  const useCard = true
  // The card starts EXPANDED (edit mode) for Research Needed as before, and now
  // also the instant the guided call reaches the customer: the caller must be
  // able to correct or verify phone, email, and mailing address immediately,
  // without clicking Edit first. Every other surface still starts collapsed.
  const startExpanded = research || (forceCall && reached)

  // Policy Summary on the working screens replaces the raw holdings list in the
  // center column. Summarize the servicing-request policies when the request
  // names them, otherwise all known holdings, so the worker still sees the
  // customer's policy facts. Existing policy data only; nothing invented.
  const summaryPolicies = (request.length > 0 ? request : context).map(holdingToPolicySummary)

  return (
    <>
      {/* On the calling workbench, once the customer is reached, a prominent
          yellow instruction sits directly above the contact card to draw the
          caller's attention to the contact facts to review during the live
          conversation. It replaces the former left-column note so the prompt
          lives next to the card it refers to. */}
      {forceCall && reached && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base font-medium text-amber-900">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>Confirm or correct the customer&apos;s phone number, email address, and mailing address.</span>
        </div>
      )}
      {useCard ? (
        // Writes straight to the customer record via the shared route and keeps
        // the surrounding task in sync through onChange. Approved Overview/Edit
        // presentation; collapsed by default, expanded for Research Needed and
        // for a reached guided call (edit mode during the conversation).
        <StewardshipCustomerContact detail={detail} setDetail={setDetail} reload={reload} startExpanded={startExpanded} />
      ) : (
        <CustomerContext detail={detail} busy={busy} act={act} showVerification />
      )}
      {/* The record-an-attempt tool belongs to the general call/research view,
          not the fast-send Introductory Emails flow, the find-contact Research
          flow (which records no contact attempt), nor the guided calling
          workbench (whose Reached/Didn't Reach flow IS the single recording). */}
      {!introEmail && !research && !forceCall && !forceCustomerInteraction && <RecordAttemptPanel detail={detail} busy={busy} act={act} />}
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
  detail, setDetail, reload, startExpanded = false,
}: {
  detail: Detail
  setDetail: React.Dispatch<React.SetStateAction<Detail | null>>
  /** Reload the task detail so the authoritative contact_options are recomputed
   * from the saved facts after a card edit (see StewardshipContextPanel). */
  reload: () => Promise<void> | void
  /** Whether the self-contained card opens EXPANDED (editing). Find Missing
   * Contact Information (Research Needed) and a reached guided call pass true;
   * every other stewardship surface opens COLLAPSED in the compact overview.
   * This is the ONLY presentation input the screen supplies — the card owns the
   * heading, the calculated age, the layout, the editing, and the texting
   * status itself. */
  startExpanded?: boolean
}) {
  // The screen invokes the self-contained card with ONLY the customer identity
  // and the initial display mode. The card fetches, displays, edits, and saves
  // all of the customer's contact information itself (name, calculated age,
  // email, phone, mailing address, verification, email availability, Do Not Text
  // / Text Undeliverable, and the customer alert), so this screen no longer
  // assembles a contact object, a name/age header, or the texting facts.
  //
  // `onChange` keeps the surrounding task in step with a card save in two ways:
  //   1. It folds the authoritative customer facts the card returns back into
  //      Detail, so the name shown elsewhere and the contact values update
  //      immediately (no flicker while the reload is in flight).
  //   2. It reloads the task detail, so the AUTHORITATIVE contact_options
  //      (call / text / email / postal) are recomputed from the saved facts by
  //      the one established server path (ZEN over normalized phone identity +
  //      the value-scoped/legacy unusable history + Do Not Text). That single
  //      source of truth is what the channel actions read, so reformatting a
  //      number keeps a value-scoped restriction, replacing a genuinely unusable
  //      number restores eligible calling AND texting, and Do Not Text / Text
  //      Undeliverable restrict only texting — all without a page refresh and
  //      with no second availability calculation on the client.
  // A future change to the card needs no edit here.
  return (
    <CustomerContactCard
      customerId={detail.customer.id}
      initialMode={startExpanded ? 'expanded' : 'collapsed'}
      onChange={(u) => {
        setDetail(prev => prev ? {
          ...prev,
          email_verified_at: u.email_verified_at,
          phone_verified_at: u.phone_verified_at,
          address_verified_at: u.address_verified_at,
          customer: {
            ...prev.customer,
            // A corrected name updates everywhere the detail's customer name is
            // shown; fall back to the existing value if the record returns null.
            first_name: u.first_name ?? prev.customer.first_name,
            last_name: u.last_name ?? prev.customer.last_name,
            email: u.email,
            phone: u.phone,
            street: u.street,
            address_line1: u.address_line1 ?? prev.customer.address_line1,
            city: u.city,
            state: u.state,
            zip: u.zip,
            email_availability: u.email_availability,
            contact_alert: u.contact_alert ?? null,
            sms_opt_out: u.sms_opt_out ?? prev.customer.sms_opt_out,
            text_undeliverable: u.text_undeliverable ?? prev.customer.text_undeliverable,
          },
        } : prev)
        // Recompute the authoritative available actions from the saved facts.
        void reload()
      }}
    />
  )
}

/**
 * The per-queue task action. Dispatches to the queue-specific panel. Each panel
 * owns its own copy, controls, and transitions; the dispatcher only routes.
 */
function TaskAction({
  detail, request, busy, note, act, hasNextInActivity = false, forceCall = false,
  onSkip, onCallSelectionChange,
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
  /** Skip the open intro-email customer without sending/recording (fast flow). */
  onSkip?: () => void
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
          onSkip={onSkip}
          onSelectionChange={onCallSelectionChange}
        />
      )
    }
    switch (detail.queue) {
      case 'ready-to-email':
        return (
          <ReadyToEmailAction
            detail={detail} request={request} name={name} busy={busy} noteBox={noteBox} act={act}
            hasNextInActivity={hasNextInActivity} onSkip={onSkip}
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
  detail, request, name, busy, act, confirmLabelFor, onConfirm, emailOnly = false, onSkip,
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
  /** When supplied (Send Introductory Emails fast flow), render a "Skip for now"
   * control beneath the confirm. It moves to the next available customer WITHOUT
   * sending or recording anything and sends this one to the back of the working
   * sequence. It is always enabled (not gated on form generation), since
   * skipping is explicitly the "do nothing with this one yet" path. */
  onSkip?: () => void
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

  // The introductory activity (emailOnly) sends the full-explanation
  // introductory email; every other caller reaches this component AFTER a live
  // conversation (reached-by-phone, the guided-call "Agreed to authorize"), so
  // it uses the shorter "as we discussed" form-delivery body instead of
  // repeating the Everlake explanation the customer already heard.
  const emailBody = emailOnly
    ? saEmailBody(detail.customer.first_name)
    : saFollowUpEmailBody(detail.customer.first_name)
  const mailto = buildMailto(detail.customer.email, SA_SUBJECT, emailBody)

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
    if (method === 'email') openMailto(mailto)
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
      {/* Skip for now (Send Introductory Emails fast flow): move to the next
          available customer without sending or recording anything. Sits beneath
          the confirm as a quiet secondary action and is always available, since
          skipping is the deliberate "not this one yet" path. */}
      {onSkip && (
        <WorkflowButton
          icon={SkipForward}
          disabled={busy}
          onClick={onSkip}
          className="w-full justify-center"
        >
          Skip for now
        </WorkflowButton>
      )}
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
  detail, request, name, busy, noteBox, act, hasNextInActivity = false, onSkip,
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
  /** Skip this customer without sending/recording (Send Introductory Emails fast
   * flow). Only the introductory-EMAIL path offers it; the reached-by-phone
   * authorization branch below never does. */
  onSkip?: () => void
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
        // Skip for now: move to the next available customer without sending or
        // recording anything. Sends this customer to the back of the working
        // sequence; the parent client owns the cycling.
        onSkip={onSkip}
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
function CallScriptCard({ label, body, hideCopy = false }: { label: string; body: string; hideCopy?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-supporting">{label}</p>
        {/* Copy is the paste-into-Hearsay/email affordance. The voicemail script
            is read aloud, not pasted, so it hides Copy (hideCopy) while keeping
            the same card treatment. Every other channel keeps Copy. */}
        {!hideCopy && (
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-surface-border-strong bg-surface-card px-2 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:border-brand-ring hover:bg-brand-wash hover:text-brand-subtle-foreground"
          >
            {copied ? <><Check className="size-3 text-status-confirmed" aria-hidden /> Copied</> : <><Copy className="size-3" aria-hidden /> Copy</>}
          </button>
        )}
      </div>
      <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">{body}</p>
    </div>
  )
}

/**
 * An explicitly UNAVAILABLE communication channel in the Didn't Reach workflow.
 * Shown in place of a channel's script/action when the contact information it
 * needs is missing, so the worker sees the channel exists but cannot be used —
 * never a hidden channel and never an implication that it was sent.
 */
function ChannelUnavailable({ body }: { body: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-surface-border-strong bg-surface-muted p-3 text-sm text-ink-supporting">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{body}</p>
    </div>
  )
}

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
  onSkip, onSelectionChange,
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
}) {
  if (workbench) {
    return (
      <CallWorkbenchAction
        detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
        hasNextInActivity={hasNextInActivity}
        onSkip={onSkip}
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
      <CallContext detail={detail} />
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
  detail, request, busy, noteBox, act, hasNextInActivity, onSkip, onSelectionChange,
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

  // ── Optional Call Notes ────────────────────────────────────────────────────
  // One free-text field, available for EVERY recorded call outcome. It is saved
  // WITH the completed interaction (appended to the recorded touch), never as a
  // separate history entry. Empty by default; the employee documents only what
  // the system does not already know.
  const [callNote, setCallNote] = useState('')
  const noteForAction = callNote.trim() || null

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
  }, [onSelectionChange, reach, voicemailLeft, textSent, emailSent, decision, callbackWhen, detail.form_delivery_method, callNote])

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
    // Entering Reached: drop any Didn't-Reach channel selections.
    setVoicemailLeft(null); setTextSent(false); setEmailSent(false)
  }
  function chooseNotReached() {
    if (reach === 'not-reached') { setReach(null); setVoicemailLeft(null); setTextSent(false); setEmailSent(false); return }
    setReach('not-reached')
    // Entering Didn't Reach: drop any Reached decision + callback draft.
    setDecision(null); setCallbackWhen('')
  }

  return (
    <ActionPanel heading={`Call ${name}`}>
      {noteBox}
      <CallContext detail={detail} />

      {/* 1. Phone button. The number is shown in the standard (XXX) XXX-XXXX
          display form via the shared formatter; the tel: link still dials the
          stored value through the team member\u2019s configured phone, so the
          existing system phone behavior is unchanged. Launching the dialer is
          not proof the call happened. */}
      {phone ? (
        <a href={`tel:${phone}`} className="block">
          <PrimaryAction icon={Phone} label={`Call ${formatPhoneDisplay(phone)}`} />
        </a>
      ) : (
        <PrimaryAction icon={Phone} label="No phone on file" disabled />
      )}

      {/* 2. The three call choices sit immediately below the phone button —
          Reached, Didn\u2019t Reach, and Skip for Now. The opening script stays
          hidden until Reached is chosen, so the worker decides the outcome
          first. Skip records nothing and advances to the next customer. */}
      <div className="border-t border-surface-divider pt-4">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">Did you reach the customer?</p>
        <div className="flex flex-wrap gap-2">
          <WorkflowButton icon={PhoneCall} selected={reach === 'reached'} disabled={busy}
            onClick={chooseReached}>
            Reached
          </WorkflowButton>
          <WorkflowButton icon={PhoneOff} selected={reach === 'not-reached'} disabled={busy}
            onClick={chooseNotReached}>
            Didn&apos;t reach
          </WorkflowButton>
          {onSkip && (
            <WorkflowButton icon={SkipForward} disabled={busy} onClick={onSkip}>
              Skip for now
            </WorkflowButton>
          )}
        </div>
      </div>

      {/* Optional Call Notes — available for EVERY recorded call outcome. The
          system already records what happened (reached, voicemail, callback,
          bad number); this captures anything extra the employee wants on the
          record. It is saved WITH the completed interaction, never as a separate
          history entry, and nothing is recorded until an outcome is completed.
          Skip for now and selecting an outcome record nothing, so a note typed
          here is only saved when the worker completes a real outcome. */}
      <div className="border-t border-surface-divider pt-4">
        <label htmlFor="wb-call-note" className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          <StickyNote className="size-4" aria-hidden /> Call notes (optional)
        </label>
        <textarea
          id="wb-call-note"
          value={callNote}
          onChange={e => setCallNote(e.target.value)}
          disabled={busy}
          rows={2}
          placeholder="Anything extra worth recording. The outcome itself is logged automatically."
          className="w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
        />
      </div>

      {/* ── DIDN\u2019T REACH ─────────────────────────────────────────────────── */}
      {reach === 'not-reached' && (
        <div className="space-y-4 border-t border-surface-divider pt-4">
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
          {/* The reason-for-calling mentoring and the opening script are the
              guidance for HAVING the conversation, so they show only until the
              caller records what the customer decided. Once a decision is
              selected (Agreed / Callback / Not interested) both are hidden to
              keep the column focused on the decision's next actions; clearing
              the decision brings them back. Mentoring sits ABOVE the script. */}
          {decision === null && (
            <>
              {/* Reason for calling + the servicing-agent authorization
                  explanation, as a mentoring section: the global Mentoring
                  toggle sets its default open/closed, and the caller can expand
                  or collapse it independently (the shared MentorGuidance
                  behavior). Apostrophes are real characters here, not \u2019
                  escapes in JSX text. */}
              <MentorGuidance label="Why you're calling">
                Our office lost access to {c.first_name ? `${c.first_name}’s` : 'the customer’s'} life insurance
                policy when Allstate’s life business moved to Everlake, because we are not listed as the servicing
                agent. The servicing-agent authorization simply restores our access to help with questions and
                servicing. It does not change the policy or coverage, and it needs a wet (ink) signature.
              </MentorGuidance>

              {/* The approved opening script, read aloud on the line, with the
                  employee + customer names filled in. The spoken-script card (no
                  Copy), not the copy-to-paste CallScriptCard. */}
              <SpokenScriptCard label={SERVICING_CALL_SCRIPTS.opening.label} body={callOpeningScript(c.first_name ?? 'there', senderName)} bodySizeClassName="text-lg" />
            </>
          )}

          {/* Capture the customer’s actual decision. Each choice toggles: picking
              the one already selected clears it, which restores the script and
              mentoring above. Clearing never un-records an already-recorded
              reached attempt (that call happened); it only reopens the choice. */}
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-supporting">What did the customer decide?</p>
            <div className="flex flex-wrap gap-2">
              <WorkflowButton icon={Check} selected={decision === 'agreed'} disabled={busy}
                onClick={() => setDecision(decision === 'agreed' ? null : 'agreed')}>
                Agreed to authorize
              </WorkflowButton>
              <WorkflowButton icon={Clock} selected={decision === 'callback'} disabled={busy}
                onClick={() => setDecision(decision === 'callback' ? null : 'callback')}>
                Wants a callback
              </WorkflowButton>
              <WorkflowButton icon={CircleAlert} selected={decision === 'not-interested'} disabled={busy}
                onClick={() => setDecision(decision === 'not-interested' ? null : 'not-interested')}>
                Not interested
              </WorkflowButton>
            </div>
          </div>

          {/* Agreed -> the established authorization-form process. */}
          {decision === 'agreed' && (
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
                  { type: 'record-attempt', call: 'callback', callback_date: callbackWhen, note: noteForAction },
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
                  { type: 'record-attempt', call: 'not-interested', note: noteForAction },
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

// ─────────────────────────────────────────────────────────────────────────────
// Customer Interaction — the action column for the active-conversation stage
// between routine calling and Servicing Access. It records the conversation
// across email, phone, and text — both an INCOMING response from the customer
// and an OUTGOING reply — and lets the employee set a FOLLOW-UP commitment and
// date WITHOUT placing a phone call. A due follow-up surfaces here as actionable.
//
// Recording an interaction uses the SAME durable history (case_touches via the
// touch route, direction-aware): an incoming genuine response marks engagement
// so the customer moves into / stays in Customer Interaction; an automated reply
// is recorded but never establishes engagement. The follow-up commitment uses
// the set-follow-up transition (a promised date, no call required). The shared
// three-column layout keeps customer contact, policies, and communication
// history visible throughout — the phone workbench is NOT required to see
// context. When the signed authorization arrives the customer moves on via the
// existing Servicing Access workflow.
// ─────────────────────────────────────────────────────────────────────────────

const INTERACTION_CHANNELS: { id: 'email' | 'call' | 'text'; label: string; icon: typeof Mail }[] = [
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'call', label: 'Phone', icon: Phone },
  { id: 'text', label: 'Text', icon: MessageSquare },
]

function CustomerInteractionAction({
  detail, busy, note, act, reload, onAdvanceToNext, onSelectionChange,
}: {
  detail: Detail
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
  const [activeGroup, setActiveGroup] = useState<'communication' | 'follow-up' | null>(null)

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
    if (activeGroup === 'communication') {
      onSelectionChange(communicationPreview())
      return
    }
    // Before any interaction: the panel's primary action is recording a
    // communication, so preview that default compose selection.
    onSelectionChange(communicationPreview())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectionChange, resolveIntent, activeGroup, incoming, automated, channel, notes, followUpDate])

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
        <div
          className="space-y-1.5 border-t border-surface-divider pt-3"
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

// ─────────────────────────────────────────────────────────────────────────────
// Servicing Access — the working screen between Outreach and Operations
// Preparation. It owns the signed-authorization stage of the EXISTING servicing
// workflow: the signed servicing-agent authorization has arrived (returned from
// the introductory email or any channel), so the next work is to save the
// signed form, prepare the carrier email, send it and confirm, run the existing
// seven-day carrier follow-up, and record the carrier's confirmation per policy.
//
// Every business transition is the EXISTING one (form-received, submit-to-
// carrier, record-follow-up, carrier-confirmed); this panel only presents them
// as one continuous servicing-access flow and adds the two steps the task calls
// for that the funnel did not yet surface: saving the signed form into the
// existing document repository, and a Prepare Carrier Email + Email Sent step.
// When every request policy is confirmed, the existing handoff advances the
// customer into Operations Preparation automatically.
// ─────────────────────────────────────────────────────────────────────────────

function ServicingAccessAction({
  detail, request, busy, note, act,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  note: string | null
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
}) {
  const name = fullName(detail.customer)
  const noteBox = note && (
    <div className="flex items-center gap-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4 text-base text-status-confirmed-strong">
      <Check className="size-5" aria-hidden /> {note}
    </div>
  )

  // Stage within servicing access, derived from the SAME durable facts the
  // transitions use. Waiting for Carrier means the form is submitted and the
  // carrier confirmation is outstanding; otherwise the request is pre-submission
  // (receipt + upload + prepare-and-send the carrier email).
  const awaitingCarrier = detail.queue === 'waiting-for-carrier'

  return (
    <ActionPanel heading={awaitingCarrier
      ? `Confirm servicing access for ${name}`
      : `Process ${name}\u2019s signed authorization`}>
      {noteBox}

      {/* Step 1 — save the signed authorization into the existing repository. */}
      <AuthorizationUpload detail={detail} busy={busy} />

      {awaitingCarrier ? (
        // Step 4+ — the existing per-policy carrier-confirmation flow (with the
        // seven-day carrier follow-up chase), reused verbatim.
        <CarrierAction detail={detail} request={request} busy={busy} noteBox={null} act={act} />
      ) : (
        // Steps 2-3 — record receipt (if not yet), then prepare the carrier
        // email and confirm it sent (which is the submit-to-carrier transition).
        <ServicingAccessSubmit detail={detail} request={request} name={name} busy={busy} act={act} />
      )}
    </ActionPanel>
  )
}

/**
 * Save the signed servicing-agent authorization into Right Path's existing
 * document repository (the shared rightpath-documents bucket + policy_documents
 * table) via the stewardship authorization route. Upload, replace, and
 * open/download of the stored form; uploading records a receipt in Customer
 * History on the server. This is the task's "upload and save the signed form"
 * step; it adds no new storage system.
 */
function AuthorizationUpload({
  detail, busy,
}: {
  detail: Detail
  busy: boolean
}) {
  const [onFile, setOnFile] = useState(!!detail.authorization_on_file)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setErr(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(`/api/stewardship/${detail.id}/authorization`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(json.error ?? 'Upload failed.'); return }
      setOnFile(true)
    } catch {
      setErr('Network error during upload.')
    } finally {
      setUploading(false)
    }
  }

  async function openStored() {
    setErr(null)
    setOpening(true)
    try {
      const res = await fetch(`/api/stewardship/${detail.id}/authorization`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(json.error ?? 'Could not open the saved authorization.'); return }
      if (json?.data?.url) window.open(json.data.url as string, '_blank', 'noopener')
    } catch {
      setErr('Network error opening the saved authorization.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className={`space-y-2 rounded-xl border p-4 ${onFile ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <FileText className="size-4 text-slate-600" aria-hidden /> Signed authorization
      </p>
      {onFile ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-800">
          <Check className="size-4" aria-hidden /> Saved to the customer&apos;s documents.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Upload the signed servicing-agent authorization to save it in the customer&apos;s documents.
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = '' }}
      />
      <div className="flex flex-wrap gap-2">
        <WorkflowButton
          icon={uploading ? Loader2 : Upload}
          disabled={busy || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Uploading\u2026' : (onFile ? 'Replace signed form' : 'Upload signed form')}
        </WorkflowButton>
        {onFile && (
          <WorkflowButton
            icon={opening ? Loader2 : Download}
            disabled={busy || opening}
            onClick={() => void openStored()}
          >
            {opening ? 'Opening\u2026' : 'Open saved form'}
          </WorkflowButton>
        )}
      </div>
      {err && <p className="text-sm text-rose-700">{err}</p>}
      <NextNote>Saved to the customer&apos;s documents and recorded in their history. Signature verification is not required here.</NextNote>
    </div>
  )
}

/**
 * Record receipt (if not yet recorded), then prepare the carrier email and
 * confirm it sent. "Email Sent" is the existing submit-to-carrier transition:
 * it moves the customer to Waiting for Carrier and starts the existing
 * seven-day carrier follow-up. The employee attaches the signed form and sends
 * the email manually from the opened draft; launching is not completion.
 */
function ServicingAccessSubmit({
  detail, request, name, busy, act,
}: {
  detail: Detail
  request: Holding[]
  name: string
  busy: boolean
  act: (action: unknown, successNote?: string) => void
}) {
  const received = !!detail.form_received_at

  // Which action records receipt depends on where the customer currently sits.
  // A customer already in Waiting for Form (reached through the normal funnel,
  // form sent) records receipt with form-received. A customer still earlier in
  // the pre-authorization funnel — the signed authorization simply ARRIVED
  // (returned from the introductory email, or opened via the find-a-customer
  // search) — advances to Waiting for Form AND records receipt in one step via
  // form-returned, which is valid from anywhere in the funnel. Either way
  // form_received_at ends up set, after which Submit to carrier is available.
  const receiptAction = detail.queue === 'waiting-for-form'
    ? { type: 'form-received' as const }
    : { type: 'form-returned' as const }

  // The appropriate carrier(s) and the request's policy numbers for the carrier
  // email. Carriers come from the request policies (existing data, nothing
  // invented); the email asks the carrier to process the authorization.
  const carriers = uniqueCarriers(request.map(h => h.carrier))
  const policyNumbers = request.map(h => h.policy_number).filter(Boolean)
  // The recipient is resolved from existing carrier contact information only.
  // Right Path stores no carrier email addresses today, so this is empty and the
  // draft opens with a blank To: the employee fills in. We never invent an
  // address. (When carrier addresses are later stored, pass them here and the
  // draft is pre-addressed automatically.)
  const carrierRecipient = resolveCarrierRecipient(carriers)
  const carrierMailto = buildMailto(
    carrierRecipient ?? '',
    carrierEmailSubject(carriers),
    carrierEmailMessage({ carriers, policyNumbers, customerName: name }),
  )

  if (!received) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          First record that the signed form came back. One form can cover several policy numbers.
        </p>
        <PrimaryAction
          icon={FileText}
          label="Record authorization received"
          disabled={busy}
          onClick={() => act(receiptAction, 'Receipt recorded. Prepare the carrier email below.')}
        />
        <FollowUpChase detail={detail} busy={busy} act={act} label="Followed up on the signature" />
        <NextNote>Recording receipt does not submit anything. After it is recorded, prepare the carrier email and confirm it sent.</NextNote>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="size-4" aria-hidden /> Authorization received{detail.form_received_at ? ` ${shortDate(detail.form_received_at)}` : ''}.
      </div>

      <FormCoverage request={request} />

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Building2 className="size-4 text-slate-600" aria-hidden /> Prepare carrier email
        </p>
        <p className="text-sm text-slate-600">
          Opens a prepared email to {carriers.length > 0 ? carriers.join(', ') : 'the carrier'} asking them to
          process the authorization. Attach the signed form, send it, then confirm below.
        </p>
        {carrierRecipient ? (
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <Mail className="size-4 shrink-0 text-slate-500" aria-hidden />
            Prefilled recipient: <span className="font-medium text-slate-900">{carrierRecipient}</span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              No carrier email address is on file, so the draft opens with the recipient blank. Add
              {carriers.length === 1 ? ` ${carriers[0]}\u2019s` : ' the carrier\u2019s'} email address before sending.
            </span>
          </p>
        )}
        <ExternalActionConfirm
          launchIcon={Mail}
          launchLabel="Prepare carrier email"
          confirmLabel="Email Sent"
          confirmedNote="Submitted to the carrier. Waiting for Carrier, with the seven-day follow-up started."
          hint="Confirming Email Sent submits the authorization and starts the seven-day carrier follow-up."
          onLaunch={() => { openMailto(carrierMailto) }}
          onConfirmed={() => act(
            { type: 'submit-to-carrier' },
            'Submitted. Moved to Waiting for Carrier; seven-day follow-up started.',
          )}
        />
      </div>

      <FollowUpChase detail={detail} busy={busy} act={act} label="Followed up on the signature" />
      <NextNote>
        Email Sent is the submission: {name} moves to Waiting for Carrier and the seven-day carrier follow-up
        begins. Carrier confirmations are recorded there; once every policy is confirmed, {name} opens in
        Operations Preparation automatically.
      </NextNote>
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
  // Every distinct policy number on file for the customer pairs with the last
  // name for the shared Search Gateway look-up, exactly like the consolidated
  // Contact Research task the worker is sent to. The GET route gathers these
  // customer-wide (service policies + associated cases, de-duplicated); if that
  // field is unavailable, fall back to the request holdings' numbers so the
  // look-up still works.
  const policyNumbers =
    detail.gateway_policy_numbers && detail.gateway_policy_numbers.length > 0
      ? detail.gateway_policy_numbers
      : Array.from(
          new Set(
            request
              .map(h => (h.policy_number ?? '').trim())
              .filter(p => p.length > 0),
          ),
        )

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
      <div className="flex items-center gap-2 rounded-xl border border-status-missing-border bg-status-missing-soft p-4 text-base text-status-missing-strong">
        <Search className="size-5" aria-hidden /> Usable contact information is missing or has failed.
      </div>

      {/* The shared Search Gateway look-up — last name + every policy number on
          file, each with its own Copy button; identical to the consolidated
          Contact Research task. */}
      <GatewayLookup
        lastName={detail.customer.last_name}
        fallbackName={fullName(detail.customer)}
        policyNumbers={policyNumbers}
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
