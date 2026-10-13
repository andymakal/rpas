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
  | { type: 'email-sent'; follow_up_days?: number }
  | { type: 'email-bounced' }        // emailed outreach bounced
  | { type: 'call-outcome'; outcome: CallOutcome; callback_date?: string | null }
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
          // Two-day initial-email follow-up window. When it lapses with no
          // response, the board/My Work/Assistant reads route the item to Ready
          // to Call (no-response) via deriveFollowUpRouting — see below.
          follow_up_due: addDays(now, action.follow_up_days ?? INITIAL_EMAIL_FOLLOW_UP_DAYS),
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
      if (state.queue !== 'ready-to-call') {
        return { patch: {}, error: `Cannot record a call outcome from ${state.queue}` }
      }
      switch (action.outcome) {
        case 'reached':
          // Reached: stay in ready-to-call until the form is sent (next action).
          return { patch: { last_call_outcome: 'reached' } }
        case 'bad-number':
          return {
            patch: {
              last_call_outcome: 'bad-number',
              queue: 'research-needed',
              research_reason: 'bad-number',
              call_reason: null,
            },
          }
        case 'callback':
          return {
            patch: {
              last_call_outcome: 'callback',
              callback_date: action.callback_date ?? null,
              call_reason: 'callback-due',
            },
          }
        case 'voicemail':
          // Left a voicemail: auto-schedule the next attempt and WAIT until it
          // is due. The item moves to the waiting state with follow_up_due set,
          // so it does not re-appear as actionable immediately — it resurfaces
          // to Ready to Call (no-response) via deriveFollowUpRouting once the
          // window lapses, exactly like an unanswered email. There is NO attempt
          // limit and NO counter: each voicemail simply rolls the next attempt
          // forward. A human decides to stop; nothing auto-closes. (This is a
          // waiting state, not a promised callback — callback_date stays null;
          // only an explicit customer-promised callback sets callback_date.)
          return {
            patch: {
              last_call_outcome: 'voicemail',
              queue: 'waiting-for-response',
              call_reason: null,
              research_reason: null,
              follow_up_due: addDays(new Date().toISOString(), FOLLOW_UP_INTERVAL_DAYS),
            },
          }
        case 'not-interested':
          // Explicit refusal: STOP further outreach. refused_at suppresses the
          // item from actionable/resurfacing reads and clears any pending
          // follow-up so nothing re-queues it. This is a human-recorded
          // disposition, NOT an automatic lost/closed state — it is reversed by
          // an explicit reopen.
          return {
            patch: {
              last_call_outcome: 'not-interested',
              refused_at: new Date().toISOString(),
              follow_up_due: null,
              call_reason: null,
            },
          }
      }
      return { patch: {} }
    }

    case 'form-sent': {
      // Sending the servicing-agent form (from a reached call or from email).
      // Entering waiting-for-form schedules a follow-up nudge to chase the
      // signature (does not change the queue when due; isWaitingFollowUpDue).
      if (state.queue !== 'ready-to-call' && state.queue !== 'waiting-for-response') {
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
