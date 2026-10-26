'use client'

/**
 * CustomerOverviewHeader — the customer-record header, built on the shared
 * CustomerContactCard.
 *
 * This replaces the old hand-rolled dark contact header. It renders the ONE
 * shared Customer Contact card (the same component used by Contact Research and
 * the stewardship working screens) in its collapsed Overview / expanded Edit
 * presentation, with the customer identity inside the card header:
 *   - Prominent name (approved bold teal), calculated age, a selectable customer
 *     status (Active / Prospect / Former Customer / Deceased) and a selectable
 *     Right Path tier (Tier 1 Wanderer … Tier 5 Trailblazer), with the single
 *     Edit/Done control at the header's right end.
 *   - Email / phone / mailing address with the existing per-field editing and
 *     customer-verification, the status key, and normalized address display —
 *     all owned by the shared card.
 *   - The single persisted customer alert (customers.contact_alert): Add / Edit
 *     / Clear, saved through the shared contact route and shown as a banner.
 *
 * Everything the shared card does NOT own is preserved here: the customer status
 * and tier (persisted to the customers row), the My Money (eMoney) flag, and the
 * demographic details the card does not edit (date of birth, gender, marital
 * status, tobacco, preferred language, health notes, Drive folder). Those keep
 * their existing PATCH /api/customers/[id] persistence; contact + alert +
 * verification go through the card's PATCH /api/customers/[id]/contact.
 *
 * Note on theme: the shared card is the light workflow design-system card; the
 * surrounding customer record is the dark theme. The card is self-contained
 * (its own light tokens) and renders as a light card within the dark page.
 */

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  CustomerContactCard,
  type CustomerContact,
} from '@/components/workflow/CustomerContactCard'
import type { CustomerDetail } from './page'

// ── Status (the existing four) ───────────────────────────────────────────────

type CustomerStatus = 'active' | 'prospect' | 'former_client' | 'deceased'

function deriveStatus(c: {
  is_deceased: boolean
  is_former_client: boolean
  is_prospect: boolean
}): CustomerStatus {
  if (c.is_deceased) return 'deceased'
  if (c.is_former_client) return 'former_client'
  if (c.is_prospect) return 'prospect'
  return 'active'
}

const STATUS_OPTIONS: { value: CustomerStatus; label: string; className: string }[] = [
  { value: 'active', label: 'Active', className: 'bg-status-confirmed-fill text-status-confirmed-strong border-status-confirmed-border' },
  { value: 'prospect', label: 'Prospect', className: 'bg-brand-subtle text-brand-subtle-foreground border-brand-ring' },
  { value: 'former_client', label: 'Former Customer', className: 'bg-surface-muted text-ink-supporting border-surface-border-strong' },
  // Display label "Deceased"; underlying value stays is_deceased.
  { value: 'deceased', label: 'Deceased', className: 'bg-status-missing-fill text-status-missing-strong border-status-missing-border' },
]

// ── Classification (the actual Right Path tiers) ─────────────────────────────

const SEGMENT_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'wanderer', label: 'Tier 1 — Wanderer', description: 'Legacy policy — service only' },
  { value: 'explorer', label: 'Tier 2 — Explorer', description: 'Life insurance client' },
  { value: 'pathfinder', label: 'Tier 3 — Pathfinder', description: 'Financial client — under $100K' },
  { value: 'voyageur', label: 'Tier 4 — Voyageur', description: 'Financial client — $100K – $500K' },
  { value: 'trailblazer', label: 'Tier 5 — Trailblazer', description: 'Financial client — $500K+' },
]

function classificationLabel(segment: string | null): string {
  if (!segment) return 'Unassigned'
  return SEGMENT_OPTIONS.find((o) => o.value === segment)?.label ?? 'Unassigned'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fullName(c: Pick<CustomerDetail, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

/** Calculated age from a reliable date of birth. The day is used only for the
 * calculation and never displayed. Null when the DOB is missing or implausible. */
function calcAge(iso: string | null): number | null {
  if (!iso) return null
  const datePart = iso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null
  const [y, m, d] = datePart.split('-').map(Number)
  const now = new Date()
  let age = now.getUTCFullYear() - y
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  return age >= 0 && age <= 120 ? age : null
}

/** Map the customer-record row onto the shared card's contact shape. Every
 * field already lives on the row; the card reads and corrects it. */
function toCardCustomer(c: CustomerDetail, contactAlert: string | null): CustomerContact {
  return {
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    street: c.street,
    address_line1: c.address_line1,
    city: c.city,
    state: c.state,
    zip: c.zip,
    email_verified_at: c.email_verified_at,
    phone_verified_at: c.phone_verified_at,
    address_verified_at: c.address_verified_at,
    email_availability: (c.email_availability as CustomerContact['email_availability']) ?? null,
    contact_alert: contactAlert,
  }
}

// ── A small in-memory selectable badge (status / tier) ───────────────────────

function SelectableBadge<T extends string>({
  value, label, options, onChange, className, ariaLabel, busy,
}: {
  value: T
  label: string
  options: { value: T; label: string; description?: string }[]
  onChange: (v: T) => void
  className?: string
  ariaLabel: string
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50',
          className,
        )}
      >
        {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
        {label}
        <ChevronDown className="size-3" aria-hidden />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            className="absolute left-0 z-20 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-surface-border-strong bg-surface-card py-1 shadow-md"
          >
            {options.map((o) => {
              const selected = o.value === value
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false) }}
                    className="flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className={cn('block text-sm text-ink', selected && 'font-semibold')}>{o.label}</span>
                      {o.description && (
                        <span className="mt-0.5 block text-xs text-ink-supporting">{o.description}</span>
                      )}
                    </span>
                    {selected && <Check className="mt-0.5 size-4 shrink-0 text-brand-icon" aria-hidden />}
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

// ── The header ───────────────────────────────────────────────────────────────

export function CustomerOverviewHeader({
  customer,
  onNameChange,
}: {
  customer: CustomerDetail
  /** Called after a save so the parent can refresh any name it displays. */
  onNameChange?: (first: string, last: string) => void
}) {
  const router = useRouter()

  const [status, setStatus] = useState<CustomerStatus>(() => deriveStatus(customer))
  const [segment, setSegment] = useState<string | null>(customer.segment)
  const [isEmoney, setIsEmoney] = useState(customer.is_emoney_client)
  const [alert, setAlert] = useState<string | null>(customer.contact_alert)
  const [statusBusy, setStatusBusy] = useState(false)
  const [segmentBusy, setSegmentBusy] = useState(false)
  const [emoneyBusy, setEmoneyBusy] = useState(false)

  const name = fullName(customer)
  const age = calcAge(customer.date_of_birth)
  const statusMeta = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[0]

  const patchCustomer = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customers/${customer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('save failed')
    router.refresh()
  }, [customer.id, router])

  const changeStatus = useCallback(async (next: CustomerStatus) => {
    const prev = status
    setStatus(next); setStatusBusy(true)
    try {
      await patchCustomer({
        is_deceased: next === 'deceased',
        is_former_client: next === 'former_client',
        is_prospect: next === 'prospect',
      })
    } catch {
      setStatus(prev)
    } finally {
      setStatusBusy(false)
    }
  }, [status, patchCustomer])

  const changeSegment = useCallback(async (next: string) => {
    const prev = segment
    setSegment(next); setSegmentBusy(true)
    try {
      await patchCustomer({ segment: next })
    } catch {
      setSegment(prev)
    } finally {
      setSegmentBusy(false)
    }
  }, [segment, patchCustomer])

  const toggleEmoney = useCallback(async () => {
    const prev = isEmoney
    setIsEmoney(!prev); setEmoneyBusy(true)
    try {
      await patchCustomer({ is_emoney_client: !prev })
    } catch {
      setIsEmoney(prev)
    } finally {
      setEmoneyBusy(false)
    }
  }, [isEmoney, patchCustomer])

  const cardCustomer = useMemo(() => toCardCustomer(customer, alert), [customer, alert])

  // The identity block inside the card header: name + age on the first row (the
  // card places Edit/Done at its right end), status + tier + My Money on the
  // second row.
  const headerContent = (
    <div className="space-y-2">
      <h2 className="text-[33px] font-bold leading-tight tracking-tight text-brand">{name}</h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {age != null && (
          <span className="text-base font-medium text-ink-supporting">Age {age}</span>
        )}
        <SelectableBadge
          value={status}
          label={statusMeta.label}
          options={STATUS_OPTIONS}
          onChange={changeStatus}
          className={statusMeta.className}
          ariaLabel="Customer status"
          busy={statusBusy}
        />
        <SelectableBadge
          value={segment ?? ''}
          label={classificationLabel(segment)}
          options={SEGMENT_OPTIONS}
          onChange={changeSegment}
          className="border-surface-border-strong bg-surface-muted text-ink-supporting"
          ariaLabel="Customer classification tier"
          busy={segmentBusy}
        />
        <button
          type="button"
          onClick={toggleEmoney}
          disabled={emoneyBusy}
          title="Toggle Allstate My Money (eMoney) account"
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50',
            isEmoney
              ? 'bg-brand-subtle text-brand-subtle-foreground border-brand-ring'
              : 'border-surface-border-strong bg-surface-card text-ink-muted hover:text-ink-secondary',
          )}
        >
          {emoneyBusy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          My Money
        </button>
      </div>
    </div>
  )

  return (
    <CustomerContactCard
      customer={cardCustomer}
      header={headerContent}
      alert={alert}
      alertEditable
      onAlertChange={setAlert}
      collapsible
      defaultExpanded={false}
      showName={false}
      showMentoring={false}
      onChange={(u) => {
        onNameChange?.(u.first_name ?? customer.first_name, u.last_name ?? customer.last_name)
        router.refresh()
      }}
    />
  )
}
