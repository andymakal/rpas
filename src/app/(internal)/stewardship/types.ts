/**
 * Stewardship / capture outreach — shared data shapes and board constants.
 *
 * Extracted verbatim from `StewardshipClient.tsx` so the board host, the task
 * orchestrator, and the individual panels (in their own files) all import the
 * SAME `Detail` / `Holding` / `BoardItem` types rather than re-declaring them.
 * Pure types + immutable constants only — no JSX, no client code — so this is a
 * plain module both server and client files can import.
 */

import { Mail, Phone, Search, Inbox, FileText, Building2 } from 'lucide-react'
import { type EmailAvailability } from '@/lib/email-availability'
import { type OutreachQueue } from '@/lib/stewardship/queues'
import { type HistoryEvent } from '@/lib/stewardship/customer-history'

export type Customer = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }

export type BoardItem = {
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
  // When set, the customer explicitly declined outreach on this date. Carried on
  // board items only for the declined basin (population=declined), the one view
  // that surfaces refused items; every other board list suppresses them.
  refused_at?: string | null
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
 * populations, the first-touch introductory-email subset of Ready to Email, and
 * the declined basin (customers who explicitly said no — the one view that
 * surfaces refused items instead of suppressing them). */
export type OpenPopulation = 'calls-due' | 'available-to-call' | 'introductory-emails' | 'declined'

export const POPULATION_META: Record<OpenPopulation, { label: string; blurb: string }> = {
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
  'declined': {
    label: 'Declined / Not interested',
    blurb: 'Customers who explicitly declined servicing-agent outreach. Outreach is stopped; nothing is auto-closed. Reopen a customer to deliberately re-engage.',
  },
}

export type Holding = {
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

export type Detail = BoardItem & {
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
  /** The situation-specific CALL CONTENT for the outbound call panel, resolved
   * server-side from the (project type, phase) catalog with the caller/customer
   * identity already filled: the "why you're calling" reason the cap reveals,
   * the opening talk path, and optional mentoring prose. The panel feeds these
   * to the CallMentorCap / TalkPathCard Legos. Optional for back-compat: when
   * absent (older payloads), the panel uses its built-in default wording. */
  call_context?: {
    reason: string
    talkPath: string
    mentoring: string | null
    fromCatalog: boolean
  } | null
}

export const QUEUE_ICON: Record<OutreachQueue, typeof Mail> = {
  'ready-to-email': Mail,
  'ready-to-call': Phone,
  'research-needed': Search,
  'waiting-for-response': Inbox,
  'waiting-for-form': FileText,
  'waiting-for-carrier': Building2,
}

export const QUEUE_GROUPS: { label: string; queues: OutreachQueue[] }[] = [
  { label: 'Outreach', queues: ['ready-to-email', 'ready-to-call'] },
  { label: 'Quiet / exception work', queues: ['research-needed'] },
  { label: 'Waiting', queues: ['waiting-for-response', 'waiting-for-form', 'waiting-for-carrier'] },
]
