/**
 * Static story data for the 1035 Workflow prototype.
 *
 * STORYBOOK-ONLY fixture. Nothing here reads from or writes to Supabase, the
 * APIs, or any production workflow. No GoRules/ZEN. The customers and policies
 * below are drawn from the real Cassidy legacy book so the prototype reads like
 * production data, but it is all in-memory.
 *
 * This is a QUEUE-FIRST work system, not a per-customer wizard. A customer
 * lives in exactly one queue at a time. Movement between queues is driven by
 * what happened (email sent, form returned, call outcome, carrier confirmed),
 * never by a fixed five-step sequence.
 *
 * Fidelity to the live records:
 *   - Real customers (Stephen Remy, Rita Eburuoh, Gerald Cassidy) carry only
 *     their ACTUAL holdings. We never attach fabricated financial holdings or
 *     relationships to a real person.
 *   - Where a scenario needs an extra holding, a linked spouse, or a specific
 *     contact state that the real records cannot demonstrate, it is attached to
 *     a clearly SYNTHETIC customer (names marked DEMO), never to a real one.
 *   - Email addresses on real customers are illustrative placeholders; no
 *     Cassidy record stores an email. They exist only to exercise the UI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Queues — the backbone of the work system.
//
// Six working queues, shown in a fixed order on the landing screen. There is
// NO "Complete" queue: when the carrier confirms servicing-agent status the
// customer EXITS the 1035 Workflow and is handed off to the Review workflow.
// ─────────────────────────────────────────────────────────────────────────────

export type QueueId =
  | 'ready-to-email'
  | 'ready-to-call'
  | 'research-needed'
  | 'waiting-for-response'
  | 'waiting-for-form'
  | 'waiting-for-carrier'

/** Fixed landing-screen order. */
export const QUEUE_ORDER: QueueId[] = [
  'ready-to-email',
  'ready-to-call',
  'research-needed',
  'waiting-for-response',
  'waiting-for-form',
  'waiting-for-carrier',
]

export interface QueueMeta {
  id:    QueueId
  label: string
  /** One line explaining what this queue represents, for the worker. */
  blurb: string
  /** Whether this queue is actionable (worker starts work) or a waiting state. */
  kind:  'action' | 'waiting'
}

export const QUEUE_META: Record<QueueId, QueueMeta> = {
  'ready-to-email': {
    id: 'ready-to-email',
    label: 'Ready to Email for initial outreach',
    blurb: 'A usable email exists. Send the initial servicing-agent outreach.',
    kind: 'action',
  },
  'ready-to-call': {
    id: 'ready-to-call',
    label: 'Ready to Call',
    blurb: 'Customers ready for a call.',
    kind: 'action',
  },
  'research-needed': {
    id: 'research-needed',
    label: 'Research Needed to verify contact path',
    blurb: 'Usable contact information is missing or has failed. Exception path only.',
    kind: 'action',
  },
  'waiting-for-response': {
    id: 'waiting-for-response',
    label: 'Waiting for Response from customer',
    blurb: 'Initial email sent and still inside the follow-up window.',
    kind: 'waiting',
  },
  'waiting-for-form': {
    id: 'waiting-for-form',
    label: 'Waiting for Return of Signed Form',
    blurb: 'Customer engaged and the servicing-agent form has been sent.',
    kind: 'waiting',
  },
  'waiting-for-carrier': {
    id: 'waiting-for-carrier',
    label: 'Waiting for Carrier',
    blurb: 'Signed form submitted. Awaiting carrier confirmation of servicing agent.',
    kind: 'waiting',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue groups — how the right-hand work-queue column is organized visually.
// Three groups: outreach, quiet/exception work, and waiting. This is a display
// grouping only; it does not change the underlying queues or their counts.
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueGroup {
  id:     'outreach' | 'quiet' | 'waiting'
  label:  string
  queues: QueueId[]
}

export const QUEUE_GROUPS: QueueGroup[] = [
  { id: 'outreach', label: 'Outreach',             queues: ['ready-to-email', 'ready-to-call'] },
  { id: 'quiet',    label: 'Quiet / exception work', queues: ['research-needed'] },
  { id: 'waiting',  label: 'Waiting',              queues: ['waiting-for-response', 'waiting-for-form', 'waiting-for-carrier'] },
]

// ─────────────────────────────────────────────────────────────────────────────
// Work modes — how the Assistant frames the queues for the worker.
//
// The queues are NOT a rigid priority order. The Assistant groups them into
// kinds of work the worker can choose from based on the moment:
//
//   active-outreach — reaching out to customers (email, calls).
//   quiet-work      — heads-down work that needs no outreach (research), plus
//                     checking the status queues for anything that came back.
//
// A status queue (waiting-for-*) is never framed as something to "work." The
// Assistant translates it into a check action: look for replies, returned
// forms, or carrier updates.
// ─────────────────────────────────────────────────────────────────────────────

export type WorkModeId =
  | 'send-emails'
  | 'make-calls'
  | 'do-research'
  | 'check-inbox'
  | 'check-carrier'

export type WorkModeKind = 'active-outreach' | 'quiet-work'

export interface WorkMode {
  id:    WorkModeId
  kind:  WorkModeKind
  /** The button/verb the worker chooses, e.g. "Send emails". */
  action: string
  /** Which queue this mode opens directly, when it maps to a single queue. */
  queue?: QueueId
  /**
   * The status queues this mode lets the worker CHECK. Present on the inbox and
   * carrier modes, which translate waiting queues into check actions rather
   * than queues to "work."
   */
  checks?: QueueId[]
}

/**
 * The inbox spans the two queues where something comes back to us by email:
 * replies while inside the follow-up window, and returned servicing-agent
 * forms. Carrier status is its own distinct kind of quiet work.
 */
export const INBOX_QUEUES:   QueueId[] = ['waiting-for-response', 'waiting-for-form']
export const CARRIER_QUEUES: QueueId[] = ['waiting-for-carrier']

export const WORK_MODES: WorkMode[] = [
  { id: 'send-emails',   kind: 'active-outreach', action: 'Send emails',         queue: 'ready-to-email' },
  { id: 'make-calls',    kind: 'active-outreach', action: 'Make calls',          queue: 'ready-to-call' },
  { id: 'do-research',   kind: 'quiet-work',      action: 'Do research',         queue: 'research-needed' },
  { id: 'check-inbox',   kind: 'quiet-work',      action: 'Check inbox',         checks: INBOX_QUEUES },
  { id: 'check-carrier', kind: 'quiet-work',      action: 'Check carrier status', checks: CARRIER_QUEUES },
]

// ─────────────────────────────────────────────────────────────────────────────
// DOB — precision is a property of the DATA we hold, independent of whether a
// worker has confirmed it. We never invent missing components.
// ─────────────────────────────────────────────────────────────────────────────

export type DobPrecision = 'exact' | 'month-year' | 'year-only' | 'unknown'

export type Dob =
  | { precision: 'exact'; year: number; month: number; day: number }
  | { precision: 'month-year'; year: number; month: number }
  | { precision: 'year-only'; year: number }
  | { precision: 'unknown' }

// ─────────────────────────────────────────────────────────────────────────────
// Per-fact source / confirmation status. SEPARATE from DOB precision.
//
//   'unverified'       — imported or not yet checked. Amber: known but not
//                        customer confirmed.
//   'allstate-record'  — present in a current Allstate system (eAgent, etc.).
//                        A system record, NOT a customer confirmation. Amber.
//   'customer-verified'— confirmed directly with the customer. Green.
//   'not-found'        — checked and nothing usable was found. Red/missing.
//
// Facts are verified INDIVIDUALLY, never at the customer level.
// ─────────────────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | 'unverified'
  | 'allstate-record'
  | 'customer-verified'
  | 'not-found'

export function verificationLabel(status: VerificationStatus): string {
  switch (status) {
    case 'customer-verified': return 'Customer verified'
    case 'allstate-record':   return 'Allstate record'
    case 'unverified':        return 'Unverified'
    case 'not-found':         return 'Checked, not found'
  }
}

/**
 * Accessible status tone. The three worker-facing buckets never rely on color
 * alone: each pairs a tone with an icon and text in the UI layer.
 *   confirmed — green check: customer confirmed.
 *   known     — amber: known but not customer confirmed (unverified / record).
 *   missing   — red: no usable information (not found or empty).
 */
export type StatusTone = 'confirmed' | 'known' | 'missing'

export function statusTone(status: VerificationStatus): StatusTone {
  switch (status) {
    case 'customer-verified': return 'confirmed'
    case 'allstate-record':   return 'known'
    case 'unverified':        return 'known'
    case 'not-found':         return 'missing'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact model — intentionally minimal.
//
// Per person: exactly one email, a personal phone, a work phone, and one
// exclusive preferred-phone selection (personal OR work). No Home / Mobile /
// Landline / Other, no multiple email categories. Each field carries its own
// field-level status.
// ─────────────────────────────────────────────────────────────────────────────

export type PreferredPhone = 'personal' | 'work'

export interface ContactField {
  value:  string | null
  status: VerificationStatus
}

export interface ContactInfo {
  email:          ContactField
  personalPhone:  ContactField
  workPhone:      ContactField
  /** Exactly one of personal | work is preferred. */
  preferredPhone: PreferredPhone
}

/** The preferred phone field, per the person's preferredPhone choice. */
export function preferredPhoneField(c: ContactInfo): ContactField {
  return c.preferredPhone === 'work' ? c.workPhone : c.personalPhone
}

function fieldHasValue(f: ContactField): boolean {
  return !!f.value && f.value.trim() !== '' && f.status !== 'not-found'
}

/** True when a usable (non-empty, not failed) email exists. */
export function hasUsableEmail(c: ContactInfo): boolean {
  return fieldHasValue(c.email)
}

/** True when a usable (non-empty, not failed) phone exists on either line. */
export function hasUsablePhone(c: ContactInfo): boolean {
  return fieldHasValue(c.personalPhone) || fieldHasValue(c.workPhone)
}

/**
 * A person who can be a routine-contact target and/or a required signer. We
 * never copy one person's contact details onto another; each person owns their
 * own email and phones.
 */
export interface Person {
  id:        string
  firstName: string
  lastName:  string
  /** Relationship label for display only, e.g. "Spouse". Optional. */
  relationship?: string
  dob?:      Dob
  dobStatus?: VerificationStatus
  contact:   ContactInfo
}

export function personName(p: Pick<Person, 'firstName' | 'lastName'>): string {
  return `${p.firstName} ${p.lastName}`.trim()
}

/**
 * Routine communication preference. Default: communicate with the customer
 * directly. Optionally handled by a LINKED person (e.g. a spouse), in which
 * case we show THAT person's own contact details. This never changes policy
 * ownership or signature requirements.
 */
export type Communication =
  | { mode: 'direct' }
  | { mode: 'linked'; personId: string }

// ─────────────────────────────────────────────────────────────────────────────
// Holdings.
//
// When a customer is opened we show ALL stewarded holdings Right Path knows
// about them. We distinguish only: holdings INCLUDED in this servicing-agent
// request vs. OTHER stewarded holdings shown for relationship context. How a
// holding entered the book (the source spreadsheet) is never modeled or shown.
// ─────────────────────────────────────────────────────────────────────────────

export interface Holding {
  id:            string
  policyNumber:  string
  productType:   string
  carrier:       string
  faceAmount:    number | null
  /** Insured name. Null when the insured IS the owner (the common case). */
  insuredName:   string | null
  coverageStatus: string
  /** Short, worker-facing servicing context. */
  servicingContext: string
  /**
   * true  — included in the CURRENT servicing-agent request.
   * false — another stewarded holding shown for relationship context only.
   */
  inRequest: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Work item — a customer as they sit in the 1035 Workflow.
//
// The customer identity plus the single queue they are in, why they landed
// there, and the state needed to render the actionable task for that queue.
// ─────────────────────────────────────────────────────────────────────────────

/** How a call went, when the item has been through Ready to Call. */
export type CallOutcome =
  | 'reached'
  | 'voicemail'
  | 'bad-number'
  | 'not-interested'
  | 'callback'

/** Why a Ready to Call item needs a call — selects the right script. */
export type CallReason =
  | 'no-email'          // never had an email
  | 'email-bounced'     // emailed outreach bounced
  | 'no-response'       // emailed outreach, follow-up window lapsed
  | 'callback-due'      // customer asked us to call back

/** Concise reason labels shown inline on the Ready to Call customer cards. */
export const CALL_REASON_LABEL: Record<CallReason, string> = {
  'no-email':      'No email',
  'email-bounced': 'Email bounced',
  'no-response':   'No response',
  'callback-due':  'Callback due',
}

/** Why a Research Needed item is in research. */
export type ResearchReason =
  | 'no-contact'        // no usable email or phone at intake
  | 'bad-number'        // the only phone turned out to be a bad number
  | 'bounce-no-phone'   // email bounced and no usable phone exists

export interface WorkItem {
  id:        string
  firstName: string
  lastName:  string
  address: {
    line1: string | null
    city:  string | null
    state: string | null
    zip:   string | null
  }
  dob:       Dob
  dobStatus: VerificationStatus
  /** The customer's own minimal contact info. */
  contact:   ContactInfo
  /** All stewarded holdings Right Path knows about this customer. */
  holdings:  Holding[]

  /** Other household people who may handle communication or must sign. */
  relatedPeople?: Person[]
  /** Routine communication preference. Defaults to direct when absent. */
  communication?: Communication
  /**
   * Ids of people whose signature the request requires. An id matches this
   * customer's id (the customer signs) or a relatedPeople id. Independent of
   * the communication preference and of policy ownership.
   */
  requiredSignerIds?: string[]

  // ── Queue placement ──
  queue: QueueId
  /** Set when queue is 'ready-to-call'. Drives the call script. */
  callReason?: CallReason
  /** Set when queue is 'research-needed'. */
  researchReason?: ResearchReason
  /** Scheduled callback date (ISO), when the item is a callback. */
  callbackDate?: string
  /** When the initial email was sent (ISO), for Waiting for Response items. */
  emailSentDate?: string
  /** When the follow-up becomes due (ISO), for Waiting for Response items. */
  followUpDueDate?: string
  /** When the signed form was submitted to the carrier (ISO). */
  submittedDate?: string
  /**
   * Carrier correction requested on a Waiting for Carrier item. When present,
   * this is actionable work WITHIN the stage, not a new permanent queue.
   */
  carrierCorrection?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function fullName(c: Pick<WorkItem, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`.trim()
}

/**
 * Resolve a person id to a Person, treating the customer as a person too, so
 * routine-contact and signer lists can reference either uniformly.
 */
export function resolvePerson(item: WorkItem, id: string): Person | null {
  if (id === item.id) {
    return {
      id:        item.id,
      firstName: item.firstName,
      lastName:  item.lastName,
      dob:       item.dob,
      dobStatus: item.dobStatus,
      contact:   item.contact,
    }
  }
  return item.relatedPeople?.find(p => p.id === id) ?? null
}

/** The person who handles routine communication, per the preference. */
export function routineContactPerson(item: WorkItem): Person | null {
  const comm = item.communication ?? { mode: 'direct' }
  if (comm.mode === 'linked') return resolvePerson(item, comm.personId)
  return resolvePerson(item, item.id)
}

/** The required signers for the current request, resolved to people. */
export function requiredSigners(item: WorkItem): Person[] {
  const ids = item.requiredSignerIds ?? [item.id]
  return ids
    .map(id => resolvePerson(item, id))
    .filter((p): p is Person => p !== null)
}

/** Holdings included in the current servicing-agent request. */
export function requestHoldings(item: WorkItem): Holding[] {
  return item.holdings.filter(h => h.inRequest)
}

/** Other stewarded holdings, shown for relationship context only. */
export function contextHoldings(item: WorkItem): Holding[] {
  return item.holdings.filter(h => !h.inRequest)
}

/**
 * The queue a brand-new item routes to at intake, applying TRUST BUT VERIFY:
 * use existing contact info without pre-verifying it.
 *   email exists                 -> Ready to Email
 *   no email but phone exists     -> Ready to Call
 *   no usable email or phone      -> Research Needed
 */
export function initialQueue(item: Pick<WorkItem, 'contact'>): QueueId {
  if (hasUsableEmail(item.contact)) return 'ready-to-email'
  if (hasUsablePhone(item.contact)) return 'ready-to-call'
  return 'research-needed'
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Render a DOB at exactly the precision held. Never fabricate missing parts. */
export function formatDob(dob: Dob): string {
  switch (dob.precision) {
    case 'exact':      return `${MONTHS[dob.month - 1]} ${dob.day}, ${dob.year}`
    case 'month-year': return `${MONTHS[dob.month - 1]} ${dob.year}`
    case 'year-only':  return String(dob.year)
    case 'unknown':    return 'Not on file'
  }
}

export function dobPrecisionLabel(dob: Dob): string {
  switch (dob.precision) {
    case 'exact':      return 'Exact date'
    case 'month-year': return 'Month & year'
    case 'year-only':  return 'Year only'
    case 'unknown':    return 'Missing'
  }
}

export function currency(n: number | null): string {
  if (n == null) return '\u2014'
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
}

/** Short, friendly date like "Oct 12" from an ISO date, for queue chips. */
export function shortDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
