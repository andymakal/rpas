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
 *     access (service_policies.sa_status = 'confirmed') and moves the customer
 *     out of outreach toward documentation/readiness.
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
  | { type: 'call-outcome'; outcome: CallOutcome; callback_date?: string | null }
  | { type: 'form-sent' }            // after a reached call, the form is (re)sent
  | { type: 'research-found'; found: 'email' | 'phone' | 'nothing' }
  | { type: 'submit-to-carrier' }
  | { type: 'carrier-correction'; note: string }
  | { type: 'carrier-confirmed' }

export interface OutreachState {
  queue: OutreachQueue
  call_reason: CallReason | null
  research_reason: ResearchReason | null
  last_call_outcome: CallOutcome | null
  callback_date: string | null
  email_sent_at: string | null
  follow_up_due: string | null
  submitted_at: string | null
  carrier_correction: string | null
}

export type OutreachPatch = Partial<OutreachState>

/** The result of applying an action: the outreach patch plus optional side effects. */
export interface TransitionResult {
  patch: OutreachPatch
  /** When set, service_policies in the request should move to this sa_status. */
  saStatus?: 'confirmed'
  /** When true, carrier confirmation means outreach is complete (prereview advances). */
  completesOutreach?: boolean
  error?: string
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
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
          follow_up_due: addDays(now, action.follow_up_days ?? 7),
          call_reason: null,
          research_reason: null,
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
          return { patch: { last_call_outcome: 'voicemail' } }
        case 'not-interested':
          // Explicit human disposition. No further outreach, but NOT auto-closed.
          return { patch: { last_call_outcome: 'not-interested' } }
      }
      return { patch: {} }
    }

    case 'form-sent': {
      // Sending the servicing-agent form (from a reached call or from email).
      if (state.queue !== 'ready-to-call' && state.queue !== 'waiting-for-response') {
        return { patch: {}, error: `Cannot send the form from ${state.queue}` }
      }
      return { patch: { queue: 'waiting-for-form' } }
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

    case 'submit-to-carrier': {
      if (state.queue !== 'waiting-for-form') {
        return { patch: {}, error: `Cannot submit to carrier from ${state.queue}` }
      }
      return {
        patch: {
          queue: 'waiting-for-carrier',
          submitted_at: new Date().toISOString(),
          carrier_correction: null,
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
      // Carrier confirmation confirms servicing access and ends outreach. It
      // does NOT create a review. The customer moves toward documentation.
      return {
        patch: { carrier_correction: null },
        saStatus: 'confirmed',
        completesOutreach: true,
      }
    }
  }
}
