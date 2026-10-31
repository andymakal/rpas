'use client'

/**
 * ContactPhone — the reusable phone surface for Right Path's light-theme
 * workflow UI. One component family for showing and editing a customer's phone
 * number AND its text-message availability (Do Not Text / Text Undeliverable),
 * so every light-theme screen presents, edits, validates, and restricts texting
 * the same way without copying logic.
 *
 * Texting belongs to the phone: both restrictions ride the number, so they live
 * here with it rather than as a separate surface. All normalization/validation
 * RULES live in `@/lib/contact-input` (`normalizePhoneInput`,
 * `formatPhoneAsTyped`: the one `(XXX) XXX-XXXX` standard) and the texting status
 * set lives in `@/lib/sms-availability`. This file is the UI layer:
 *
 *   - `PhoneDisplay` — the read-only value: the formatted number, with the
 *     texting restriction noted on its own line when texting is off, or "Missing"
 *     when no number is on file.
 *   - `PhoneFields` — the controlled phone input, the Text-message availability
 *     controls (Do Not Text + Text Undeliverable), and the Customer Verified
 *     checkbox. It carries NO Save/Cancel so it embeds in a larger coordinated
 *     form (the contact card's one Save) as well as the standalone editor. This
 *     is the single implementation of the phone field, the texting toggles,
 *     verified gating, and inline validation.
 *   - `usePhoneDraft` — the shared draft state + validation hook backing the
 *     fields, so every host validates and resolves phone + texting identically.
 *   - `PhoneEditor` — `PhoneFields` wrapped with its own Save/Cancel for a
 *     standalone edit.
 *
 * The behavior reproduced here (so every host matches):
 *   - The number is formatted to the `(XXX) XXX-XXXX` standard as typed; it is
 *     validated on blur. An invalid number blocks Save with an inline reason; an
 *     empty number is a valid "cleared" state.
 *   - Do Not Text is the durable customer opt-out (`sms_opt_out`); it is
 *     togglable even with no number on file (it follows the customer) and
 *     outranks Undeliverable.
 *   - Text Undeliverable records a delivery failure for the NUMBER that will be
 *     on file; it needs a number, is moot while Do Not Text is on, and is locked
 *     ON when the current number already failed and is unchanged (it clears only
 *     by replacing the number). It is never cleared here.
 *   - A changed number clears its own prior verification (the host applies this
 *     against the value that will be on file; the server enforces it too).
 *   - Verified cannot be checked without a usable number on file.
 *   - Both texting restrictions disable TEXTING only; telephone calls are never
 *     affected.
 *
 * Nothing here persists; a host wires Save to its route.
 */

import { useMemo, useState } from 'react'
import { Phone, Ban, MessageSquareOff, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizePhoneInput, formatPhoneAsTyped, formatPhoneDisplay, type ContactFieldResult } from '@/lib/contact-input'
import {
  type SmsAvailabilityDisplay,
  SMS_AVAILABILITY_LABEL,
  SMS_AVAILABILITY_HELP,
  resolveSmsAvailabilityDisplay,
} from '@/lib/sms-availability'

// ── Shared field styling (light-theme workflow tokens) ───────────────────────

const fieldInputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-2.5 py-1 text-sm text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Show a customer's phone for reading: the formatted number, with the texting
 * restriction (Do Not Text / Text Undeliverable) on a second line when texting
 * is off, or "Missing" when no number is on file. Calls are never affected, so
 * the number still shows even when texting is restricted.
 */
export function PhoneDisplay({
  phone,
  smsOptOut,
  textUndeliverable,
  className,
  style,
  missingClassName,
  noteClassName,
}: {
  phone: string | null | undefined
  /** The durable customer texting opt-out (`customers.sms_opt_out`). */
  smsOptOut: boolean
  /** Whether the NUMBER on file has a recorded text-delivery failure. */
  textUndeliverable: boolean
  /** Applied to the number element. */
  className?: string
  style?: React.CSSProperties
  /** Applied to "Missing" so a host can de-emphasize it. */
  missingClassName?: string
  /** Applied to the texting-restriction note line. */
  noteClassName?: string
}) {
  const number = formatPhoneDisplay(phone)
  const display = resolveSmsAvailabilityDisplay({
    smsOptOut,
    textUndeliverable: textUndeliverable && !!number,
  })
  if (!number) {
    const text = display === 'do_not_text' ? SMS_AVAILABILITY_LABEL.do_not_text : 'Missing'
    return <span className={cn(className, missingClassName)} style={style}>{text}</span>
  }
  return (
    <span className={className} style={style}>
      {number}
      {display !== 'available' && (
        <span className={cn('block', noteClassName)}>{SMS_AVAILABILITY_LABEL[display]}</span>
      )}
    </span>
  )
}

// ── Draft state + validation (shared by the fields and every host) ───────────

/** The editor's working draft: the raw (as-typed) phone and the two STAGED
 * texting restrictions. Nothing persists until the host saves. */
export interface PhoneDraft {
  /** As-typed phone, kept in the `(XXX) XXX-XXXX` standard while editing. */
  phone: string
  /** Staged Do Not Text opt-out. */
  doNotText: boolean
  /** Staged Text Undeliverable (delivery failure for the number on file). */
  markUndeliverable: boolean
  /** Whether the operator wants the number marked Customer Verified. */
  verified: boolean
}

/** The record facts the draft seeds from and resolves against. */
export interface PhoneRecord {
  phone: string | null
  /** The durable customer texting opt-out (`customers.sms_opt_out`). */
  sms_opt_out: boolean
  /** Whether the number CURRENTLY on file has a recorded text-delivery failure
   * (the resolved per-number fact; replacing the number clears it on its own). */
  text_undeliverable: boolean
  /** Truthy when the stored number is currently Customer Verified. */
  phone_verified_at: string | null
}

export interface PhoneDraftApi {
  draft: PhoneDraft
  /** Set the typed phone (re-formatted to the standard as typed). */
  setPhone: (value: string) => void
  /** Normalize/validate the typed phone on blur (for the inline message). */
  blurNormalize: () => void
  toggleDoNotText: () => void
  toggleUndeliverable: () => void
  setVerified: (value: boolean) => void
  /** The live normalization of the typed phone (for the inline message). */
  result: ContactFieldResult
  /** The phone value that will be on file after save (null when empty). */
  resolvedPhone: string | null
  /** Whether a usable number will be on file after save. */
  willHaveNumber: boolean
  /** Whether the staged number equals the stored number. */
  numberUnchanged: boolean
  /** The current number already failed and is unchanged, so Text Undeliverable
   * cannot be cleared here (the toggle shows pressed and locked). */
  lockedUndeliverable: boolean
  /** Whether a delivery failure should be RECORDED on save (staged, gated on a
   * number, not already-and-unchanged). Never clears a failure. */
  willMarkUndeliverable: boolean
  /** The staged texting status, for the help/preview line. */
  smsDisplay: SmsAvailabilityDisplay
  /** Whether Verified can be toggled (a usable number). */
  canVerify: boolean
  /** Whether the draft is valid to save (an empty number is a valid clear). */
  valid: boolean
  /** The inline invalid reason, or null. */
  invalidReason: string | null
}

/** The shared draft + validation hook. Every host drives `PhoneFields` through
 * this so validation, texting gating, and resolution are identical everywhere. */
export function usePhoneDraft(record: PhoneRecord): PhoneDraftApi {
  const [draft, setDraft] = useState<PhoneDraft>(() => ({
    phone: formatPhoneAsTyped(record.phone ?? ''),
    doNotText: record.sms_opt_out === true,
    markUndeliverable: record.text_undeliverable === true && !!record.phone?.trim(),
    verified: !!record.phone_verified_at,
  }))

  const setPhone = (value: string) => setDraft((d) => ({ ...d, phone: formatPhoneAsTyped(value) }))
  // The value is already kept in the standard format on every keystroke, and
  // validity is derived live, so blur has nothing to re-format. Kept as a named
  // handler so PhoneFields can wire onBlur uniformly with the other Legos.
  const blurNormalize = () => {}
  const toggleDoNotText = () => setDraft((d) => ({ ...d, doNotText: !d.doNotText }))
  const setVerified = (value: boolean) => setDraft((d) => ({ ...d, verified: value }))

  const result = useMemo(() => normalizePhoneInput(draft.phone), [draft.phone])

  // The number that WILL be on file after Save, so the texting controls and
  // verification reflect the pending state, not the stored one.
  const resolvedPhone = result.status === 'valid' ? result.value : null
  const willHaveNumber = result.status !== 'empty' && result.status !== 'invalid'
  const storedNormalized = record.phone ? (normalizePhoneInput(record.phone).value ?? null) : null
  const numberUnchanged = (resolvedPhone ?? null) === storedNormalized
  // Text Undeliverable clears only by replacing the number, so when the number
  // is unchanged and already undeliverable the control is locked on.
  const lockedUndeliverable =
    record.text_undeliverable === true && !!record.phone?.trim() && numberUnchanged && willHaveNumber

  // Toggling Undeliverable respects the lock (can't be turned off in place).
  const toggleUndeliverable = () =>
    setDraft((d) => (lockedUndeliverable ? d : { ...d, markUndeliverable: !d.markUndeliverable }))

  const willMarkUndeliverable =
    draft.markUndeliverable && willHaveNumber && !lockedUndeliverable &&
    !(numberUnchanged && record.text_undeliverable === true)

  const smsDisplay = resolveSmsAvailabilityDisplay({
    smsOptOut: draft.doNotText,
    textUndeliverable: draft.markUndeliverable && willHaveNumber,
  })

  const canVerify = !!(resolvedPhone && resolvedPhone.trim())
  const valid = result.status !== 'invalid'
  const invalidReason = result.status === 'invalid' ? (result.reason ?? null) : null

  return {
    draft,
    setPhone,
    blurNormalize,
    toggleDoNotText,
    toggleUndeliverable,
    setVerified,
    result,
    resolvedPhone,
    willHaveNumber,
    numberUnchanged,
    lockedUndeliverable,
    willMarkUndeliverable,
    smsDisplay,
    canVerify,
    valid,
    invalidReason,
  }
}

// ── Text-message availability controls (embedded in the fields) ──────────────

/**
 * The Text-message availability controls: Do Not Text and Text Undeliverable,
 * each a STAGED toggle that is part of the host's single Save (clicking flips
 * the pending selection; nothing persists until Save). Both disable texting
 * only; telephone calls are never affected.
 */
function SmsAvailabilityControls({
  display, hasNumber, doNotText, undeliverable, lockedUndeliverable, busy,
  onToggleDoNotText, onToggleUndeliverable,
}: {
  display: SmsAvailabilityDisplay
  hasNumber: boolean
  doNotText: boolean
  undeliverable: boolean
  lockedUndeliverable: boolean
  busy: boolean
  onToggleDoNotText: () => void
  onToggleUndeliverable: () => void
}) {
  return (
    <fieldset className="mt-3 border-t border-surface-border-strong pt-3">
      <legend className="text-sm font-semibold text-ink-secondary">Text-message availability</legend>
      <p className="mt-0.5 text-sm text-ink-muted">
        {SMS_AVAILABILITY_HELP[display]}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-pressed={doNotText}
          onClick={onToggleDoNotText}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
            doNotText
              ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
              : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
          )}
        >
          <Ban className="size-3.5 shrink-0" aria-hidden />
          Do Not Text
        </button>
        <button
          type="button"
          disabled={busy || !hasNumber || doNotText || lockedUndeliverable}
          aria-pressed={undeliverable}
          onClick={onToggleUndeliverable}
          title={
            !hasNumber ? 'Enter a phone number first.'
            : doNotText ? 'Do Not Text already disables texting.'
            : lockedUndeliverable ? 'Already undeliverable. Replace the number to restore texting.'
            : 'Mark that a text to this number failed to deliver (saved on Save).'
          }
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
            undeliverable && !doNotText
              ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
              : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
          )}
        >
          <MessageSquareOff className="size-3.5 shrink-0" aria-hidden />
          Text Undeliverable
        </button>
      </div>
    </fieldset>
  )
}

// ── Fields (headless of Save/Cancel; embeddable) ─────────────────────────────

/**
 * The controlled phone input, the Text-message availability controls, and the
 * Customer Verified checkbox. It owns the layout, the inline invalid message,
 * texting gating, and verified gating — but NO buttons, so it embeds inside a
 * larger coordinated form as well as the standalone editor. All state and
 * validity come from `usePhoneDraft`.
 *
 * `idPrefix` keeps the input id unique when more than one instance renders on a
 * page. `showError` lets the host defer the inline message until a save attempt.
 */
export function PhoneFields({
  api,
  busy = false,
  idPrefix = 'phone',
  showError = true,
  autoFocus = false,
}: {
  api: PhoneDraftApi
  busy?: boolean
  idPrefix?: string
  showError?: boolean
  autoFocus?: boolean
}) {
  const {
    draft, setPhone, blurNormalize, toggleDoNotText, toggleUndeliverable, setVerified,
    result, willHaveNumber, lockedUndeliverable, smsDisplay, canVerify, invalidReason,
  } = api
  const id = (s: string) => `${idPrefix}-${s}`

  return (
    <div>
      <input
        id={id('input')}
        type="tel"
        autoFocus={autoFocus}
        value={draft.phone}
        disabled={busy}
        onChange={(e) => setPhone(e.target.value)}
        onBlur={blurNormalize}
        placeholder="(215) 555-0100"
        aria-invalid={result.status === 'invalid' || undefined}
        className={fieldInputCls(result.status === 'invalid')}
      />

      {showError && invalidReason && (
        <p className="mt-1 text-sm text-status-missing-strong">{invalidReason}</p>
      )}

      <SmsAvailabilityControls
        display={smsDisplay}
        hasNumber={willHaveNumber}
        doNotText={draft.doNotText}
        undeliverable={draft.markUndeliverable && willHaveNumber}
        lockedUndeliverable={lockedUndeliverable}
        busy={busy}
        onToggleDoNotText={toggleDoNotText}
        onToggleUndeliverable={toggleUndeliverable}
      />

      <div className="mt-2">
        <label
          className={cn(
            'flex w-fit items-center gap-2 text-sm font-medium',
            !canVerify || busy ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
          )}
          title={!canVerify ? 'A missing or unusable number cannot be marked verified.' : undefined}
        >
          <input
            type="checkbox"
            checked={draft.verified && canVerify}
            disabled={busy || !canVerify}
            onChange={(e) => setVerified(e.target.checked)}
            className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
          />
          <span>Phone verified</span>
        </label>
      </div>
    </div>
  )
}

// ── Standalone editor (fields + Save / Cancel) ───────────────────────────────

/** What a standalone phone save hands back to the host. The host persists these
 * against the customer record (and applies the verification auto-clear on a
 * changed number). */
export interface PhoneEditResult {
  /** The number that will be on file (null clears it). */
  phone: string | null
  /** The staged Do Not Text opt-out. */
  doNotText: boolean
  /** Whether a delivery failure should be recorded for the number on file. */
  markUndeliverable: boolean
  /** Whether the operator asked to mark the number Customer Verified. */
  verified: boolean
}

/**
 * The standalone phone editor: the shared fields with their own Save / Cancel.
 * On Save it validates via the shared hook and hands the host the resolved
 * number, texting selections, and verified intent; it does not persist. Hosts
 * that edit phone inside a larger form embed `PhoneFields` with `usePhoneDraft`
 * directly instead.
 */
export function PhoneEditor({
  record,
  busy = false,
  error = null,
  onCancel,
  onSave,
}: {
  record: PhoneRecord
  busy?: boolean
  /** A host-supplied error (e.g. a rejected save) shown beneath the controls. */
  error?: string | null
  onCancel: () => void
  onSave: (value: PhoneEditResult) => void
}) {
  const api = usePhoneDraft(record)
  const [attempted, setAttempted] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!api.valid) return
    onSave({
      phone: api.resolvedPhone,
      doNotText: api.draft.doNotText,
      markUndeliverable: api.willMarkUndeliverable,
      verified: api.draft.verified && api.canVerify,
    })
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-bold text-ink">
        <Phone className="size-4" aria-hidden /> Phone
      </p>
      <div className="mt-1.5">
        <PhoneFields api={api} busy={busy} showError={attempted} autoFocus />
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
