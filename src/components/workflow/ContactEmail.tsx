'use client'

/**
 * ContactEmail — the reusable email surface for Right Path's light-theme
 * workflow UI. One component family for showing and editing a customer's email,
 * so every light-theme screen presents, edits, validates, and records email
 * availability the same way without copying logic.
 *
 * All normalization/validation RULES live in `@/lib/contact-input`
 * (`normalizeEmailInput`: trim + lowercase + a light shape check, returning a
 * structured valid/empty/invalid result) and the availability state set lives in
 * `@/lib/email-availability`. This file is the UI layer:
 *
 *   - `EmailDisplay` — the read-only value: a usable address shown as-is, else
 *     the recorded reason ("No Usable Email", "Undeliverable") or "Missing".
 *   - `EmailFields` — the controlled email input, the three mutually-exclusive
 *     availability reason buttons (Missing / No Usable Email / Undeliverable),
 *     and the Customer Verified checkbox. It carries NO Save/Cancel so it embeds
 *     in a larger coordinated form (the contact card's one Save) as well as the
 *     standalone editor. This is the single implementation of the email field,
 *     the reason buttons, verified gating, and inline validation.
 *   - `useEmailDraft` — the shared draft state + validation hook backing the
 *     fields, so every host validates and resolves email identically.
 *   - `EmailEditor` — `EmailFields` wrapped with its own Save/Cancel for a
 *     standalone edit.
 *
 * The behavior reproduced here (so every host matches):
 *   - Typing an email and the three reason buttons are MUTUALLY EXCLUSIVE.
 *     Selecting a reason clears the typed email, disables the input, and clears
 *     the Verified checkbox. Clearing the reason restores the stored email.
 *   - A usable email saved sets availability to 'available'; "Missing" resets
 *     availability to unknown (null); the other two store their reason.
 *   - A changed email clears its own prior verification (the host applies this
 *     against the value that will be on file; the server enforces it too).
 *   - Verified cannot be checked without a usable email on file.
 *   - An invalid typed address blocks Save with an inline reason; an empty email
 *     with no reason is a valid "cleared" state.
 *
 * Nothing here persists; a host wires Save to its route.
 */

import { useMemo, useState } from 'react'
import { Mail, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeEmailInput, type ContactFieldResult } from '@/lib/contact-input'
import { normalizeEmail } from '@/lib/fmt'
import {
  type EmailAvailability,
  type SelectableEmailAvailability,
  EMAIL_AVAILABILITY_LABEL,
  SELECTABLE_EMAIL_AVAILABILITY_VALUES,
  resolveEmailAvailabilityDisplay,
} from '@/lib/email-availability'

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
 * Show a customer's email for reading: a usable address displayed trimmed and
 * lowercased, otherwise the recorded reason ("No Usable Email", "Undeliverable")
 * or "Missing" when nothing is on file and no reason is recorded. The wording
 * matches the editor so a display and an editor never disagree.
 */
export function EmailDisplay({
  email,
  availability,
  className,
  style,
  missingClassName,
}: {
  email: string | null | undefined
  availability: EmailAvailability | null | undefined
  /** Applied to the value element when a usable address is shown. */
  className?: string
  style?: React.CSSProperties
  /** Applied when the value is a reason/"Missing" rather than an address, so a
   * host can de-emphasize it. */
  missingClassName?: string
}) {
  const display = resolveEmailAvailabilityDisplay(availability, email)
  if (display === 'on_file') {
    return <span className={className} style={style}>{normalizeEmail(email)}</span>
  }
  const text = display === 'missing' ? EMAIL_AVAILABILITY_LABEL.missing : EMAIL_AVAILABILITY_LABEL[display]
  return <span className={cn(className, missingClassName)} style={style}>{text}</span>
}

// ── Draft state + validation (shared by the fields and every host) ───────────

/** The editor's working draft: the raw typed email, the staged availability
 * reason (mutually exclusive with a typed email), and the Verified intent. */
export interface EmailDraft {
  /** Raw typed email. Empty when a reason is staged. */
  email: string
  /** A staged "no usable email" reason, or null when editing the address. */
  reason: SelectableEmailAvailability | null
  /** Whether the operator wants the email marked Customer Verified. */
  verified: boolean
}

/** The record facts the draft seeds from and resolves against. */
export interface EmailRecord {
  email: string | null
  email_availability: EmailAvailability | null
  /** Truthy when the stored email is currently Customer Verified. */
  email_verified_at: string | null
}

export interface EmailDraftApi {
  draft: EmailDraft
  /** Set the typed email (clears any inline invalid message via the host). */
  setEmail: (value: string) => void
  /** Normalize the typed email on blur (trim + lowercase); no-op with a reason. */
  blurNormalize: () => void
  /** Toggle an availability reason. Selecting one clears the typed email and
   * Verified; selecting the active one again clears the reason and restores the
   * stored email. */
  selectReason: (choice: SelectableEmailAvailability) => void
  setVerified: (value: boolean) => void
  /** The live normalization of the typed email (for the inline message). */
  result: ContactFieldResult
  /** The email value that will be on file after save: null when a reason is
   * staged, else the normalized typed value (null when empty). */
  resolvedEmail: string | null
  /** The availability that will be on file after save. */
  resolvedAvailability: EmailAvailability | null
  /** Whether a usable email will be on file after save (gates Verified). */
  usableAfter: boolean
  /** Whether Verified can be toggled (a usable email, no staged reason). */
  canVerify: boolean
  /** Whether the draft is valid to save. Invalid only when a typed address has
   * content but bad shape (an empty address with no reason is a valid clear). */
  valid: boolean
  /** The inline invalid reason, or null. */
  invalidReason: string | null
}

/** The shared draft + validation hook. Every host drives `EmailFields` through
 * this so validation and resolution are identical everywhere. */
export function useEmailDraft(record: EmailRecord): EmailDraftApi {
  const [draft, setDraft] = useState<EmailDraft>(() => ({
    email: record.email ?? '',
    reason: null,
    verified: !!record.email_verified_at,
  }))

  const setEmail = (value: string) => setDraft((d) => ({ ...d, email: value }))
  const blurNormalize = () =>
    setDraft((d) => (d.reason ? d : { ...d, email: normalizeEmailInput(d.email).value ?? d.email }))
  const setVerified = (value: boolean) => setDraft((d) => ({ ...d, verified: value }))
  const selectReason = (choice: SelectableEmailAvailability) =>
    setDraft((d) => {
      const next = d.reason === choice ? null : choice
      return {
        ...d,
        reason: next,
        email: next ? '' : (record.email ?? ''),
        verified: next ? false : d.verified,
      }
    })

  const result = useMemo(() => normalizeEmailInput(draft.email), [draft.email])

  // What will be on file after save. A staged reason clears the email; "Missing"
  // resets availability to unknown (null), the other reasons store themselves. A
  // usable typed address flips availability to 'available'.
  let resolvedEmail: string | null
  let resolvedAvailability: EmailAvailability | null
  if (draft.reason) {
    resolvedEmail = null
    resolvedAvailability = draft.reason === 'missing' ? null : draft.reason
  } else {
    resolvedEmail = result.status === 'valid' ? result.value : null
    resolvedAvailability = resolvedEmail ? 'available' : (record.email_availability ?? null)
  }

  const usableAfter = !!(resolvedEmail && resolvedEmail.trim())
  const canVerify = !draft.reason && usableAfter
  const valid = draft.reason != null || result.status !== 'invalid'
  const invalidReason = result.status === 'invalid' ? (result.reason ?? null) : null

  return {
    draft,
    setEmail,
    blurNormalize,
    selectReason,
    setVerified,
    result,
    resolvedEmail,
    resolvedAvailability,
    usableAfter,
    canVerify,
    valid,
    invalidReason,
  }
}

// ── Fields (headless of Save/Cancel; embeddable) ─────────────────────────────

/**
 * The controlled email input, the three mutually-exclusive availability reason
 * buttons, and the Customer Verified checkbox. It owns the layout, the inline
 * invalid message, and verified gating — but NO buttons, so it embeds inside a
 * larger coordinated form as well as the standalone editor. All state and
 * validity come from `useEmailDraft`.
 *
 * `idPrefix` keeps the input id unique when more than one instance renders on a
 * page. `showError` lets the host defer the inline message until a save attempt.
 */
export function EmailFields({
  api,
  busy = false,
  idPrefix = 'email',
  showError = true,
  autoFocus = false,
}: {
  api: EmailDraftApi
  busy?: boolean
  idPrefix?: string
  showError?: boolean
  autoFocus?: boolean
}) {
  const { draft, setEmail, blurNormalize, selectReason, setVerified, result, canVerify, invalidReason } = api
  const id = (s: string) => `${idPrefix}-${s}`
  const reason = draft.reason

  return (
    <div>
      <input
        id={id('input')}
        type="email"
        autoFocus={autoFocus}
        value={draft.email}
        disabled={busy || !!reason}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={blurNormalize}
        placeholder={reason ? EMAIL_AVAILABILITY_LABEL[reason] : 'name@example.com'}
        aria-invalid={result.status === 'invalid' || undefined}
        className={cn(fieldInputCls(result.status === 'invalid'), reason && 'opacity-50')}
      />

      {showError && invalidReason && (
        <p className="mt-1 text-sm text-status-missing-strong">{invalidReason}</p>
      )}

      {/* The three mutually-exclusive availability reasons. Selecting one clears
          the typed email and Verified; selecting it again restores the email. */}
      <div className="mt-2 flex flex-wrap gap-2">
        {SELECTABLE_EMAIL_AVAILABILITY_VALUES.map((choice) => {
          const selected = reason === choice
          return (
            <button
              key={choice}
              type="button"
              disabled={busy}
              aria-pressed={selected}
              onClick={() => selectReason(choice)}
              className={cn(
                'inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
                selected
                  ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
                  : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
              )}
            >
              {EMAIL_AVAILABILITY_LABEL[choice]}
            </button>
          )
        })}
      </div>

      <div className="mt-2">
        <label
          className={cn(
            'flex w-fit items-center gap-2 text-sm font-medium',
            !canVerify || busy ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
          )}
          title={!canVerify ? 'A missing or unusable email cannot be marked verified.' : undefined}
        >
          <input
            type="checkbox"
            checked={draft.verified && canVerify}
            disabled={busy || !canVerify}
            onChange={(e) => setVerified(e.target.checked)}
            className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
          />
          <span>Email verified</span>
        </label>
      </div>
    </div>
  )
}

// ── Standalone editor (fields + Save / Cancel) ───────────────────────────────

/** What a standalone email save hands back to the host. The host persists these
 * against the customer record (and applies the verification auto-clear on a
 * changed value). */
export interface EmailEditResult {
  /** The email that will be on file (null clears it). */
  email: string | null
  /** The availability that will be on file (null = unknown/"Missing"). */
  availability: EmailAvailability | null
  /** Whether the operator asked to mark the email Customer Verified. */
  verified: boolean
}

/**
 * The standalone email editor: the shared fields with their own Save / Cancel.
 * On Save it validates via the shared hook and hands the host the resolved
 * email, availability, and verified intent; it does not persist. Hosts that
 * edit email inside a larger form embed `EmailFields` with `useEmailDraft`
 * directly instead.
 */
export function EmailEditor({
  record,
  busy = false,
  error = null,
  onCancel,
  onSave,
}: {
  record: EmailRecord
  busy?: boolean
  /** A host-supplied error (e.g. a rejected save) shown beneath the controls. */
  error?: string | null
  onCancel: () => void
  onSave: (value: EmailEditResult) => void
}) {
  const api = useEmailDraft(record)
  const [attempted, setAttempted] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!api.valid) return
    onSave({
      email: api.resolvedEmail,
      availability: api.resolvedAvailability,
      verified: api.draft.verified && api.canVerify,
    })
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-bold text-ink">
        <Mail className="size-4" aria-hidden /> Email
      </p>
      <div className="mt-1.5">
        <EmailFields api={api} busy={busy} showError={attempted} autoFocus />
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
