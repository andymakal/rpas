/**
 * Stewardship / capture outreach — shared queue model and transition rules.
 *
 * This mirrors the servicing-recovery prototype's state machine
 * (src/components/servicing-recovery/data.ts) but is the DURABLE version: these
 * types match the stewardship_outreach table and drive the real API routes.
 *
 * Settled rules enforced here:
 *   - No automatic lost/closed state. Every terminal-looking outcome is an
 *     explicit human-recorded value; the system never closes an item on its own.
 *   - Calls are to customers, not carriers.
 *   - Carrier confirmation does NOT create a review; it confirms servicing
 *     access (service_policies.sa_status = 'confirmed') PER POLICY. Each policy
 *     keeps its own status; confirming one never changes another. Outreach stays
 *     actionable while any request policy still needs access, and ends only once
 *     every request policy is confirmed. (Separately, the 1035 review advances to
 *     operations prep as soon as the permanent policies are confirmed — term
 *     policies are still pursued in outreach but never block that advancement.)
 */

export type OutreachQueue =
  | 'ready-to-email'
  | 'ready-to-call'
  | 'research-needed'
  | 'waiting-for-response'
  | 'waiting-for-form'
  | 'waiting-for-carrier'

export const OUTREACH_QUEUES: OutreachQueue[] = [
  'ready-to-email',
  'ready-to-call',
  'research-needed',
  'waiting-for-response',
  'waiting-for-form',
  'waiting-for-carrier',
]

export type CallReason = 'no-email' | 'email-bounced' | 'no-response' | 'callback-due'
export type ResearchReason = 'no-contact' | 'bad-number' | 'bounce-no-phone'
export type CallOutcome = 'reached' | 'voicemail' | 'bad-number' | 'not-interested' | 'callback'

/**
 * A non-call channel's recorded outcome within a coordinated attempt, using the
 * IPF grouping vocabulary mapped to Right Path:
 *   - 'touch'      a real completed send (voicemail left, text sent, email sent,
 *                  postal sent).
 *   - 'no_contact' the channel was attempted but not completed (an ordinary
 *                  non-send; recorded so the attempt is honest).
 *   - 'unusable'   the channel cannot deliver (full mailbox, bouncing text or
 *                  email). A recorded usability fact; never a touch.
 * These never influence cadence/timing (IPF Decision Engine Boundary); they feed
 * the touch grouping and contact-method usability only.
 */
export type AttemptChannelOutcome = 'touch' | 'no_contact' | 'unusable'

/** The three contact facts the customer can confirm during onboarding. */
export type ContactField = 'phone' | 'email' | 'address'

/** How the authorization form is delivered to the customer. */
export type FormDeliveryMethod = 'email' | 'postal'

/**
 * Days to wait for a reply to the INITIAL servicing-agent email before the item
 * resurfaces for a phone call. Two days per the onboarding spec. Applied as
 * follow_up_due when the email is recorded sent; deriveFollowUpRouting promotes
 * the item to Ready to Call (no-response) once it lapses.
 */
export const INITIAL_EMAIL_FOLLOW_UP_DAYS = 2

/**
 * Default spacing (in days) between automatic follow-up attempts after an
 * unsuccessful CALL (a voicemail with no promised callback). There is
 * deliberately NO attempt limit and NO attempt counter: each voicemail simply
 * rolls the next follow-up forward by this many days. A human decides to stop;
 * the system never caps attempts or auto-closes.
 */
export const FOLLOW_UP_INTERVAL_DAYS = 2

/**
 * How many days to wait before nudging a follow-up on work that is waiting on
 * the CUSTOMER to return the signed form (waiting-for-form) or on the CARRIER to
 * confirm (waiting-for-carrier). These are legitimately waiting states, so the
 * nudge does NOT change the queue; it just marks the item follow-up-due so it
 * resurfaces for a chase. Rolled forward on each nudge; no attempt limit.
 */
export const AWAITING_SIGNATURE_FOLLOW_UP_DAYS = 5
export const AWAITING_CARRIER_FOLLOW_UP_DAYS = 7

export interface QueueMeta {
  id: OutreachQueue
  label: string
  blurb: string
  kind: 'action' | 'waiting'
}

export const QUEUE_META: Record<OutreachQueue, QueueMeta> = {
  'ready-to-email': {
    id: 'ready-to-email',
    label: 'Ready to Email',
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
    label: 'Research Needed',
    blurb: 'Usable contact information is missing or has failed. Exception path only.',
    kind: 'action',
  },
  'waiting-for-response': {
    id: 'waiting-for-response',
    label: 'Waiting for Response',
    blurb: 'Initial email sent and still inside the follow-up window.',
    kind: 'waiting',
  },
  'waiting-for-form': {
    id: 'waiting-for-form',
    label: 'Waiting for Form',
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

/**
 * Intake routing — TRUST BUT VERIFY: use existing contact info without
 * pre-verifying it.
 *   email exists              -> Ready to Email
 *   no email but phone exists  -> Ready to Call (reason: no-email)
 *   no usable email or phone   -> Research Needed (reason: no-contact)
 */
export function initialQueue(contact: { email: string | null; phone: string | null }): {
  queue: OutreachQueue
  call_reason: CallReason | null
  research_reason: ResearchReason | null
} {
  const hasEmail = !!contact.email?.trim()
  const hasPhone = !!contact.phone?.trim()
  if (hasEmail) return { queue: 'ready-to-email', call_reason: null, research_reason: null }
  if (hasPhone) return { queue: 'ready-to-call', call_reason: 'no-email', research_reason: null }
  return { queue: 'research-needed', call_reason: null, research_reason: 'no-contact' }
}

/**
 * The actions a worker can take on an outreach item. Each returns the fields to
 * patch on the stewardship_outreach row (and, for carrier-confirm, a signal to
 * update service_policies). Transitions are explicit; nothing auto-advances.
 */
export type OutreachAction =
  // next_call_date is the cadence-resolved first-call date (YYYY-MM-DD), computed
  // by the route from the attempt history + actor calendar. Supplied so the pure
  // transition stays free of time-math and timezone concerns: after the intro
  // email the first call is due per the cadence (24h for the first attempt).
  // follow_up_days remains as a legacy fallback when no date is supplied.
  | { type: 'email-sent'; follow_up_days?: number; next_call_date?: string | null }
  | { type: 'email-bounced' }        // emailed outreach bounced
  // next_call_date is the cadence-resolved next automatic call date (YYYY-MM-DD)
  // for an unsuccessful (voicemail) call, computed by the route from the grouped
  // attempt history. Supplied so applyAction stays pure (no time-math/timezone).
  // When absent, the legacy flat FOLLOW_UP_INTERVAL_DAYS spacing is used.
  | { type: 'call-outcome'; outcome: CallOutcome; callback_date?: string | null; next_call_date?: string | null }
  // ONE coordinated multi-channel outreach attempt (adapted from IPF
  // record_outreach_grouping). It records the outcome of each channel used in a
  // single reach-out AND advances the workflow, so the employee records the
  // activity ONCE. The call outcome (when a call channel was used) drives the
  // workflow transition exactly like call-outcome; the voicemail/text/email/
  // postal outcomes are recorded as individual touches by the route (one
  // grouping at a shared timestamp) and never influence cadence/timing. An
  // attempt with no call channel (e.g. an email-only reach-out from Ready to
  // Email) records its touches and, when it is a plain non-reaching attempt on a
  // callable customer, schedules the next call via next_call_date without
  // forcing a call transition. Channel outcomes use the IPF vocabulary
  // (touch / no_contact / unusable); only the CALL channel carries a workflow
  // CallOutcome.
  | {
      type: 'record-attempt'
      /** The call channel's workflow outcome, when a call was placed in this
       * attempt. Omitted when the attempt used no call channel. */
      call?: CallOutcome | null
      /** Promised callback date (YYYY-MM-DD) when call === 'callback'. */
      callback_date?: string | null
      /** Per-channel recorded outcomes (for the touch grouping + usability).
       * Absent channel = not offered on this attempt. */
      voicemail?: AttemptChannelOutcome | null
      text?: AttemptChannelOutcome | null
      email?: AttemptChannelOutcome | null
      postal?: AttemptChannelOutcome | null
      /** The cadence-resolved next automatic call date (YYYY-MM-DD), supplied by
       * the route, used when the attempt schedules another call. */
      next_call_date?: string | null
    }
  | { type: 'form-sent' }            // after a reached call, the form is (re)sent
  // Signed form came back on its own after the intro email (which already
  // carried the form) — advance to waiting-for-form WITHOUT recording a second
  // send. Distinct from form-sent so no fictitious mailing is logged.
  | { type: 'form-returned' }
  | { type: 'research-found'; found: 'email' | 'phone' | 'nothing' }
  | { type: 'form-received' }        // signed form came back (before submit)
  | { type: 'submit-to-carrier' }
  | { type: 'carrier-correction'; note: string }
  // Carrier confirmation is PER POLICY: the carrier confirms the servicing agent
  // on one policy at a time, so each confirmation names the policy it applies
  // to. Confirming one policy never changes another. Outreach ends only once
  // every request policy is confirmed — that completion is decided by the route
  // after it re-reads the request policies' statuses, not here.
  | { type: 'carrier-confirmed'; policy_id: string }
  // Record that the customer confirmed a specific contact value is correct.
  // Pure workflow state only; persisting the confirmation timestamp is a
  // side-effect the route performs. Verification never changes the queue.
  | { type: 'verify-contact'; field: ContactField; verified: boolean }
  // Record which channel the authorization form is delivered through. An
  // operator decision that does not, by itself, change the queue.
  | { type: 'set-delivery-method'; method: FormDeliveryMethod }
  // Reopen a refused item: clear refused_at and return it to active outreach.
  // The deliberate, human-initiated reversal of an explicit refusal.
  | { type: 'reopen' }
  // Record a follow-up chase on a waiting item (awaiting the signed form or
  // carrier confirmation) and schedule the next one. Stays in the same waiting
  // queue; rolls follow_up_due forward by that queue's interval. No attempt cap.
  | { type: 'record-follow-up' }

export interface OutreachState {
  queue: OutreachQueue
  call_reason: CallReason | null
  research_reason: ResearchReason | null
  last_call_outcome: CallOutcome | null
  callback_date: string | null
  email_sent_at: string | null
  follow_up_due: string | null
  form_received_at: string | null
  submitted_at: string | null
  carrier_correction: string | null
  // Chosen authorization-form delivery channel; null until the worker picks one.
  form_delivery_method: FormDeliveryMethod | null
  // When set, the customer explicitly declined further outreach. The item is
  // suppressed from actionable/resurfacing reads until an explicit reopen clears
  // it. Human-recorded, reversible; never an automatic lost/closed state.
  refused_at: string | null
  /**
   * Whether the customer currently has a usable phone. Not stored on the
   * outreach row (contact facts live on customers); supplied by the caller so
   * email-bounce routing is deterministic: bounce + phone -> Ready to Call,
   * bounce + no phone -> Research Needed.
   */
  has_usable_phone: boolean
}

export type OutreachPatch = Partial<OutreachState>

/** The result of applying an action: the outreach patch plus optional side effects. */
export interface TransitionResult {
  patch: OutreachPatch
  /**
   * When set, this ONE request policy should move to sa_status = 'confirmed'.
   * Carrier confirmation is per policy; the route confirms exactly this policy
   * and never touches the others. Whether the outreach then ends is decided by
   * the route after re-reading every request policy's status — not here, because
   * the pure transition cannot see the other policies' current statuses.
   */
  confirmPolicyId?: string
  error?: string
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/**
 * The derived call ACTION POPULATION an open item belongs to, if any. This is
 * the single shared definition both My Work (counting the population) and the
 * board route (opening it) use, so the counted set and the opened set are always
 * identical (Rule 1). Callability is independent of the stored queue: a customer
 * with a usable phone is callable even while sitting in Ready to Email awaiting a
 * reply, so they belong to the call population too.
 *
 *   - 'calls-due'          callable AND a scheduled call has arrived: a promised
 *                          callback due today, or an automatic cadence retry
 *                          that came due (the item was promoted from
 *                          waiting-for-response to Ready to Call, which durably
 *                          stamps call_reason = 'no-response'). Due status is
 *                          read from DURABLE row state (call_reason + a due
 *                          callback_date), so it survives repeated reads,
 *                          refreshes, and the queue transition until the
 *                          scheduled call is actually handled.
 *   - 'available-to-call'  callable and actionable now, not on a scheduled due
 *                          date (Ready to Call without a due marker, or a
 *                          callable Ready to Email item).
 *   - null                 not a call opportunity (no usable phone, or a
 *                          non-actionable / research / waiting-not-due state).
 */
export type CallPopulation = 'calls-due' | 'available-to-call'

export function callPopulationOf(input: {
  /** Effective queue after follow-up promotion (deriveFollowUpRouting applied). */
  effectiveQueue: OutreachQueue
  /**
   * The item's durable call_reason. A cadence retry that came due is persisted
   * as 'no-response' by the follow-up promotion (deriveFollowUpRouting only
   * stamps it once follow_up_due has lapsed), so 'no-response' is a durable
   * fact that the retry IS due now. A promised callback is persisted as
   * 'callback-due' the MOMENT it is scheduled, with its due date in the future,
   * so 'callback-due' records only that a callback is promised — NOT that it is
   * due now. Whether that callback has actually come due is carried separately
   * by `callbackDue` (date on/before today on the actor's calendar).
   */
  callReason: CallReason | null
  /** Whether the customer has a usable phone (callable at all). */
  hasUsablePhone: boolean
  /** Whether a promised callback is due today (actor calendar; caller decides). */
  callbackDue: boolean
}): CallPopulation | null {
  if (!input.hasUsablePhone) return null
  const callable = input.effectiveQueue === 'ready-to-call' || input.effectiveQueue === 'ready-to-email'
  if (!callable) return null
  // A scheduled call has come due when, in the call flow, EITHER a promised
  // callback has reached its scheduled date (callbackDue), OR the row durably
  // carries a cadence retry that already lapsed ('no-response', stamped by the
  // follow-up promotion only once overdue). A 'callback-due' reason is NOT an
  // independent due signal: it is set when the callback is scheduled (future
  // date), so a future promised callback stays Available to Call until its date
  // arrives, at which point `callbackDue` turns it to Calls Due. Both remaining
  // triggers are durable until the call is handled, so Calls Due does not flip
  // back to Available on a later read.
  const due =
    input.effectiveQueue === 'ready-to-call' &&
    (input.callbackDue || input.callReason === 'no-response')
  return due ? 'calls-due' : 'available-to-call'
}

/**
 * Normalize a date-only (YYYY-MM-DD) cadence date to a storable ISO instant for
 * follow_up_due. The board/My Work/Daily Direction reads compare follow_up_due
 * as a date, so a start-of-day UTC instant preserves the intended due DATE. A
 * value that is already a full ISO instant is passed through unchanged. The
 * cadence computes the date on the actor's calendar; this only widens it to the
 * timestamptz column's type without inventing a clock time.
 */
function dateOnlyToIso(dateOnly: string): string {
  const trimmed = dateOnly.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`
  return trimmed
}

/**
 * The outreach patch for one CALL outcome, independent of the stored queue. This
 * is the single place the call-outcome -> workflow transition lives, so both the
 * queue-gated `call-outcome` action and the queue-independent `record-attempt`
 * action produce identical workflow progress for the same outcome. The caller
 * decides whether a queue gate applies; this only maps outcome -> patch.
 */
function callOutcomePatch(
  outcome: CallOutcome,
  opts: { callback_date?: string | null; next_call_date?: string | null },
): OutreachPatch {
  switch (outcome) {
    case 'reached':
      // Reached: stay in the call flow until the form is sent (next action).
      return { last_call_outcome: 'reached' }
    case 'bad-number':
      return {
        last_call_outcome: 'bad-number',
        queue: 'research-needed',
        research_reason: 'bad-number',
        call_reason: null,
      }
    case 'callback':
      return {
        last_call_outcome: 'callback',
        callback_date: opts.callback_date ?? null,
        queue: 'ready-to-call',
        call_reason: 'callback-due',
      }
    case 'voicemail':
      // Left a voicemail: schedule the NEXT attempt per the escalating cadence
      // and WAIT until it is due. Resurfaces to Ready to Call (no-response) via
      // deriveFollowUpRouting once the scheduled date arrives. No attempt limit;
      // nothing auto-closes.
      return {
        last_call_outcome: 'voicemail',
        queue: 'waiting-for-response',
        call_reason: null,
        research_reason: null,
        follow_up_due: opts.next_call_date
          ? dateOnlyToIso(opts.next_call_date)
          : addDays(new Date().toISOString(), FOLLOW_UP_INTERVAL_DAYS),
      }
    case 'not-interested':
      // Explicit refusal: STOP further outreach (reversible via reopen). Not an
      // automatic lost/closed state.
      return {
        last_call_outcome: 'not-interested',
        refused_at: new Date().toISOString(),
        follow_up_due: null,
        call_reason: null,
      }
  }
}

/**
 * The queues from which a call outcome drives the pre-authorization call-flow
 * transition. In every OTHER queue a call is a CHASE on the current stage (e.g.
 * calling to chase the signed form while awaiting it, or the carrier), so it
 * must preserve the stage and never move the customer backward.
 */
const CALL_FLOW_QUEUES: readonly OutreachQueue[] = ['ready-to-call', 'waiting-for-response', 'ready-to-email']

/**
 * Apply a call outcome WITHOUT ever moving the customer backward through
 * authorization or carrier servicing. In the pre-authorization call flow
 * (ready-to-call / waiting-for-response / ready-to-email) the outcome drives the
 * normal call-flow transition. In an authorization/carrier waiting stage
 * (waiting-for-form / waiting-for-carrier) a call is a chase: it records
 * last_call_outcome for history but leaves the stage and its scheduled chase
 * untouched. 'not-interested' is the single exception that always applies, since
 * an explicit refusal stops outreach from any stage (reversible via reopen).
 */
function callOutcomeInStage(
  state: OutreachState,
  outcome: CallOutcome,
  opts: { callback_date?: string | null; next_call_date?: string | null },
): OutreachPatch {
  if (CALL_FLOW_QUEUES.includes(state.queue) || outcome === 'not-interested') {
    return callOutcomePatch(outcome, opts)
  }
  // Authorization / carrier stage (or any non-call-flow waiting state): record
  // the call outcome only; never change the queue or the stage's schedule.
  return { last_call_outcome: outcome }
}

/**
 * Deterministic derived routing for overdue waiting-for-response items.
 *
 * When the follow-up window has lapsed with no response, the item should be in
 * Ready to Call (reason: no-response). This is derived from follow_up_due vs
 * now, so overdue work surfaces in the right queue without manual housekeeping.
 * Returns a patch to apply, or null when nothing is overdue.
 *
 * A REFUSED item is never resurfaced: an explicit refusal stops outreach until
 * a deliberate reopen.
 */
export function deriveFollowUpRouting(
  state: Pick<OutreachState, 'queue' | 'follow_up_due'> & { refused_at?: string | null },
  now: Date = new Date(),
): OutreachPatch | null {
  if (state.refused_at) return null
  if (state.queue !== 'waiting-for-response') return null
  if (!state.follow_up_due) return null
  if (new Date(state.follow_up_due).getTime() > now.getTime()) return null
  return { queue: 'ready-to-call', call_reason: 'no-response' }
}

/**
 * Deterministic derived routing for an item whose email became usable AFTER
 * intake.
 *
 * The stored `queue` records the recommended FIRST action chosen at intake from
 * the contact facts known then (initialQueue): email when an email was on file,
 * else a call, else research. But contact facts change — Contact Review and
 * later imports fill in a customer's email after the item was already created.
 * When that happens, the recommended opening action for an item that has NOT
 * yet started its workflow should become the introductory email (it carries the
 * authorization form), exactly as it would have at intake had the email been
 * present. Reads re-derive this live from the current email, the same way the
 * call population derives callability live from the current phone, so a
 * newly-added email surfaces in Ready to Email without a stored-queue backfill.
 *
 * This ONLY upgrades an UNTOUCHED opening item:
 *   - stored queue is the opening `ready-to-call` (reason no-email) or
 *     `research-needed` (reason no-contact) — the two states intake assigns when
 *     no email was on file;
 *   - no workflow activity has occurred (no email_sent_at, no last_call_outcome,
 *     no promised callback_date);
 *   - not refused.
 * An item that has advanced (a call was placed, a voicemail left and now
 * waiting, the form sent, a callback promised, a bad number sent to research)
 * is NEVER rerouted — its stage reflects real work and the new email simply
 * becomes an additional usable channel on the live board, not a reset to the
 * top of the funnel. Returns the effective-queue patch, or null when nothing
 * changes.
 */
export function deriveEmailRouting(
  state: Pick<
    OutreachState,
    'queue' | 'call_reason' | 'research_reason' | 'last_call_outcome' | 'email_sent_at' | 'callback_date'
  > & { refused_at?: string | null; has_usable_email: boolean },
): OutreachPatch | null {
  if (!state.has_usable_email) return null
  if (state.refused_at) return null
  // Already emailable: nothing to upgrade.
  if (state.queue === 'ready-to-email') return null
  // Only the two OPENING states intake assigns when no email was on file.
  const isOpeningCall = state.queue === 'ready-to-call' && state.call_reason === 'no-email'
  const isOpeningResearch = state.queue === 'research-needed' && state.research_reason === 'no-contact'
  if (!isOpeningCall && !isOpeningResearch) return null
  // Untouched: no workflow activity has happened yet.
  if (state.last_call_outcome != null) return null
  if (state.email_sent_at != null) return null
  if (state.callback_date != null) return null
  return { queue: 'ready-to-email', call_reason: null, research_reason: null }
}

/**
 * Whether a WAITING item (awaiting the signed form or awaiting carrier
 * confirmation) is due for a follow-up chase. Unlike deriveFollowUpRouting this
 * does NOT change the queue — those items are legitimately waiting on the
 * customer or carrier — it only reports that the follow-up window has lapsed so
 * the item resurfaces for a nudge. A refused item is never due.
 */
export function isWaitingFollowUpDue(
  state: Pick<OutreachState, 'queue' | 'follow_up_due'> & { refused_at?: string | null },
  now: Date = new Date(),
): boolean {
  if (state.refused_at) return false
  if (state.queue !== 'waiting-for-form' && state.queue !== 'waiting-for-carrier') return false
  if (!state.follow_up_due) return false
  return new Date(state.follow_up_due).getTime() <= now.getTime()
}

/** The follow-up interval (days) for a given waiting queue. */
export function waitingFollowUpDays(queue: OutreachQueue): number {
  return queue === 'waiting-for-carrier' ? AWAITING_CARRIER_FOLLOW_UP_DAYS : AWAITING_SIGNATURE_FOLLOW_UP_DAYS
}

/**
 * Pure transition function. Given the current state and an action, return the
 * patch to persist. Invalid actions for the current queue return an error so
 * the API can reject them rather than silently corrupting state.
 */
export function applyAction(state: OutreachState, action: OutreachAction): TransitionResult {
  switch (action.type) {
    case 'email-sent': {
      if (state.queue !== 'ready-to-email' && state.queue !== 'waiting-for-response') {
        return { patch: {}, error: `Cannot send email from ${state.queue}` }
      }
      const now = new Date().toISOString()
      return {
        patch: {
          queue: 'waiting-for-response',
          email_sent_at: now,
          // After the introductory email the first CALL is due per the cadence
          // (24h for the first attempt). The route supplies that cadence date as
          // next_call_date; when it lapses with no response the reads promote the
          // item to Ready to Call (no-response) via deriveFollowUpRouting. A
          // legacy caller with no date falls back to the fixed initial-email
          // follow-up window.
          follow_up_due: action.next_call_date
            ? dateOnlyToIso(action.next_call_date)
            : addDays(now, action.follow_up_days ?? INITIAL_EMAIL_FOLLOW_UP_DAYS),
          call_reason: null,
          research_reason: null,
        },
      }
    }

    case 'email-bounced': {
      if (state.queue !== 'ready-to-email' && state.queue !== 'waiting-for-response') {
        return { patch: {}, error: `Cannot record a bounce from ${state.queue}` }
      }
      // Settled routing: bounce + usable phone -> Ready to Call (email bounced);
      // bounce + no usable phone -> Research Needed.
      if (state.has_usable_phone) {
        return {
          patch: {
            queue: 'ready-to-call',
            call_reason: 'email-bounced',
            research_reason: null,
          },
        }
      }
      return {
        patch: {
          queue: 'research-needed',
          research_reason: 'bounce-no-phone',
          call_reason: null,
        },
      }
    }

    case 'call-outcome': {
      // A call is an available action whenever the item is in the call flow OR
      // is a callable customer sitting in another queue (e.g. Ready to Email):
      // the stored queue is the RECOMMENDED next step, not a lock on which
      // channel the employee may use. The route gates on actual callability
      // (a usable phone), not on the stored queue.
      //
      // CRITICAL: a contact attempt must NEVER move a customer BACKWARD through
      // authorization or carrier servicing. While the item is awaiting the
      // signed form or carrier confirmation, a call is a CHASE on that same
      // stage: it records history but does not change the queue (handled below
      // via callOutcomeInStage). Only in the pre-authorization call flow does a
      // call outcome drive the call-flow transition.
      return { patch: callOutcomeInStage(state, action.outcome, {
        callback_date: action.callback_date,
        next_call_date: action.next_call_date,
      }) }
    }

    case 'record-attempt': {
      // ONE coordinated multi-channel attempt (IPF record_outreach_grouping
      // adapted). The CALL channel's outcome (when present) drives the workflow
      // transition exactly like call-outcome; the other channels are recorded as
      // touches by the route and never change the workflow here. The employee
      // records the activity ONCE.
      //
      // Backward-movement guard: in the authorization/carrier waiting stages a
      // recorded attempt is a chase that NEVER changes the stage (see
      // callOutcomeInStage and the no-call branch below).
      if (action.call) {
        return { patch: callOutcomeInStage(state, action.call, {
          callback_date: action.callback_date,
          next_call_date: action.next_call_date,
        }) }
      }
      // No call channel. An EMAIL sent from Ready to Email is the introductory
      // authorization email: it advances the workflow out of the intro-email
      // population (so the introduction is never recommended again) and starts
      // the call cadence, exactly like the dedicated email-sent action. The
      // route stamps email_sent_at; here we move to the waiting state and set
      // the first scheduled call.
      const sentEmailFromIntro =
        state.queue === 'ready-to-email' && action.email === 'touch'
      if (sentEmailFromIntro) {
        return {
          patch: {
            queue: 'waiting-for-response',
            email_sent_at: new Date().toISOString(),
            follow_up_due: action.next_call_date
              ? dateOnlyToIso(action.next_call_date)
              : addDays(new Date().toISOString(), INITIAL_EMAIL_FOLLOW_UP_DAYS),
            call_reason: null,
            research_reason: null,
          },
        }
      }
      // Otherwise a record-only attempt. A scheduled next call keeps the cadence
      // moving ONLY while the item is in the pre-authorization call flow
      // (ready-to-call / waiting-for-response). In every other state, including
      // the authorization/carrier waiting stages, the touches are the progress
      // and the stage is preserved.
      if (action.next_call_date && (state.queue === 'ready-to-call' || state.queue === 'waiting-for-response')) {
        return {
          patch: {
            queue: 'waiting-for-response',
            follow_up_due: dateOnlyToIso(action.next_call_date),
            call_reason: null,
            research_reason: null,
          },
        }
      }
      return { patch: {} }
    }

    case 'form-sent': {
      // Sending the servicing-agent form (from a reached call or from email).
      // Entering waiting-for-form schedules a follow-up nudge to chase the
      // signature (does not change the queue when due; isWaitingFollowUpDue).
      // Allowed from the whole pre-authorization call flow: Ready to Call and
      // the waiting-for-response window as before, AND Ready to Email — so a
      // worker who CALLS FIRST and reaches the customer can proceed directly to
      // authorization without being forced back through the email step.
      if (
        state.queue !== 'ready-to-call' &&
        state.queue !== 'waiting-for-response' &&
        state.queue !== 'ready-to-email'
      ) {
        return { patch: {}, error: `Cannot send the form from ${state.queue}` }
      }
      return {
        patch: {
          queue: 'waiting-for-form',
          follow_up_due: addDays(new Date().toISOString(), AWAITING_SIGNATURE_FOLLOW_UP_DAYS),
          call_reason: null,
        },
      }
    }

    case 'form-returned': {
      // The signed form came back on its own after the introductory email (which
      // already carried the form). Advance to waiting-for-form and record the
      // RECEIPT directly — WITHOUT recording a second mailing/send. The route
      // logs no form-sent touch for this transition; it records receipt only.
      if (state.queue !== 'waiting-for-response') {
        return { patch: {}, error: `Can only record a returned form while awaiting a reply (from ${state.queue})` }
      }
      return {
        patch: {
          queue: 'waiting-for-form',
          form_received_at: new Date().toISOString(),
          follow_up_due: addDays(new Date().toISOString(), AWAITING_SIGNATURE_FOLLOW_UP_DAYS),
          call_reason: null,
        },
      }
    }

    case 'research-found': {
      if (state.queue !== 'research-needed') {
        return { patch: {}, error: `Cannot record research from ${state.queue}` }
      }
      if (action.found === 'email') {
        return { patch: { queue: 'ready-to-email', research_reason: null, call_reason: null } }
      }
      if (action.found === 'phone') {
        return { patch: { queue: 'ready-to-call', research_reason: null, call_reason: 'no-email' } }
      }
      // nothing usable: stay put. No auto-close.
      return { patch: {} }
    }

    case 'form-received': {
      if (state.queue !== 'waiting-for-form') {
        return { patch: {}, error: `Cannot record form receipt from ${state.queue}` }
      }
      // Step 1 of the two-step form flow: record that the signed form came back.
      // Stays in waiting-for-form; the worker then confirms policies + signer(s)
      // before Submit to carrier becomes available.
      return { patch: { form_received_at: new Date().toISOString() } }
    }

    case 'submit-to-carrier': {
      if (state.queue !== 'waiting-for-form') {
        return { patch: {}, error: `Cannot submit to carrier from ${state.queue}` }
      }
      // Step 2: submission only after the signed form has been recorded received.
      if (!state.form_received_at) {
        return { patch: {}, error: 'Record the signed form as received before submitting to the carrier' }
      }
      return {
        patch: {
          queue: 'waiting-for-carrier',
          submitted_at: new Date().toISOString(),
          carrier_correction: null,
          // Schedule a chase on the carrier if confirmation does not come back.
          follow_up_due: addDays(new Date().toISOString(), AWAITING_CARRIER_FOLLOW_UP_DAYS),
        },
      }
    }

    case 'carrier-correction': {
      if (state.queue !== 'waiting-for-carrier') {
        return { patch: {}, error: `Cannot record a carrier correction from ${state.queue}` }
      }
      // Correction is actionable work WITHIN the stage, not a new queue.
      return { patch: { carrier_correction: action.note } }
    }

    case 'carrier-confirmed': {
      if (state.queue !== 'waiting-for-carrier') {
        return { patch: {}, error: `Cannot confirm the carrier from ${state.queue}` }
      }
      if (!action.policy_id) {
        return { patch: {}, error: 'A policy_id is required: carrier confirmation is recorded per policy' }
      }
      // Confirm servicing access for THIS one policy. Clear any standing
      // correction note (a confirmation resolves it). The item stays in
      // waiting-for-carrier and remains actionable; the route ends outreach only
      // once every request policy is confirmed. Confirmation does NOT create a
      // review. No automatic close.
      return {
        patch: { carrier_correction: null },
        confirmPolicyId: action.policy_id,
      }
    }

    case 'verify-contact': {
      // Record (or clear) the customer's confirmation that one contact value is
      // correct. Allowed from any queue — verification is customer-record
      // hygiene that can happen whenever the worker is in contact — and it never
      // changes the queue. The verification timestamp is DURABLE customer-record
      // truth, so it is persisted on the CUSTOMER by the route (a side effect,
      // like research-found), NOT on the temporary outreach row. The pure
      // transition therefore validates the field and returns no outreach patch.
      if (action.field !== 'phone' && action.field !== 'email' && action.field !== 'address') {
        return { patch: {}, error: `Unknown contact field: ${String((action as { field?: unknown }).field)}` }
      }
      return { patch: {} }
    }

    case 'set-delivery-method': {
      if (action.method !== 'email' && action.method !== 'postal') {
        return { patch: {}, error: `Unknown delivery method: ${String((action as { method?: unknown }).method)}` }
      }
      // Operator records the chosen delivery channel. Does not change the queue.
      return { patch: { form_delivery_method: action.method } }
    }

    case 'reopen': {
      // Deliberate reversal of an explicit refusal. Clear refused_at so the item
      // becomes actionable again. Only meaningful when currently refused.
      if (!state.refused_at) {
        return { patch: {}, error: 'This item is not refused.' }
      }
      // Return it to active outreach: clear the refusal and the stale outcome,
      // and give it a fresh next-attempt date so it resurfaces as actionable.
      return {
        patch: {
          refused_at: null,
          last_call_outcome: null,
          follow_up_due: null,
        },
      }
    }

    case 'record-follow-up': {
      // A chase on a waiting item: the worker followed up on the outstanding
      // signature (waiting-for-form) or carrier confirmation (waiting-for-carrier)
      // and it is still unresolved, so schedule the NEXT follow-up. Stays in the
      // same waiting queue (nothing is resolved yet); only the next-chase date
      // moves forward, by that queue's interval. No attempt limit; nothing
      // auto-closes. The route logs the chase as a touch.
      if (state.queue !== 'waiting-for-form' && state.queue !== 'waiting-for-carrier') {
        return { patch: {}, error: `Cannot record a follow-up from ${state.queue}` }
      }
      return {
        patch: {
          follow_up_due: addDays(new Date().toISOString(), waitingFollowUpDays(state.queue)),
        },
      }
    }
  }
}

/**
 * Whether an outreach item may be CLAIMED by an employee.
 *
 * Claiming records that an employee has SPOKEN WITH the customer and accepted
 * responsibility for personal follow-up — it is not a lease on open shared
 * work, and routine outreach never creates ownership. The settled rule
 * (Angie/Dulce):
 *   - a decided item is no longer claimable (it is not open work),
 *   - sending an email, an unanswered call, or a voicemail does NOT claim,
 *   - a claim is warranted once the customer has been REACHED — the two
 *     outcomes that mean "spoke with the customer" are 'reached' and 'callback'
 *     (a callback is a reach that additionally produced a promised time).
 * A scheduled callback is explicitly NOT required: reaching the customer is
 * itself the moment of ownership. A reached customer may sit in an
 * authorization/carrier WAITING stage (e.g. the form has been sent), which is a
 * legitimate point to hold a personal commitment, so the stored queue never
 * bars a claim; only being decided does.
 *
 * This is the pure predicate behind POST /api/stewardship/claim (capability and
 * project-scope checks are layered on top in the route).
 */
export function canClaimOutreach(input: {
  decision: string | null
  lastCallOutcome: CallOutcome | null
}): boolean {
  if (input.decision != null) return false
  return input.lastCallOutcome === 'reached' || input.lastCallOutcome === 'callback'
}
