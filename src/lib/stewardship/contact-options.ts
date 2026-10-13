/**
 * Contact-options decision for Servicing-Agent Onboarding (Right Path) —
 * server-only.
 *
 * The GoRules ZEN decision layer owns WHICH contact methods a customer qualifies
 * for; this module is the thin TypeScript boundary around it, following the same
 * pattern as the Daily Direction and My Work engines:
 *   - ZEN (src/rules/contact-options.json) decides the eligibility matrix over
 *     normalized booleans and NEVER queries the database.
 *   - TypeScript here gathers the facts from the real customer record and
 *     normalizes ZEN's collected rows into one resolved set of options.
 *
 * Settled business rules this surfaces (ZEN encodes them; TS only normalizes):
 *   - Calling, emailing, and texting are INDEPENDENT and SIMULTANEOUS: a usable
 *     phone enables both calling and texting; a usable email enables emailing;
 *     none of them competes with the others.
 *   - A customer with NO usable contact method needs Contact Research.
 *   - A mailing address alone enables neither call/email/text; it supports
 *     postal form delivery after contact is established, so it is reported as a
 *     separate fact (hasUsableAddress) but never substitutes for a channel.
 */

import { ZenEngine } from '@gorules/zen-engine'
import contactOptionsModel from '@/rules/contact-options.json'
import type { OutreachChannel } from './outreach-attempts'

let engine: ZenEngine | null = null

function getEngine(): ZenEngine {
  if (!engine) {
    engine = new ZenEngine({
      loader: {
        type: 'static',
        content: { 'contact-options.json': contactOptionsModel },
      },
    })
  }
  return engine
}

/** The raw contact values from a customer record, as stored. */
export interface CustomerContact {
  phone: string | null
  email: string | null
  /** Mailing-address components (both street conventions in this schema). */
  street?: string | null
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

/** The normalized presence facts handed to the ZEN contact-options decision. */
export interface ContactFacts {
  hasUsablePhone: boolean
  hasUsableEmail: boolean
  /** Not a ZEN input (address enables no channel); carried for postal delivery. */
  hasUsableAddress: boolean
}

/** The resolved contact options for a customer. */
export interface ContactOptions {
  canCall: boolean
  canText: boolean
  canEmail: boolean
  /** A mailing address usable for postal form delivery exists. */
  canPostal: boolean
  /** No usable contact method: the customer needs Contact Research. */
  needsResearch: boolean
}

/**
 * Normalize a raw customer contact record into the presence facts. A value is
 * "usable" when it is present and non-blank; this layer does not re-validate
 * format (the contact-input standard owns that on write). A usable mailing
 * address requires at least a street line plus a city or zip, so a stray
 * fragment is not mistaken for a mailable address.
 */
export function toContactFacts(contact: CustomerContact): ContactFacts {
  const nonBlank = (v: string | null | undefined): boolean => !!v && v.trim().length > 0
  const hasStreet = nonBlank(contact.street) || nonBlank(contact.address_line1)
  const hasCityOrZip = nonBlank(contact.city) || nonBlank(contact.zip)
  return {
    hasUsablePhone: nonBlank(contact.phone),
    hasUsableEmail: nonBlank(contact.email),
    hasUsableAddress: hasStreet && hasCityOrZip,
  }
}

type CollectedRow = Partial<Record<'canCall' | 'canText' | 'canEmail' | 'needsResearch', boolean>>

/**
 * Evaluate the ZEN contact-options decision for the given facts and fold the
 * collected rows into one resolved set. The ZEN model uses the 'collect' hit
 * policy, so it returns an array of matched outputs (phone contributes
 * call+text, email contributes email, neither contributes research); this
 * merges them. canPostal is derived from the address fact in TypeScript because
 * address enables no customer-contact CHANNEL (it is not a ZEN channel output),
 * only postal form delivery.
 */
export async function evaluateContactOptions(
  facts: ContactFacts,
  options?: { unusableChannels?: readonly OutreachChannel[] },
): Promise<ContactOptions> {
  const zen = getEngine()
  const response = await zen.evaluate('contact-options.json', {
    hasUsablePhone: facts.hasUsablePhone,
    hasUsableEmail: facts.hasUsableEmail,
  })
  const rows = (Array.isArray(response.result) ? response.result : [response.result]) as CollectedRow[]
  const any = (key: keyof CollectedRow): boolean => rows.some((r) => r[key] === true)

  // Base eligibility from the real contact facts (ZEN). Then subtract any
  // channel recorded UNUSABLE in the attempt history: a channel that cannot
  // deliver (wrong/disconnected number, bouncing text/email) should not be
  // offered as an available action. This reuses the IPF usability FACT —
  // recorded, never inferred — as a presentation subtraction, without importing
  // the IPF early-rewarm recommendation. A phone marked unusable removes BOTH
  // calling and texting (both ride the same number); a text-channel unusable
  // removes only texting; an email unusable removes emailing.
  const unusable = new Set(options?.unusableChannels ?? [])
  const phoneUnusable = unusable.has('call') || unusable.has('voicemail')
  const canCall = any('canCall') && !phoneUnusable
  const canText = any('canText') && !phoneUnusable && !unusable.has('text')
  const canEmail = any('canEmail') && !unusable.has('email')
  const canPostal = facts.hasUsableAddress && !unusable.has('postal')

  // Research is needed when no usable contact CHANNEL remains — either because
  // none was on file, or because every channel on file has been exhausted
  // (recorded unusable). Postal is form-delivery only, not a contact channel,
  // so it does not by itself keep an item out of research.
  const needsResearch = !canCall && !canText && !canEmail

  return { canCall, canText, canEmail, canPostal, needsResearch }
}

/** Convenience: resolve contact options straight from a raw customer record,
 * optionally subtracting channels recorded unusable in the attempt history. */
export async function resolveContactOptions(
  contact: CustomerContact,
  unusable?: readonly OutreachChannel[],
): Promise<ContactOptions> {
  return evaluateContactOptions(toContactFacts(contact), { unusableChannels: unusable })
}

/**
 * The initial outreach queue a brand-new onboarding item routes to, decided by
 * the ZEN-resolved contact options. One customer, one onboarding workflow: the
 * queue is the RECOMMENDED first action, while the customer simultaneously
 * qualifies for every channel the options report (the board/My Work surface all
 * applicable action queues from the same single workflow — see the composition).
 *
 * Routing of the recommended first action (settled): prefer the introductory
 * email when email is available (it carries the authorization form); otherwise
 * open with a call when a phone is available; otherwise Contact Research. This
 * reuses the existing queue keys unchanged — it does not invent a queue — and
 * replaces the old exclusive email-OR-phone-OR-research routing with the
 * ZEN-driven options so texting and calling are not mutually exclusive with
 * email.
 */
export function initialQueueFromOptions(options: ContactOptions): {
  queue: 'ready-to-email' | 'ready-to-call' | 'research-needed'
  call_reason: 'no-email' | null
  research_reason: 'no-contact' | null
} {
  if (options.canEmail) {
    return { queue: 'ready-to-email', call_reason: null, research_reason: null }
  }
  if (options.canCall) {
    return { queue: 'ready-to-call', call_reason: 'no-email', research_reason: null }
  }
  return { queue: 'research-needed', call_reason: null, research_reason: 'no-contact' }
}
