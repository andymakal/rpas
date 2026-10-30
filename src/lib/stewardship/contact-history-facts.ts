/**
 * Contact History Facts — the centralized, readable vocabulary for what a
 * customer-contact edit CHANGED, server-only.
 *
 * This is the one place that turns a before/after contact snapshot into the
 * concise, employee-facing facts Customer History reads ("Email added", "Phone
 * corrected", "Address verified", "Alert added: <text>", "Date of birth
 * added"). It follows the established GoRules division of labor used across
 * stewardship (see src/lib/daily-direction/engine.ts and
 * src/lib/stewardship/contact-options.ts):
 *
 *   - ZEN (src/rules/contact-history-facts.json) owns the CLASSIFICATION: given
 *     a normalized change shape (changeType + before/after presence), it decides
 *     the change KIND (added / corrected / cleared / verified / restriction set
 *     / alert added / ...) and the verb that names it. ZEN never queries the
 *     database and never sees a sensitive value.
 *   - TypeScript here owns NORMALIZATION and the operator-facing PROSE: it reads
 *     the snapshot, decides which facts actually changed (reusing the project's
 *     existing rules — an edited value clears its own verification, the
 *     automatic email "available" that rides a saved email is not a separate
 *     fact), feeds ZEN the shape, and composes the one short description per
 *     change plus the short label.
 *
 * Two deliberately separate layers, matching the task's requirement that
 * employee-facing history stay separate from technical audit detail:
 *   - This module produces the EMPLOYEE-FACING facts: a kind, a short label, and
 *     a concise description with NO prior->new values and (for DOB) no day ever.
 *   - The existing `buildContactUpdateHistoryNote` in customer-history.ts still
 *     produces the TECHNICAL AUDIT note (the prior->new sentences) that is
 *     stored for audit. The two are composed from the SAME change set so they
 *     never disagree, but they are not the same text.
 *
 * The facts here are assembled by the (future) Next History Entry into one
 * event with a workflow-supplied title; this module intentionally does NOT
 * assign a title or write anything. It only describes the facts.
 */

import { ZenEngine } from '@gorules/zen-engine'
import contactHistoryFactsModel from '@/rules/contact-history-facts.json'
import { maskApproxDobForHistory } from './dob'
import type { ContactSnapshot } from './customer-history'

// ---------------------------------------------------------------------------
// Engine singleton (static loader, same pattern as the other ZEN engines)
// ---------------------------------------------------------------------------

let engine: ZenEngine | null = null

function getEngine(): ZenEngine {
  if (!engine) {
    engine = new ZenEngine({
      loader: {
        type: 'static',
        content: { 'contact-history-facts.json': contactHistoryFactsModel },
      },
    })
  }
  return engine
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape of a single change handed to the ZEN classifier. No value is ever
 * sent to ZEN; only the SHAPE of the change. */
export interface ContactChangeFactInput {
  /** The kind of fact being classified, selecting the matching ZEN rows. */
  changeType:
    | 'value'
    | 'verified'
    | 'verification_cleared'
    | 'restriction_set'
    | 'restriction_cleared'
    | 'availability_changed'
    | 'alert'
  /** Whether the fact had a value/was present BEFORE (used for value + alert). */
  hadValue: boolean
  /** Whether the fact has a value/is present AFTER (used for value + alert). */
  hasValue: boolean
}

/** The ZEN verdict for one change: its employee-facing kind and verb. */
export interface ContactChangeKind {
  changeKind:
    | 'added'
    | 'corrected'
    | 'cleared'
    | 'verified'
    | 'verification_cleared'
    | 'restriction_set'
    | 'restriction_cleared'
    | 'availability_changed'
    | 'alert_added'
    | 'alert_updated'
    | 'alert_cleared'
  verb: string
}

/** One employee-facing history fact: the field it concerns, the classified
 * kind, a short label for a combined summary, and the one concise description
 * sentence (no prior/new values; DOB never carries a day). */
export interface ContactHistoryFact {
  /** Stable ordering so facts read in the same order every time. */
  order: number
  /** The field/subject, e.g. "Email", "Phone", "Date of birth", "Alert". */
  field: string
  changeKind: ContactChangeKind['changeKind']
  /** Short label for a combined preview summary, e.g. "email added". */
  label: string
  /** The one concise employee-facing sentence, e.g. "Email added." or
   * "Alert added: Spouse handles all calls." */
  description: string
}

// ---------------------------------------------------------------------------
// ZEN evaluation
// ---------------------------------------------------------------------------

/** Classify one change shape via the ZEN decision. Exposed so tests can drive
 * the rows directly. */
export async function classifyContactChange(
  input: ContactChangeFactInput,
): Promise<ContactChangeKind> {
  const zen = getEngine()
  const response = await zen.evaluate('contact-history-facts.json', input)
  return {
    changeKind: response.result.changeKind as ContactChangeKind['changeKind'],
    verb: response.result.verb as string,
  }
}

// ---------------------------------------------------------------------------
// Normalization + prose (TypeScript, no IO beyond the ZEN call)
// ---------------------------------------------------------------------------

/** Collapse whitespace and trim; empty becomes null. */
function trimOrNull(v: string | null): string | null {
  if (v == null) return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t.length ? t : null
}

/** The displayed full name, or "(none)". */
function fullNameOf(s: Pick<ContactSnapshot, 'first_name' | 'last_name'>): string {
  const n = `${trimOrNull(s.first_name) ?? ''} ${trimOrNull(s.last_name) ?? ''}`.trim()
  return n || '(none)'
}

/** Whether a usable mailing address is present (any address part present). */
function addressPresent(s: ContactSnapshot): boolean {
  return !!(trimOrNull(s.street) || trimOrNull(s.city) || trimOrNull(s.state) || trimOrNull(s.zip))
}

/** Human label for an email-availability value in the fact prose. */
const EMAIL_AVAILABILITY_PROSE: Record<string, string> = {
  available: 'on file',
  no_address: 'No Usable Email',
  undeliverable: 'Undeliverable',
}

/** A unit of change to classify, carrying everything the prose needs that ZEN
 * does not see (the field label, the order, and any text to append). */
interface PendingChange {
  order: number
  field: string
  input: ContactChangeFactInput
  /** Optional trailing text appended to an alert description ("...: <text>"). */
  alertText?: string | null
}

/**
 * Compose the one concise, employee-facing description for a classified change.
 * No prior/new values appear (that is the technical audit note's job); the one
 * exception is the customer alert, whose actual text IS the employee-facing
 * fact the operator needs to see ("Alert added: <text>"). Email availability
 * names the resulting state in plain words, not an internal code.
 */
function describeFact(
  field: string,
  kind: ContactChangeKind['changeKind'],
  alertText?: string | null,
  availabilityLabel?: string | null,
): string {
  switch (kind) {
    case 'added':
      return `${field} added.`
    case 'corrected':
      return `${field} corrected.`
    case 'cleared':
      return `${field} cleared.`
    case 'verified':
      return `${field} verified.`
    case 'verification_cleared':
      return `${field} verification cleared.`
    case 'restriction_set':
      return `${field} set.`
    case 'restriction_cleared':
      return `${field} cleared.`
    case 'availability_changed':
      return `Email availability changed to ${availabilityLabel ?? 'unknown'}.`
    case 'alert_added':
      return `Alert added: ${alertText ?? ''}`.trimEnd()
    case 'alert_updated':
      return `Alert updated: ${alertText ?? ''}`.trimEnd()
    case 'alert_cleared':
      return 'Alert cleared.'
    default:
      return `${field} changed.`
  }
}

/** A short combined-summary label for a classified change. */
function labelFor(field: string, kind: ContactChangeKind['changeKind']): string {
  const lower = field.toLowerCase()
  switch (kind) {
    case 'added': return `${lower} added`
    case 'corrected': return `${lower} corrected`
    case 'cleared': return `${lower} cleared`
    case 'verified': return `${lower} verified`
    case 'verification_cleared': return `${lower} verification cleared`
    case 'restriction_set': return `${lower} set`
    case 'restriction_cleared': return `${lower} cleared`
    case 'availability_changed': return 'email availability changed'
    case 'alert_added': return 'alert added'
    case 'alert_updated': return 'alert updated'
    case 'alert_cleared': return 'alert cleared'
    default: return lower
  }
}

/**
 * Build the centralized, employee-facing history facts for a unified contact
 * edit: one concise fact per thing that actually changed, classified by ZEN and
 * phrased here. Returns an empty array when nothing changed. This mirrors the
 * existing diff decisions in customer-history.ts so the facts and the stored
 * audit note always describe the same change set, while keeping the two
 * phrasings separate (facts carry no prior/new values; DOB carries no day).
 *
 * The facts are intended to be assembled by Next History Entry into one event
 * (the workflow supplies the title); this function assigns no title.
 */
export async function buildContactHistoryFacts(
  before: ContactSnapshot,
  after: ContactSnapshot,
): Promise<ContactHistoryFact[]> {
  const pending: PendingChange[] = []

  // Name (first/last together).
  const nameChanged =
    (trimOrNull(before.first_name) ?? null) !== (trimOrNull(after.first_name) ?? null) ||
    (trimOrNull(before.last_name) ?? null) !== (trimOrNull(after.last_name) ?? null)
  if (nameChanged) {
    pending.push({
      order: 0,
      field: 'Name',
      input: { changeType: 'value', hadValue: fullNameOf(before) !== '(none)', hasValue: fullNameOf(after) !== '(none)' },
    })
  }

  // Date of birth — compared MASKED (no day). Exact and partial are mutually
  // exclusive in storage, so the masked form is the DOB's stable identity.
  const beforeDob = maskApproxDobForHistory(before.date_of_birth, before.date_of_birth_approx)
  const afterDob = maskApproxDobForHistory(after.date_of_birth, after.date_of_birth_approx)
  if (beforeDob !== afterDob) {
    pending.push({
      order: 0.5,
      field: 'Date of birth',
      input: { changeType: 'value', hadValue: beforeDob !== '(none)', hasValue: afterDob !== '(none)' },
    })
  }

  // Email value.
  const emailChanged = (trimOrNull(before.email) ?? null) !== (trimOrNull(after.email) ?? null)
  if (emailChanged) {
    pending.push({
      order: 1,
      field: 'Email',
      input: { changeType: 'value', hadValue: !!trimOrNull(before.email), hasValue: !!trimOrNull(after.email) },
    })
  }

  // Email availability — skip the purely-automatic transition to "available"
  // that always rides a saved usable email (the value change already conveys it).
  if ((before.email_availability ?? null) !== (after.email_availability ?? null)) {
    const automaticAvailable = after.email_availability === 'available' && emailChanged
    if (!automaticAvailable) {
      pending.push({
        order: 2,
        field: 'Email availability',
        input: { changeType: 'availability_changed', hadValue: true, hasValue: true },
        alertText: after.email_availability ? EMAIL_AVAILABILITY_PROSE[after.email_availability] : 'unknown',
      })
    }
  }

  // Phone value.
  if ((trimOrNull(before.phone) ?? null) !== (trimOrNull(after.phone) ?? null)) {
    pending.push({
      order: 3,
      field: 'Phone',
      input: { changeType: 'value', hadValue: !!trimOrNull(before.phone), hasValue: !!trimOrNull(after.phone) },
    })
  }

  // Do Not Text.
  if (before.sms_opt_out !== after.sms_opt_out) {
    pending.push({
      order: 4,
      field: 'Do Not Text',
      input: { changeType: after.sms_opt_out ? 'restriction_set' : 'restriction_cleared', hadValue: before.sms_opt_out, hasValue: after.sms_opt_out },
    })
  }

  // Text Undeliverable.
  if (before.text_undeliverable !== after.text_undeliverable) {
    pending.push({
      order: 5,
      field: 'Text Undeliverable',
      input: { changeType: after.text_undeliverable ? 'restriction_set' : 'restriction_cleared', hadValue: before.text_undeliverable, hasValue: after.text_undeliverable },
    })
  }

  // Mailing address (as one group).
  const addrChanged =
    (trimOrNull(before.street) ?? null) !== (trimOrNull(after.street) ?? null) ||
    (trimOrNull(before.city) ?? null) !== (trimOrNull(after.city) ?? null) ||
    (trimOrNull(before.state) ?? null) !== (trimOrNull(after.state) ?? null) ||
    (trimOrNull(before.zip) ?? null) !== (trimOrNull(after.zip) ?? null)
  if (addrChanged) {
    pending.push({
      order: 6,
      field: 'Address',
      input: { changeType: 'value', hadValue: addressPresent(before), hasValue: addressPresent(after) },
    })
  }

  // Verification (per field). An edited value auto-clears its own verification;
  // that automatic clear is a consequence of the value change, not a separate
  // operator act, so it is NOT reported as its own fact.
  const verify = (
    order: number,
    field: string,
    beforeAt: string | null,
    afterAt: string | null,
    valueEdited: boolean,
  ) => {
    const was = !!beforeAt
    const is = !!afterAt
    if (was === is) return
    if (valueEdited && was && !is) return
    pending.push({
      order,
      field,
      input: { changeType: is ? 'verified' : 'verification_cleared', hadValue: was, hasValue: is },
    })
  }
  verify(7, 'Email', before.email_verified_at, after.email_verified_at, emailChanged)
  verify(8, 'Phone', before.phone_verified_at, after.phone_verified_at,
    (trimOrNull(before.phone) ?? null) !== (trimOrNull(after.phone) ?? null))
  verify(9, 'Address', before.address_verified_at, after.address_verified_at, addrChanged)

  // Customer alert — the actual alert text IS the employee-facing fact.
  if ((trimOrNull(before.contact_alert) ?? null) !== (trimOrNull(after.contact_alert) ?? null)) {
    pending.push({
      order: 10,
      field: 'Alert',
      input: { changeType: 'alert', hadValue: !!trimOrNull(before.contact_alert), hasValue: !!trimOrNull(after.contact_alert) },
      alertText: trimOrNull(after.contact_alert),
    })
  }

  if (pending.length === 0) return []

  // Classify each change via the ZEN decision, then compose the prose here.
  const facts = await Promise.all(
    pending.map(async (p): Promise<ContactHistoryFact> => {
      const kind = await classifyContactChange(p.input)
      const availabilityLabel = p.input.changeType === 'availability_changed' ? p.alertText : undefined
      return {
        order: p.order,
        field: p.field,
        changeKind: kind.changeKind,
        label: labelFor(p.field, kind.changeKind),
        description: describeFact(p.field, kind.changeKind, p.alertText, availabilityLabel),
      }
    }),
  )

  return facts.sort((a, b) => a.order - b.order)
}
