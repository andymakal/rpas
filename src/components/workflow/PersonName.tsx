'use client'

/**
 * PersonName — the reusable name surface for Right Path's light-theme workflow
 * UI. One component family for showing and editing a customer's name, so every
 * light-theme screen presents, edits, and validates names the same way without
 * copying logic.
 *
 * All presentation and validation RULES live in `@/lib/person-name` (familiar /
 * greeting / full-recorded, the suffix-in-familiar preference, the suffix
 * dropdown model, and normalization that preserves spelling, capitalization,
 * accents, and multi-word names). This file is the UI layer:
 *
 *   - `PersonNameDisplay` — the familiar name shown prominently, with the full
 *     recorded name beneath it ONLY when it differs.
 *   - `PersonNameFields` — the controlled field rows (First, Middle, Last,
 *     Suffix dropdown; Goes by + the suffix-in-familiar checkbox) plus the live
 *     familiar + greeting preview. It carries NO Save/Cancel, so it can be
 *     embedded in a larger form (the contact card's one coordinated save) as
 *     well as the standalone editor. This is the single implementation of the
 *     name fields, widths, required indicators, and inline validation.
 *   - `usePersonNameDraft` — the shared draft state + validation hook that backs
 *     the fields, so every host validates names identically.
 *   - `PersonNameEditor` — `PersonNameFields` wrapped with its own Save/Cancel
 *     for hosts that edit the name on its own.
 *
 * Nothing here persists; a host wires Save to its route. Capitalization and
 * accents are preserved, multi-word names stay whole, and nothing is inferred —
 * no nickname guessing, no middle name in a greeting.
 */

import { useMemo, useState } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type PersonName,
  type SuffixSelection,
  type PersonNameFieldErrors,
  SUFFIX_OPTIONS,
  presentPersonName,
  familiarName,
  greetingName,
  validatePersonName,
  includeSuffixInFamiliar,
  suffixSelectionFrom,
  resolveSuffixSelection,
  normalizeNameInput,
} from '@/lib/person-name'

// ── Shared field styling (light-theme workflow tokens) ───────────────────────

const fieldInputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-3 py-2 text-lg text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

const labelCls = 'block text-sm font-medium text-ink-secondary'

/** A field label, with a red required asterisk when the field is required. */
function FieldLabel({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={labelCls}>
      {children}
      {required && <span className="ml-0.5 text-status-missing-strong" aria-hidden>*</span>}
    </label>
  )
}

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Show a customer's name: the familiar name prominently, and the full recorded
 * name beneath it only when the full name carries something the familiar name
 * does not (a middle name, a suppressed suffix, or a different recorded first
 * name behind a "Goes by").
 */
export function PersonNameDisplay({
  name,
  className,
  style,
  fallback = 'Unknown customer',
  showFullRecorded = true,
}: {
  name: PersonName
  /** Applied to the prominent familiar-name element so the host controls its
   * size/weight (e.g. the card's 33px bold teal heading). */
  className?: string
  style?: React.CSSProperties
  /** Label shown when nothing is recorded. */
  fallback?: string
  /** Show the full recorded name beneath the familiar name when they differ.
   * Default true; a host that only wants the familiar name sets it false. */
  showFullRecorded?: boolean
}) {
  const p = useMemo(() => presentPersonName(name, fallback), [name, fallback])
  return (
    <div>
      <div className={className} style={style}>{p.familiar}</div>
      {showFullRecorded && p.fullDiffersFromFamiliar && (
        <div className="mt-0.5 text-base font-medium text-ink-supporting">
          Full name: <span className="text-ink-secondary">{p.full}</span>
        </div>
      )}
    </div>
  )
}

// ── Draft state + validation (shared by the fields and every host) ───────────

/** The editor's working draft: raw strings for the text fields plus the suffix
 * dropdown selection and the familiar-suffix preference. */
export interface PersonNameDraft {
  first: string
  middle: string
  last: string
  goesBy: string
  suffix: SuffixSelection
  /** null = no preference recorded (defaults to include). */
  suffixInFamiliar: boolean | null
}

function draftFromName(name: PersonName): PersonNameDraft {
  return {
    first: name.firstName ?? '',
    middle: name.middleName ?? '',
    last: name.lastName ?? '',
    goesBy: name.goesBy ?? '',
    suffix: suffixSelectionFrom(name.suffix),
    suffixInFamiliar: name.suffixInFamiliar,
  }
}

/** Build the live PersonName from a draft (what the preview shows and what Save
 * persists — they must match). */
export function nameFromDraft(d: PersonNameDraft): PersonName {
  return {
    firstName: normalizeNameInput(d.first).value,
    middleName: normalizeNameInput(d.middle).value,
    lastName: normalizeNameInput(d.last).value,
    goesBy: normalizeNameInput(d.goesBy).value,
    suffix: resolveSuffixSelection(d.suffix),
    suffixInFamiliar: d.suffixInFamiliar,
  }
}

/** True when the draft's suffix dropdown is on "Other" with blank custom text. */
function suffixOtherBlank(d: PersonNameDraft): boolean {
  return d.suffix.option === 'Other' && normalizeNameInput(d.suffix.custom).status === 'empty'
}

/** Whether the draft has a suffix that will appear (so the familiar-suffix
 * preference is meaningful). */
function draftHasSuffix(d: PersonNameDraft): boolean {
  return resolveSuffixSelection(d.suffix) != null
}

export interface PersonNameDraftApi {
  draft: PersonNameDraft
  setField: <K extends keyof PersonNameDraft>(key: K, value: PersonNameDraft[K]) => void
  /** Normalize a text field on blur (collapse whitespace, trim; caps kept). */
  blurNormalize: (key: 'first' | 'middle' | 'last' | 'goesBy') => void
  /** The live name the draft resolves to (preview + save payload). */
  liveName: PersonName
  /** Whether a suffix is present (preference checkbox shown only then). */
  hasSuffix: boolean
  /** Whether the suffix should appear in the familiar name (resolved default). */
  suffixInFamiliar: boolean
  /** Validity of the current draft. */
  valid: boolean
  reason: string | null
  fieldErrors: PersonNameFieldErrors
  /** The normalized, validated name, or null when invalid. */
  resolve: () => PersonName | null
}

/** The shared draft + validation hook. Every host (standalone editor, contact
 * card) drives `PersonNameFields` through this, so validation and resolution
 * are identical everywhere. */
export function usePersonNameDraft(name: PersonName): PersonNameDraftApi {
  const [draft, setDraft] = useState<PersonNameDraft>(() => draftFromName(name))

  const setField = <K extends keyof PersonNameDraft>(key: K, value: PersonNameDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const blurNormalize = (key: 'first' | 'middle' | 'last' | 'goesBy') =>
    setDraft((d) => ({ ...d, [key]: normalizeNameInput(d[key]).value ?? '' }))

  const liveName = useMemo(() => nameFromDraft(draft), [draft])
  const validation = useMemo(
    () =>
      validatePersonName({
        firstName: draft.first,
        middleName: draft.middle,
        lastName: draft.last,
        goesBy: draft.goesBy,
        suffix: resolveSuffixSelection(draft.suffix),
        suffixInFamiliar: draft.suffixInFamiliar,
        suffixOtherBlank: suffixOtherBlank(draft),
      }),
    [draft],
  )

  return {
    draft,
    setField,
    blurNormalize,
    liveName,
    hasSuffix: draftHasSuffix(draft),
    suffixInFamiliar: includeSuffixInFamiliar(liveName),
    valid: validation.status === 'valid',
    reason: validation.status === 'invalid' ? validation.reason : null,
    fieldErrors: validation.status === 'invalid' ? validation.fieldErrors : {},
    resolve: () => (validation.status === 'valid' ? { ...validation.value } : null),
  }
}

// ── Fields (headless of Save/Cancel; embeddable) ─────────────────────────────

/**
 * The controlled name fields plus the live familiar + greeting preview. It owns
 * the layout (First, Middle, Last, Suffix on the first row; Goes by + the
 * suffix-in-familiar checkbox on the second), the required asterisks, the
 * practical field widths, and the inline required-field error — but NO buttons,
 * so it embeds inside a larger coordinated form as well as the standalone
 * editor. All state and validity come from `usePersonNameDraft`.
 *
 * `idPrefix` keeps input ids unique when more than one instance renders on a
 * page. `showError` lets the host defer the inline message until a save attempt
 * (the contact card shows it only after Save is pressed).
 */
export function PersonNameFields({
  api,
  busy = false,
  idPrefix = 'pn',
  showError = true,
  autoFocus = true,
}: {
  api: PersonNameDraftApi
  busy?: boolean
  idPrefix?: string
  showError?: boolean
  autoFocus?: boolean
}) {
  const { draft, setField, blurNormalize, liveName, hasSuffix, suffixInFamiliar, reason, fieldErrors } = api
  const id = (s: string) => `${idPrefix}-${s}`
  const familiar = familiarName(liveName)
  const greeting = greetingName(liveName)

  return (
    <div>
      {/* Row 1: First, Middle, Last share the width evenly; Suffix is a narrow
          fixed column (its values are short). Wraps gracefully on small widths. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[6rem] flex-1">
          <FieldLabel htmlFor={id('first')} required>First</FieldLabel>
          <input
            id={id('first')} type="text" autoFocus={autoFocus} value={draft.first} disabled={busy}
            onChange={(e) => setField('first', e.target.value)}
            onBlur={() => blurNormalize('first')}
            aria-invalid={fieldErrors.firstName || undefined}
            className={cn('mt-0.5', fieldInputCls(!!fieldErrors.firstName))}
          />
        </div>
        <div className="min-w-[6rem] flex-1">
          <FieldLabel htmlFor={id('middle')}>Middle</FieldLabel>
          <input
            id={id('middle')} type="text" value={draft.middle} disabled={busy}
            onChange={(e) => setField('middle', e.target.value)}
            onBlur={() => blurNormalize('middle')}
            className={cn('mt-0.5', fieldInputCls(false))}
          />
        </div>
        <div className="min-w-[6rem] flex-1">
          <FieldLabel htmlFor={id('last')} required>Last</FieldLabel>
          <input
            id={id('last')} type="text" value={draft.last} disabled={busy}
            onChange={(e) => setField('last', e.target.value)}
            onBlur={() => blurNormalize('last')}
            aria-invalid={fieldErrors.lastName || undefined}
            className={cn('mt-0.5', fieldInputCls(!!fieldErrors.lastName))}
          />
        </div>
        <div className="w-[5.5rem] shrink-0">
          <FieldLabel htmlFor={id('suffix')}>Suffix</FieldLabel>
          <select
            id={id('suffix')}
            value={draft.suffix.option}
            disabled={busy}
            onChange={(e) => setField('suffix', { ...draft.suffix, option: e.target.value as SuffixSelection['option'] })}
            className={cn('mt-0.5 px-2', fieldInputCls(false), 'bg-surface-card')}
          >
            {SUFFIX_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Goes by (narrow) + the custom-suffix field when "Other" and the
          suffix-in-familiar checkbox when a suffix exists. One compact row. */}
      <div className="mt-1.5 flex flex-wrap items-end gap-x-4 gap-y-1.5">
        <div className="w-[12rem] max-w-full">
          <FieldLabel htmlFor={id('goesby')}>Goes by</FieldLabel>
          <input
            id={id('goesby')} type="text" value={draft.goesBy} disabled={busy}
            onChange={(e) => setField('goesBy', e.target.value)}
            onBlur={() => blurNormalize('goesBy')}
            className={cn('mt-0.5', fieldInputCls(false))}
          />
        </div>
        {draft.suffix.option === 'Other' && (
          <div className="w-[10rem] max-w-full">
            <FieldLabel htmlFor={id('suffix-custom')} required>Suffix</FieldLabel>
            <input
              id={id('suffix-custom')} type="text" autoFocus value={draft.suffix.custom} disabled={busy}
              onChange={(e) => setField('suffix', { ...draft.suffix, custom: e.target.value })}
              onBlur={() => setField('suffix', { ...draft.suffix, custom: normalizeNameInput(draft.suffix.custom).value ?? '' })}
              placeholder="e.g. Esq."
              aria-invalid={fieldErrors.suffix || undefined}
              className={cn('mt-0.5', fieldInputCls(!!fieldErrors.suffix))}
            />
          </div>
        )}
        {hasSuffix && (
          <label className="flex min-h-[2.5rem] items-center gap-2 text-base font-medium text-ink-secondary">
            <input
              type="checkbox"
              checked={suffixInFamiliar}
              disabled={busy}
              onChange={(e) => setField('suffixInFamiliar', e.target.checked)}
              className="size-4 rounded border-surface-border-strong text-brand focus:ring-brand-wash"
            />
            Use suffix in familiar name
          </label>
        )}
      </div>

      {/* Compact single-line live preview of exactly what Save persists:
          the familiar name, with the greeting appended inline. */}
      <p className="mt-1.5 text-base">
        <span className="font-medium uppercase tracking-wide text-ink-supporting">Preview </span>
        {familiar
          ? <span className="font-semibold text-ink">{familiar}</span>
          : <span className="text-ink-muted">Enter a name</span>}
        {greeting && (
          <span className="text-ink-secondary"> · Greeting: <span className="font-medium text-ink">Hi {greeting}</span></span>
        )}
      </p>

      {showError && reason && (
        <p className="mt-1 text-base text-status-missing-strong">{reason}</p>
      )}
    </div>
  )
}

// ── Standalone editor (fields + Save / Cancel) ───────────────────────────────

/**
 * The standalone name editor: the shared fields with their own Save / Cancel.
 * On Save it validates via the shared hook and hands the host the normalized
 * parts; it does not persist. Used where the name is edited on its own (the
 * Customer Contact name heading). Hosts that edit the name inside a larger form
 * embed `PersonNameFields` with `usePersonNameDraft` directly instead.
 */
export function PersonNameEditor({
  name,
  busy = false,
  error = null,
  onCancel,
  onSave,
}: {
  name: PersonName
  busy?: boolean
  /** A host-supplied error (e.g. a rejected save) shown beneath the controls. */
  error?: string | null
  onCancel: () => void
  /** Receives the normalized, validated parts. The host persists them. */
  onSave: (value: PersonName) => void
}) {
  const api = usePersonNameDraft(name)
  const [attempted, setAttempted] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    const resolved = api.resolve()
    if (resolved) onSave(resolved)
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="text-base font-semibold text-ink-secondary">Edit name</p>
      <div className="mt-1.5">
        <PersonNameFields api={api} busy={busy} showError={attempted} />
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
