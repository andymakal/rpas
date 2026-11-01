'use client'

/**
 * ContactAlert — the reusable customer-alert surface for Right Path's
 * light-theme workflow UI. One component family for showing and editing a
 * customer's single current alert (a short note surfaced prominently at the top
 * of the customer's card), so every light-theme screen shows and edits it the
 * same way.
 *
 *   - `AlertBanner` — the prominent read-only banner (amber "known" band,
 *     `role="alert"`, line breaks preserved). Render it only when there is an
 *     alert; it returns null for empty text.
 *   - `AlertField` — the controlled multiline textarea. It carries NO
 *     Save/Cancel so it embeds in a larger coordinated form (the contact card's
 *     one Save) as well as the standalone editor.
 *   - `useAlertDraft` — the shared draft state hook backing the field, so every
 *     host resolves the alert identically (trimmed text, or null to clear).
 *   - `AlertEditor` — `AlertField` wrapped with its own Save/Cancel for a
 *     standalone edit.
 *
 * The behavior reproduced here (so every host matches): the alert is a single
 * free-text note; saving empty text clears it (null). There is no validation
 * beyond trim.
 *
 * Nothing here persists; a host wires Save to its route.
 */

import { useState } from 'react'
import { AlertTriangle, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * The prominent customer-alert banner. Shows the alert text in the amber
 * "known" status band with an alert-triangle icon, preserving line breaks and
 * announcing via `role="alert"`. Returns null when there is no alert, so a host
 * can render it unconditionally.
 */
export function AlertBanner({
  alert,
  className,
}: {
  alert: string | null | undefined
  className?: string
}) {
  const text = (alert ?? '').trim()
  if (!text) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-status-known-border bg-status-known-fill px-3 py-2.5',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-known-strong" aria-hidden />
      <p className="min-w-0 whitespace-pre-line break-words text-base font-medium text-status-known-strong">
        {text}
      </p>
    </div>
  )
}

// ── Draft state (shared by the field and every host) ─────────────────────────

/** The record fact the draft seeds from and resolves against. */
export interface AlertRecord {
  /** The customer's current alert (`customers.contact_alert`), or null. */
  contact_alert: string | null
}

export interface AlertDraftApi {
  draft: string
  setText: (value: string) => void
  /** The value that will be on file after save: trimmed text, or null to clear. */
  resolved: string | null
}

/** The shared draft hook. Every host drives `AlertField` through this so the
 * alert resolves identically (trimmed, or null when blank). */
export function useAlertDraft(record: AlertRecord): AlertDraftApi {
  const [draft, setDraft] = useState<string>(record.contact_alert ?? '')
  const resolved = draft.trim().length ? draft.trim() : null
  return { draft, setText: setDraft, resolved }
}

// ── Field (headless of Save/Cancel; embeddable) ──────────────────────────────

/**
 * The controlled multiline alert textarea. Carries NO buttons, so it embeds
 * inside a larger coordinated form as well as the standalone editor. All state
 * comes from `useAlertDraft`.
 *
 * `idPrefix` keeps the textarea id unique when more than one instance renders on
 * a page.
 */
export function AlertField({
  api,
  busy = false,
  idPrefix = 'alert',
  rows = 2,
  autoFocus = false,
}: {
  api: AlertDraftApi
  busy?: boolean
  idPrefix?: string
  rows?: number
  autoFocus?: boolean
}) {
  const { draft, setText } = api
  return (
    <textarea
      id={`${idPrefix}-text`}
      rows={rows}
      value={draft}
      disabled={busy}
      autoFocus={autoFocus}
      onChange={(e) => setText(e.target.value)}
      placeholder="Add a short alert shown at the top of this customer's card."
      className="w-full rounded-lg border border-surface-border-strong px-2.5 py-1 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-wash disabled:opacity-50"
    />
  )
}

// ── Standalone editor (field + Save / Cancel) ────────────────────────────────

/** What a standalone alert save hands back to the host: the trimmed text, or
 * null to clear. */
export interface AlertEditResult {
  alert: string | null
}

/**
 * The standalone alert editor: the shared field with its own Save / Cancel. On
 * Save it hands the host the resolved alert (trimmed, or null to clear); it does
 * not persist. Hosts that edit the alert inside a larger form embed `AlertField`
 * with `useAlertDraft` directly instead.
 */
export function AlertEditor({
  record,
  busy = false,
  error = null,
  onCancel,
  onSave,
}: {
  record: AlertRecord
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onSave: (value: AlertEditResult) => void
}) {
  const api = useAlertDraft(record)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ alert: api.resolved })
  }

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-bold text-status-known-strong">
        <AlertTriangle className="size-4" aria-hidden /> Customer alert
      </p>
      <div className="mt-1.5">
        <AlertField api={api} busy={busy} autoFocus />
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
