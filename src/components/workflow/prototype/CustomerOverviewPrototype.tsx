'use client'

/**
 * CustomerOverviewPrototype — a Storybook-only exploration of a simplified
 * Right Path Customer Overview.
 *
 * This is a PROTOTYPE. It lives under `prototype/` and is wired only into
 * Storybook stories. It does not touch production routes, the customer record
 * screen, the API, the database schema, or any real customer data. It reuses
 * the real shared `CustomerContactCard` for the contact section rather than
 * building a competing contact surface, and it composes the existing light
 * workflow tokens and primitives for everything around it.
 *
 * What it shows (per the simplified-overview brief):
 *   - A prominent customer name (no initials avatar).
 *   - The existing customer STATUS (Active / Prospect / Former Customer /
 *     Quiet Filed) as the primary badge, derived from the same flags the
 *     record screen uses.
 *   - The existing customer CLASSIFICATION as a smaller, secondary badge.
 *   - Email, phone, and mailing address, via the real CustomerContactCard
 *     (so contact editing and the Verified behavior are preserved exactly).
 *   - NO redundant case / policy / service-request counts.
 *
 * Expanded view adds, as secondary customer details only:
 *   - Date of birth (always masked MM/xx/YYYY — the day is never shown),
 *     gender, and marital status.
 *   - Tobacco, health notes, preferred language, and the Drive folder are
 *     deliberately kept OUT of this contact section.
 *
 * Address presentation reuses Right Path's existing address normalization
 * (`normalizeStreet` / `normalizeCity` / `normalizeState` from `@/lib/fmt`) for
 * DISPLAY only: the record passed to the card is normalized to normal
 * capitalization while legitimate abbreviations (NE, PO, state code) are
 * preserved. Because the card renders (and copies) exactly that normalized
 * value, copied text matches what is shown. The stored customer address is
 * never modified — normalization happens on the in-memory display record.
 *
 * An optional prominent alert can be shown above the contact information,
 * similar to eAgent's alert box. It is display-only: no persistence, no new
 * database field.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import { normalizeStreet, normalizeCity, normalizeState } from '@/lib/fmt'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
} from '@/components/workflow/CustomerContactCard'

// ── The overview record shape ────────────────────────────────────────────────

/**
 * The customer fields this overview reads. A superset of `CustomerContact`
 * (which the contact card owns) plus the secondary identity details the
 * expanded view surfaces and the flags/classification the header shows. Every
 * field already exists on the Right Path customers row; the prototype adds no
 * new field.
 */
export interface OverviewCustomer extends CustomerContact {
  /** Stored as a date; ALWAYS displayed masked MM/xx/YYYY (day never shown). */
  date_of_birth: string | null
  gender: string | null
  marital_status: string | null

  /** Status flags — the same three the record screen derives status from. */
  is_prospect: boolean
  is_former_client: boolean
  is_deceased: boolean

  /** Customer classification (the existing segment label, e.g. "A — Priority").
   * Shown as the smaller secondary badge. Null reads as "Unclassified". */
  classification: string | null
}

// ── Status (the existing four) ───────────────────────────────────────────────

type CustomerStatus = 'active' | 'prospect' | 'former_client' | 'quiet_filed'

/** Derive the single status from the stored flags, matching the record screen's
 * precedence (deceased → former → prospect → active). "Quiet Filed" is the
 * agency's label for the deceased/filed state. */
function deriveStatus(c: {
  is_deceased: boolean
  is_former_client: boolean
  is_prospect: boolean
}): CustomerStatus {
  if (c.is_deceased) return 'quiet_filed'
  if (c.is_former_client) return 'former_client'
  if (c.is_prospect) return 'prospect'
  return 'active'
}

/** The status label + light-token treatment. The brief's four statuses, toned
 * with the light status/tag tokens (never the dark record-screen classes):
 * Active = confirmed/emerald, Prospect = info/teal brand, Former = neutral
 * surface, Quiet Filed = missing/rose. */
const STATUS_META: Record<
  CustomerStatus,
  { label: string; className: string }
> = {
  active: {
    label: 'Active',
    className:
      'bg-status-confirmed-fill text-status-confirmed-strong border-status-confirmed-border',
  },
  prospect: {
    label: 'Prospect',
    className: 'bg-brand-subtle text-brand-subtle-foreground border-brand-ring',
  },
  former_client: {
    label: 'Former Customer',
    className: 'bg-surface-muted text-ink-supporting border-surface-border-strong',
  },
  quiet_filed: {
    label: 'Quiet Filed',
    className:
      'bg-status-missing-fill text-status-missing-strong border-status-missing-border',
  },
}

// ── Display helpers ──────────────────────────────────────────────────────────

function fullName(c: Pick<OverviewCustomer, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

/**
 * Mask a stored DOB to MM/xx/YYYY — the day is never shown. Mirrors the record
 * screen's `maskDob` so the prototype shows DOB identically. UTC-safe from the
 * ISO slice so the month/year never shift across time zones.
 */
function maskDob(iso: string | null): string {
  if (!iso) return '—'
  const datePart = iso.slice(0, 10)
  const [y, m] = datePart.split('-')
  if (!y || !m) return '—'
  return `${m}/xx/${y}`
}

/** Title-case a single stored word (gender / marital status) for display,
 * leaving an already-mixed value alone enough to read naturally. */
function titleCaseWord(raw: string | null): string {
  if (!raw?.trim()) return '—'
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Return a copy of the record whose address fields are normalized to normal
 * capitalization for DISPLAY, reusing Right Path's existing normalizers. This
 * does not mutate the input and never writes anything back: it only shapes what
 * the contact card shows (and therefore what it copies). Legitimate
 * abbreviations (NE/PO and the two-letter state) are preserved by the
 * normalizers themselves.
 */
function withNormalizedAddressForDisplay(c: OverviewCustomer): OverviewCustomer {
  return {
    ...c,
    street: normalizeStreet(c.street),
    address_line1: normalizeStreet(c.address_line1 ?? null),
    city: normalizeCity(c.city),
    state: normalizeState(c.state),
  }
}

// ── Secondary identity details (expanded view) ───────────────────────────────

function SecondaryDetails({ customer }: { customer: OverviewCustomer }) {
  const items: { label: string; value: string }[] = [
    { label: 'Date of birth', value: maskDob(customer.date_of_birth) },
    { label: 'Gender', value: titleCaseWord(customer.gender) },
    { label: 'Marital status', value: titleCaseWord(customer.marital_status) },
  ]
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-sm uppercase tracking-wide text-ink-supporting">{it.label}</dt>
          <dd className="mt-0.5 text-base text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Optional alert box (display-only, eAgent-style) ───────────────────────────

export interface OverviewAlert {
  /** The prominent message. Required when an alert is shown. */
  message: string
  /** Optional smaller supporting line beneath the message. */
  detail?: string
}

/**
 * A prominent customer alert, shown above the contact information when supplied.
 * Styled after eAgent's alert box: a solid high-contrast amber band so it reads
 * at a glance. Display-only — the prototype never persists it and it maps to no
 * database field.
 */
function AlertBox({ alert }: { alert: OverviewAlert }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-status-known-border bg-status-known-fill px-4 py-3"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-status-known-strong" aria-hidden />
      <div className="min-w-0">
        <p className="text-base font-semibold text-status-known-strong">{alert.message}</p>
        {alert.detail && (
          <p className="mt-0.5 text-sm text-status-known-foreground">{alert.detail}</p>
        )}
      </div>
    </div>
  )
}

// ── The overview ─────────────────────────────────────────────────────────────

export interface CustomerOverviewPrototypeProps {
  customer: OverviewCustomer
  /** Persistence for the embedded contact card. In Storybook this is an
   * in-memory function so editing/verifying stays interactive and side-effect
   * free. */
  onPersist: (id: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  /** Keep the host's copy of the contact record in sync when the card writes. */
  onContactChange?: (updated: CustomerContact) => void
  /** Optional prominent alert shown above the contact information. */
  alert?: OverviewAlert
  /** Whether the expanded (secondary details) view starts open. */
  defaultExpanded?: boolean
  className?: string
}

export function CustomerOverviewPrototype({
  customer,
  onPersist,
  onContactChange,
  alert,
  defaultExpanded = false,
  className,
}: CustomerOverviewPrototypeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const status = deriveStatus(customer)
  const statusMeta = STATUS_META[status]
  const name = fullName(customer)
  const classification = customer.classification?.trim() || 'Unclassified'

  // Normalize the address for display only — the stored record is untouched.
  const displayRecord = useMemo(
    () => withNormalizedAddressForDisplay(customer),
    [customer],
  )

  return (
    <section
      className={cn(
        'mx-auto w-full max-w-[640px] space-y-4 font-workflow text-ink-secondary',
        className,
      )}
    >
      {/* Header: prominent name, primary status, secondary classification. */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[32px] font-bold leading-tight tracking-tight text-ink">
            {name}
          </h2>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-0.5 text-sm font-semibold',
              statusMeta.className,
            )}
          >
            {statusMeta.label}
          </span>
        </div>
        {/* Classification: deliberately smaller + quieter than the status. */}
        <span className="inline-flex items-center rounded-md border border-surface-border bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-ink-supporting">
          {classification}
        </span>
      </header>

      {/* Optional prominent alert, above the contact information. */}
      {alert && <AlertBox alert={alert} />}

      {/* Contact information — the REAL shared card, address normalized for
          display. Editing and the Verified behavior come straight from the
          production component. */}
      <CustomerContactCard
        customer={displayRecord}
        onPersist={onPersist}
        onChange={onContactChange}
      />

      {/* Secondary customer details, expandable. */}
      <div className="rounded-2xl border border-surface-border bg-surface-card">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="text-base font-semibold text-ink">Customer details</span>
          {expanded ? (
            <ChevronUp className="size-5 text-ink-supporting" aria-hidden />
          ) : (
            <ChevronDown className="size-5 text-ink-supporting" aria-hidden />
          )}
        </button>
        {expanded && (
          <div className="border-t border-surface-border px-4 py-3">
            <SecondaryDetails customer={customer} />
          </div>
        )}
      </div>
    </section>
  )
}
