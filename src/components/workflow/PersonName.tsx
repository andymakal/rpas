'use client'

/**
 * PersonName — the reusable name surface for Right Path's light-theme workflow
 * UI. One component family for showing and editing a customer's name, so every
 * screen presents and edits names the same way without copying logic.
 *
 * All presentation RULES live in `@/lib/person-name` (familiar / greeting /
 * full-recorded, the suffix-in-familiar preference, normalization that
 * preserves spelling, capitalization, and multi-word names). This file is the
 * UI layer over those rules:
 *
 *   - `PersonNameDisplay` — the familiar name shown prominently, with the full
 *     recorded name beneath it ONLY when it differs.
 *   - `PersonNameEditor` — compact controls for first, middle, last, suffix,
 *     "Goes by", and the suffix-in-familiar preference, with a live familiar +
 *     greeting preview and Save / Cancel.
 *
 * The editor keeps draft state local and hands the host a normalized, validated
 * result on Save; it never persists on its own. Hosts (the Customer Contact
 * card, Contact Research, any stewardship screen) wire Save to their existing
 * save route. Capitalization is preserved, multi-word names stay whole, and
 * nothing is inferred — no nickname guessing, no middle name in a greeting.
 */

import { useMemo, useState } from 'react'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type PersonName,
  presentPersonName,
  familiarName,
  greetingName,
  validatePersonName,
  includeSuffixInFamiliar,
  normalizeNameInput,
} from '@/lib/person-name'

// ── Shared input styling (matches the Customer Contact card's inline edit) ───

const nameInputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-3 py-2 text-lg text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

const labelCls = 'text-sm font-medium text-ink-secondary'

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Show a customer's name: the familiar name prominently, and the full recorded
 * name beneath it only when the full name carries something the familiar name
 * does not (a middle name, a suppressed suffix, or a different recorded first
 * name behind a "Goes by"). The greeting name is available via the shared rules
 * for hosts that address the customer directly.
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

// ── Editor ───────────────────────────────────────────────────────────────────

/** The draft shape the editor works with (all strings for inputs; the
 * preference as a tri-state via the recorded boolean|null). */
interface Draft {
  first: string
  middle: string
  last: string
  suffix: string
  goesBy: string
  /** null = no preference recorded (defaults to include). */
  suffixInFamiliar: boolean | null
}

function draftFrom(name: PersonName): Draft {
  return {
    first: name.firstName ?? '',
    middle: name.middleName ?? '',
    last: name.lastName ?? '',
    suffix: name.suffix ?? '',
    goesBy: name.goesBy ?? '',
    suffixInFamiliar: name.suffixInFamiliar,
  }
}

/** Build a live PersonName from the current draft, for the preview and for the
 * save payload (the preview must reflect exactly what will be saved). */
function nameFromDraft(d: Draft): PersonName {
  return {
    firstName: normalizeNameInput(d.first).value,
    middleName: normalizeNameInput(d.middle).value,
    lastName: normalizeNameInput(d.last).value,
    suffix: normalizeNameInput(d.suffix).value,
    goesBy: normalizeNameInput(d.goesBy).value,
    suffixInFamiliar: d.suffixInFamiliar,
  }
}

/**
 * Compact editor for every name part plus the suffix-in-familiar preference,
 * with a live familiar + greeting preview. On Save it validates and normalizes
 * via the shared rules (at least a first or last name required; capitalization
 * and multi-word names preserved) and hands the host the normalized parts; it
 * does not persist. Cancel discards the draft.
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
  const [draft, setDraft] = useState<Draft>(() => draftFrom(name))

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const blurNormalize = (key: 'first' | 'middle' | 'last' | 'suffix' | 'goesBy') =>
    setDraft((d) => ({ ...d, [key]: normalizeNameInput(d[key]).value ?? '' }))

  // The live preview reflects exactly what will be saved.
  const previewName = useMemo(() => nameFromDraft(draft), [draft])
  const familiar = familiarName(previewName)
  const greeting = greetingName(previewName)

  // Validity: at least a first or last name after normalization.
  const validation = validatePersonName({
    firstName: draft.first,
    lastName: draft.last,
  })
  const invalid = validation.status === 'invalid'

  const hasSuffix = normalizeNameInput(draft.suffix).status === 'valid'
  const suffixShown = includeSuffixInFamiliar(previewName)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const result = validatePersonName(draft)
    if (result.status === 'invalid') return
    onSave({ ...result.value })
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
        <Pencil className="size-4" aria-hidden /> Edit name
      </p>

      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="pn-first" className={labelCls}>First name</label>
          <input
            id="pn-first" type="text" autoFocus value={draft.first} disabled={busy}
            onChange={(e) => set('first', e.target.value)}
            onBlur={() => blurNormalize('first')}
            placeholder="First name" className={cn('mt-1', nameInputCls(false))}
          />
        </div>
        <div>
          <label htmlFor="pn-last" className={labelCls}>Last name</label>
          <input
            id="pn-last" type="text" value={draft.last} disabled={busy}
            onChange={(e) => set('last', e.target.value)}
            onBlur={() => blurNormalize('last')}
            placeholder="Last name" className={cn('mt-1', nameInputCls(false))}
          />
        </div>
        <div>
          <label htmlFor="pn-middle" className={labelCls}>
            Middle name <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="pn-middle" type="text" value={draft.middle} disabled={busy}
            onChange={(e) => set('middle', e.target.value)}
            onBlur={() => blurNormalize('middle')}
            placeholder="Middle name(s)" className={cn('mt-1', nameInputCls(false))}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="pn-goesby" className={labelCls}>
              Goes by <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id="pn-goesby" type="text" value={draft.goesBy} disabled={busy}
              onChange={(e) => set('goesBy', e.target.value)}
              onBlur={() => blurNormalize('goesBy')}
              placeholder="e.g. Bob" className={cn('mt-1', nameInputCls(false))}
            />
          </div>
          <div className="w-24">
            <label htmlFor="pn-suffix" className={labelCls}>Suffix</label>
            <input
              id="pn-suffix" type="text" value={draft.suffix} disabled={busy}
              onChange={(e) => set('suffix', e.target.value)}
              onBlur={() => blurNormalize('suffix')}
              placeholder="Jr" className={cn('mt-1', nameInputCls(false))}
            />
          </div>
        </div>
      </div>

      {/* Suffix-in-familiar preference — only meaningful when a suffix exists. */}
      {hasSuffix && (
        <label className="mt-2 flex items-center gap-2 text-base font-medium text-ink-secondary">
          <input
            type="checkbox"
            checked={suffixShown}
            disabled={busy}
            onChange={(e) => set('suffixInFamiliar', e.target.checked)}
            className="size-4 rounded border-surface-border-strong text-brand focus:ring-brand-wash"
          />
          Include the suffix in the familiar name
        </label>
      )}

      {/* Live preview of exactly what will be saved. */}
      <div className="mt-2.5 rounded-lg border border-surface-border bg-surface-muted px-3 py-2">
        <p className="text-sm font-medium uppercase tracking-wide text-ink-supporting">Preview</p>
        <p className="mt-0.5 text-lg font-semibold text-ink">
          {familiar || <span className="text-ink-muted">Enter a name</span>}
        </p>
        {greeting && (
          <p className="mt-0.5 text-base text-ink-secondary">
            Greeting: <span className="font-medium text-ink">Hi {greeting}</span>
          </p>
        )}
      </div>

      {invalid && (
        <p className="mt-1.5 text-base text-status-missing-strong">{validation.reason}</p>
      )}
      {error && <p className="mt-1.5 text-base text-status-missing-strong">{error}</p>}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || invalid}
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
