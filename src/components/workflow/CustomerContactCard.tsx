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
 *   - Customer name on top, then email / phone / mailing address stacked.
 *   - Values are shown in full and never truncated. A field with no usable value
 *     reads "Missing".
 *   - Each field carries a status cue: green = Customer Verified, yellow = On
 *     File — Not Verified, red = Missing or Unusable. Never color alone (icon +
 *     text accompany every cue), with a compact legend at the foot of the card.
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
 * Persistence is injectable so the card is testable and Storybook-friendly:
 *   - Omit `onPersist` and the card calls PATCH /api/customers/[id]/contact.
 *   - Provide `onPersist` (e.g. in Storybook) to intercept writes.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Mail, Phone, MapPin, Pencil, Check, X, Loader2, ShieldCheck, CircleAlert, ShieldQuestion,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  normalizeEmailInput, normalizePhoneInput, formatPhoneAsTyped,
  type ContactFieldResult,
} from '@/lib/contact-input'

// ── Data shape ───────────────────────────────────────────────────────────────

/** The subset of the customer record this card reads and writes. All fields
 * already exist on the customers row; the card introduces no new field. */
export interface CustomerContact {
  id: string
  first_name: string | null
  last_name: string | null
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
}

type ContactFieldKey = 'email' | 'phone' | 'address'

/** The request the card would send. Exposed so a host (or Storybook) can supply
 * its own persistence and still exercise the exact same payloads. */
export type ContactPersistPayload =
  | { field: 'email'; email: string | null }
  | { field: 'phone'; phone: string | null }
  | { field: 'address'; street: string | null; city: string | null; state: string | null; zip: string | null }
  | { field: ContactFieldKey; verified: boolean }

type Tone = 'confirmed' | 'known' | 'missing'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fullName(c: Pick<CustomerContact, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

function streetOf(c: CustomerContact): string {
  return (c.street ?? c.address_line1 ?? '').trim()
}

function addressLines(c: CustomerContact): string[] {
  const street = streetOf(c)
  const cityStateZip = [[c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ').trim()
  return [street, cityStateZip].filter(Boolean)
}

function addressUsable(c: CustomerContact): boolean {
  return !!(streetOf(c) && c.city && c.state && c.zip)
}

/** The field's green/amber/red tone. Verified → green; present but unverified →
 * amber; missing/unusable → red. Verification can only hold for a usable value,
 * so a cleared value always reads amber or red, never stale green. */
function toneFor(present: boolean, verifiedAt: string | null): Tone {
  if (!present) return 'missing'
  return verifiedAt ? 'confirmed' : 'known'
}

const TONE_META: Record<Tone, { label: string; icon: typeof ShieldCheck; dot: string; chip: string }> = {
  confirmed: {
    label: 'Customer Verified',
    icon: ShieldCheck,
    dot: 'bg-status-confirmed',
    chip: 'border-status-confirmed-border bg-status-confirmed-soft text-status-confirmed-strong',
  },
  known: {
    label: 'On File — Not Verified',
    icon: ShieldQuestion,
    dot: 'bg-status-known',
    chip: 'border-status-known-border bg-status-known-soft text-status-known-strong',
  },
  missing: {
    label: 'Missing or Unusable',
    icon: CircleAlert,
    dot: 'bg-status-missing',
    chip: 'border-status-missing-border bg-status-missing-soft text-status-missing-strong',
  },
}

// ── Component ──────────────────────────────────────────────────────────────

export function CustomerContactCard({
  customer,
  onChange,
  onPersist,
  heading,
  className,
}: {
  customer: CustomerContact
  /** Called with the authoritative updated record after any successful write,
   * so a host can keep its own copy of the customer in sync. */
  onChange?: (updated: CustomerContact) => void
  /** Inject persistence. Omit to PATCH /api/customers/[id]/contact. Must resolve
   * with the full updated record. */
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  /** Optional small eyebrow over the name (e.g. "Customer contact"). */
  heading?: string
  className?: string
}) {
  // The card holds the current record locally so the display updates the instant
  // a write returns, without the host round-tripping a reload.
  const [record, setRecord] = useState<CustomerContact>(customer)
  const [editing, setEditing] = useState<ContactFieldKey | null>(null)
  const [busyField, setBusyField] = useState<ContactFieldKey | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const applyUpdate = useCallback((updated: CustomerContact) => {
    setRecord(updated)
    onChange?.(updated)
  }, [onChange])

  // Verification: toggle a field's customer-verified flag. Independent of
  // editing; disabled when the value is not usable.
  const toggleVerify = useCallback(async (field: ContactFieldKey, verified: boolean) => {
    setBusyField(field); setError(null)
    try {
      const updated = await persist({ field, verified })
      applyUpdate(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update verification')
    } finally {
      setBusyField(null)
    }
  }, [persist, applyUpdate])

  const saveField = useCallback(async (payload: ContactPersistPayload) => {
    const field = payload.field
    setBusyField(field); setError(null)
    try {
      const updated = await persist(payload)
      applyUpdate(updated)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusyField(null)
    }
  }, [persist, applyUpdate])

  const emailPresent = !!record.email?.trim()
  const phonePresent = !!record.phone?.trim()
  const addrPresent = addressUsable(record)

  return (
    <section
      className={cn(
        'space-y-4 rounded-2xl border border-surface-border bg-surface-card p-5 font-workflow',
        className,
      )}
    >
      <header className="space-y-0.5">
        {heading && (
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">{heading}</p>
        )}
        <h3 className="text-xl font-semibold text-ink">{fullName(record)}</h3>
      </header>

      {error && (
        <p className="rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-sm text-status-missing-strong">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <EmailRow
          icon={Mail}
          label="Email"
          present={emailPresent}
          verifiedAt={record.email_verified_at}
          value={record.email}
          editing={editing === 'email'}
          busy={busyField === 'email'}
          onEdit={() => { setError(null); setEditing('email') }}
          onCancel={() => setEditing(null)}
          onSave={(email) => saveField({ field: 'email', email })}
          onVerify={(v) => toggleVerify('email', v)}
        />

        <PhoneRow
          icon={Phone}
          label="Phone"
          present={phonePresent}
          verifiedAt={record.phone_verified_at}
          value={record.phone}
          editing={editing === 'phone'}
          busy={busyField === 'phone'}
          onEdit={() => { setError(null); setEditing('phone') }}
          onCancel={() => setEditing(null)}
          onSave={(phone) => saveField({ field: 'phone', phone })}
          onVerify={(v) => toggleVerify('phone', v)}
        />

        <AddressRow
          present={addrPresent}
          verifiedAt={record.address_verified_at}
          record={record}
          editing={editing === 'address'}
          busy={busyField === 'address'}
          onEdit={() => { setError(null); setEditing('address') }}
          onCancel={() => setEditing(null)}
          onSave={(a) => saveField({ field: 'address', ...a })}
          onVerify={(v) => toggleVerify('address', v)}
        />
      </div>

      <ContactStatusKey />
    </section>
  )
}

// ── Shared row chrome ─────────────────────────────────────────────────────────

function StatusChip({ tone }: { tone: Tone }) {
  const meta = TONE_META[tone]
  const Icon = meta.icon
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', meta.chip)}
      role="status"
    >
      <Icon className="size-3.5" aria-hidden /> {meta.label}
    </span>
  )
}

function VerifyCheckbox({
  checked, disabled, busy, onChange,
}: {
  checked: boolean
  disabled: boolean
  busy: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-sm font-medium',
        disabled ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
      )}
      title={disabled ? 'A missing or unusable value cannot be marked verified.' : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || busy}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
      />
      <span>Customer Verified</span>
      {busy && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden />}
    </label>
  )
}

function RowShell({
  icon: Icon, label, tone, present, verifiedAt, busy, canEdit = true, onEdit, onVerify, children,
}: {
  icon: typeof Mail
  label: string
  tone: Tone
  present: boolean
  verifiedAt: string | null
  busy: boolean
  canEdit?: boolean
  onEdit: () => void
  onVerify: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          <span className={cn('inline-block size-2 rounded-full', TONE_META[tone].dot)} aria-hidden />
          <Icon className="size-4 text-ink-supporting" aria-hidden /> {label}
        </p>
        <StatusChip tone={tone} />
      </div>

      <div className="mt-2">{children}</div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-surface-divider pt-3">
          <VerifyCheckbox
            checked={!!verifiedAt}
            disabled={!present}
            busy={busy}
            onChange={onVerify}
          />
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-sm font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit
          </button>
        </div>
      )}
    </div>
  )
}

/** The value line: full value or an explicit "Missing". Never truncated. */
function ValueText({ value, present }: { value: string | null; present: boolean }) {
  if (!present) {
    return <p className="text-base font-medium text-status-missing-strong">Missing</p>
  }
  return <p className="break-words text-base text-ink">{value}</p>
}

function EditActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-sm font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
      >
        <X className="size-3.5" aria-hidden /> Cancel
      </button>
    </div>
  )
}

const inputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-3 py-2 text-base text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

// ── Email ──────────────────────────────────────────────────────────────────

function EmailRow({
  icon, label, present, verifiedAt, value, editing, busy, onEdit, onCancel, onSave, onVerify,
}: {
  icon: typeof Mail
  label: string
  present: boolean
  verifiedAt: string | null
  value: string | null
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (email: string | null) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const [draft, setDraft] = useState(value ?? '')
  const [result, setResult] = useState<ContactFieldResult | null>(null)

  // Reset the draft whenever the editor opens, so Cancel-then-Edit starts clean.
  const open = useCallback(() => { setDraft(value ?? ''); setResult(null); onEdit() }, [value, onEdit])

  if (!editing) {
    return (
      <RowShell icon={icon} label={label} tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} onEdit={open} onVerify={onVerify}>
        <ValueText value={value} present={present} />
      </RowShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizeEmailInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value) // valid canonical value, or null when empty (a valid clear)
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-subtle bg-surface-card p-4">
      <label htmlFor="cc-email" className="flex items-center gap-1.5 text-sm font-semibold text-ink-secondary">
        <Mail className="size-4" aria-hidden /> Edit email
      </label>
      <input
        id="cc-email"
        type="email"
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(e.target.value); if (result) setResult(null) }}
        onBlur={() => setResult(normalizeEmailInput(draft))}
        placeholder="name@example.com"
        aria-invalid={result?.status === 'invalid' || undefined}
        className={cn('mt-2', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-sm text-status-missing-strong">{result.reason}</p>
      )}
      <div className="mt-3"><EditActions busy={busy} onCancel={onCancel} /></div>
    </form>
  )
}

// ── Phone ──────────────────────────────────────────────────────────────────

function PhoneRow({
  icon, label, present, verifiedAt, value, editing, busy, onEdit, onCancel, onSave, onVerify,
}: {
  icon: typeof Phone
  label: string
  present: boolean
  verifiedAt: string | null
  value: string | null
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (phone: string | null) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const [draft, setDraft] = useState(formatPhoneAsTyped(value ?? ''))
  const [result, setResult] = useState<ContactFieldResult | null>(null)

  const open = useCallback(() => { setDraft(formatPhoneAsTyped(value ?? '')); setResult(null); onEdit() }, [value, onEdit])

  if (!editing) {
    return (
      <RowShell icon={icon} label={label} tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} onEdit={open} onVerify={onVerify}>
        <ValueText value={value} present={present} />
      </RowShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizePhoneInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value)
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-subtle bg-surface-card p-4">
      <label htmlFor="cc-phone" className="flex items-center gap-1.5 text-sm font-semibold text-ink-secondary">
        <Phone className="size-4" aria-hidden /> Edit phone
      </label>
      <input
        id="cc-phone"
        type="tel"
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(formatPhoneAsTyped(e.target.value)); if (result) setResult(null) }}
        onBlur={() => setResult(normalizePhoneInput(draft))}
        placeholder="(215) 555-0100"
        aria-invalid={result?.status === 'invalid' || undefined}
        className={cn('mt-2', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-sm text-status-missing-strong">{result.reason}</p>
      )}
      <div className="mt-3"><EditActions busy={busy} onCancel={onCancel} /></div>
    </form>
  )
}

// ── Mailing address (edited as one group) ─────────────────────────────────────

function AddressRow({
  present, verifiedAt, record, editing, busy, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  record: CustomerContact
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (a: { street: string | null; city: string | null; state: string | null; zip: string | null }) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const [street, setStreet] = useState(streetOf(record))
  const [city, setCity] = useState(record.city ?? '')
  const [stateVal, setStateVal] = useState(record.state ?? '')
  const [zip, setZip] = useState(record.zip ?? '')

  const open = useCallback(() => {
    setStreet(streetOf(record)); setCity(record.city ?? '')
    setStateVal(record.state ?? ''); setZip(record.zip ?? '')
    onEdit()
  }, [record, onEdit])

  const lines = useMemo(() => addressLines(record), [record])

  if (!editing) {
    return (
      <RowShell icon={MapPin} label="Mailing address" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} onEdit={open} onVerify={onVerify}>
        {present ? (
          <address className="not-italic text-base leading-relaxed text-ink">
            {lines.map((line, i) => <span key={i} className="block break-words">{line}</span>)}
          </address>
        ) : (
          <p className="text-base font-medium text-status-missing-strong">Missing</p>
        )}
      </RowShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = (v: string) => { const t = v.replace(/\s+/g, ' ').trim(); return t.length ? t : null }
    onSave({
      street: clean(street),
      city: clean(city),
      state: clean(stateVal) ? clean(stateVal)!.toUpperCase() : null,
      zip: clean(zip),
    })
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-subtle bg-surface-card p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-secondary">
        <MapPin className="size-4" aria-hidden /> Edit mailing address
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <label htmlFor="cc-street" className="text-xs font-medium uppercase tracking-wide text-ink-supporting">Street</label>
          <input id="cc-street" autoFocus value={street} onChange={(e) => setStreet(e.target.value)}
            placeholder="123 Main St" className={cn('mt-1', inputCls(false))} />
        </div>
        <div>
          <label htmlFor="cc-city" className="text-xs font-medium uppercase tracking-wide text-ink-supporting">City</label>
          <input id="cc-city" value={city} onChange={(e) => setCity(e.target.value)}
            placeholder="Philadelphia" className={cn('mt-1', inputCls(false))} />
        </div>
        <div className="flex gap-2">
          <div className="w-24">
            <label htmlFor="cc-state" className="text-xs font-medium uppercase tracking-wide text-ink-supporting">State</label>
            <input id="cc-state" value={stateVal} onChange={(e) => setStateVal(e.target.value)}
              maxLength={2} placeholder="PA" className={cn('mt-1 uppercase', inputCls(false))} />
          </div>
          <div className="flex-1">
            <label htmlFor="cc-zip" className="text-xs font-medium uppercase tracking-wide text-ink-supporting">ZIP</label>
            <input id="cc-zip" value={zip} onChange={(e) => setZip(e.target.value)}
              placeholder="19103" className={cn('mt-1', inputCls(false))} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-supporting">
        A mailing address needs street, city, state, and ZIP to be usable and verifiable.
      </p>
      <div className="mt-3"><EditActions busy={busy} onCancel={onCancel} /></div>
    </form>
  )
}

// ── Legend ───────────────────────────────────────────────────────────────────

/** The card's own compact status key. Self-contained and source-agnostic: it
 * states what each color means without referencing any external system. */
function ContactStatusKey() {
  const order: Tone[] = ['confirmed', 'known', 'missing']
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-divider pt-2.5 text-xs text-ink-supporting">
      {order.map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span className={cn('inline-block size-2.5 rounded-full', TONE_META[tone].dot)} aria-hidden />
          {TONE_META[tone].label}
        </span>
      ))}
    </div>
  )
}
