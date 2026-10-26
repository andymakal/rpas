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
import { ExternalLink, MessageSquareQuote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TaskColumns } from './TaskColumns'

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
  heading,
  className,
  surfaceClassName,
  contentWidthClassName = WORKFLOW_MAX_WIDTH,
}: {
  children: ReactNode
  /** Optional fixed heading band (e.g. a Back link + WorkflowHeader). When
   * provided, the page fills the available height: this band stays visible and
   * only `children` (the work area) scrolls. The behavior is pure flex — it
   * needs no viewport offset and adapts to any app-header height — and it
   * requires a height-providing parent (WorkflowChrome supplies one for every
   * light-theme workflow route). Omit it and the page keeps its original
   * single-scroll behavior exactly, so stories and non-workflow callers are
   * unchanged. */
  heading?: ReactNode
  className?: string
  surfaceClassName?: string
  /** Max-width of the centered content column. Defaults to the shared workflow
   * width; My Work passes its wider column so its appearance is preserved. */
  contentWidthClassName?: string
}) {
  // No heading band: unchanged single-column surface that scrolls with the page.
  if (heading == null) {
    return (
      <WorkflowSurface className={cn('sm:px-10', surfaceClassName)}>
        <div className={cn('mx-auto w-full', contentWidthClassName, 'space-y-8 text-ink-secondary', className)}>
          {children}
        </div>
      </WorkflowSurface>
    )
  }

  // Heading band + independently scrolling work area. The surface becomes a
  // flex column filling its parent (WorkflowChrome's flex-1 region). The band
  // carries the top + side gutter and never scrolls; the work area carries the
  // side + bottom gutter, fills the rest (flex-1 + min-h-0), and is the ONLY
  // scroller (overflow-y-auto). min-h-0 is what lets the work area shrink below
  // its content so it scrolls instead of growing the page. Same max-width,
  // centering, gutters, and space-y-8 rhythm as the default, so appearance is
  // preserved; only the scroll boundary moves from the whole page to the work
  // area.
  return (
    <WorkflowSurface className={cn('flex h-full min-h-0 flex-col !px-0 !py-0', surfaceClassName)}>
      <div className={cn('mx-auto w-full shrink-0 px-6 pt-8 sm:px-10', contentWidthClassName)}>
        {heading}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-8 sm:px-10">
        <div className={cn('mx-auto w-full', contentWidthClassName, 'space-y-8 text-ink-secondary', className)}>
          {children}
        </div>
      </div>
    </WorkflowSurface>
  )
}

/**
 * The prominent page heading. Renders in the clean sans workflow font (inherited
 * from WorkflowSurface) with the dark bold teal heading treatment
 * (`text-ink-heading`, extrabold), matching the IPF page-title style. Renders
 * "Primary — secondary" when a secondary part is supplied (e.g. "1035 Workflow —
 * Today's work"); the secondary reads as muted supporting text beside it.
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
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-heading sm:text-4xl">
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
//
// A THIRD `history` column is optional: when supplied, the task uses the
// working-screen three-column layout — current work and actions on the LEFT,
// the customer context (identity + policy summary) in the CENTER, and the
// customer's history (with the preview of what this work will record) on the
// RIGHT. Omitting `history` keeps the original two-column action/context layout
// unchanged, so existing callers are untouched.
// ─────────────────────────────────────────────────────────────────────────────

export function TaskShell({
  header, action, context, history,
}: {
  header: ReactNode
  /** The current action: what the worker should do now (left column). */
  action: ReactNode
  /** Customer/relationship context supporting the action (center/right column). */
  context: ReactNode
  /** Optional customer-history column. When present the layout is three columns
   * (work · context · history); when absent it stays the two-column default. */
  history?: ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full', WORKFLOW_MAX_WIDTH, 'space-y-6 text-ink-secondary')}>
      {header}
      {history != null ? (
        // Three EQUAL-width columns on the widest screens, staying responsive:
        // one column on narrow, two on medium, three equal thirds on xl. Equal
        // thirds keep work · context · history balanced across the working
        // screens.
        //
        // Independent column scrolling is INHERENT to the three-column workspace
        // (not a per-page opt-in). TaskColumns fits the row to the ACTUAL space
        // beneath the page heading by measuring the row's own position — no
        // guessed viewport offset — and scrolls each column within its bounds on
        // desktop. Below xl the columns stack and the page scrolls normally.
        <TaskColumns action={action} context={context} history={history} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-5">{action}</div>
          <div className="space-y-5">{context}</div>
        </div>
      )}
    </div>
  )
}

/** A column heading for grouping context blocks on the left of a task screen. */
export function ContextLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-supporting">{children}</p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionPanel — the action-first panel for the right column. Leads with a large
// action heading so the worker instantly knows what to do.
// ─────────────────────────────────────────────────────────────────────────────

export function ActionPanel({
  heading, children,
}: {
  /** Optional large action heading. Omit it when the panel's leading content
   * already states the action (so the panel does not carry a redundant title). */
  heading?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-5 rounded-2xl border border-brand-subtle bg-surface-card p-6">
      {heading != null && (
        <h3 className="text-2xl font-semibold leading-tight tracking-tight text-ink">{heading}</h3>
      )}
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
        // A workflow action is read and clicked, so it carries a comfortable
        // readable size (>=16px) and target height regardless of the shadcn
        // Button's small default. [&_svg] keeps the icon proportionate.
        'h-11 gap-2 px-4 text-base [&_svg]:size-5',
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
    <p className="flex items-start gap-1.5 text-base leading-relaxed text-ink-supporting">
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
        <span className="text-base text-ink-supporting">
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

// ─────────────────────────────────────────────────────────────────────────────
// SpokenScriptCard — a read-aloud talk track.
//
// For script text the worker SAYS to a person who is on the line right now: a
// live call opening, an in-person greeting, any prompt read out loud. It is
// deliberately NOT the copy-to-clipboard CallScriptCard / LightScriptCard, which
// exist for text the worker transmits through another channel (a voicemail
// greeting note, a Hearsay text, an email). Spoken words have no paste
// destination, so this card carries NO Copy affordance; it only presents the
// label and the script to be read.
//
// Generic and data-type-agnostic, so any workflow screen with a spoken prompt
// reuses it. The talk track is operational information the worker performs, so
// it is rendered at a readable (not muted) tier per the workflow visual rules.
// ─────────────────────────────────────────────────────────────────────────────

export function SpokenScriptCard({
  label,
  body,
  bodySizeClassName = 'text-base',
}: {
  /** The short uppercase section label (e.g. "Opening script"). */
  label: string
  /** The talk track to read aloud. Preserves its own line breaks. */
  body: string
  /** Tailwind text-size class for the body. Defaults to text-base (16px) so
   * every existing call site is unchanged; a caller can pass e.g. text-lg (18px)
   * for a larger, read-aloud-friendly size. */
  bodySizeClassName?: string
}) {
  return (
    <div className="space-y-2 rounded-xl border border-surface-border bg-surface-muted p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-supporting">
        <MessageSquareQuote className="size-3.5" aria-hidden /> {label}
      </p>
      <p className={cn('whitespace-pre-line leading-relaxed text-ink-secondary', bodySizeClassName)}>{body}</p>
    </div>
  )
}
