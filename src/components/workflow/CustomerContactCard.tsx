'use client'

/**
 * CustomerContactCard — the reusable customer-contact surface for Right Path.
 *
 * One shared component for showing and correcting a customer's durable contact
 * facts: name, email, phone, and mailing address. It is deliberately NOT tied to
 * any one workflow (stewardship, contact review, the customer record) — it reads
 * and writes only the customer record itself, so the same card can be dropped
 * anywhere the existing contact display can be replaced.
 *
 * Display
 *   - The customer's name is the card heading, with an expandable Mentoring tip
 *     beneath it.
 *   - One outer card holds three compact sections: Email, Phone, Mailing
 *     Address. Each section heading pairs a large status icon (yellow
 *     shield-question = on file not verified, green check-circle = customer
 *     verified, red warning = missing) with the field's contact icon (Mail /
 *     Phone / MapPin) and label, and carries the Customer Verified checkbox at
 *     the right.
 *   - The complete value shows beneath the heading in full (never truncated,
 *     the mailing address on two lines), with Edit at its right. A field with no
 *     usable value reads "Missing".
 *   - Status meaning never relies on color alone: each status icon is a distinct
 *     shape, and its accessible label states the meaning.
 *
 * Editing
 *   - Email and phone edit independently; the mailing address edits as one group
 *     (street, city, state, ZIP). Each editor has Save and Cancel.
 *   - Values are normalized/validated with Right Path's shared contact-input
 *     utilities before saving. Saving writes straight to the customer record and
 *     the display updates immediately from the returned row.
 *
 * Verification
 *   - A Customer Verified checkbox sits beside each field. It reuses the
 *     customer record's existing *_verified_at facts and is independent of
 *     editing. A missing/unusable value cannot be verified. Changing a verified
 *     value clears its prior verification (the server resets it on edit, and the
 *     card reflects that from the returned row).
 *
 * Persistence is injectable so the card is testable:
 *   - Omit `onPersist` and the card calls PATCH /api/customers/[id]/contact.
 *   - Provide `onPersist` (e.g. in a test) to intercept writes.
 *
 * Appearance
 *   - The card renders one approved look, inlined directly where it is used:
 *     a 33px bold teal (var(--brand)) customer name, a 1px slate-700 card
 *     border at 16px radius/padding, and the green/amber/red status key. There
 *     is no appearance-override layer (the former Storybook-driven subsystem
 *     was removed with Storybook).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Mail, Phone, MapPin, Pencil, Check, X, Loader2,
  ShieldQuestion, CheckCircle2, AlertTriangle, CalendarDays,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMentorDisclosure, MentorCapButton, MentorCapPanel } from '@/lib/mentoring/MentorUi'
import {
  formatPhoneDisplay,
} from '@/lib/contact-input'
import {
  normalizeEmail, normalizeStreet, normalizeCity, normalizeState,
} from '@/lib/fmt'
import {
  type EmailAvailability,
  type SelectableEmailAvailability,
  EMAIL_AVAILABILITY_LABEL,
  resolveEmailAvailabilityDisplay,
} from '@/lib/email-availability'
import {
  SMS_AVAILABILITY_LABEL,
  resolveSmsAvailabilityDisplay,
} from '@/lib/sms-availability'
import {
  describeContactUpdate,
  type ContactSnapshot,
  type NextHistoryEntryPreview,
} from '@/lib/stewardship/customer-history'
import { formatDobDisplay } from '@/lib/stewardship/dob'
import {
  type PersonName,
  familiarName as personFamiliarName,
} from '@/lib/person-name'
import { PersonNameDisplay, PersonNameEditor, PersonNameFields, usePersonNameDraft } from './PersonName'
import { EmailFields, useEmailDraft } from './ContactEmail'
import { PhoneFields, usePhoneDraft } from './ContactPhone'
import { DobFields, useDobDraft } from './ContactDob'
import { AddressFields, useAddressDraft } from './ContactAddress'
import { AlertBanner, AlertField, useAlertDraft } from './ContactAlert'
import { Divider, DividerStack } from './Divider'

// ── Data shape ───────────────────────────────────────────────────────────────

/** The subset of the customer record this card reads and writes. All fields
 * already exist on the customers row; the card introduces no new field. */
export interface CustomerContact {
  id: string
  first_name: string | null
  last_name: string | null
  /** Recorded middle name(s), kept whole. NULL = none. Optional so existing
   * callers that don't select it still satisfy the type. */
  middle_name?: string | null
  /** Generational suffix as typed ("Jr", "III"). NULL = none. Optional. */
  suffix?: string | null
  /** The name the customer is called ("Goes by" / preferred first). NULL = none
   * and the familiar/greeting names fall back to first_name. Optional. */
  goes_by?: string | null
  /** Preference for showing the suffix in the FAMILIAR name. NULL = no
   * preference (defaults to include); false suppresses it from the familiar
   * name only. Optional. */
  suffix_in_familiar?: boolean | null
  email: string | null
  phone: string | null
  /** Mailing street. Mirrors the app convention: `street`, falling back to the
   * (in practice empty) `address_line1`. */
  street: string | null
  address_line1?: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  /** Durable email-availability fact (customers.email_availability). NULL means
   * unknown ("Missing"). Governs how the Email section reads and whether email
   * research is worthwhile. See `@/lib/email-availability`. */
  email_availability: EmailAvailability | null
  /** The customer's single current alert (customers.contact_alert). NULL/empty
   * means no alert. Shown as a prominent banner at the top of the card and
   * editable via the Add / Edit / Clear control when alert editing is enabled.
   * Optional so existing callers that don't select it still satisfy the type. */
  contact_alert?: string | null
  /** Do Not Text — the durable customer-level texting opt-out
   * (`customers.sms_opt_out`). True = the customer asked not to be texted (STOP).
   * Follows the customer even if the phone number changes; cleared only
   * deliberately. Disables texting only, never calling. Optional so existing
   * callers that don't select it still satisfy the type (defaults to not opted
   * out). */
  sms_opt_out?: boolean
  /** Text Undeliverable (presentation fact) — whether the NUMBER currently on
   * file has a recorded text-delivery failure (the value-scoped
   * `[channel-unusable:<digits>]` text fact, already matched against the current
   * phone by the attempt-history read). Not a stored customer column: it is the
   * resolved per-number fact the host supplies so the card can show Text
   * Undeliverable. Replacing the number clears it on its own. Optional; defaults
   * to no failure on file. */
  text_undeliverable?: boolean
  /** The customer's best-available-precision age for the identity header
   * (reused project age logic: exact date_of_birth, else the agreed masked
   * policy DOB, UNKNOWN on conflict). Null/omitted means unknown and the age
   * line is not shown — never guessed. The day/DOB is never carried here; this
   * is age only. Supplied by the GET half of /api/customers/[id]/contact when
   * the card fetches its own data. */
  age?: number | null
  /** True when `age` came from the masked policy fallback rather than an exact
   * date_of_birth, so the identity header labels it approximate ("~N (approx.)").
   * Optional; defaults to exact. */
  age_approximate?: boolean
  /** The customer's EXACT date of birth (YYYY-MM-DD) when all three parts are
   * known, else null. Shown MASKED only (day never rendered) beneath the name,
   * alongside age, and editable in the expanded editor. Optional so existing
   * callers that don't select it still satisfy the type. */
  date_of_birth?: string | null
  /** The customer's PARTIAL date of birth (masked 'MM/xx/YYYY' / 'xx/xx/YYYY',
   * no day) when the exact date is not fully known, else null. Optional. */
  date_of_birth_approx?: string | null
  /** The best-available-precision DOB resolved for display ("MM/DD/YYYY" /
   * "MM/YYYY" / "YYYY"), drawn from the exact date, the customer's own partial
   * DOB, or the reliable owner-DOB consensus across the customer's LINKED
   * POLICIES (never the policy insured). Null when nothing usable is on file.
   * Supplied by /api/customers/[id]/contact. The card's scoped full-DOB
   * exception; prefer this over formatting the stored columns directly so a
   * linked-policy partial DOB is also shown. */
  dob_display?: string | null
  /** Where `dob_display` came from: 'exact'/'customer_partial' stored on the
   * customer, 'linked_policy' derived from the customer's policies, 'none'. */
  dob_source?: 'exact' | 'customer_partial' | 'linked_policy' | 'none'
  /** True when `dob_display` is NOT a confirmed exact date on the customer (a
   * partial, or derived from linked policies), so it is labeled not-yet-
   * confirmed — mirroring the approximate-age treatment. */
  dob_approximate?: boolean
  /** The resolved DOB parts for seeding the editor (a partial/linked source has
   * a blank day). Numbers, or null when unknown. */
  dob_month?: number | null
  dob_day?: number | null
  dob_year?: number | null
}

type ContactFieldKey = 'email' | 'phone' | 'address'

/** The changed fields of a unified contact save. Every key is optional: the
 * card includes ONLY the facts the operator actually changed, so the route
 * applies a minimal update and the one recorded history entry names only real
 * changes. `email_availability` carries a selected "no usable email" reason;
 * `mark_undeliverable` requests recording a text-delivery failure for the number
 * on file (it is never cleared here — replacing the number clears it). */
export interface ContactUpdatePayload {
  first_name?: string | null
  last_name?: string | null
  middle_name?: string | null
  suffix?: string | null
  goes_by?: string | null
  suffix_in_familiar?: boolean | null
  email?: string | null
  phone?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  email_verified?: boolean
  phone_verified?: boolean
  address_verified?: boolean
  email_availability?: SelectableEmailAvailability
  do_not_text?: boolean
  mark_undeliverable?: boolean
  alert?: string | null
  /** Date of birth, sent as the three raw parts the operator entered. Any part
   * may be blank (unknown); the route normalizes them with the same rules the
   * form applies and stores an exact or partial DOB accordingly. Present only
   * when the DOB actually changed. */
  dob_month?: string
  dob_day?: string
  dob_year?: string
}

/** The request the card would send. Exposed so a host (or a test) can supply
 * its own persistence and still exercise the exact same payloads. */
export type ContactPersistPayload =
  // The unified save: every changed contact fact in one request. Only the keys
  // that changed are sent; the route applies them in one update and records one
  // "Customer Contact Updated" history entry. This is what the single Save on
  // the card sends.
  | ({ field: 'contact' } & ContactUpdatePayload)
  | {
      field: 'name'
      first_name: string | null
      last_name: string | null
      middle_name?: string | null
      suffix?: string | null
      goes_by?: string | null
      suffix_in_familiar?: boolean | null
    }
  | { field: 'email'; email: string | null }
  | { field: 'phone'; phone: string | null }
  | { field: 'address'; street: string | null; city: string | null; state: string | null; zip: string | null }
  | { field: ContactFieldKey; verified: boolean }
  | { field: 'email_availability'; availability: SelectableEmailAvailability }
  | { field: 'alert'; alert: string | null }
  // Do Not Text — set/clear the durable customer opt-out (customers.sms_opt_out).
  // Disables texting only; follows the customer regardless of the number.
  | { field: 'sms'; do_not_text: boolean }
  // Text Undeliverable — record a text-DELIVERY FAILURE for the number on file.
  // Scoped to that number (restores on replacement). An ordinary unsent text is
  // not a failure, so this is a deliberate "the text bounced" action.
  | { field: 'sms_undeliverable' }

type Tone = 'confirmed' | 'known' | 'missing'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build the shared PersonName shape from a customer-contact record, so the
 * card reuses the centralized familiar/greeting/full-recorded presentation. */
function personNameOf(
  c: Pick<CustomerContact, 'first_name' | 'last_name' | 'middle_name' | 'suffix' | 'goes_by' | 'suffix_in_familiar'>,
): PersonName {
  return {
    firstName: c.first_name ?? null,
    middleName: c.middle_name ?? null,
    lastName: c.last_name ?? null,
    suffix: c.suffix ?? null,
    goesBy: c.goes_by ?? null,
    suffixInFamiliar: c.suffix_in_familiar ?? null,
  }
}

/** The customer's familiar name (the everyday name), via the shared rules. Used
 * where a single-line name string is needed (Overview, mentoring heading). */
function fullName(
  c: Pick<CustomerContact, 'first_name' | 'last_name' | 'middle_name' | 'suffix' | 'goes_by' | 'suffix_in_familiar'>,
): string {
  return personFamiliarName(personNameOf(c)) || 'Unknown customer'
}

function streetOf(c: CustomerContact): string {
  return (c.street ?? c.address_line1 ?? '').trim()
}

/** Street shown with normal capitalization, directional abbreviations
 * preserved (NE/SW/PO/...), via the shared `normalizeStreet` helper. Display
 * only: the stored record is untouched. */
function streetDisplay(c: CustomerContact): string {
  return normalizeStreet(streetOf(c)) ?? ''
}

function addressLines(c: CustomerContact): string[] {
  const street = streetDisplay(c)
  const city = normalizeCity(c.city) ?? ''
  const state = normalizeState(c.state) ?? ''
  const cityStateZip = [[city, state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ').trim()
  return [street, cityStateZip].filter(Boolean)
}

function addressUsable(c: CustomerContact): boolean {
  return !!(streetOf(c) && c.city && c.state && c.zip)
}

/** Email shown trimmed and lowercased via the shared `normalizeEmail` helper.
 * Display only: the stored record is untouched. */
function emailDisplay(c: CustomerContact): string | null {
  return normalizeEmail(c.email)
}

/** Phone shown in the `(XXX) XXX-XXXX` standard via the shared formatter.
 * Display only: the stored record is untouched. Falls back to the trimmed
 * stored value if it cannot be reduced to a formatted number. */
function phoneDisplay(c: CustomerContact): string | null {
  const t = c.phone?.trim()
  if (!t) return null
  return formatPhoneDisplay(t) || t
}

/** The field's green/amber/red tone. Verified → green; present but unverified →
 * amber; missing/unusable → red. Verification can only hold for a usable value,
 * so a cleared value always reads amber or red, never stale green. */
function toneFor(present: boolean, verifiedAt: string | null): Tone {
  if (!present) return 'missing'
  return verifiedAt ? 'confirmed' : 'known'
}

/** The status presentation per tone. Distinct SHAPES so the meaning survives
 * without color: a check for verified, a question-shield for on-file, a warning
 * triangle for missing. `color` is applied uniformly to the status icon, the
 * contact icon, and the field label so a field reads as one colored unit; the
 * accessible label carries the meaning in words. Shared between the field
 * headings and the status key so both stay identical. */
const STATUS_META: Record<Tone, { label: string; icon: typeof ShieldQuestion; color: string }> = {
  confirmed: { label: 'Verified', icon: CheckCircle2, color: 'text-status-confirmed' },
  known: { label: 'On file, not verified', icon: ShieldQuestion, color: 'text-status-known' },
  missing: { label: 'Missing', icon: AlertTriangle, color: 'text-status-missing' },
}

// ── Public component (self-contained + legacy invocations) ───────────────────

/** The initial presentation mode of the self-contained card: the compact
 * read-only Overview, or the per-field editing + verification view. */
export type ContactCardMode = 'collapsed' | 'expanded'

/**
 * The props of the self-contained invocation: a page supplies ONLY the customer
 * identity and the initial display mode. The card fetches, displays, edits, and
 * saves ALL of the customer's contact information itself — name, calculated age,
 * email, phone, mailing address, verification, email availability, Do Not Text /
 * Text Undeliverable, and the customer alert — and owns the complete approved
 * collapsed and expanded layouts and the name+age identity header. A future
 * change to the card appears on every screen that uses it without touching the
 * page.
 */
interface SelfContainedProps {
  /** The ONLY data a page supplies: which customer to show. The card fetches the
   * rest from the shared /api/customers/[id]/contact endpoint. */
  customerId: string
  /** Initial display mode: the compact Overview ('collapsed') or the editing
   * view ('expanded'). Find Missing Contact Information and a reached guided call
   * open 'expanded'; every other surface opens 'collapsed'. The worker can
   * toggle in place afterward. Default 'collapsed'. */
  initialMode?: ContactCardMode
  className?: string
  /** Optional: notified with the authoritative record after any successful write
   * (contact edit, verification, name correction, alert, texting change), so a
   * host can keep a surrounding view in sync WITHOUT owning the card's data.
   * Purely additive — the card persists and refreshes on its own regardless. */
  onChange?: (updated: CustomerContact) => void
  /** Optional: notified when the card switches between Overview and Edit. */
  onModeChange?: (mode: ContactCardMode) => void
  /** Optional: the live Next History Entry preview of the pending unified edit
   * while the editor is open (null when collapsed or nothing changed). Lets a
   * host render exactly what Save will record WITHOUT re-deriving any diff. */
  onPendingChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Optional: notified whenever the card has work in flight that a host should
   * wait on before advancing — true while the editor holds unsaved changes OR a
   * save is in progress, false once Save or Cancel completes. The card owns this
   * determination (dirty-draft + busy) so hosts never re-derive it. */
  onPendingStateChange?: (pending: boolean) => void
  // Mutually exclusive with the legacy `customer` invocation.
  customer?: never
}

/** The legacy, host-assembled invocation: the host passes a fully resolved
 * `customer` record and optionally its own header. Preserved so any remaining
 * host (and injectable persistence) keeps working exactly as before. */
interface LegacyProps {
  customer: CustomerContact
  onChange?: (updated: CustomerContact) => void
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  className?: string
  header?: ReactNode
  showName?: boolean
  showMentoring?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  alert?: string | null
  onAlertChange?: (next: string | null) => void
  alertEditable?: boolean
  customerId?: never
}

/**
 * CustomerContactCard — the single reusable customer-contact surface.
 *
 * SELF-CONTAINED (the standard for every workflow screen):
 *
 *   <CustomerContactCard customerId={id} initialMode="collapsed" />
 *
 * A page invokes the card with only a customer id and the initial display mode.
 * The card retrieves, displays, edits, and saves all of the customer's contact
 * information itself: name and calculated age; the complete approved collapsed
 * and expanded layouts; Edit Name (expanded only); email, phone, and mailing
 * address; all contact editing, normalization, and verification; email
 * availability and delivery failures; Do Not Text and Text Undeliverable;
 * customer alerts; and every contact-status indicator — all correct immediately
 * on open and consistent after each save. Pages no longer construct a heading,
 * retrieve age, assemble contact fields, or compute texting status, and a future
 * change to the card appears everywhere it is used without editing those pages.
 *
 * LEGACY (host-assembled): passing a resolved `customer` renders the same core
 * exactly as before. Used with injectable persistence.
 */
export function CustomerContactCard(props: SelfContainedProps | LegacyProps) {
  if (props.customerId !== undefined) {
    return <SelfContainedContactCard {...(props as SelfContainedProps)} />
  }
  return <ContactCardView {...(props as LegacyProps)} />
}

/**
 * The self-contained card: fetch the customer by id, then render the shared view
 * with the resolved record and the name+age identity header the card now owns.
 * It is the ONE place the identity header is assembled, so every workflow screen
 * gets an identical heading (approved 33px bold teal name, calculated age
 * beneath it in both modes, Edit Name only in the expanded view) without the
 * page building one. The card persists through the shared route and refreshes
 * itself; `onChange` is optional sync for a surrounding view.
 */
function SelfContainedContactCard({
  customerId,
  initialMode = 'collapsed',
  className,
  onChange,
  onModeChange,
  onPendingChange,
  onPendingStateChange,
}: SelfContainedProps) {
  const [record, setRecord] = useState<CustomerContact | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Mirror the card's Overview/Edit state so the owned heading shows the Edit
  // Name control only in the expanded Edit view.
  const [expanded, setExpanded] = useState(initialMode === 'expanded')

  // Fetch the customer's own contact record (contact facts + resolved
  // text_undeliverable + calculated age) once per customer. The card is the
  // source of its own data; the page supplied only the id.
  useEffect(() => {
    let active = true
    setRecord(null)
    setLoadError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/customers/${customerId}/contact`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not load customer contact')
        if (active) setRecord(json.data as CustomerContact)
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : 'Could not load customer contact')
      }
    })()
    return () => { active = false }
  }, [customerId])

  // Re-seed the mode if the page changes the initial mode for the SAME customer
  // (e.g. the calling workbench opening the card in edit the instant the
  // customer is reached), mirroring the view's own defaultExpanded behavior.
  useEffect(() => { setExpanded(initialMode === 'expanded') }, [initialMode])

  const handleChange = useCallback((updated: CustomerContact) => {
    // Preserve the derived age across writes: the PATCH responses carry the
    // contact facts and text_undeliverable but not the age, so keep the age the
    // GET resolved so the heading never drops it after an edit.
    setRecord((prev) => ({
      ...updated,
      age: updated.age ?? prev?.age ?? null,
      age_approximate: updated.age_approximate ?? prev?.age_approximate ?? false,
      // The resolved DOB display travels with every PATCH response now (so a
      // just-saved or just-promoted DOB shows at its true precision); keep the
      // prior resolution if a response ever omits it.
      dob_display: updated.dob_display ?? prev?.dob_display ?? null,
      dob_source: updated.dob_source ?? prev?.dob_source,
      dob_approximate: updated.dob_approximate ?? prev?.dob_approximate ?? false,
    }))
    onChange?.(updated)
  }, [onChange])

  const handleExpandedChange = useCallback((next: boolean) => {
    setExpanded(next)
    onModeChange?.(next ? 'expanded' : 'collapsed')
  }, [onModeChange])

  if (loadError) {
    return (
      <section className={cn('rounded-2xl border border-status-missing-border bg-status-missing-soft p-4 font-workflow', className)}>
        <p className="text-base text-status-missing-strong">{loadError}</p>
      </section>
    )
  }

  if (!record) {
    return (
      <section className={cn('flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow', className)}>
        <Loader2 className="size-4 animate-spin text-ink-supporting" aria-hidden />
        <span className="text-base text-ink-supporting">Loading customer contact…</span>
      </section>
    )
  }

  return (
    <ContactCardView
      customer={record}
      className={className}
      // The card owns the identity header now: the uniform name + calculated age
      // heading with the Edit Name control shown only in the expanded view.
      showName={false}
      showMentoring={false}
      collapsible
      defaultExpanded={expanded}
      onExpandedChange={handleExpandedChange}
      // Customer alerts are a standard part of the self-contained card.
      alert={record.contact_alert ?? null}
      alertEditable
      onPendingChange={onPendingChange}
      onPendingStateChange={onPendingStateChange}
      header={
        <CustomerNameHeading
          customerId={record.id}
          firstName={record.first_name}
          lastName={record.last_name}
          middleName={record.middle_name ?? null}
          suffix={record.suffix ?? null}
          goesBy={record.goes_by ?? null}
          suffixInFamiliar={record.suffix_in_familiar ?? null}
          className="text-[26px] font-bold leading-tight tracking-tight text-brand"
          // Name is corrected inside the one unified editor now, so the heading
          // never shows its own Edit name control (expanded=false hides it).
          expanded={false}
          age={record.age ?? null}
          ageApproximate={record.age_approximate === true}
          // Prefer the resolved best-available DOB (which includes a reliable
          // partial DOB consensus from the customer's LINKED POLICIES) over the
          // DOB stored directly on the row, falling back to the stored columns
          // if the resolver did not run. The card's scoped full-DOB exception.
          dob={record.dob_display ?? formatDobDisplay(record.date_of_birth, record.date_of_birth_approx)}
          dobApproximate={record.dob_approximate === true}
          onSaved={handleChange}
        />
      }
      onChange={handleChange}
    />
  )
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * The rendering core of the card. It takes a RESOLVED `customer` record and
 * owns display, editing, saving, verification, email availability, Do Not Text /
 * Text Undeliverable, and the alert — exactly as before. The public
 * `CustomerContactCard` below wraps it: in the self-contained mode it fetches
 * the customer by id and supplies this view with the resolved record plus the
 * name+age identity header; in the legacy mode it passes through unchanged.
 */
function ContactCardView({
  customer,
  onChange,
  onPersist,
  className,
  header,
  showName = true,
  showMentoring = true,
  collapsible = false,
  defaultExpanded = true,
  onExpandedChange,
  alert,
  onAlertChange,
  alertEditable = false,
  onPendingChange,
  onPendingStateChange,
}: {
  customer: CustomerContact
  /** Called with the authoritative updated record after any successful write,
   * so a host can keep its own copy of the customer in sync. */
  onChange?: (updated: CustomerContact) => void
  /** Inject persistence. Omit to PATCH /api/customers/[id]/contact. Must resolve
   * with the full updated record. */
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  className?: string
  /** Optional content rendered across the TOP of the card, with the single
   * Overview/Edit toggle at its right end (when `collapsible`). A host uses this
   * to place the customer identity (name, age, status, classification) inside
   * the card header. Omit it and the card has no header slot. */
  header?: ReactNode
  /** Render the customer name as the card heading. Default true. Set false so a
   * host can own a single name heading elsewhere. */
  showName?: boolean
  /** Render the inline mentoring control beside the name. Default true. */
  showMentoring?: boolean
  /** Opt into the two-mode Overview/Edit presentation. Default false. When true,
   * the card shows a compact READ-ONLY overview with a single Edit button that
   * opens the one unified editor. When false the unified editor is always open
   * (the legacy always-editing surface). */
  collapsible?: boolean
  /** When `collapsible`, whether the card starts expanded (Edit) or collapsed
   * (Overview). Default true. Ignored when not collapsible. */
  defaultExpanded?: boolean
  /** Notified when the collapsible card switches between Overview and Edit. */
  onExpandedChange?: (expanded: boolean) => void
  /** The customer's single current alert text, or null/empty when there is no
   * alert. Opt-in — omit `alertEditable` and the card shows no alert affordance. */
  alert?: string | null
  /** Optional notification after the alert is saved/cleared, with the new text. */
  onAlertChange?: (next: string | null) => void
  /** Enable the alert feature (banner in Overview + Add Alert inside the editor). */
  alertEditable?: boolean
  /** Report the live Next History Entry preview of the pending edit while the
   * editor is open (null when collapsed or when nothing has changed), so a host
   * can show what the single Save will record WITHOUT re-deriving the diff. */
  onPendingChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Report whether the card currently has work a host should wait on before
   * advancing: true while the editor holds unsaved changes OR a save is running,
   * false once Save or Cancel settles. Combines the editor's own dirty-draft
   * signal with the card's busy flag, so a host never re-derives either. */
  onPendingStateChange?: (pending: boolean) => void
}) {
  // The card holds the current record locally so the display updates the instant
  // a write returns, without the host round-tripping a reload.
  const [record, setRecord] = useState<CustomerContact>(customer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Whether the open editor currently holds a non-empty pending change. Reported
  // up from the editor (which already builds the minimal changed-fact payload),
  // so the card does not re-derive dirtiness. False whenever the editor is not
  // open. Combined with `busy` into the single onPendingStateChange signal.
  const [editorDirty, setEditorDirty] = useState(false)
  // Bumped to force the unified editor to remount with fresh drafts after a save
  // or a legacy (non-collapsible) Cancel.
  const [editorKey, setEditorKey] = useState(0)
  // Overview (collapsed) vs the one unified Editor (expanded). Only meaningful
  // when `collapsible`; a non-collapsible card is always "expanded" (the legacy
  // always-editing surface).
  const [expanded, setExpanded] = useState(defaultExpanded)
  // Re-seed the Overview/Edit state when the host's default changes, mirroring
  // MentorGuidance: a host that drives `defaultExpanded` from live state (e.g.
  // the calling workbench opening the card in edit mode the instant the customer
  // is reached) sees the card follow. Callers passing a constant `defaultExpanded`
  // (every existing one) are unaffected, since the value never changes. A worker
  // can still toggle Overview/Edit in between; only a new default re-seeds it.
  useEffect(() => { setExpanded(defaultExpanded) }, [defaultExpanded])
  const isExpanded = !collapsible || expanded

  // When the editor is not open there can be no pending draft; keep the dirty
  // flag honest so a collapsed Overview never reports unsaved changes.
  useEffect(() => { if (!isExpanded) setEditorDirty(false) }, [isExpanded])

  // The single pending signal a host waits on: unsaved draft OR a save in
  // flight. Emitted whenever either input changes, so buttons re-enable the
  // moment Save or Cancel settles.
  useEffect(() => {
    onPendingStateChange?.(editorDirty || busy)
  }, [editorDirty, busy, onPendingStateChange])
  // The current alert value: the controlled `alert` prop when a host manages it,
  // else the durable customers.contact_alert on the record. Shown as a banner in
  // Overview; edited inside the one unified editor.
  const alertText = (alert !== undefined ? alert : record.contact_alert)?.trim()
    ? (alert !== undefined ? alert : record.contact_alert)
    : null

  const setExpandedState = useCallback((next: boolean) => {
    setError(null)
    setExpanded(next)
    // Leaving the editor clears any live pending-change preview.
    if (!next) onPendingChange?.(null)
    onExpandedChange?.(next)
  }, [onExpandedChange, onPendingChange])

  const persist = useCallback(
    async (payload: ContactPersistPayload): Promise<CustomerContact> => {
      if (onPersist) return onPersist(record.id, payload)
      const res = await fetch(`/api/customers/${record.id}/contact`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      return json.data as CustomerContact
    },
    [onPersist, record.id],
  )

  // The ONE save. The unified editor hands up every changed fact in a single
  // payload; this persists it in one request (the combined `field: 'contact'`
  // route branch, or the injected onPersist) that records exactly one "Customer
  // Contact Updated" history entry, applies the authoritative returned record,
  // notifies the host, and returns the card to the compact Overview. An empty
  // payload (nothing changed) short-circuits to collapsed with no write, so no
  // history is recorded for a no-op. Cancel never reaches here.
  const saveUnified = useCallback(async (payload: ContactUpdatePayload) => {
    if (Object.keys(payload).length === 0) {
      setExpandedState(false)
      return
    }
    setBusy(true); setError(null)
    try {
      const updated = await persist({ field: 'contact', ...payload })
      setRecord(updated)
      setEditorKey((k) => k + 1)
      onChange?.(updated)
      onAlertChange?.(updated.contact_alert ?? null)
      setExpandedState(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }, [persist, onChange, onAlertChange, setExpandedState])

  // The self-sweeping floor: the first time this record is VIEWED (the card
  // mounts with the record, display or edit state alike — not only when the
  // editor is opened), ask the server to heal representation-only
  // inconsistencies (address case, email-availability derivation) on the STORED
  // value — silently, with no history. Working a customer cleans them up, so a
  // record a reviewer only ever looks at still heals instead of staying dirty
  // forever. Guards that keep it cheap and safe:
  //   - once per customer per session (cleanedKeyRef), so re-renders and
  //     expand/collapse never re-fire it;
  //   - the server writes NOTHING when the record is already canonical, so a
  //     clean customer costs one no-op request and an already-swept floor is
  //     never swept again;
  //   - best-effort and silent: a failure is ignored (the display already
  //     normalizes) and never blocks viewing or editing;
  //   - skipped entirely when a host injects persistence.
  const cleanedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (onPersist) return
    if (cleanedKeyRef.current === record.id) return
    cleanedKeyRef.current = record.id
    void (async () => {
      try {
        const res = await fetch(`/api/customers/${record.id}/contact`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'cleanup' }),
        })
        if (!res.ok) return
        const json = await res.json()
        const cleaned = json.data as CustomerContact | undefined
        if (cleaned) { setRecord(cleaned); onChange?.(cleaned) }
      } catch {
        // Best-effort: leave the stored value un-healed and try again next view.
      }
    })()
  }, [onPersist, record.id, onChange])

  const emailPresent = !!record.email?.trim()
  const phonePresent = !!record.phone?.trim()
  const addrPresent = addressUsable(record)

  return (
    <section
      className={cn(
        'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
        className,
      )}
      // The approved card chrome: a 1px slate-700 (var(--text-secondary))
      // border at 16px radius/padding on the white surface. Only the border
      // COLOR differs from the base classes (which use the paler surface-border),
      // so it is set inline; the rest matches rounded-2xl / border / p-4.
      style={{
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'var(--text-secondary)',
        borderRadius: '16px',
        padding: '16px',
        background: 'var(--surface-card)',
      }}
    >
      {/* Optional header slot across the top of the card: the host's identity
          content (the name + age heading). The single Edit affordance lives in
          the Overview's bottom bar and the Save / Cancel in the editor, so the
          header is pure identity with no control. */}
      {header != null && (
        <div className="min-w-0">{header}</div>
      )}

      {/* The customer alert banner near the top, shown in the compact Overview
          whenever an alert exists. In the editor the alert is one of the fields,
          so the banner is not shown there. */}
      {alertText && !isExpanded && <AlertBanner alert={alertText} className="mt-3" />}

      {/* The customer's name heading (read-only here). Name is corrected inside
          the one unified editor, so the heading never carries its own Edit name
          control. `showName` / `showMentoring` let a host suppress either. */}
      {showName && (
        <ContactMentoring
          name={fullName(record)}
          showMentoring={showMentoring}
        />
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-base text-status-missing-strong">
          {error}
        </p>
      )}

      {isExpanded ? (
        /* The ONE unified editor: every contact fact edited together, with a
           single Save and a single Cancel at the bottom. All edits are pending
           until Save; Cancel discards everything. */
        <UnifiedContactEditor
          // Remount (fresh drafts seeded from the record) whenever the record
          // changes after a save, or when Cancel is used on a non-collapsible
          // card that has no Overview to fall back to.
          key={`${record.id}:${editorKey}`}
          record={record}
          busy={busy}
          alertEditable={alertEditable}
          onSave={saveUnified}
          onCancel={() => {
            onPendingChange?.(null)
            setEditorDirty(false)
            if (collapsible) setExpandedState(false)
            else { setError(null); setEditorKey((k) => k + 1) }
          }}
          onPendingChange={onPendingChange}
          onDirtyChange={setEditorDirty}
        />
      ) : (
        <>
          {/* Overview mode — a compact, read-only summary of the same three
              fields, reusing the status tones and value rendering. One Edit
              button opens the unified editor. The section separators use the
              SAME standard as the editor (2px slate-500 section divider), so
              display and edit read identically. */}
          <DividerStack className="mt-3">
            <OverviewRow
              contactIcon={Mail}
              label="Email"
              tone={toneFor(emailPresent, record.email_verified_at)}
              value={overviewEmailText(record)}
              present={emailPresent}
              first
            />
            <OverviewRow
              contactIcon={Phone}
              label="Phone"
              tone={toneFor(phonePresent, record.phone_verified_at)}
              value={overviewPhoneText(record)}
              present={phonePresent}
            />
            <OverviewRow
              contactIcon={MapPin}
              label="Mailing Address"
              tone={toneFor(addrPresent, record.address_verified_at)}
              value={addrPresent ? addressLines(record).join('\n') : null}
              present={addrPresent}
              last
            />
          </DividerStack>

          {/* Bottom bar of the compact Overview: the status key on the left so
              the green/amber/red icons above read clearly, and the single Edit
              button on the right that opens the unified editor. */}
          <Divider className="my-2.5" />
          <div className="flex items-center justify-between gap-3">
            <ContactStatusKey inline />
            {collapsible && (
              <ModeToggleButton
                label="Edit"
                icon={Pencil}
                onClick={() => setExpandedState(true)}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}

// ── The one unified editor ───────────────────────────────────────────────────

/**
 * The single editing experience for the whole card. It opens with every durable
 * contact fact — name, email (+ availability reason), phone (+ Do Not Text /
 * Text Undeliverable), mailing address, the three Customer Verified checkboxes,
 * and the customer alert — all editable together, with compact, consistently
 * divided sections and ONE Save + ONE Cancel at the bottom. There are no
 * per-field Edit/Save/Cancel controls.
 *
 * Every change is LOCAL pending state until Save. Save builds a minimal payload
 * of only the facts that actually changed and hands it up (`onSave`); Cancel
 * discards everything. Normalization and validation reuse the shared
 * contact-input utilities, so the same rules the server enforces are enforced
 * here and an invalid changed value blocks Save. While the editor is open it
 * reports a live Next History Entry preview of the pending change up through
 * `onPendingChange`, so the history column shows exactly what Save will record.
 */
function UnifiedContactEditor({
  record, busy, alertEditable, onSave, onCancel, onPendingChange, onDirtyChange,
}: {
  record: CustomerContact
  busy: boolean
  alertEditable: boolean
  onSave: (payload: ContactUpdatePayload) => void
  onCancel: () => void
  onPendingChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Report whether the current drafts differ from the record — true when the
   * minimal changed-fact payload is non-empty. The host card lifts this into the
   * single pending signal it exposes; the editor already builds this payload for
   * the live preview, so dirtiness is reported from the same place. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  // ── Drafts, seeded from the current record (display-normalized where the
  // read view shows a normalized value, so the operator edits what they saw). ──
  // Name is edited through the ONE shared Person Name field group + validation
  // (usePersonNameDraft / PersonNameFields), the same implementation the
  // standalone editor uses — no duplicated name-field logic here. Seeded from
  // the record's recorded parts.
  const nameApi = usePersonNameDraft({
    firstName: record.first_name ?? null,
    middleName: record.middle_name ?? null,
    lastName: record.last_name ?? null,
    suffix: record.suffix ?? null,
    goesBy: record.goes_by ?? null,
    suffixInFamiliar: record.suffix_in_familiar ?? null,
  })
  // Defer the inline name error until a Save attempt, like the standalone editor.
  const [nameAttempted, setNameAttempted] = useState(false)
  // Email — the ONE shared Email field group (input + the three mutually-
  // exclusive availability reasons + the Verified checkbox), driven by the
  // shared draft hook so validation and resolution match everywhere.
  const emailApi = useEmailDraft({
    email: record.email,
    email_availability: record.email_availability ?? null,
    email_verified_at: record.email_verified_at,
  })
  // Defer the inline email error until a Save attempt, like the name section.
  const [emailAttempted, setEmailAttempted] = useState(false)
  // Phone — the ONE shared Phone field group (number + the Text-message
  // availability controls Do Not Text / Text Undeliverable + the Verified
  // checkbox), driven by the shared draft hook so validation, texting gating,
  // and resolution match everywhere.
  const phoneApi = usePhoneDraft({
    phone: record.phone,
    sms_opt_out: record.sms_opt_out === true,
    text_undeliverable: record.text_undeliverable === true,
    phone_verified_at: record.phone_verified_at,
  })
  // Defer the inline phone error until a Save attempt, like the name section.
  const [phoneAttempted, setPhoneAttempted] = useState(false)
  // Defer the inline DOB error until a Save attempt, like the name section.
  const [dobAttempted, setDobAttempted] = useState(false)
  // Date of birth — the ONE shared DOB field group (month / day / year with the
  // exact-vs-partial rules and the downgrade guard). Seeded from the resolved
  // best-available parts (which may be a linked-policy consensus) when present,
  // else the stored columns; the Lego persists only on a genuine edit away from
  // that seed, so merely opening the editor never writes a derived DOB.
  const dobApi = useDobDraft({
    date_of_birth: record.date_of_birth ?? null,
    date_of_birth_approx: record.date_of_birth_approx ?? null,
    seed_month: record.dob_month ?? null,
    seed_day: record.dob_day ?? null,
    seed_year: record.dob_year ?? null,
  })
  // Mailing address — the ONE shared Address field group (street / city / state
  // / ZIP + the Address Verified checkbox), driven by the shared draft hook so
  // normalization, resolution, and verified gating match everywhere.
  const addressApi = useAddressDraft({
    street: record.street,
    address_line1: record.address_line1 ?? null,
    city: record.city,
    state: record.state,
    zip: record.zip,
    address_verified_at: record.address_verified_at,
  })
  // Customer alert — the ONE shared Alert field group (a single free-text note).
  const alertApi = useAlertDraft({ contact_alert: record.contact_alert ?? null })

  // The number/texting state that WILL be on file after Save lives in the shared
  // Phone Lego draft (`phoneApi.willHaveNumber` / `numberUnchanged` /
  // `lockedUndeliverable` / `willMarkUndeliverable`), so the card no longer
  // derives it; the mailing-address verifiability still reads it from there.

  // Build the minimal payload of ONLY changed facts, plus the before/after
  // snapshots for the live preview. Verification reflects the value that will be
  // on file: an edited value clears its own verification first, then an explicit
  // check re-affirms it. A staged email reason clears the active email.
  const buildChange = useCallback((): { payload: ContactUpdatePayload; after: ContactSnapshot; before: ContactSnapshot } => {
    const payload: ContactUpdatePayload = {}

    // Name — the live, normalized parts from the shared draft. Save-only-changed
    // per column.
    const ln = nameApi.liveName
    const nf = ln.firstName
    const nl = ln.lastName
    const nm = ln.middleName
    const nsuf = ln.suffix
    const ngb = ln.goesBy
    if ((nf ?? null) !== (record.first_name ?? null)) payload.first_name = nf
    if ((nl ?? null) !== (record.last_name ?? null)) payload.last_name = nl
    if ((nm ?? null) !== (record.middle_name ?? null)) payload.middle_name = nm
    if ((nsuf ?? null) !== (record.suffix ?? null)) payload.suffix = nsuf
    if ((ngb ?? null) !== (record.goes_by ?? null)) payload.goes_by = ngb
    // The suffix-in-familiar preference. Only meaningful when a suffix will be
    // on file; otherwise there is nothing to show or hide, so don't write it.
    const nextPref = nsuf ? ln.suffixInFamiliar : (record.suffix_in_familiar ?? null)
    if ((nextPref ?? null) !== (record.suffix_in_familiar ?? null)) {
      payload.suffix_in_familiar = nextPref
    }

    // DOB: the shared DOB Lego resolves whether the operator actually edited the
    // date away from its seed and whether that edit changes the stored columns
    // (never a downgrade of a known exact date, never a policy-derived seed
    // written on a plain save). Send the three raw parts only on a genuine
    // change; the route re-normalizes them identically.
    const nextDob =
      dobApi.willChange
        ? { date_of_birth: dobApi.result.date_of_birth, date_of_birth_approx: dobApi.result.date_of_birth_approx }
        : { date_of_birth: record.date_of_birth ?? null, date_of_birth_approx: record.date_of_birth_approx ?? null }
    if (dobApi.willChange) {
      payload.dob_month = dobApi.parts.month
      payload.dob_day = dobApi.parts.day
      payload.dob_year = dobApi.parts.year
    }

    // Email: the shared Email Lego resolves the value and availability that will
    // be on file (a staged reason clears the email; a usable address flips
    // availability to 'available'; "Missing" resets it to null). Send only what
    // actually changed. A staged reason always writes the availability it
    // resolved, so a "no usable email" disposition records even when the stored
    // email was already empty.
    const nextEmail = emailApi.resolvedEmail
    const nextAvailability = emailApi.resolvedAvailability
    if ((nextEmail ?? null) !== (record.email ?? null)) {
      payload.email = nextEmail
    }
    if (emailApi.draft.reason != null) {
      payload.email_availability = emailApi.draft.reason
    }

    // Phone: the shared Phone Lego resolves the number that will be on file.
    // Send it only when it actually changed.
    const nextPhone = phoneApi.resolvedPhone
    if ((nextPhone ?? null) !== (record.phone ?? null)) {
      payload.phone = nextPhone
    }

    // Mailing address: the shared Address Lego resolves the four normalized
    // values that will be on file. Send the group only when any of them changed.
    const ns = addressApi.resolved.street
    const nc = addressApi.resolved.city
    const nst = addressApi.resolved.state
    const nz = addressApi.resolved.zip
    const beforeStreet = (record.street ?? record.address_line1 ?? '').trim() || null
    const addrChanged =
      (ns ?? null) !== (beforeStreet ?? null) ||
      (nc ?? null) !== (record.city ?? null) ||
      (nst ?? null) !== (record.state ?? null) ||
      (nz ?? null) !== (record.zip ?? null)
    if (addrChanged) {
      payload.street = ns; payload.city = nc; payload.state = nst; payload.zip = nz
    }

    // Do Not Text / Text Undeliverable — both resolved by the Phone Lego. Send
    // the opt-out only when it changed; request a delivery-failure record only
    // when the Lego says one should be recorded (staged, a number on file, not
    // already-and-unchanged). A failure is never cleared here.
    const doNotText = phoneApi.draft.doNotText
    const willMarkUndeliverable = phoneApi.willMarkUndeliverable
    if (doNotText !== (record.sms_opt_out === true)) payload.do_not_text = doNotText
    if (willMarkUndeliverable) payload.mark_undeliverable = true

    // Alert: the shared Alert Lego resolves the trimmed note (null to clear).
    const nextAlert = alertApi.resolved
    if ((nextAlert ?? null) !== ((record.contact_alert ?? '').trim() ? record.contact_alert : null)) {
      payload.alert = nextAlert
    }

    // Verification: compare the desired state against the value that will be on
    // file, accounting for the auto-clear a changed value triggers.
    const emailEdited = payload.email !== undefined || payload.email_availability !== undefined
    const phoneEdited = payload.phone !== undefined
    const addrEdited = payload.street !== undefined
    const emailUsableAfter = !!(nextEmail && nextEmail.trim())
    const phoneUsableAfter = !!(nextPhone && nextPhone.trim())
    const addrUsableAfter = !!(ns && nc && nst && nz)
    const emailVerifiedAfter = emailEdited ? false : !!record.email_verified_at
    const phoneVerifiedAfter = phoneEdited ? false : !!record.phone_verified_at
    const addrVerifiedAfter = addrEdited ? false : !!record.address_verified_at
    const wantEmailVerified = emailApi.draft.verified && emailApi.canVerify && emailUsableAfter
    const wantPhoneVerified = phoneApi.draft.verified && phoneApi.canVerify && phoneUsableAfter
    const wantAddrVerified = addressApi.draft.verified && addressApi.canVerify && addrUsableAfter
    if (wantEmailVerified !== emailVerifiedAfter) payload.email_verified = wantEmailVerified
    if (wantPhoneVerified !== phoneVerifiedAfter) payload.phone_verified = wantPhoneVerified
    if (wantAddrVerified !== addrVerifiedAfter) payload.address_verified = wantAddrVerified

    const toSnapshot = (): ContactSnapshot => ({
      first_name: record.first_name,
      last_name: record.last_name,
      middle_name: record.middle_name ?? null,
      suffix: record.suffix ?? null,
      goes_by: record.goes_by ?? null,
      suffix_in_familiar: record.suffix_in_familiar ?? null,
      email: record.email,
      phone: record.phone,
      street: beforeStreet,
      city: record.city,
      state: record.state,
      zip: record.zip,
      email_verified_at: record.email_verified_at,
      phone_verified_at: record.phone_verified_at,
      address_verified_at: record.address_verified_at,
      email_availability: record.email_availability ?? null,
      sms_opt_out: record.sms_opt_out === true,
      date_of_birth: record.date_of_birth ?? null,
      date_of_birth_approx: record.date_of_birth_approx ?? null,
      text_undeliverable: record.text_undeliverable === true && !!record.phone?.trim(),
      contact_alert: record.contact_alert ?? null,
    })
    const before = toSnapshot()
    const after: ContactSnapshot = {
      first_name: nf,
      last_name: nl,
      middle_name: nm,
      suffix: nsuf,
      goes_by: ngb,
      suffix_in_familiar: nextPref,
      email: nextEmail,
      phone: nextPhone,
      street: ns,
      city: nc,
      state: nst,
      zip: nz,
      email_verified_at: wantEmailVerified ? (record.email_verified_at ?? 'pending') : null,
      phone_verified_at: wantPhoneVerified ? (record.phone_verified_at ?? 'pending') : null,
      address_verified_at: wantAddrVerified ? (record.address_verified_at ?? 'pending') : null,
      email_availability: nextAvailability,
      sms_opt_out: doNotText,
      date_of_birth: nextDob.date_of_birth,
      date_of_birth_approx: nextDob.date_of_birth_approx,
      text_undeliverable: willMarkUndeliverable || (phoneApi.numberUnchanged && record.text_undeliverable === true && phoneApi.willHaveNumber),
      contact_alert: nextAlert,
    }
    return { payload, before, after }
  }, [
    nameApi.liveName,
    emailApi.resolvedEmail, emailApi.resolvedAvailability, emailApi.draft.reason,
    emailApi.draft.verified, emailApi.canVerify,
    phoneApi.resolvedPhone, phoneApi.draft.doNotText, phoneApi.draft.verified,
    phoneApi.willMarkUndeliverable, phoneApi.willHaveNumber, phoneApi.numberUnchanged,
    phoneApi.canVerify,
    dobApi.willChange, dobApi.result, dobApi.parts,
    addressApi.resolved, addressApi.draft.verified, addressApi.canVerify,
    alertApi.resolved,
    record,
  ])

  // Report the live preview of the pending change AND whether the drafts are
  // dirty (a non-empty changed-fact payload) up as drafts change. Both come from
  // the one buildChange() the editor already runs, so neither the preview nor
  // dirtiness is derived twice.
  useEffect(() => {
    const { payload, before, after } = buildChange()
    onPendingChange?.(describeContactUpdate(before, after))
    onDirtyChange?.(Object.keys(payload).length > 0)
  }, [buildChange, onPendingChange, onDirtyChange])

  // On unmount (Save collapses the editor, or the customer changes), the editor
  // no longer holds a draft; make sure the host's dirty flag does not stay stuck
  // on from the last render.
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Block Save on an invalid typed email (an empty email with no reason is a
    // valid clear; a staged reason always resolves valid). The shared Email Lego
    // reports validity, mirroring the server, so bad formatting cannot slip
    // through; surface the inline message on attempt.
    if (!emailApi.valid) { setEmailAttempted(true); return }
    // Phone: the shared Phone Lego reports validity (an empty number is a valid
    // clear). Block Save and surface the inline message on an invalid number.
    if (!phoneApi.valid) { setPhoneAttempted(true); return }
    // Name: First and Last both required (Other needs a custom suffix). The
    // shared draft reports validity; block Save and surface the inline errors.
    if (!nameApi.valid) { setNameAttempted(true); return }
    // Block Save on an invalid DOB, or on a downgrade of a known exact DOB to
    // partial info (same guards the route enforces); the shared DOB Lego reports
    // both as not-valid. Surface the inline message on attempt.
    if (!dobApi.valid) { setDobAttempted(true); return }
    onSave(buildChange().payload)
  }

  // Name validity comes from the shared draft hook (First and Last both
  // required; Other requires a custom suffix) — the same rule the server
  // enforces. The inline field errors/preview live inside PersonNameFields.
  const nameInvalid = !nameApi.valid

  return (
    <form onSubmit={submit} className="mt-3">
      <DividerStack>
        {/* Name — the ONE shared Person Name field group (First, Middle, Last,
            Suffix dropdown; Goes by + the suffix-in-familiar checkbox) with its
            compact live familiar + greeting preview. Exactly the implementation
            the standalone editor uses, so there is no duplicated name-field
            logic. A bold section heading (matching the other sections) marks
            Name as its own section; the inline required-field error shows only
            after a Save attempt. */}
        <div className="py-3 first:pt-0">
          <p className="flex items-center gap-1.5 text-base font-bold text-ink">
            <Pencil className="size-4" aria-hidden /> Name
          </p>
          <div className="mt-1.5">
            <PersonNameFields
              api={nameApi}
              busy={busy}
              idPrefix="uc-name"
              autoFocus={false}
              showError={nameAttempted}
            />
          </div>
        </div>

        {/* Date of birth — the ONE shared DOB field group (month / day / year
            with the exact-vs-partial rules and the exact-DOB downgrade guard).
            The inline invalid/downgrade message shows only after a Save
            attempt. */}
        <div className="py-3">
          <p className="flex items-center gap-1.5 text-base font-bold text-ink">
            <CalendarDays className="size-4" aria-hidden /> Date of birth
          </p>
          <div className="mt-1.5">
            <DobFields
              api={dobApi}
              busy={busy}
              idPrefix="uc-dob"
              showError={dobAttempted}
            />
          </div>
        </div>

        {/* Email — the ONE shared Email field group (input + the three
            mutually-exclusive availability reasons + the Verified checkbox) with
            its inline validation. Exactly the implementation the standalone
            Email editor uses, so there is no duplicated email logic; the inline
            invalid message shows only after a Save attempt. */}
        <div className="py-3">
          <p className="flex items-center gap-1.5 text-base font-bold text-ink">
            <Mail className="size-4" aria-hidden /> Email
          </p>
          <div className="mt-1.5">
            <EmailFields
              api={emailApi}
              busy={busy}
              idPrefix="uc-email"
              showError={emailAttempted}
            />
          </div>
        </div>

        {/* Phone — the ONE shared Phone field group (number + the Text-message
            availability controls Do Not Text / Text Undeliverable + the Verified
            checkbox) with its inline validation. Exactly the implementation the
            standalone Phone editor uses, so there is no duplicated phone/texting
            logic; the inline invalid message shows only after a Save attempt. */}
        <div className="py-3">
          <p className="flex items-center gap-1.5 text-base font-bold text-ink">
            <Phone className="size-4" aria-hidden /> Phone
          </p>
          <div className="mt-1.5">
            <PhoneFields
              api={phoneApi}
              busy={busy}
              idPrefix="uc-phone"
              showError={phoneAttempted}
            />
          </div>
        </div>

        {/* Mailing address — the ONE shared Address field group (street / city /
            state / ZIP + the Address Verified checkbox). */}
        <div className={cn('py-3', !alertEditable && 'last:pb-0')}>
          <p className="flex items-center gap-1.5 text-base font-bold text-ink">
            <MapPin className="size-4" aria-hidden /> Mailing Address
          </p>
          <div className="mt-1.5">
            <AddressFields api={addressApi} busy={busy} idPrefix="uc-addr" />
          </div>
        </div>

        {/* Customer alert — the ONE shared Alert field group (a single note),
            part of the one editing area. */}
        {alertEditable && (
          <div className="py-3 last:pb-0">
            <p className="flex items-center gap-1.5 text-base font-bold text-status-known-strong">
              <AlertTriangle className="size-4" aria-hidden /> Customer alert
            </p>
            <div className="mt-1.5">
              <AlertField api={alertApi} busy={busy} idPrefix="uc-alert" />
            </div>
          </div>
        )}
      </DividerStack>

      {/* One Save and one Cancel at the bottom of the whole editor. */}
      <Divider className="my-3" />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || nameInvalid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-base font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40">
          <X className="size-3.5" aria-hidden /> Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * The customer-name heading with the inline graduation-cap mentoring control —
 * the same large purple cap used in My Work, replacing the former boxed
 * MentorGuidance disclosure. The cap sits beside the name; clicking it expands
 * the coaching directly beneath the heading, and the open/closed default follows
 * the global Mentoring preference (global ON -> expanded, OFF -> collapsed), with
 * the employee able to toggle it independently. Settled behavior, never hidden
 * or forced.
 *
 * The only thing appearance layers on is presentation (font-size / color) of the
 * coaching body, which the Playground exposes for experimentation; when the
 * appearance is the untouched neutral baseline the body renders verbatim.
 */
function ContactMentoring({
  name, showMentoring = true,
}: {
  name: string
  /** Render the mentoring cap/panel. Default true (the existing behavior). When
   * false, only the name heading renders and no mentoring appears. */
  showMentoring?: boolean
}) {
  const body =
    'Changes here update customer information throughout Right Path. Check Verified only when the ' +
    'customer has confirmed the information is correct, including when they confirm it in an email ' +
    'response.'

  const { open, setOpen } = useMentorDisclosure()

  // The name is read-only here: it is corrected inside the one unified editor
  // (the shared Person Name fields). This heading never carries its own editor.
  // The approved look: 33px bold teal (var(--brand)) name.
  return (
    <>
      <div className="flex items-center gap-2">
        <h3
          className="text-[22px] font-bold leading-tight text-ink"
          style={{ fontSize: '33px', color: 'var(--brand)' }}
        >
          {name}
        </h3>
        {showMentoring && !open && (
          <MentorCapButton size="text-display" onOpen={() => setOpen(true)} label="Show mentoring about these fields" />
        )}
      </div>
      {showMentoring && open && (
        <MentorCapPanel className="mt-2" onClose={() => setOpen(false)}>
          <span>{body}</span>
        </MentorCapPanel>
      )}
    </>
  )
}

/* The legacy inline first/last NameEditor and NameEditActions were removed: the
   one shared Person Name field group (PersonNameFields / usePersonNameDraft,
   used by the unified editor and the standalone PersonNameEditor) is now the
   single name-editing implementation. */

/**
 * A standalone, editable customer-name heading for hosts that render their OWN
 * name heading beside the shared CustomerContactCard (Contact Research, the
 * calling workbench, and other stewardship surfaces that pass `showName={false}`
 * and supply a `header`). It renders the familiar name prominently (with the
 * full recorded name beneath when it differs) via the shared `PersonNameDisplay`
 * and adds an "Edit name" control that opens the shared `PersonNameEditor` — the
 * same name UI, validation, and rules the card's unified editor uses.
 *
 * It persists through the SAME shared route the card uses
 * (`PATCH /api/customers/[id]/contact`, `{ field: 'name' }`), so capitalization
 * is preserved (McAndrew, DeLuca), multiword surnames stay whole (La Bar), and
 * the correction is recorded once in Customer History. On success it calls
 * `onSaved` with the authoritative updated record so the host folds the new name
 * into its own state and the displayed name updates immediately everywhere in
 * the active workflow. A host may inject `onPersist` (tests) exactly
 * as the card does.
 */
export function CustomerNameHeading({
  customerId,
  firstName,
  lastName,
  middleName = null,
  suffix = null,
  goesBy = null,
  suffixInFamiliar = null,
  className,
  style,
  expanded = true,
  age = null,
  ageApproximate = false,
  dob = null,
  dobApproximate = false,
  onPersist,
  onSaved,
}: {
  customerId: string
  firstName: string | null
  lastName: string | null
  /** Recorded middle name(s); shown only in the full recorded name. */
  middleName?: string | null
  /** Generational suffix; shown in the familiar name per the preference. */
  suffix?: string | null
  /** The name the customer is called; drives the familiar and greeting names. */
  goesBy?: string | null
  /** Preference for the suffix in the familiar name (null = include). */
  suffixInFamiliar?: boolean | null
  /** Applied to the heading text so it matches the host's existing name style. */
  className?: string
  style?: React.CSSProperties
  /** The card's Overview/Edit state. This shared heading owns the uniform rule
   * for every workflow screen: the Edit name button shows ONLY in expanded Edit
   * mode and is hidden in the compact Overview. Hosts pass the card's expanded
   * state (from `onExpandedChange`); default true preserves the always-editable
   * behavior for a non-collapsible caller. */
  expanded?: boolean
  /** The customer's best-available-precision age (reused project age logic:
   * exact DOB, else the agreed masked policy DOB). Shown directly beneath the
   * name in BOTH modes. Null omits the age entirely — never guessed. */
  age?: number | null
  /** True when `age` came from the masked policy fallback rather than an exact
   * date_of_birth, so it is labeled approximate ("~N (approx.)"). */
  ageApproximate?: boolean
  /** The customer's date of birth, ALREADY FORMATTED for display by the caller
   * ("MM/DD/YYYY" when the exact date is known, "MM/YYYY" or "YYYY" when only
   * those parts are known). Shown beneath the name alongside age. Null omits it.
   * This is the shared card's scoped exception to the DOB-masking rule (it shows
   * the day when known); see AGENTS.md and src/lib/stewardship/dob.ts. */
  dob?: string | null
  /** True when `dob` is NOT a confirmed exact date stored on the customer (a
   * partial, or one derived from the customer's linked policies), so it is
   * labeled "(unconfirmed)" — the operator can open Edit to confirm and save it
   * onto the customer. Mirrors the approximate-age treatment. */
  dobApproximate?: boolean
  /** Inject persistence. Omit to PATCH /api/customers/[id]/contact. Must resolve
   * with the full updated record. */
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  /** Notified with the authoritative updated record after a successful save, so
   * the host can refresh the displayed name throughout the workflow. */
  onSaved?: (updated: CustomerContact) => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const personName: PersonName = useMemo(
    () => ({
      firstName,
      middleName,
      lastName,
      suffix,
      goesBy,
      suffixInFamiliar,
    }),
    [firstName, middleName, lastName, suffix, goesBy, suffixInFamiliar],
  )

  const save = useCallback(async (value: PersonName) => {
    setBusy(true); setError(null)
    try {
      const payload: ContactPersistPayload = {
        field: 'name',
        first_name: value.firstName,
        last_name: value.lastName,
        middle_name: value.middleName,
        suffix: value.suffix,
        goes_by: value.goesBy,
        suffix_in_familiar: value.suffixInFamiliar,
      }
      let updated: CustomerContact
      if (onPersist) {
        updated = await onPersist(customerId, payload)
      } else {
        const res = await fetch(`/api/customers/${customerId}/contact`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not save name')
        updated = json.data as CustomerContact
      }
      onSaved?.(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save name')
    } finally {
      setBusy(false)
    }
  }, [customerId, onPersist, onSaved])

  // The DOB + age line beneath the name, shown uniformly in both modes. The DOB
  // is shown MASKED (the day is never rendered) alongside the calculated age; an
  // approximate age (from the masked policy fallback or a partial DOB) is marked
  // "~N (approx.)" with a clarifying tooltip. Each part is omitted when unknown,
  // never guessed. Shared by both the editing and read states so every workflow
  // screen reads identically.
  const ageSubline = (dob || age != null) ? (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base font-medium text-ink-supporting">
      {dob && (
        <span title={dobApproximate ? 'Partial or derived from linked records — open Edit to confirm' : undefined}>
          DOB <span className="font-mono text-ink-secondary">{dob}</span>
          {dobApproximate && <span className="ml-1 text-ink-muted">(unconfirmed)</span>}
        </span>
      )}
      {dob && age != null && <span aria-hidden className="text-ink-muted">·</span>}
      {age != null && (
        <span title={ageApproximate ? 'Approximate age, estimated from available records' : undefined}>
          Age {ageApproximate ? `~${age}` : age}
          {ageApproximate && <span className="ml-1 text-ink-muted">(approx.)</span>}
        </span>
      )}
    </div>
  ) : null

  if (editing) {
    return (
      <div>
        <PersonNameEditor
          name={personName}
          busy={busy}
          error={error}
          onCancel={() => { setError(null); setEditing(false) }}
          onSave={save}
        />
        {ageSubline}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        {/* The familiar name shown prominently (host className), with the full
            recorded name beneath it only when it differs — the shared rule. */}
        <PersonNameDisplay name={personName} className={className} style={style} />
        {/* Uniform rule for every workflow screen: Edit name only in expanded
            Edit mode, hidden in the compact Overview. */}
        {expanded && (
          <button
            type="button"
            onClick={() => { setError(null); setEditing(true) }}
            aria-label="Edit customer name"
            className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-2 py-1 text-sm font-medium text-ink-secondary hover:bg-surface-muted"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit name
          </button>
        )}
      </div>
      {ageSubline}
    </div>
  )
}

/**
 * The read-only value for the Email line of the Overview. A usable address
 * shows as-is; otherwise it shows the recorded reason ("No Usable Email",
 * "Undeliverable") or "Missing" — the same wording the editable Email section
 * uses, so Overview and Edit never disagree.
 */
function overviewEmailText(record: CustomerContact): string | null {
  const display = resolveEmailAvailabilityDisplay(record.email_availability, record.email)
  if (display === 'on_file') return emailDisplay(record)
  if (display === 'missing') return null
  return EMAIL_AVAILABILITY_LABEL[display]
}

/**
 * The read-only value for the Phone line of the Overview: the formatted number,
 * with the texting restriction appended on its own line when texting is
 * restricted (Do Not Text / Text Undeliverable). Calls are unaffected, so the
 * number still shows; the note only tells the worker texting is off and why.
 * Keeps Overview and Edit consistent, like overviewEmailText.
 */
function overviewPhoneText(record: CustomerContact): string | null {
  const number = phoneDisplay(record)
  const display = resolveSmsAvailabilityDisplay({
    smsOptOut: record.sms_opt_out === true,
    textUndeliverable: record.text_undeliverable === true && !!number,
  })
  if (display === 'available') return number
  const note = SMS_AVAILABILITY_LABEL[display]
  return number ? `${number}\n${note}` : note
}

/**
 * One compact, read-only row in the Overview: the field's status icon, the
 * contact-method icon, then the actual contact value — all on a single line,
 * with no text label. A long mailing address wraps naturally beneath the icons.
 * No Edit button and no Verified checkbox; the single Edit button on the card
 * reveals those. The status ICON carries the same verified/on-file/missing
 * meaning as the editable view (and the same accessible label), and the
 * contact-method icon carries the field name as its accessible label since the
 * visible text label is gone, so the row stays meaningful without a label.
 *
 * Styling reuses the approved card tokens: the status/contact icons take the
 * field's green/amber/red status color at the same `size-5` as the editable
 * headings, and the value uses the same `text-lg text-ink` as the editable
 * value line.
 */
function OverviewRow({
  contactIcon: ContactIcon, label, tone, value, present, first, last,
}: {
  contactIcon: typeof Mail
  label: string
  tone: Tone
  value: string | null
  present: boolean
  first?: boolean
  last?: boolean
}) {
  const status = STATUS_META[tone]
  const StatusIcon = status.icon
  return (
    <div className={cn('flex items-start gap-2 py-2.5', first && 'pt-0', last && 'pb-0')}>
      <StatusIcon
        className={cn('mt-0.5 size-5 shrink-0', status.color)}
        aria-label={status.label}
        role="img"
      />
      <ContactIcon className={cn('mt-0.5 size-5 shrink-0', status.color)} aria-label={label} role="img" />
      {present ? (
        <p className="min-w-0 whitespace-pre-line break-words text-lg text-ink">{value}</p>
      ) : (
        <p className="mt-0.5 text-lg font-medium text-status-missing-strong">
          {value ?? 'Missing'}
        </p>
      )}
    </div>
  )
}

/**
 * The single control that opens the unified editor from the compact Overview.
 */
function ModeToggleButton({
  label, icon: Icon, onClick,
}: {
  label: string
  icon: typeof Pencil
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
    >
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  )
}

/** The compact status key at the foot of the card: the same Lucide icons and
 * colors as the field headings, so green / amber / red read consistently. */
function ContactStatusKey({ inline = false }: { inline?: boolean }) {
  const order: Tone[] = ['confirmed', 'known', 'missing']
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-supporting',
        // Standalone: its own top divider + spacing (the shared section-divider
        // standard). Inline: it sits inside a shared bottom bar that already owns
        // the divider.
        !inline && 'mt-3 border-t-2 border-surface-border-section pt-2.5',
      )}
    >
      {order.map((tone) => {
        const meta = STATUS_META[tone]
        const Icon = meta.icon
        return (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <Icon className={cn('size-4 shrink-0', meta.color)} aria-hidden />
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}

// The Text-message availability controls (Do Not Text / Text Undeliverable) now
// live in the shared Phone Lego (`./ContactPhone`), rendered by `PhoneFields`.


