'use client'

/**
 * CallbackPrecision — the reusable "when did we promise to call back" picker for
 * Right Path's light-theme workflow UI. A promised callback at whatever
 * precision the customer gave: an EXACT time, a set of availability WINDOWS
 * (days × time bands), or ANY TIME that day. The DOB-precision pattern applied
 * to a callback (see ContactDob for the reference shape).
 *
 * All precision VOCABULARY, validation, and resolution RULES live in
 * `@/lib/calendar/callback-precision.ts` (pure, testable, zone-delegating). This
 * file is only the UI layer:
 *
 *   - `useCallbackPrecisionDraft` — draft state + live validation, so every host
 *     validates identically. Seeds from an optional prior commitment.
 *   - `CallbackPrecisionFields` — the controlled precision selector plus the
 *     per-precision controls (exact date+time / days×bands / date only) and the
 *     inline validity message. NO Save button, so it embeds in the Defer panel's
 *     own Save (the host owns the action).
 *
 * The customer clock is the authority: the host passes the customer's zone so
 * the shown/stored time means the time ON THE CUSTOMER'S clock. Nothing here
 * persists; the host resolves and writes.
 */

import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type CallbackCommitment,
  type CallbackPrecision as Precision,
  type CallbackValidation,
  type TimeBandKey,
  type TimeSlot,
  type WeekdayKey,
  TIME_BANDS,
  WEEKDAYS,
  buildHalfHourSlots,
  validateCallback,
  emptyCommitment,
} from '@/lib/calendar/callback-precision'

/** The controlled half-hour choices, built once. No arbitrary minute entry. */
const TIME_SLOTS: TimeSlot[] = buildHalfHourSlots()

// ── Draft state + validation (shared by the fields and every host) ───────────

export interface CallbackPrecisionDraftApi {
  draft: CallbackCommitment
  setDate: (date: string) => void
  setPrecision: (precision: Precision) => void
  setClock: (clock: string) => void
  toggleDay: (day: WeekdayKey) => void
  toggleBand: (band: TimeBandKey) => void
  /** Live validation of the draft. */
  validation: CallbackValidation
  /** Valid to save (valid OR an empty no-promise). */
  valid: boolean
  /** The inline message, or null. */
  message: string | null
}

/** The shared draft + validation hook. */
export function useCallbackPrecisionDraft(
  seed?: CallbackCommitment | null,
): CallbackPrecisionDraftApi {
  const [draft, setDraft] = useState<CallbackCommitment>(() => seed ?? emptyCommitment())

  const setDate = (date: string) => setDraft((d) => ({ ...d, date }))
  const setClock = (clock: string) => setDraft((d) => ({ ...d, clock }))
  const setPrecision = (precision: Precision) =>
    setDraft((d) => ({
      ...d,
      precision,
      // Clear the parts that don't belong to the chosen precision so a switch
      // never leaves a stale clock or band set behind.
      clock: precision === 'exact' ? d.clock : null,
      days: precision === 'windows' ? d.days : [],
      bands: precision === 'windows' ? d.bands : [],
    }))
  const toggleDay = (day: WeekdayKey) =>
    setDraft((d) => ({
      ...d,
      days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day],
    }))
  const toggleBand = (band: TimeBandKey) =>
    setDraft((d) => ({
      ...d,
      bands: d.bands.includes(band) ? d.bands.filter((x) => x !== band) : [...d.bands, band],
    }))

  const validation = useMemo(() => validateCallback(draft), [draft])
  const valid = validation.status !== 'invalid'
  const message = validation.reason

  return { draft, setDate, setPrecision, setClock, toggleDay, toggleBand, validation, valid, message }
}

// ── Field styling (light-theme workflow tokens, matching the contact Legos) ──

const inputCls = (invalid: boolean) =>
  cn(
    'rounded-lg border px-2.5 py-1.5 text-base text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

function Chip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
        selected
          ? 'border-brand bg-brand text-brand-foreground'
          : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  )
}

const PRECISIONS: { key: Precision; label: string; hint: string }[] = [
  { key: 'exact', label: 'Exact time', hint: 'A specific time, e.g. 2:00 PM. Becomes an appointment.' },
  { key: 'windows', label: 'Time of day', hint: 'When they can be reached (days and bands).' },
  { key: 'anytime', label: 'Any time that day', hint: 'A date only; call anytime.' },
]

// ── Fields (headless of Save; embeddable in the Defer panel) ─────────────────

/**
 * The precision selector plus the per-precision controls and the inline
 * validity message. All state and validity come from `useCallbackPrecisionDraft`.
 * The customer-clock note is shown when the customer's zone differs from the
 * operator's, so an exact time is unambiguous about whose clock it is.
 */
export function CallbackPrecisionFields({
  api,
  busy = false,
  idPrefix = 'cb',
  showError = true,
  /** Short customer-zone label (e.g. "ET") shown next to an exact time when it
   * differs from the operator's zone. Optional; purely a clarity hint. */
  customerZoneLabel = null,
}: {
  api: CallbackPrecisionDraftApi
  busy?: boolean
  idPrefix?: string
  showError?: boolean
  customerZoneLabel?: string | null
}) {
  const { draft, setDate, setPrecision, setClock, toggleDay, toggleBand, validation, message } = api
  const id = (s: string) => `${idPrefix}-${s}`
  const invalid = validation.status === 'invalid'

  return (
    <div className="space-y-3">
      {/* Due date — always required. */}
      <div>
        <label htmlFor={id('date')} className="text-sm font-medium text-ink-secondary">
          Callback date
        </label>
        <input
          id={id('date')}
          type="date"
          value={draft.date}
          disabled={busy}
          onChange={(e) => setDate(e.target.value)}
          className={cn('mt-0.5 block w-full max-w-xs', inputCls(invalid && !draft.date))}
        />
      </div>

      {/* Precision selector. */}
      <div>
        <p className="text-sm font-medium text-ink-secondary">How specific is the time?</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {PRECISIONS.map((p) => (
            <Chip
              key={p.key}
              selected={draft.precision === p.key}
              disabled={busy}
              onClick={() => setPrecision(p.key)}
            >
              {p.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {PRECISIONS.find((p) => p.key === draft.precision)?.hint}
        </p>
      </div>

      {/* Exact time. */}
      {draft.precision === 'exact' && (
        <div>
          <label htmlFor={id('clock')} className="text-sm font-medium text-ink-secondary">
            Exact time
            {customerZoneLabel && (
              <span className="ml-1 font-normal text-ink-muted">(customer&apos;s time, {customerZoneLabel})</span>
            )}
          </label>
          {/* Half-hour dropdown, not a free time input: scroll to 9:30 / 10:00
              / 10:30, never type 1:13. Half-hour is the finest we offer. */}
          <select
            id={id('clock')}
            value={draft.clock ?? ''}
            disabled={busy}
            onChange={(e) => setClock(e.target.value)}
            className={cn('mt-0.5 block w-full max-w-[12rem]', inputCls(invalid))}
          >
            <option value="">Pick a time…</option>
            {TIME_SLOTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Windows: days × bands. */}
      {draft.precision === 'windows' && (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-ink-secondary">
              Days <span className="font-normal text-ink-muted">(none = any day)</span>
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <Chip key={d.key} selected={draft.days.includes(d.key)} disabled={busy} onClick={() => toggleDay(d.key)}>
                  {d.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-ink-secondary">Time of day</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {TIME_BANDS.map((b) => (
                <Chip key={b.key} selected={draft.bands.includes(b.key)} disabled={busy} onClick={() => toggleBand(b.key)}>
                  {b.label} <span className="opacity-70">{b.shortLabel}</span>
                </Chip>
              ))}
            </div>
          </div>
        </div>
      )}

      {showError && message && (
        <p className="flex items-center gap-1.5 text-sm text-status-missing-strong">
          <Clock className="size-3.5" aria-hidden /> {message}
        </p>
      )}
    </div>
  )
}
