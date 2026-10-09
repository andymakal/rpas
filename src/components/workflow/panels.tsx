'use client'

/**
 * Right Path workflow context/assistant panels.
 *
 * ContextHeader renders the customer/task identity header on a task screen: a
 * name, an optional back control and escape hatch, an optional location line,
 * and a row of fields each with its own field-level status cue.
 *
 * AssistantPanel is the Assistant briefing shell: an identity row, a large
 * heading, and the briefing content supplied by the workflow.
 */

import type { ComponentType, ReactNode } from 'react'
import { MapPin, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { type FieldStatusTone, FieldStatusDot } from './primitives'

type IconType = ComponentType<{ className?: string }>

// ─────────────────────────────────────────────────────────────────────────────
// ContextHeader — customer / task identity + field-status header.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextField {
  label: string
  value: ReactNode
  /** Whether the value is empty/unavailable, so it renders muted + italic. */
  empty?: boolean
  /** Field-level status cue. */
  statusTone: FieldStatusTone
  statusIcon: IconType
  statusLabel: string
}

export function ContextHeader({
  eyebrow,
  title,
  location,
  fields,
  onBack,
  backLabel = 'All queues',
  escapeHatch,
  showVerificationKey = true,
}: {
  /** Small label shown when there is no back control (e.g. "1035 Workflow"). */
  eyebrow?: ReactNode
  title: ReactNode
  location?: ReactNode
  fields: ContextField[]
  onBack?: () => void
  backLabel?: string
  /** Optional "view full record" escape hatch, top-right. */
  escapeHatch?: ReactNode
  /** Show the compact green/amber/red verification key. Defaults to on. */
  showVerificationKey?: boolean
}) {
  return (
    <header className="space-y-3 rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack ? (
            <Button
              variant="ghost"
              size="xs"
              className="-ml-2 mb-0.5 h-6 text-slate-500 hover:text-slate-800"
              onClick={onBack}
            >
              {'\u2190'} {backLabel}
            </Button>
          ) : eyebrow != null ? (
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{eyebrow}</p>
          ) : null}
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {location && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="size-3" aria-hidden /> {location}
            </p>
          )}
        </div>
        {escapeHatch}
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {fields.map(f => (
          <div key={f.label} className="min-w-0">
            {/* Field labels identify operational values; keep them readable
                (slate-600), never pale gray. Only empty values fall back to
                muted slate-400. */}
            <dt className="text-[11px] uppercase tracking-wide text-ink-supporting">{f.label}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5">
              <FieldStatusDot tone={f.statusTone} icon={f.statusIcon} label={f.statusLabel} />
              <span className={cn('truncate', f.empty ? 'italic text-ink-muted' : 'text-ink')}>
                {f.value}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {showVerificationKey && <VerificationKey />}
    </header>
  )
}

/**
 * Compact, reusable key explaining the field-status dots. Concise and inline,
 * not a large legend panel. Each entry pairs the dot's tone with a plain-
 * language meaning so the green/amber/red cues are self-explanatory.
 */
const VERIFICATION_KEY: { tone: FieldStatusTone; label: string }[] = [
  { tone: 'confirmed', label: 'Customer verified' },
  { tone: 'known',     label: 'Allstate record / not yet confirmed' },
  { tone: 'missing',   label: 'Missing or unusable' },
]

// Solid status dots in the verification key, from the status tokens.
const KEY_DOT: Record<FieldStatusTone, string> = {
  confirmed: 'bg-status-confirmed',
  known:     'bg-status-known',
  missing:   'bg-status-missing',
}

export function VerificationKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-divider pt-2.5 text-[11px] text-ink-supporting">
      <span className="font-medium uppercase tracking-wide text-ink-supporting">Key</span>
      {VERIFICATION_KEY.map(k => (
        <span key={k.tone} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-full', KEY_DOT[k.tone])} aria-hidden />
          {k.label}
        </span>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SlimTaskHeader — the minimal task-screen top row.
//
// A task screen leads with the WORK, not with a customer record. The header is
// therefore a single slim row of NAVIGATION ONLY: a back-to-queues control and
// an escape hatch to the full record. The customer is NOT named here; the task
// heading below identifies both the action and the customer (e.g. "Call
// Stephen Remy"). Customer facts (DOB, email, phone, address, verification)
// live in the right-side context. Use this when the task itself should
// dominate.
// ─────────────────────────────────────────────────────────────────────────────

export function SlimTaskHeader({
  onBack,
  backLabel = 'All queues',
  escapeHatch,
}: {
  onBack?: () => void
  backLabel?: string
  /** Optional "view full record" escape hatch, right-aligned. */
  escapeHatch?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-surface-border pb-3">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 shrink-0 text-slate-500 hover:text-slate-800"
          onClick={onBack}
        >
          {'\u2190'} {backLabel}
        </Button>
      )}
      {escapeHatch && <div className="ml-auto shrink-0">{escapeHatch}</div>}
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AssistantPanel — the Assistant briefing shell.
// ─────────────────────────────────────────────────────────────────────────────

export function AssistantPanel({
  heading, children, label = 'Assistant',
}: {
  heading: ReactNode
  children: ReactNode
  label?: string
}) {
  return (
    <section
      className="flex flex-col gap-7 rounded-3xl border border-brand-subtle bg-surface-card p-7 sm:p-8"
      aria-label={label}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-semibold uppercase tracking-[0.1em] text-brand-hover">{label}</p>
      </div>

      <h2 className="text-4xl font-semibold leading-tight tracking-tight text-ink">{heading}</h2>

      {children}
    </section>
  )
}
