'use client'

/**
 * CustomerOverviewPrototype — a Storybook-only exploration of a simplified
 * Right Path Customer Overview.
 *
 * This is a PROTOTYPE. It lives under `prototype/` and is wired only into
 * Storybook stories. It does not touch production routes, the customer record
 * screen, the API, the database schema, or any real customer data.
 *
 * It does NOT fork the contact card. It renders the REAL shared
 * `CustomerContactCard` in its two presentation modes:
 *   - Overview (collapsed): compact, read-only email / phone / address with a
 *     single Edit button.
 *   - Edit (expanded): the same card's existing per-field editing +
 *     verification controls.
 * The card's new `collapsible` / `defaultExpanded` / `showName` / `showMentoring`
 * props drive this; they default to the card's existing behavior, so no live
 * screen (including Contact Research) changes.
 *
 * The prototype owns the single customer-name heading, the existing status
 * (Active / Prospect / Former Customer / Quiet Filed), the actual Right Path
 * classification (Wanderer / Explorer / Pathfinder / Voyageur / Trailblazer),
 * and the calculated age. Mentoring is suppressed on this instance. The address
 * is normalized for DISPLAY with Right Path's own `normalizeStreet` /
 * `normalizeCity` / `normalizeState`, so the card shows (and copies) normal
 * capitalization while the stored address is left untouched.
 *
 * An optional prominent alert can sit above the contact information, similar to
 * eAgent's alert box. It is display-only: no persistence, no new field.
 */

import { useMemo } from 'react'
import { Compass, TriangleAlert } from 'lucide-react'

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
 * (which the contact card owns) plus the identity details the header shows.
 * Every field already exists on the Right Path customers row; the prototype
 * adds no new field.
 */
export interface OverviewCustomer extends CustomerContact {
  /** Stored as a date; used only to compute age. The day is never displayed. */
  date_of_birth: string | null

  /** Status flags — the same three the record screen derives status from. */
  is_prospect: boolean
  is_former_client: boolean
  is_deceased: boolean

  /** Right Path classification (customers.segment). One of the five values
   * below; null reads as "Unassigned". */
  segment: string | null
}

// ── Status (the existing four) ───────────────────────────────────────────────

type CustomerStatus = 'active' | 'prospect' | 'former_client' | 'quiet_filed'

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

const STATUS_META: Record<CustomerStatus, { label: string; className: string }> = {
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

// ── Classification (the actual Right Path segments) ──────────────────────────

const SEGMENT_LABEL: Record<string, string> = {
  wanderer: 'Wanderer',
  explorer: 'Explorer',
  pathfinder: 'Pathfinder',
  voyageur: 'Voyageur',
  trailblazer: 'Trailblazer',
}

function classificationLabel(segment: string | null): string {
  if (!segment) return 'Unassigned'
  return SEGMENT_LABEL[segment] ?? 'Unassigned'
}

// ── Display helpers ──────────────────────────────────────────────────────────

function fullName(c: Pick<OverviewCustomer, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

/**
 * Calculated age from a reliable date of birth. Returns null when the DOB is
 * missing or not a plausible full date, so the header shows age only when it is
 * trustworthy. The day is used only for the calculation; it is never displayed.
 */
function calcAge(iso: string | null): number | null {
  if (!iso) return null
  const datePart = iso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null
  const [y, m, d] = datePart.split('-').map(Number)
  const dob = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - y
  const beforeBirthday =
    now.getUTCMonth() + 1 < m ||
    (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  if (age < 0 || age > 120) return null
  return age
}

/**
 * Return a copy of the record whose address fields are normalized to normal
 * capitalization for DISPLAY, reusing Right Path's existing normalizers. It
 * does not mutate the input and never writes anything back. Legitimate
 * abbreviations (NE/PO and the two-letter state) are preserved by the
 * normalizers themselves.
 */
function withNormalizedAddressForDisplay(c: OverviewCustomer): CustomerContact {
  return {
    ...c,
    street: normalizeStreet(c.street),
    address_line1: normalizeStreet(c.address_line1 ?? null),
    city: normalizeCity(c.city),
    state: normalizeState(c.state),
  }
}

// ── Optional alert box (display-only, eAgent-style) ───────────────────────────

export interface OverviewAlert {
  message: string
  detail?: string
}

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
  /** Start in Edit (expanded) rather than Overview (collapsed). Customer
   * Overview starts collapsed; Contact Research would start expanded. */
  startExpanded?: boolean
  className?: string
}

export function CustomerOverviewPrototype({
  customer,
  onPersist,
  onContactChange,
  alert,
  startExpanded = false,
  className,
}: CustomerOverviewPrototypeProps) {
  const status = deriveStatus(customer)
  const statusMeta = STATUS_META[status]
  const name = fullName(customer)
  const classification = classificationLabel(customer.segment)
  const age = calcAge(customer.date_of_birth)

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
      {/* The single customer-name heading, with status, classification, and the
          calculated age beside it. The contact card below renders with
          showName=false so the name appears exactly once. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          {name}
        </h2>
        {age != null && (
          <span className="text-base font-medium text-ink-supporting">Age {age}</span>
        )}
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-3 py-0.5 text-sm font-semibold',
            statusMeta.className,
          )}
        >
          {statusMeta.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-surface-border-strong bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-supporting">
          <Compass className="size-3.5" aria-hidden />
          {classification}
        </span>
      </header>

      {/* Optional prominent alert, above the contact information. */}
      {alert && <AlertBox alert={alert} />}

      {/* Contact information — the REAL shared card, in its two-mode
          presentation. Name and mentoring are suppressed here (the header owns
          the single name); the address is normalized for display. */}
      <CustomerContactCard
        customer={displayRecord}
        onPersist={onPersist}
        onChange={onContactChange}
        showName={false}
        showMentoring={false}
        collapsible
        defaultExpanded={startExpanded}
      />
    </section>
  )
}
