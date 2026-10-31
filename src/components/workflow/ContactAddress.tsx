'use client'

/**
 * ContactAddress — the reusable mailing-address surface for Right Path's
 * light-theme workflow UI. One component family for showing and editing a
 * customer's mailing address (street, city, state, ZIP) and its Customer
 * Verified state, so every light-theme screen presents, edits, normalizes, and
 * verifies the address the same way without copying logic.
 *
 * All normalization RULES live in `@/lib/fmt` (`normalizeStreet` title-cases but
 * keeps directionals/PO uppercase; `normalizeCity` title-cases; `normalizeState`
 * uppercases). This file is the UI layer:
 *
 *   - `AddressDisplay` — the read-only address on two lines (street, then
 *     "City, ST ZIP"), or a "Missing" treatment when no usable address is on
 *     file. A usable address needs street, city, state, AND ZIP.
 *   - `AddressFields` — the controlled street / city / state / ZIP inputs plus
 *     the Customer Verified checkbox. It carries NO Save/Cancel so it embeds in
 *     a larger coordinated form (the contact card's one Save) as well as the
 *     standalone editor.
 *   - `useAddressDraft` — the shared draft state + resolution hook backing the
 *     fields, so every host normalizes and resolves the address identically.
 *   - `AddressEditor` — `AddressFields` wrapped with its own Save/Cancel for a
 *     standalone edit.
 *
 * The behavior reproduced here (so every host matches):
 *   - Street and city are normalized on blur; state uppercases as typed.
 *   - A changed address clears its own prior verification (the host applies this
 *     against the value that will be on file; the server enforces it too).
 *   - Verified cannot be checked unless the full address (street+city+state+ZIP)
 *     is present.
 *
 * Nothing here persists; a host wires Save to its route.
 */

import { useMemo, useState } from 'react'
import { MapPin, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeStreet, normalizeCity, normalizeState } from '@/lib/fmt'

// ── Shared field styling (light-theme workflow tokens) ───────────────────────

const fieldInputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-2.5 py-1 text-sm text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

// ── Resolution helpers (shared by display + draft) ───────────────────────────

/** The stored mailing address as the card/route model it: `street` with a
 * fallback to the (in practice empty) `address_line1`. */
function streetOf(a: Pick<AddressRecord, 'street' | 'address_line1'>): string {
  return (a.street ?? a.address_line1 ?? '').trim()
}

/** The two display lines: normalized street, then "City, ST ZIP" (each part
 * omitted when blank). Empty when nothing is on file. */
export function addressLines(a: AddressRecord): string[] {
  const street = normalizeStreet(streetOf(a)) ?? ''
  const city = normalizeCity(a.city) ?? ''
  const state = normalizeState(a.state) ?? ''
  const zip = (a.zip ?? '').trim()
  const cityStateZip = [[city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(' ').trim()
  return [street, cityStateZip].filter(Boolean)
}

/** A usable mailing address needs street, city, state, AND ZIP. */
export function addressUsable(a: AddressRecord): boolean {
  return !!(streetOf(a) && a.city?.trim() && a.state?.trim() && a.zip?.trim())
}

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Show a customer's mailing address for reading: two lines (street, then
 * "City, ST ZIP"), or a "Missing" treatment when no usable address is on file.
 */
export function AddressDisplay({
  address,
  className,
  style,
  missingClassName,
}: {
  address: AddressRecord
  className?: string
  style?: React.CSSProperties
  /** Applied to "Missing" so a host can de-emphasize it. */
  missingClassName?: string
}) {
  const lines = addressLines(address)
  if (lines.length === 0) {
    return <span className={cn(className, missingClassName)} style={style}>Missing</span>
  }
  return (
    <span className={className} style={style}>
      {lines.map((line, i) => (
        <span key={i} className="block">{line}</span>
      ))}
    </span>
  )
}

// ── Draft state + resolution (shared by the fields and every host) ───────────

/** The record facts the draft seeds from and resolves against. */
export interface AddressRecord {
  street: string | null
  /** App convention fallback for the street column. */
  address_line1?: string | null
  city: string | null
  state: string | null
  zip: string | null
  /** Truthy when the stored address is currently Customer Verified. */
  address_verified_at: string | null
}

/** The editor's working draft: the four raw fields plus the Verified intent. */
export interface AddressDraft {
  street: string
  city: string
  state: string
  zip: string
  verified: boolean
}

export interface AddressDraftApi {
  draft: AddressDraft
  setField: (key: 'street' | 'city' | 'state' | 'zip', value: string) => void
  /** Normalize street/city on blur (title-case). No-op for state/zip. */
  blurNormalize: (key: 'street' | 'city') => void
  setVerified: (value: boolean) => void
  /** The resolved values that will be on file after save (null when blank). */
  resolved: { street: string | null; city: string | null; state: string | null; zip: string | null }
  /** Whether a usable (complete) address will be on file after save. */
  usableAfter: boolean
  /** Whether Verified can be toggled (a complete address). */
  canVerify: boolean
}

/** The shared draft + resolution hook. Every host drives `AddressFields`
 * through this so normalization, resolution, and verified gating are identical
 * everywhere. */
export function useAddressDraft(record: AddressRecord): AddressDraftApi {
  const [draft, setDraft] = useState<AddressDraft>(() => ({
    street: normalizeStreet(streetOf(record)) ?? '',
    city: normalizeCity(record.city) ?? '',
    state: normalizeState(record.state) ?? '',
    zip: record.zip ?? '',
    verified: !!record.address_verified_at,
  }))

  const setField = (key: 'street' | 'city' | 'state' | 'zip', value: string) =>
    setDraft((d) => ({ ...d, [key]: key === 'state' ? value.toUpperCase() : value }))
  const blurNormalize = (key: 'street' | 'city') =>
    setDraft((d) => ({
      ...d,
      [key]: (key === 'street' ? normalizeStreet(d.street) : normalizeCity(d.city)) ?? '',
    }))
  const setVerified = (value: boolean) => setDraft((d) => ({ ...d, verified: value }))

  const resolved = useMemo(
    () => ({
      street: normalizeStreet(draft.street),
      city: normalizeCity(draft.city),
      state: normalizeState(draft.state),
      zip: ((): string | null => { const t = draft.zip.replace(/\s+/g, ' ').trim(); return t.length ? t : null })(),
    }),
    [draft.street, draft.city, draft.state, draft.zip],
  )

  const usableAfter = !!(resolved.street && resolved.city && resolved.state && resolved.zip)

  return { draft, setField, blurNormalize, setVerified, resolved, usableAfter, canVerify: usableAfter }
}

// ── Fields (headless of Save/Cancel; embeddable) ─────────────────────────────

/**
 * The controlled street / city / state / ZIP inputs plus the Customer Verified
 * checkbox. It owns the layout and verified gating — but NO buttons, so it
 * embeds inside a larger coordinated form as well as the standalone editor. All
 * state comes from `useAddressDraft`.
 *
 * `idPrefix` keeps input ids unique when more than one instance renders on a
 * page.
 */
export function AddressFields({
  api,
  busy = false,
  idPrefix = 'addr',
  autoFocus = false,
}: {
  api: AddressDraftApi
  busy?: boolean
  idPrefix?: string
  autoFocus?: boolean
}) {
  const { draft, setField, blurNormalize, setVerified, canVerify } = api
  const id = (s: string) => `${idPrefix}-${s}`

  return (
    <div>
      <div className="space-y-2">
        <div>
          <label htmlFor={id('street')} className="text-xs font-medium uppercase tracking-wide text-ink-supporting">Street</label>
          <input
            id={id('street')} value={draft.street} disabled={busy} autoFocus={autoFocus}
            onChange={(e) => setField('street', e.target.value)}
            onBlur={() => blurNormalize('street')}
            placeholder="123 Main St" className={cn('mt-0.5', fieldInputCls(false))}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor={id('city')} className="text-xs font-medium uppercase tracking-wide text-ink-supporting">City</label>
            <input
              id={id('city')} value={draft.city} disabled={busy}
              onChange={(e) => setField('city', e.target.value)}
              onBlur={() => blurNormalize('city')}
              placeholder="Philadelphia" className={cn('mt-0.5', fieldInputCls(false))}
            />
          </div>
          <div className="w-16">
            <label htmlFor={id('state')} className="text-xs font-medium uppercase tracking-wide text-ink-supporting">State</label>
            <input
              id={id('state')} value={draft.state} disabled={busy} maxLength={2}
              onChange={(e) => setField('state', e.target.value)}
              placeholder="PA" className={cn('mt-0.5 uppercase', fieldInputCls(false))}
            />
          </div>
          <div className="w-24">
            <label htmlFor={id('zip')} className="text-xs font-medium uppercase tracking-wide text-ink-supporting">ZIP</label>
            <input
              id={id('zip')} value={draft.zip} disabled={busy}
              onChange={(e) => setField('zip', e.target.value)}
              placeholder="19103" className={cn('mt-0.5', fieldInputCls(false))}
            />
          </div>
        </div>
      </div>

      <div className="mt-2">
        <label
          className={cn(
            'flex w-fit items-center gap-2 text-sm font-medium',
            !canVerify || busy ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
          )}
          title={!canVerify ? 'A missing or incomplete address cannot be marked verified.' : undefined}
        >
          <input
            type="checkbox"
            checked={draft.verified && canVerify}
            disabled={busy || !canVerify}
            onChange={(e) => setVerified(e.target.checked)}
            className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
          />
          <span>Address verified</span>
        </label>
      </div>
    </div>
  )
}

// ── Standalone editor (fields + Save / Cancel) ───────────────────────────────

/** What a standalone address save hands back to the host. The host persists
 * these against the customer record (and applies the verification auto-clear on
 * a changed address). */
export interface AddressEditResult {
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  /** Whether the operator asked to mark the address Customer Verified. */
  verified: boolean
}

/**
 * The standalone address editor: the shared fields with their own Save / Cancel.
 * On Save it hands the host the normalized values and verified intent; it does
 * not persist. Hosts that edit the address inside a larger form embed
 * `AddressFields` with `useAddressDraft` directly instead.
 */
export function AddressEditor({
  record,
  busy = false,
  error = null,
  onCancel,
  onSave,
}: {
  record: AddressRecord
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onSave: (value: AddressEditResult) => void
}) {
  const api = useAddressDraft(record)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      street: api.resolved.street,
      city: api.resolved.city,
      state: api.resolved.state,
      zip: api.resolved.zip,
      verified: api.draft.verified && api.canVerify,
    })
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-bold text-ink">
        <MapPin className="size-4" aria-hidden /> Mailing Address
      </p>
      <div className="mt-1.5">
        <AddressFields api={api} busy={busy} autoFocus />
      </div>

      {error && <p className="mt-1.5 text-base text-status-missing-strong">{error}</p>}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-base font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
        >
          <X className="size-3.5" aria-hidden /> Cancel
        </button>
      </div>
    </form>
  )
}
