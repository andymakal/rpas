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
 * `CustomerContactCard` in its two presentation modes and places the customer
 * identity INSIDE that card via the card's `header` slot:
 *   - The header row carries one customer name, calculated age, a SELECTABLE
 *     status (Active / Prospect / Former Customer / Quiet Filed) and a
 *     SELECTABLE Right Path classification (Wanderer / Explorer / Pathfinder /
 *     Voyageur / Trailblazer), with the single Edit button at its right end.
 *   - Overview (collapsed): compact, read-only email / phone / address.
 *   - Edit (expanded): the same card's existing per-field editing +
 *     verification controls.
 * The card's `header` / `collapsible` / `defaultExpanded` / `showName` /
 * `showMentoring` props drive this; they default to the card's existing
 * behavior, so no live screen (including Contact Research) changes.
 *
 * Status and classification are interactive and in-memory only: picking a value
 * updates the displayed badge. The address is normalized for DISPLAY with Right
 * Path's own `normalizeStreet` / `normalizeCity` / `normalizeState`, so the card
 * shows (and copies) normal capitalization while the stored address is left
 * untouched. Mentoring is suppressed and the name appears exactly once.
 *
 * An optional prominent alert can sit above the contact information, similar to
 * eAgent's alert box. It is display-only: no persistence, no new field.
 */

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Compass, TriangleAlert } from 'lucide-react'

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

export type CustomerStatus = 'active' | 'prospect' | 'former_client' | 'quiet_filed'

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

const STATUS_OPTIONS: { value: CustomerStatus; label: string; className: string }[] = [
  {
    value: 'active',
    label: 'Active',
    className:
      'bg-status-confirmed-fill text-status-confirmed-strong border-status-confirmed-border',
  },
  {
    value: 'prospect',
    label: 'Prospect',
    className: 'bg-brand-subtle text-brand-subtle-foreground border-brand-ring',
  },
  {
    value: 'former_client',
    label: 'Former Customer',
    className: 'bg-surface-muted text-ink-supporting border-surface-border-strong',
  },
  {
    // Display label only; the underlying value stays `quiet_filed` (derived from
    // is_deceased) so the meaning and any downstream logic are unchanged.
    value: 'quiet_filed',
    label: 'Deceased',
    className:
      'bg-status-missing-fill text-status-missing-strong border-status-missing-border',
  },
]

// ── Classification (the actual Right Path segments) ──────────────────────────

const SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'wanderer', label: 'Wanderer' },
  { value: 'explorer', label: 'Explorer' },
  { value: 'pathfinder', label: 'Pathfinder' },
  { value: 'voyageur', label: 'Voyageur' },
  { value: 'trailblazer', label: 'Trailblazer' },
]

function classificationLabel(segment: string | null): string {
  if (!segment) return 'Unassigned'
  return SEGMENT_OPTIONS.find((o) => o.value === segment)?.label ?? 'Unassigned'
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
function withNormalizedAddressForDisplay(c: CustomerContact): CustomerContact {
  return {
    ...c,
    street: normalizeStreet(c.street),
    address_line1: normalizeStreet(c.address_line1 ?? null),
    city: normalizeCity(c.city),
    state: normalizeState(c.state),
  }
}

// ── A small in-memory selectable badge (status / classification) ─────────────

/**
 * A badge that opens a compact menu of choices on click and reports the picked
 * value. Interactive and in-memory only — the prototype holds the selection in
 * React state; nothing is persisted. Used for both the status and the
 * classification so the two selections behave identically.
 */
function SelectableBadge<T extends string>({
  value,
  label,
  options,
  onChange,
  className,
  leadingIcon,
  ariaLabel,
}: {
  value: T
  label: string
  options: { value: T; label: string; className?: string }[]
  onChange: (v: T) => void
  className?: string
  leadingIcon?: React.ReactNode
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
          className,
        )}
      >
        {leadingIcon}
        {label}
        <ChevronDown className="size-3" aria-hidden />
      </button>
      {open && (
        <>
          {/* Click-away backdrop so the menu closes without a selection. */}
          <span
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute left-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-surface-border-strong bg-surface-card py-1 shadow-md"
          >
            {options.map((o) => {
              const selected = o.value === value
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false) }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted',
                      selected && 'font-semibold',
                    )}
                  >
                    {o.label}
                    {selected && <Check className="size-4 text-brand-icon" aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </span>
  )
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
  const name = fullName(customer)
  const age = calcAge(customer.date_of_birth)

  // Status + classification are interactive, in-memory selections. They start
  // from the sample's flags/segment and update the displayed badge on pick.
  const [status, setStatus] = useState<CustomerStatus>(() => deriveStatus(customer))
  const [segment, setSegment] = useState<string | null>(customer.segment)
  const statusMeta =
    STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[0]

  // Normalize the address for display only — the stored record is untouched.
  const displayRecord = useMemo(
    () => withNormalizedAddressForDisplay(customer),
    [customer],
  )

  // The identity block that renders INSIDE the card header, across its top. The
  // card places the single Edit/Done button at the right end of the first row
  // (beside the name). Row two carries age, status, and classification.
  const headerContent = (
    <div className="space-y-2">
      {/* First row: the approved Customer Contact name treatment — 150% of the
          22px base (33px), bold, teal brand token, identical to the card's
          APPROVED_DEFAULTS. The card's Edit/Done control sits to its right. */}
      <h2 className="text-[33px] font-bold leading-tight tracking-tight text-brand">
        {name}
      </h2>
      {/* Second row: age, selectable status, selectable classification. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {age != null && (
          <span className="text-base font-medium text-ink-supporting">Age {age}</span>
        )}
        <SelectableBadge
          value={status}
          label={statusMeta.label}
          options={STATUS_OPTIONS}
          onChange={setStatus}
          className={statusMeta.className}
          ariaLabel="Customer status"
        />
        <SelectableBadge
          value={segment ?? ''}
          label={classificationLabel(segment)}
          options={SEGMENT_OPTIONS}
          onChange={(v) => setSegment(v)}
          className="border-surface-border-strong bg-surface-muted text-ink-supporting"
          leadingIcon={<Compass className="size-3.5" aria-hidden />}
          ariaLabel="Customer classification"
        />
      </div>
    </div>
  )

  return (
    <section
      className={cn(
        'mx-auto w-full max-w-[640px] space-y-4 font-workflow text-ink-secondary',
        className,
      )}
    >
      {/* Optional prominent alert, above the contact information. */}
      {alert && <AlertBox alert={alert} />}

      {/* Contact information — the REAL shared card, in its two-mode
          presentation, with the identity block inside its header and the single
          Edit button at the header's right end. Name and mentoring are
          suppressed (the header owns the single name); the address is
          normalized for display. */}
      <CustomerContactCard
        customer={displayRecord}
        onPersist={onPersist}
        onChange={onContactChange}
        header={headerContent}
        showName={false}
        showMentoring={false}
        collapsible
        defaultExpanded={startExpanded}
      />
    </section>
  )
}
