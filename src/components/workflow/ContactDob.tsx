'use client'

/**
 * ContactDob — the reusable date-of-birth surface for Right Path's light-theme
 * workflow UI. One component family for showing and editing a customer's DOB at
 * whatever precision is actually known, so every light-theme screen presents,
 * edits, and validates DOB the same way without copying logic.
 *
 * All normalization, storage-precision, display, and change-detection RULES live
 * in `@/lib/stewardship/dob.ts` (`normalizeDobParts`, `wouldDowngradeExactDob`,
 * `dobToParts`, `formatDobDisplay`). This file is the UI layer:
 *
 *   - `DobDisplay` — the read-only value at its best-available precision
 *     ("MM/DD/YYYY" / "MM/YYYY" / "YYYY"), or a "Missing" treatment.
 *   - `DobFields` — the three controlled month / day / year inputs plus the
 *     inline validity + downgrade messages and the partial-date hint. It carries
 *     NO Save/Cancel so it embeds in a larger coordinated form (the contact
 *     card's one Save) as well as the standalone editor.
 *   - `useDobDraft` — the shared draft state + validation hook backing the
 *     fields, so every host validates, guards, and resolves DOB identically.
 *   - `DobEditor` — `DobFields` wrapped with its own Save/Cancel for a
 *     standalone edit.
 *
 * The behavior reproduced here (so every host matches):
 *   - A year is required for any stored DOB; a full month+day+year is stored as
 *     an EXACT date, a year (+ optional month) with a blank day as a PARTIAL
 *     date. Missing parts are never invented.
 *   - A known EXACT DOB is never silently downgraded to partial info: that case
 *     is reported invalid-to-save with an explicit message.
 *   - The draft seeds from a best-available DOB that may be a linked-policy
 *     consensus; it is persisted ONLY when the operator actually edits a field
 *     away from that seed, so merely opening the editor never writes a derived
 *     DOB onto the customer.
 *
 * Nothing here persists; a host wires Save to its route.
 */

import { useMemo, useState } from 'react'
import { CalendarDays, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type DobParts,
  type DobNormalizeResult,
  normalizeDobParts,
  wouldDowngradeExactDob,
  dobToParts,
  formatDobDisplay,
} from '@/lib/stewardship/dob'

// ── Shared field styling (light-theme workflow tokens) ───────────────────────

const fieldInputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-2.5 py-1 text-sm text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

const DOWNGRADE_MESSAGE =
  'A full date of birth is already on file. Enter the complete date to correct it, or leave it unchanged (it can\u2019t be replaced with a partial date).'

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Show a customer's date of birth for reading, at its best-available precision.
 * Pass a pre-resolved display string (`display`, e.g. the card's `dob_display`
 * that may come from a linked-policy consensus) when you have one; otherwise the
 * stored exact/partial columns are formatted with the shared rule. A day is
 * shown only for a known exact date (the card's scoped full-DOB exception).
 */
export function DobDisplay({
  display,
  exact,
  approx,
  approximate = false,
  className,
  style,
  missingClassName,
  approxNoteClassName,
}: {
  /** A pre-resolved best-available DOB display string. Takes precedence. */
  display?: string | null
  /** Stored exact DOB (YYYY-MM-DD) when no `display` is supplied. */
  exact?: string | null
  /** Stored partial DOB ("MM/xx/YYYY" / "xx/xx/YYYY") when no `display`. */
  approx?: string | null
  /** True when the shown DOB is not a confirmed exact date (partial or derived),
   * so it reads "(unconfirmed)" — mirroring the approximate-age treatment. */
  approximate?: boolean
  className?: string
  style?: React.CSSProperties
  /** Applied to "Missing" so a host can de-emphasize it. */
  missingClassName?: string
  /** Applied to the "(unconfirmed)" suffix. */
  approxNoteClassName?: string
}) {
  const text = display ?? formatDobDisplay(exact, approx)
  if (!text) {
    return <span className={cn(className, missingClassName)} style={style}>Missing</span>
  }
  return (
    <span className={className} style={style}>
      {text}
      {approximate && <span className={cn('ml-1', approxNoteClassName)}>(unconfirmed)</span>}
    </span>
  )
}

// ── Draft state + validation (shared by the fields and every host) ───────────

/** The record facts the draft seeds from and resolves against. A host that has
 * already resolved the best-available parts (e.g. a linked-policy consensus)
 * supplies them as `seed*`; otherwise the stored columns are used. */
export interface DobRecord {
  /** Stored exact DOB (YYYY-MM-DD) or null. */
  date_of_birth: string | null
  /** Stored partial DOB ("MM/xx/YYYY" / "xx/xx/YYYY") or null. */
  date_of_birth_approx: string | null
  /** Resolved best-available parts to seed the fields with (a partial/linked
   * source carries a blank day). When any is provided it wins over the stored
   * columns for SEEDING only; the downgrade guard still compares against the
   * stored exact date. */
  seed_month?: number | null
  seed_day?: number | null
  seed_year?: number | null
}

export interface DobDraftApi {
  draft: DobParts
  setPart: (key: keyof DobParts, value: string) => void
  /** The live normalization of the drafts (storage decision + validity). */
  result: DobNormalizeResult
  /** True when the draft would downgrade a known exact DOB to partial info. */
  wouldDowngrade: boolean
  /** True when the operator actually edited a field away from the seed. */
  edited: boolean
  /** True when the DOB will actually change on save (edited, valid, not a
   * downgrade, and the normalized columns differ from what is stored). */
  willChange: boolean
  /** The three raw parts to send as the payload (only meaningful on a change). */
  parts: DobParts
  /** Valid to save: not invalid and not a downgrade. (Empty is a valid clear.) */
  valid: boolean
  /** The inline message to show, or null: the invalid reason, else the downgrade
   * message when a downgrade is staged. */
  message: string | null
}

/** Digits-only sanitizer for a DOB part input. */
function digits(raw: string, max: number): string {
  return raw.replace(/\D/g, '').slice(0, max)
}

/** The shared draft + validation hook. Every host drives `DobFields` through
 * this so validation, the downgrade guard, and the edited-vs-seed persist rule
 * are identical everywhere. */
export function useDobDraft(record: DobRecord): DobDraftApi {
  // The stable seed baseline, captured once per record: the resolved
  // best-available parts when supplied (which may be a linked-policy consensus),
  // else the DOB stored directly on the row. This is the baseline for "did the
  // operator actually edit the DOB?" — it is NOT necessarily the stored customer
  // DOB, so a plain open-and-save must not persist a derived value.
  const seed = useMemo<DobParts>(
    () =>
      record.seed_year != null
        ? {
            month: record.seed_month == null ? '' : String(record.seed_month),
            day: record.seed_day == null ? '' : String(record.seed_day),
            year: String(record.seed_year),
          }
        : dobToParts(record.date_of_birth, record.date_of_birth_approx),
    [record.seed_year, record.seed_month, record.seed_day, record.date_of_birth, record.date_of_birth_approx],
  )

  const [draft, setDraft] = useState<DobParts>(seed)

  const setPart = (key: keyof DobParts, value: string) =>
    setDraft((d) => ({ ...d, [key]: digits(value, key === 'year' ? 4 : 2) }))

  const result = useMemo(() => normalizeDobParts(draft), [draft])

  const prior = {
    date_of_birth: record.date_of_birth ?? null,
    date_of_birth_approx: record.date_of_birth_approx ?? null,
  }
  const wouldDowngrade = wouldDowngradeExactDob(prior, result)

  const edited =
    draft.month.trim() !== seed.month.trim() ||
    draft.day.trim() !== seed.day.trim() ||
    draft.year.trim() !== seed.year.trim()

  const willChange =
    edited &&
    result.status !== 'invalid' &&
    !wouldDowngrade &&
    ((result.date_of_birth ?? null) !== (prior.date_of_birth ?? null) ||
      (result.date_of_birth_approx ?? null) !== (prior.date_of_birth_approx ?? null))

  const valid = result.status !== 'invalid' && !wouldDowngrade
  const message =
    result.status === 'invalid'
      ? (result.reason ?? null)
      : wouldDowngrade
        ? DOWNGRADE_MESSAGE
        : null

  return { draft, setPart, result, wouldDowngrade, edited, willChange, parts: draft, valid, message }
}

// ── Fields (headless of Save/Cancel; embeddable) ─────────────────────────────

/**
 * The three controlled month / day / year inputs plus the inline validity +
 * downgrade messages and the partial-date hint. It owns the layout and the
 * digit-only input handling — but NO buttons, so it embeds inside a larger
 * coordinated form as well as the standalone editor. All state and validity come
 * from `useDobDraft`.
 *
 * `idPrefix` keeps input ids unique when more than one instance renders on a
 * page. `showError` lets the host defer the inline message until a save attempt.
 */
export function DobFields({
  api,
  busy = false,
  idPrefix = 'dob',
  showError = true,
  autoFocus = false,
}: {
  api: DobDraftApi
  busy?: boolean
  idPrefix?: string
  showError?: boolean
  autoFocus?: boolean
}) {
  const { draft, setPart, result, wouldDowngrade, message } = api
  const id = (s: string) => `${idPrefix}-${s}`
  const yearInvalid = result.status === 'invalid' || wouldDowngrade

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:max-w-xs">
        <div>
          <label htmlFor={id('month')} className="text-xs font-medium text-ink-secondary">Month</label>
          <input
            id={id('month')} type="text" inputMode="numeric" autoFocus={autoFocus}
            value={draft.month} disabled={busy} maxLength={2}
            onChange={(e) => setPart('month', e.target.value)}
            placeholder="MM" className={cn('mt-0.5', fieldInputCls(false))}
          />
        </div>
        <div>
          <label htmlFor={id('day')} className="text-xs font-medium text-ink-secondary">Day</label>
          <input
            id={id('day')} type="text" inputMode="numeric"
            value={draft.day} disabled={busy} maxLength={2}
            onChange={(e) => setPart('day', e.target.value)}
            placeholder="DD" className={cn('mt-0.5', fieldInputCls(false))}
          />
        </div>
        <div>
          <label htmlFor={id('year')} className="text-xs font-medium text-ink-secondary">Year</label>
          <input
            id={id('year')} type="text" inputMode="numeric"
            value={draft.year} disabled={busy} maxLength={4}
            onChange={(e) => setPart('year', e.target.value)}
            placeholder="YYYY" className={cn('mt-0.5', fieldInputCls(yearInvalid))}
          />
        </div>
      </div>

      {showError && message && (
        <p className="mt-1 text-sm text-status-missing-strong">{message}</p>
      )}
      <p className="mt-1 text-sm text-ink-muted">Leave the day (or month) blank if only part of the date is known.</p>
    </div>
  )
}

// ── Standalone editor (fields + Save / Cancel) ───────────────────────────────

/** What a standalone DOB save hands back to the host: the three raw parts the
 * route re-normalizes, present only when the DOB actually changed (else null,
 * so the host writes nothing). */
export interface DobEditResult {
  /** The three parts to send, or null when the DOB did not change. */
  parts: DobParts | null
}

/**
 * The standalone DOB editor: the shared fields with their own Save / Cancel. On
 * Save it validates via the shared hook and hands the host the raw parts (only
 * when the DOB actually changed); it does not persist. Hosts that edit DOB
 * inside a larger form embed `DobFields` with `useDobDraft` directly instead.
 */
export function DobEditor({
  record,
  busy = false,
  error = null,
  onCancel,
  onSave,
}: {
  record: DobRecord
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onSave: (value: DobEditResult) => void
}) {
  const api = useDobDraft(record)
  const [attempted, setAttempted] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!api.valid) return
    onSave({ parts: api.willChange ? api.parts : null })
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-bold text-ink">
        <CalendarDays className="size-4" aria-hidden /> Date of birth
      </p>
      <div className="mt-1.5">
        <DobFields api={api} busy={busy} showError={attempted} autoFocus />
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
