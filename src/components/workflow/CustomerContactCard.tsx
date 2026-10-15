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
 * Persistence is injectable so the card is testable and Storybook-friendly:
 *   - Omit `onPersist` and the card calls PATCH /api/customers/[id]/contact.
 *   - Provide `onPersist` (e.g. in Storybook) to intercept writes.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Mail, Phone, MapPin, Pencil, Check, X, Loader2,
  ShieldQuestion, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
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

// ── Appearance (presentation-only, Storybook-driven) ─────────────────────────

/** Which color a recolorable element takes. `status` = the field's green/amber/
 * red status token (the production default for the icons); `black` = plain
 * black, independent of status. */
export type ColorChoice = 'status' | 'black'

/**
 * Optional presentation configuration for the card. It is purely cosmetic:
 * it changes color assignment and font sizing, never behavior, data, or the
 * payloads sent to `onPersist`. Omitting it (or any field) reproduces the
 * production appearance exactly — the two status/contact icons take the status
 * color, the field label reads dark ink, and every font size is the component's
 * own default. It exists so the Design Playground can drive the REAL component
 * through Storybook controls without a fork; production call sites never pass it.
 */
export interface ContactCardAppearance {
  /** Color of the per-field status indicator (the shape icon). Default `status`. */
  statusIndicatorColor?: ColorChoice
  /** Color of the per-field contact icon (Mail / Phone / MapPin). Default `status`. */
  contactIconColor?: ColorChoice
  /** Color of the per-field label text (Email / Phone / Mailing Address). Default `black`. */
  fieldLabelColor?: ColorChoice
  /** Master multiplier applied to every scalable text role. Default 1. */
  fontScale?: number
  /** Extra multiplier for the customer name heading. Default 1. */
  nameScale?: number
  /** Extra multiplier for the field labels. Default 1. */
  labelScale?: number
  /** Extra multiplier for the contact values. Default 1. */
  valueScale?: number
  /** Extra multiplier for buttons and the Verified labels. Default 1. */
  controlScale?: number
}

const DEFAULT_APPEARANCE: Required<ContactCardAppearance> = {
  statusIndicatorColor: 'status',
  contactIconColor: 'status',
  fieldLabelColor: 'black',
  fontScale: 1,
  nameScale: 1,
  labelScale: 1,
  valueScale: 1,
  controlScale: 1,
}

/** The resolved, non-cosmetic-by-default view the component actually renders
 * from, plus the derived per-role px font sizes. When the appearance equals the
 * default, `isDefault` is true and the component renders exactly as before (no
 * inline font-size styles, no color overrides). */
interface ResolvedAppearance {
  statusIndicatorColor: ColorChoice
  contactIconColor: ColorChoice
  fieldLabelColor: ColorChoice
  /** The default font px for each role, defined here so JSX stays declarative.
   * These mirror the Tailwind utilities the card uses: name text-[22px],
   * label text-base (16), value text-lg (18), control text-base (16),
   * supporting text-sm (14). */
  nameFontPx: number
  labelFontPx: number
  valueFontPx: number
  controlFontPx: number
  supportingFontPx: number
  isDefault: boolean
}

function resolveAppearance(a?: ContactCardAppearance): ResolvedAppearance {
  const r = { ...DEFAULT_APPEARANCE, ...a }
  const isDefault =
    r.statusIndicatorColor === DEFAULT_APPEARANCE.statusIndicatorColor &&
    r.contactIconColor === DEFAULT_APPEARANCE.contactIconColor &&
    r.fieldLabelColor === DEFAULT_APPEARANCE.fieldLabelColor &&
    r.fontScale === 1 && r.nameScale === 1 && r.labelScale === 1 &&
    r.valueScale === 1 && r.controlScale === 1
  return {
    statusIndicatorColor: r.statusIndicatorColor,
    contactIconColor: r.contactIconColor,
    fieldLabelColor: r.fieldLabelColor,
    nameFontPx: 22 * r.fontScale * r.nameScale,
    labelFontPx: 16 * r.fontScale * r.labelScale,
    valueFontPx: 18 * r.fontScale * r.valueScale,
    controlFontPx: 16 * r.fontScale * r.controlScale,
    supportingFontPx: 14 * r.fontScale * r.labelScale,
    isDefault,
  }
}

/** A font-size style for a role, or undefined when appearance is default so the
 * Tailwind size class alone governs (keeps production output byte-identical). */
function fontStyle(ap: ResolvedAppearance, px: number): React.CSSProperties | undefined {
  return ap.isDefault ? undefined : { fontSize: `${px.toFixed(3)}px` }
}

/** Resolve an icon/label color: the status token color (`statusColor`) when the
 * choice is `status`, or an explicit black override when the choice is `black`. */
function colorClass(choice: ColorChoice, statusColor: string): string {
  return choice === 'black' ? 'text-black' : statusColor
}

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

// ── Component ──────────────────────────────────────────────────────────────

export function CustomerContactCard({
  customer,
  onChange,
  onPersist,
  className,
  appearance,
}: {
  customer: CustomerContact
  /** Called with the authoritative updated record after any successful write,
   * so a host can keep its own copy of the customer in sync. */
  onChange?: (updated: CustomerContact) => void
  /** Inject persistence. Omit to PATCH /api/customers/[id]/contact. Must resolve
   * with the full updated record. */
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  className?: string
  /** Presentation-only overrides (color assignment + font sizing). Omit for the
   * production appearance. Used by the Design Playground to tune the REAL card.
   * Never affects behavior, data, or `onPersist` payloads. */
  appearance?: ContactCardAppearance
}) {
  const ap = useMemo(() => resolveAppearance(appearance), [appearance])
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
        'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
        className,
      )}
    >
      {/* The customer's name IS the card heading (~22px). */}
      <h3
        className="text-[22px] font-semibold leading-tight text-ink"
        style={fontStyle(ap, ap.nameFontPx)}
      >
        {fullName(record)}
      </h3>

      {/* Mentoring (HOW): always-visible purple control, expanded by the global
          Mentoring preference. */}
      <MentorGuidance label="About these fields" className="mt-2">
        Changes here update customer information throughout Right Path. Check Verified only when the
        customer has confirmed the information is correct, including when they confirm it in an email
        response.
      </MentorGuidance>

      {error && (
        <p className="mt-3 rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-base text-status-missing-strong">
          {error}
        </p>
      )}

      {/* Three compact sections in one card. The dividers use the stronger
          surface border token so they read clearly against the white card. */}
      <div className="mt-3 divide-y divide-surface-border-strong">
        <EmailRow
          present={emailPresent}
          verifiedAt={record.email_verified_at}
          value={record.email}
          editing={editing === 'email'}
          busy={busyField === 'email'}
          appearance={ap}
          onEdit={() => { setError(null); setEditing('email') }}
          onCancel={() => setEditing(null)}
          onSave={(email) => saveField({ field: 'email', email })}
          onVerify={(v) => toggleVerify('email', v)}
        />

        <PhoneRow
          present={phonePresent}
          verifiedAt={record.phone_verified_at}
          value={record.phone}
          editing={editing === 'phone'}
          busy={busyField === 'phone'}
          appearance={ap}
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
          appearance={ap}
          onEdit={() => { setError(null); setEditing('address') }}
          onCancel={() => setEditing(null)}
          onSave={(a) => saveField({ field: 'address', ...a })}
          onVerify={(v) => toggleVerify('address', v)}
        />
      </div>

      <ContactStatusKey appearance={ap} />
    </section>
  )
}

/** The compact status key at the foot of the card: the same Lucide icons and
 * colors as the field headings, so green / amber / red read consistently. */
function ContactStatusKey({ appearance }: { appearance: ResolvedAppearance }) {
  const order: Tone[] = ['confirmed', 'known', 'missing']
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-border-strong pt-2.5 text-sm text-ink-supporting"
      style={fontStyle(appearance, appearance.supportingFontPx)}
    >
      {order.map((tone) => {
        const meta = STATUS_META[tone]
        const Icon = meta.icon
        // The key repeats the status indicator, so it follows the status-indicator
        // color choice.
        return (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <Icon
              className={cn('size-4 shrink-0', colorClass(appearance.statusIndicatorColor, meta.color))}
              aria-hidden
            />
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}

// ── Shared section chrome ─────────────────────────────────────────────────────

function VerifyCheckbox({
  checked, disabled, busy, onChange, appearance,
}: {
  checked: boolean
  disabled: boolean
  busy: boolean
  onChange: (v: boolean) => void
  appearance: ResolvedAppearance
}) {
  return (
    <label
      className={cn(
        'flex shrink-0 items-center gap-2 text-base font-medium',
        disabled ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
      )}
      style={fontStyle(appearance, appearance.controlFontPx)}
      title={disabled ? 'A missing or unusable value cannot be marked verified.' : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || busy}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
      />
      <span>Verified</span>
      {busy && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden />}
    </label>
  )
}

/**
 * One contact section inside the shared card. The heading line pairs the large
 * status icon and the contact icon with the field label, and holds the Customer
 * Verified checkbox at the right. The value line shows the full value with Edit
 * at the right. Compact vertical rhythm; no inner card border.
 */
function SectionShell({
  contactIcon: ContactIcon, label, tone, present, verifiedAt, busy, appearance, onEdit, onVerify, children,
}: {
  contactIcon: typeof Mail
  label: string
  tone: Tone
  present: boolean
  verifiedAt: string | null
  busy: boolean
  appearance: ResolvedAppearance
  onEdit: () => void
  onVerify: (v: boolean) => void
  children: React.ReactNode
}) {
  const status = STATUS_META[tone]
  const StatusIcon = status.icon
  // Default: both icons take the status color and the label reads dark ink. Each
  // is independently recolorable to black via the appearance config.
  const labelColor = appearance.fieldLabelColor === 'black' ? 'text-black' : 'text-ink'
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        {/* The status indicator and contact icon take the status color (green /
            amber / red) by default; the label text reads in the standard dark
            ink. Both icons are the same ~20px size; the status shape +
            accessible label carry meaning without relying on color. */}
        <p
          className={cn('flex items-center gap-2 text-base font-semibold', labelColor)}
          style={fontStyle(appearance, appearance.labelFontPx)}
        >
          <StatusIcon
            className={cn('size-5 shrink-0', colorClass(appearance.statusIndicatorColor, status.color))}
            aria-label={status.label}
            role="img"
          />
          <ContactIcon
            className={cn('size-5 shrink-0', colorClass(appearance.contactIconColor, status.color))}
            aria-hidden
          />
          {label}
        </p>
        <VerifyCheckbox
          checked={!!verifiedAt}
          disabled={!present}
          busy={busy}
          appearance={appearance}
          onChange={onVerify}
        />
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">{children}</div>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          style={fontStyle(appearance, appearance.controlFontPx)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-2.5 py-1 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
        >
          <Pencil className="size-3.5" aria-hidden /> Edit
        </button>
      </div>
    </div>
  )
}

/** The value line (~18px): full value, or an explicit "Missing". Never truncated. */
function ValueText({ value, present, appearance }: { value: string | null; present: boolean; appearance: ResolvedAppearance }) {
  const style = fontStyle(appearance, appearance.valueFontPx)
  if (!present) {
    return <p className="text-lg font-medium text-status-missing-strong" style={style}>Missing</p>
  }
  return <p className="break-words text-lg text-ink" style={style}>{value}</p>
}

function EditActions({ busy, onCancel, appearance }: { busy: boolean; onCancel: () => void; appearance: ResolvedAppearance }) {
  const style = fontStyle(appearance, appearance.controlFontPx)
  return (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        disabled={busy}
        style={style}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-base font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={style}
        className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
      >
        <X className="size-3.5" aria-hidden /> Cancel
      </button>
    </div>
  )
}

const inputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-3 py-2 text-lg text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

// ── Email ──────────────────────────────────────────────────────────────────

function EmailRow({
  present, verifiedAt, value, editing, busy, appearance, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  value: string | null
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
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
      <SectionShell contactIcon={Mail} label="Email" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} onEdit={open} onVerify={onVerify}>
        <ValueText value={value} present={present} appearance={appearance} />
      </SectionShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizeEmailInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value) // valid canonical value, or null when empty (a valid clear)
  }

  return (
    <form onSubmit={submit} className="py-3 first:pt-0 last:pb-0">
      <label htmlFor="cc-email" className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
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
        className={cn('mt-1.5', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-base text-status-missing-strong">{result.reason}</p>
      )}
      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}

// ── Phone ──────────────────────────────────────────────────────────────────

function PhoneRow({
  present, verifiedAt, value, editing, busy, appearance, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  value: string | null
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
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
      <SectionShell contactIcon={Phone} label="Phone" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} onEdit={open} onVerify={onVerify}>
        <ValueText value={value} present={present} appearance={appearance} />
      </SectionShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizePhoneInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value)
  }

  return (
    <form onSubmit={submit} className="py-3 first:pt-0 last:pb-0">
      <label htmlFor="cc-phone" className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
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
        className={cn('mt-1.5', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-base text-status-missing-strong">{result.reason}</p>
      )}
      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}

// ── Mailing address (edited as one group) ─────────────────────────────────────

function AddressRow({
  present, verifiedAt, record, editing, busy, appearance, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  record: CustomerContact
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
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
      <SectionShell contactIcon={MapPin} label="Mailing Address" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} onEdit={open} onVerify={onVerify}>
        {present ? (
          // The complete mailing address on two lines: street, then city/state/ZIP.
          <address className="not-italic text-lg leading-snug text-ink" style={fontStyle(appearance, appearance.valueFontPx)}>
            {lines.map((line, i) => <span key={i} className="block break-words">{line}</span>)}
          </address>
        ) : (
          <p className="text-lg font-medium text-status-missing-strong" style={fontStyle(appearance, appearance.valueFontPx)}>Missing</p>
        )}
      </SectionShell>
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
    <form onSubmit={submit} className="py-3 first:pt-0 last:pb-0">
      <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
        <MapPin className="size-4" aria-hidden /> Edit mailing address
      </p>
      <div className="mt-1.5 space-y-2">
        <div>
          <label htmlFor="cc-street" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">Street</label>
          <input id="cc-street" autoFocus value={street} onChange={(e) => setStreet(e.target.value)}
            placeholder="123 Main St" className={cn('mt-1', inputCls(false))} />
        </div>
        <div>
          <label htmlFor="cc-city" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">City</label>
          <input id="cc-city" value={city} onChange={(e) => setCity(e.target.value)}
            placeholder="Philadelphia" className={cn('mt-1', inputCls(false))} />
        </div>
        <div className="flex gap-2">
          <div className="w-24">
            <label htmlFor="cc-state" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">State</label>
            <input id="cc-state" value={stateVal} onChange={(e) => setStateVal(e.target.value)}
              maxLength={2} placeholder="PA" className={cn('mt-1 uppercase', inputCls(false))} />
          </div>
          <div className="flex-1">
            <label htmlFor="cc-zip" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">ZIP</label>
            <input id="cc-zip" value={zip} onChange={(e) => setZip(e.target.value)}
              placeholder="19103" className={cn('mt-1', inputCls(false))} />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-sm text-ink-supporting">
        A mailing address needs street, city, state, and ZIP to be usable and verifiable.
      </p>
      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}
