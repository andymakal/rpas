'use client'

/**
 * Right Path workflow design-system primitives.
 *
 * Durable, reusable building blocks for operator-facing workflow UI (queue
 * boards, queue lists, task screens, the Assistant). These encode the approved
 * Right Path workflow visual standard: light neutral background, dark slate
 * text, muted teal primary accent, accessible status colors, modern sans-serif,
 * generous spacing, and prominent operational information.
 *
 * Built on Tailwind and the shadcn Button underneath; those are implementation
 * tools, not a replacement for this standard. These components are generic and
 * do not depend on any specific workflow's data types, so any Right Path
 * workflow can reuse them.
 */

import type { ComponentType, ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type IconType = ComponentType<{ className?: string }>

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowSurface — the outermost workflow shell.
//
// This is the single place every Right Path workflow surface inherits its base
// visual identity from: the light neutral page background, the modern sans
// workflow font, and the default readable (not pale) operational text color.
// New pages wrap their content in WorkflowSurface and inherit all three — they
// do not re-declare the font, background, or base text color per screen.
//
// Values come from the consolidated design tokens in globals.css
// (--color-workflow-surface, --font-workflow, the slate text ladder), so the
// look is defined once and changes in one place.
// ─────────────────────────────────────────────────────────────────────────────

export function WorkflowSurface({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        // bg + font + base text come from tokens; px/py are the shared gutter.
        'min-h-full bg-workflow-surface font-workflow text-ink-secondary',
        'px-6 py-8',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowPage / WorkflowHeader — page shell and prominent page heading.
// ─────────────────────────────────────────────────────────────────────────────

/** The desktop working width shared by every workflow surface. */
export const WORKFLOW_MAX_WIDTH = 'max-w-[1360px]'

/**
 * The standard page body for a Right Path workflow surface.
 *
 * WorkflowPage now OWNS the shared visual surface: it wraps its centered,
 * max-width content column in `WorkflowSurface`, so any application page that
 * renders through WorkflowPage automatically inherits the light workflow
 * background, the modern sans workflow font, the standard page gutter, and the
 * readable default text color. Pages no longer paint their own `bg-slate-50
 * px-6 py-8` wrapper or reach for a special surface wrapper — using the shared
 * component is enough.
 *
 * `className` still applies to the inner content column (e.g. to adjust the
 * vertical rhythm), while `surfaceClassName` can tune the outer surface when a
 * page needs it (rare).
 */
export function WorkflowPage({
  children,
  className,
  surfaceClassName,
}: {
  children: ReactNode
  className?: string
  surfaceClassName?: string
}) {
  return (
    <WorkflowSurface className={cn('sm:px-10', surfaceClassName)}>
      <div className={cn('mx-auto w-full', WORKFLOW_MAX_WIDTH, 'space-y-8 text-ink-secondary', className)}>
        {children}
      </div>
    </WorkflowSurface>
  )
}

/**
 * The prominent page heading. Renders "Primary — secondary" when a secondary
 * part is supplied (e.g. "1035 Workflow — Today's work").
 */
export function WorkflowHeader({
  primary,
  secondary,
}: {
  primary: ReactNode
  secondary?: ReactNode
}) {
  return (
    <header>
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {primary}
        {secondary != null && (
          <>
            {' '}<span className="font-normal text-surface-border-strong">{'\u2014'}</span>{' '}
            <span className="font-normal text-ink-supporting">{secondary}</span>
          </>
        )}
      </h1>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OperationalTag — prominent reason / status / exception tag.
//
// Operational information that CHANGES what the worker should do must look
// important: a solid tinted fill, bold text at roughly the size of the primary
// label beside it, and substantial padding. No thin low-contrast outline, no
// explanatory prefix. Pick a tone by meaning.
// ─────────────────────────────────────────────────────────────────────────────

export type OperationalTone = 'reason' | 'exception' | 'blocked' | 'info'

// Operational tag tones are driven by the status/tag design tokens (see
// globals.css) so a tone's color can be retuned centrally and propagate to
// every tag everywhere, instead of being hardcoded per use.
const OPERATIONAL_TONE: Record<OperationalTone, string> = {
  reason:    'border-tag-reason-border bg-tag-reason-fill text-tag-reason-text',
  exception: 'border-tag-exception-border bg-tag-exception-fill text-tag-exception-text',
  blocked:   'border-tag-blocked-border bg-tag-blocked-fill text-tag-blocked-text',
  info:      'border-tag-info-border bg-tag-info-fill text-tag-info-text',
}

export function OperationalTag({
  children,
  tone = 'reason',
  className,
}: {
  children: ReactNode
  tone?: OperationalTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-4 py-1.5 text-lg font-semibold leading-none',
        OPERATIONAL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FieldStatus — field-level verification/status treatment.
//
// A small round dot with an icon, used in context headers and field rows. Never
// color alone: the tone pairs with an icon and an accessible label. Generic
// over tone so any workflow's status model can map onto it.
// ─────────────────────────────────────────────────────────────────────────────

export type FieldStatusTone = 'confirmed' | 'known' | 'missing'

// Field-status cue colors come from the status tokens so verification coloring
// is defined once and shared by every field cue and the verification key.
const FIELD_STATUS_DOT: Record<FieldStatusTone, string> = {
  confirmed: 'bg-status-confirmed-fill text-status-confirmed-foreground',
  known:     'bg-status-known-fill text-status-known-foreground',
  missing:   'bg-status-missing-fill text-status-missing-foreground',
}

export function FieldStatusDot({
  tone, icon: Icon, label,
}: {
  tone: FieldStatusTone
  icon: IconType
  label: string
}) {
  return (
    <span
      className={cn('inline-flex size-5 items-center justify-center rounded-full', FIELD_STATUS_DOT[tone])}
      title={label}
      role="img"
      aria-label={label}
    >
      <Icon className="size-3" aria-hidden />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TaskShell — action-first desktop task layout. The header spans full width;
// below it the ACTION sits on the left (what to do now) and the customer
// CONTEXT sits on the right (identity, contact, signers, holdings). The worker
// sees the next action immediately without scanning across the page. Stacks to
// one column on narrow screens, action first.
// ─────────────────────────────────────────────────────────────────────────────

export function TaskShell({
  header, action, context,
}: {
  header: ReactNode
  /** The current action: what the worker should do now (left column). */
  action: ReactNode
  /** Customer/relationship context supporting the action (right column). */
  context: ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full', WORKFLOW_MAX_WIDTH, 'space-y-6 text-ink-secondary')}>
      {header}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">{action}</div>
        <div className="space-y-5">{context}</div>
      </div>
    </div>
  )
}

/** A column heading for grouping context blocks on the left of a task screen. */
export function ContextLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">{children}</p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionPanel — the action-first panel for the right column. Leads with a large
// action heading so the worker instantly knows what to do.
// ─────────────────────────────────────────────────────────────────────────────

export function ActionPanel({
  heading, children,
}: {
  heading: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-5 rounded-2xl border border-brand-subtle bg-surface-card p-6">
      <h3 className="text-2xl font-semibold leading-tight tracking-tight text-ink">{heading}</h3>
      {children}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PrimaryAction — the single unmistakable primary action button for a task.
// ─────────────────────────────────────────────────────────────────────────────

export function PrimaryAction({
  icon: Icon, label, onClick, disabled,
}: {
  icon: IconType
  label: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <Button
      size="lg"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Right Path teal primary-action treatment, driven by the brand token
        // so it is teal everywhere and tunable in one place — never the
        // near-black shadcn default.
        'h-14 w-full justify-start gap-3 rounded-xl px-5 text-lg font-semibold',
        'border-transparent bg-brand text-brand-foreground hover:bg-brand-hover',
      )}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowButton — a secondary workflow action / selectable control.
//
// Smaller than the single PrimaryAction, but still a workflow action, so its
// emphasis is Right Path teal, never the near-black shadcn default. Use it for
// workflow actions (e.g. "Send the form") and for selectable controls like the
// call-outcome chips, where `selected` fills the control teal and the unselected
// state is a neutral outline. This keeps teal consistent across screens without
// restyling buttons per screen.
// ─────────────────────────────────────────────────────────────────────────────

export function WorkflowButton({
  icon: Icon,
  children,
  selected = false,
  onClick,
  disabled,
  size = 'default',
  type = 'button',
  className,
}: {
  icon?: IconType
  children: ReactNode
  /** Selected/active state fills the control teal. */
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
  size?: 'sm' | 'default' | 'lg'
  /** Native button type, so WorkflowButton can submit a form. */
  type?: 'button' | 'submit' | 'reset'
  className?: string
}) {
  return (
    <Button
      variant="outline"
      size={size}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        selected
          // Selected / active: solid Right Path teal, from the brand token.
          ? 'border-transparent bg-brand text-brand-foreground hover:bg-brand-hover'
          // Unselected: neutral outline that reads as brand-capable on hover.
          : 'border-surface-border-strong text-ink-secondary hover:border-brand-ring hover:bg-brand-wash hover:text-brand-subtle-foreground',
        className,
      )}
    >
      {Icon && <Icon aria-hidden />}
      {children}
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NextNote — a plain-language note describing what happens next.
// ─────────────────────────────────────────────────────────────────────────────

export function NextNote({ children }: { children: ReactNode }) {
  // "What happens next" is operational: it tells the worker the resulting
  // state. Keep it readable (slate-600), never pale gray.
  return (
    <p className="flex items-start gap-1.5 text-sm text-ink-supporting">
      <span className="mt-0.5 shrink-0" aria-hidden>{'\u2192'}</span>
      <span>{children}</span>
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ExternalActionConfirm — launch an external action, then confirm completion.
//
// The worker first launches an external action (open the prepared email, dial
// the phone). Launching does NOT count as completion. Only after launching does
// the confirmation become available, where the worker confirms what happened.
// The launch handler is injected; the prototype passes a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Check } from 'lucide-react'

export function ExternalActionConfirm({
  launchIcon = ExternalLink,
  launchLabel,
  confirmLabel,
  confirmedNote,
  hint,
  onLaunch,
  onConfirmed,
}: {
  launchIcon?: IconType
  launchLabel: string
  confirmLabel: string
  confirmedNote: ReactNode
  hint?: ReactNode
  onLaunch?: () => void
  onConfirmed?: () => void
}) {
  const [launched, setLaunched] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4 text-base text-status-confirmed-strong">
        <Check className="size-5" aria-hidden /> {confirmedNote}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <PrimaryAction
        icon={launchIcon}
        label={launchLabel}
        onClick={() => { onLaunch?.(); setLaunched(true) }}
      />

      {/* The confirmation only becomes available after the external action is
          launched. Launching is not completion. */}
      <div className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors',
        launched ? 'border-surface-border bg-surface-card' : 'border-dashed border-surface-border bg-surface-muted',
      )}>
        <span className="text-sm text-ink-supporting">
          {launched ? 'Done in the external tool?' : 'After you open it and finish there, confirm here.'}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!launched}
          onClick={() => { setConfirmed(true); onConfirmed?.() }}
          className="ml-auto"
        >
          <Check className="size-4" aria-hidden /> {confirmLabel}
        </Button>
      </div>

      {hint && <NextNote>{hint}</NextNote>}
    </div>
  )
}
