'use client'

/**
 * CallbackPrecision — the reusable "when did we promise to call back" picker for
 * Right Path's light-theme workflow UI, built on two axes (see
 * callback-precision.ts):
 *
 *   WHEN:  a specific date (date picker) OR recurring days (Mon-Sat chips).
 *   TIME:  an exact half-hour time (specific date only) OR time bands (with an
 *          "Any" select-all) OR any time (all day).
 *
 * All vocabulary, validation, and resolution RULES live in
 * `@/lib/calendar/callback-precision.ts` (pure, testable, zone-delegating).
 * This file is only the UI layer:
 *   - `useCallbackPrecisionDraft` — draft state + live validation.
 *   - `CallbackPrecisionFields` — the two-axis controls + inline validity. NO
 *     Save button, so it embeds in the Defer panel's own Save.
 *
 * The customer clock is the authority: the host passes the customer's zone so an
 * exact time means the time ON THE CUSTOMER'S clock. Nothing here persists.
 */

import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type CallbackCommitment,
  type CallbackValidation,
  type TimeBandKey,
  type TimeMode,
  type TimeSlot,
  type WeekdayKey,
  type WhenMode,
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
  setWhenMode: (mode: WhenMode) => void
  setDate: (date: string) => void
  toggleDay: (day: WeekdayKey) => void
  setTimeMode: (mode: TimeMode) => void
  setClock: (clock: string) => void
  toggleBand: (band: TimeBandKey) => void
  selectAllBands: () => void
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

  const setWhenMode = (whenMode: WhenMode) =>
    setDraft((d) => ({
      ...d,
      whenMode,
      // Switching to recurring can't keep an exact time (needs a real date); drop
      // it to bands so the choice stays coherent.
      timeMode: whenMode === 'recurring' && d.timeMode === 'exact' ? 'bands' : d.timeMode,
      clock: whenMode === 'recurring' ? null : d.clock,
    }))
  const setDate = (date: string) => setDraft((d) => ({ ...d, date }))
  const toggleDay = (day: WeekdayKey) =>
    setDraft((d) => ({
      ...d,
      days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day],
    }))
  const setTimeMode = (timeMode: TimeMode) =>
    setDraft((d) => ({
      ...d,
      timeMode,
      clock: timeMode === 'exact' ? d.clock : null,
      bands: timeMode === 'bands' ? d.bands : [],
    }))
  const setClock = (clock: string) => setDraft((d) => ({ ...d, clock }))
  const toggleBand = (band: TimeBandKey) =>
    setDraft((d) => ({
      ...d,
      bands: d.bands.includes(band) ? d.bands.filter((x) => x !== band) : [...d.bands, band],
    }))
  const selectAllBands = () =>
    setDraft((d) => ({ ...d, bands: TIME_BANDS.map((b) => b.key) }))

  const validation = useMemo(() => validateCallback(draft), [draft])
  const valid = validation.status !== 'invalid'
  const message = validation.reason

  return {
    draft,
    setWhenMode,
    setDate,
    toggleDay,
    setTimeMode,
    setClock,
    toggleBand,
    selectAllBands,
    validation,
    valid,
    message,
  }
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

const WHEN_MODES: { key: WhenMode; label: string }[] = [
  { key: 'date', label: 'A specific date' },
  { key: 'recurring', label: 'Recurring days' },
]

// Exact first, then bands, then any — per the operator's ordering.
const TIME_MODES: { key: TimeMode; label: string; hint: string }[] = [
  { key: 'exact', label: 'Exact time', hint: 'A specific time. Becomes an appointment.' },
  { key: 'bands', label: 'Time bands', hint: 'When they can be reached (one or more).' },
  { key: 'any', label: 'Any time', hint: 'No particular time; all day.' },
]

// ── Fields (headless of Save; embeds in the Defer panel) ─────────────────────

/**
 * The two-axis controls. All state and validity come from
 * `useCallbackPrecisionDraft`. Exact time is offered only when the WHEN axis is
 * a specific date, and renders on the SAME row as the date. The customer-zone
 * label is shown next to an exact time when the customer's zone differs from the
 * operator's, so an exact time is unambiguous about whose clock it is.
 */
export function CallbackPrecisionFields({
  api,
  busy = false,
  idPrefix = 'cb',
  showError = true,
  customerZoneLabel = null,
}: {
  api: CallbackPrecisionDraftApi
  busy?: boolean
  idPrefix?: string
  showError?: boolean
  customerZoneLabel?: string | null
}) {
  const { draft, setWhenMode, setDate, toggleDay, setTimeMode, setClock, toggleBand, selectAllBands, validation, message } = api
  const id = (s: string) => `${idPrefix}-${s}`
  const invalid = validation.status === 'invalid'
  const dateMode = draft.whenMode === 'date'
  const allBandsSelected = draft.bands.length === TIME_BANDS.length

  return (
    <div className="space-y-3">
      {/* WHEN axis. */}
      <div>
        <p className="text-sm font-medium text-ink-secondary">When?</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {WHEN_MODES.map((w) => (
            <Chip key={w.key} selected={draft.whenMode === w.key} disabled={busy} onClick={() => setWhenMode(w.key)}>
              {w.label}
            </Chip>
          ))}
        </div>

        {/* Specific date: the date picker, and (for exact time) the time on the
            SAME line. */}
        {dateMode ? (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={id('date')} className="block text-xs font-medium text-ink-secondary">Date</label>
              <input
                id={id('date')}
                type="date"
                value={draft.date}
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
                className={cn('mt-0.5 block', inputCls(invalid && !draft.date))}
              />
            </div>
            {draft.timeMode === 'exact' && (
              <div>
                <label htmlFor={id('clock')} className="block text-xs font-medium text-ink-secondary">
                  Time
                  {customerZoneLabel && (
                    <span className="ml-1 font-normal text-ink-muted">(customer&apos;s, {customerZoneLabel})</span>
                  )}
                </label>
                <select
                  id={id('clock')}
                  value={draft.clock ?? ''}
                  disabled={busy}
                  onChange={(e) => setClock(e.target.value)}
                  className={cn('mt-0.5 block', inputCls(invalid && !draft.clock))}
                >
                  <option value="">Pick a time…</option>
                  {TIME_SLOTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-xs font-medium text-ink-secondary">Days</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((dw) => (
                <Chip key={dw.key} selected={draft.days.includes(dw.key)} disabled={busy} onClick={() => toggleDay(dw.key)}>
                  {dw.label}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* TIME axis. */}
      <div>
        <p className="text-sm font-medium text-ink-secondary">What time?</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {TIME_MODES.map((t) => {
            // Exact is only meaningful for a specific date.
            const disabled = busy || (t.key === 'exact' && !dateMode)
            return (
              <Chip key={t.key} selected={draft.timeMode === t.key} disabled={disabled} onClick={() => setTimeMode(t.key)}>
                {t.label}
              </Chip>
            )
          })}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {TIME_MODES.find((t) => t.key === draft.timeMode)?.hint}
        </p>

        {/* Bands: the four daily buckets + an Any (all) button. The exact-time
            input renders up with the date (above); any-time needs no control. */}
        {draft.timeMode === 'bands' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {TIME_BANDS.map((b) => (
              <Chip key={b.key} selected={draft.bands.includes(b.key)} disabled={busy} onClick={() => toggleBand(b.key)}>
                {b.label} <span className="opacity-70">{b.shortLabel}</span>
              </Chip>
            ))}
            <button
              type="button"
              disabled={busy || allBandsSelected}
              onClick={selectAllBands}
              className="rounded-lg border border-dashed border-surface-border-strong px-3 py-1.5 text-sm font-medium text-ink-supporting hover:bg-surface-muted disabled:opacity-40"
            >
              Any
            </button>
          </div>
        )}
      </div>

      {showError && message && (
        <p className="flex items-center gap-1.5 text-sm text-status-missing-strong">
          <Clock className="size-3.5" aria-hidden /> {message}
        </p>
      )}
    </div>
  )
}
