import type { Meta, StoryObj } from '@storybook/react'
import { useState, type ReactNode } from 'react'
import {
  Phone,
  Mail,
  Users,
  CalendarClock,
  Sparkles,
  GraduationCap,
  X,
  Clock,
  AlertCircle,
  Target,
  Briefcase,
  FolderOpen,
} from 'lucide-react'

import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import { WorkflowSurface } from '@/components/workflow/primitives'
import { WorkflowPageHeader } from '@/components/workflow'
import { cn } from '@/lib/utils'

/**
 * MY WORK — redesign PROTOTYPE (visual + interaction only).
 *
 * A Storybook-only exploration of a redesigned My Work landing page. It does NOT
 * touch the real My Work application, its composition, business rules, routes,
 * or data — it renders representative SAMPLE data through the shared Right Path
 * light-theme workflow surface and design tokens.
 *
 * The direction is the THREE-COLUMN board (the single story). Three distinct
 * areas, each under a prominent teal heading, let an employee read the screen in
 * seconds:
 *
 *   1. PRIORITIES         — Fixed commitments (exact + window), missed
 *      commitments, intake, outreach. A category with nothing to act on
 *      collapses to a compact neutral white card; strong color is earned only
 *      when attention is warranted.
 *   2. AVAILABLE WORK     — Work the employee can pick up around their
 *      commitments, in a representative order (Calls Due Today, Contact
 *      Research, Ready to Email, Ready to Call, Policy Reviews).
 *   3. PRACTICE DIRECTION — Management direction, the active Today's Focus, and
 *      the employee's standing responsibilities. No greeting or filler.
 *
 * Content here is ILLUSTRATIVE. Actual priorities, available work, and practice
 * direction will be driven by employee responsibilities, live data, and GoRules
 * ZEN — no business rules are hardcoded into this design.
 *
 * Preserved throughout: the three-column responsive layout (collapses to a
 * single stack on narrow screens), the settled "Strong" purposeful color, the
 * compact cards, and the purple graduation-cap mentoring disclosures (click to
 * expand beneath the item, close to restore the cap; collapsed by default).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tone system — deliberate, purposeful color for urgency/importance.
//
// Each tone drives the WHOLE card (border, left accent, surface wash, count
// chip, icon badge), so importance reads from the overall presentation rather
// than a small colored glyph. 'critical' (missed) is the loudest, 'attention'
// (intake) is clearly elevated, 'calm' (routine outreach / available work) is
// quiet so it never competes with the two that matter.
// ─────────────────────────────────────────────────────────────────────────────

type Tone = 'critical' | 'attention' | 'focus' | 'calm'

interface ToneStyle {
  card: string
  badge: string
  chip: string
  count: string
  label: string
}

/**
 * The settled color treatment (chosen from the earlier five-level comparison:
 * the "Strong" step). Each attention-bearing tone carries a clearly tinted
 * surface (`-100`), a strong left-accent bar and solid fills (`-700`), and deep
 * readable text (`-900`), so importance reads from the whole card. The three
 * tones share this weight so the board's color moves together:
 *   - critical = red    (missed commitments)
 *   - attention = amber (intake + the fixed-commitments summary)
 *   - focus = teal      (Today's Focus — the Right Path brand accent)
 * 'calm' stays on the quiet design tokens so routine work never competes.
 */
const TONE: Record<Tone, ToneStyle> = {
  critical: {
    card: 'border-l-4 border-red-300 border-l-red-700 bg-red-100',
    badge: 'bg-red-700 text-white',
    chip: 'bg-red-700 text-white',
    count: 'text-red-900',
    label: 'text-red-900',
  },
  attention: {
    card: 'border-l-4 border-amber-300 border-l-amber-700 bg-amber-100',
    badge: 'bg-amber-700 text-white',
    chip: 'bg-amber-700 text-white',
    count: 'text-amber-900',
    label: 'text-amber-900',
  },
  focus: {
    card: 'border-l-4 border-teal-300 border-l-teal-700 bg-teal-100',
    badge: 'bg-teal-700 text-white',
    chip: 'bg-teal-700 text-white',
    count: 'text-teal-900',
    label: 'text-teal-900',
  },
  calm: {
    card: 'border-surface-border bg-surface-card',
    badge: 'bg-brand-wash text-brand-hover',
    chip: 'bg-brand-wash text-brand-hover',
    count: 'text-ink',
    label: 'text-ink',
  },
}

/** Resolve a tone to its concrete styling. */
function toneStyle(tone: Tone): ToneStyle {
  return TONE[tone]
}

// ─────────────────────────────────────────────────────────────────────────────
// Representative sample data (prototype only — no real records).
// ─────────────────────────────────────────────────────────────────────────────

interface PriorityItem {
  key: string
  label: string
  count: number
  /** One-line steer shown under the label when the category needs attention. */
  steer: string
  /** The tone used WHEN this category warrants attention (count > 0). At zero
   * the card is rendered neutral/white regardless of this. */
  attentionTone: Exclude<Tone, 'calm' | 'focus'>
  icon: typeof Phone
  /** One-line "nothing to do" note shown in the compact neutral empty state. */
  emptyNote: string
  /** Optional coaching, revealed by the graduation-cap icon. */
  mentoring?: ReactNode
  /** Optional inline Assistant note — shown only when it genuinely adds value. */
  assistant?: ReactNode
}

/**
 * The attention categories, in priority order. A category only earns color when
 * it has something requiring attention (count > 0); otherwise it collapses to a
 * compact neutral white card so the employee can see at a glance that it is
 * clear without it competing for attention. Outreach is intentionally 'calm'
 * even when present — it is available work, not an exception — so it never earns
 * the critical/attention treatment here.
 */
const PRIORITIES: PriorityItem[] = [
  {
    key: 'missed',
    label: 'Missed commitments',
    count: 2,
    steer: 'Two promised callbacks are past due.',
    attentionTone: 'critical',
    icon: AlertCircle,
    emptyNote: 'None past due.',
    assistant: 'Start here. These were promised for earlier and the customer is still waiting.',
    mentoring: (
      <>
        A missed commitment is a promise the customer is still holding. Call
        before anything else, lead by acknowledging the delay, and reset a
        realistic time if you cannot finish now.
      </>
    ),
  },
  {
    key: 'intake',
    label: 'Intake waiting',
    count: 4,
    steer: 'Four new referrals need a first touch today.',
    attentionTone: 'attention',
    icon: Users,
    emptyNote: 'No new referrals waiting.',
    mentoring: (
      <>
        Intake is a fresh lead from a partner agency. The first contact sets the
        tone: confirm the referral, verify contact details, and book the next
        step rather than trying to close on the first call.
      </>
    ),
  },
  {
    // Demonstrates the quiet empty state: outreach has nothing due as a
    // priority right now, so it renders as a compact neutral card. (Available
    // outreach work still lives in the Available Work column.)
    key: 'outreach',
    label: 'Outreach due',
    count: 0,
    steer: '',
    attentionTone: 'attention',
    icon: Phone,
    emptyNote: 'Nothing due — open outreach is in Available Work.',
    mentoring: (
      <>
        Outreach spans two modes. Save calls for calling hours and batch the
        intro emails into quieter time so your live-phone energy goes where it
        matters.
      </>
    ),
  },
]

interface WorkCard {
  /** Lower rank = worked sooner. Drives the visible ordering of the column. */
  rank: number
  label: string
  count: number
  channel: 'calls' | 'emails' | 'mixed'
  note: string
  /** Short reason this sits where it does in the order. */
  orderNote: string
  mentoring?: ReactNode
}

/**
 * Available work in a representative suggested order for the prototype: Calls
 * Due Today, Contact Research, Ready to Email, Ready to Call, Policy Reviews.
 *
 * IMPORTANT: this ordering is ILLUSTRATIVE only. It is not a new fixed priority
 * system. In the real screen the order must come from the existing GoRules
 * decision, Today's Focus, and the employee's eligibility — not from a second
 * ranking invented here. The `rank` values just reproduce the requested
 * example sequence for the mock.
 */
const AVAILABLE_WORK: WorkCard[] = [
  {
    rank: 1,
    label: 'Calls due today',
    count: 3,
    channel: 'calls',
    note: 'Promised or scheduled for today.',
    orderNote: 'Time-sensitive.',
    mentoring: (
      <>
        A due call has a date attached. It is the closest thing to a commitment
        in this list, so clear it before picking up open outreach.
      </>
    ),
  },
  {
    rank: 2,
    label: 'Contact research',
    count: 2,
    channel: 'mixed',
    note: 'Missing phone or email to find.',
    orderNote: 'Unblocks later outreach.',
    mentoring: (
      <>
        Research clears the blockers for everyone. When a number or email is
        missing, a few minutes here turns an un-callable record into reachable
        work for the whole team.
      </>
    ),
  },
  {
    rank: 3,
    label: 'Ready to email',
    count: 5,
    channel: 'emails',
    note: 'Prepared messages are drafted.',
    orderNote: 'Fits quiet, non-calling time.',
    mentoring: (
      <>
        Email is quiet work. The intro message is already prepared; your job is
        to personalize the opening line so it reads like a person, not a batch.
      </>
    ),
  },
  {
    rank: 4,
    label: 'Ready to call',
    count: 6,
    channel: 'calls',
    note: 'Usable phone, no open commitment.',
    orderNote: 'Best during calling hours.',
    mentoring: (
      <>
        These customers have a usable phone and no open commitment. Work them in
        calling hours; a live conversation moves the relationship faster than a
        message.
      </>
    ),
  },
  {
    rank: 5,
    label: 'Policy reviews',
    count: 3,
    channel: 'mixed',
    note: 'Annual reviews due this week.',
    orderNote: 'Due this week, not today.',
  },
]

/**
 * Fixed commitments come in two kinds, mirroring the IPF exact-time vs
 * date-only/window distinction:
 *
 *   - 'exact'  — an appointment at a specified date AND clock time. These
 *                control the day and are shown with their time.
 *   - 'window' — a commitment to reach the customer within a stated part of the
 *                day. Our intended blocks are 9–12, 12–3, 3–6, and after 6.
 *
 * Illustrative sample only; no scheduling logic is implemented here.
 */
type TimeBlock = '9-12' | '12-3' | '3-6' | 'after-6'

const TIME_BLOCK_LABEL: Record<TimeBlock, string> = {
  '9-12': '9 AM – 12 PM',
  '12-3': '12 – 3 PM',
  '3-6': '3 – 6 PM',
  'after-6': 'After 6 PM',
}

type FixedCommitment =
  | { kind: 'exact'; label: string; time: string }
  | { kind: 'window'; label: string; block: TimeBlock }

const FIXED_COMMITMENTS: FixedCommitment[] = [
  // Two exact appointments (specified date + clock time).
  { kind: 'exact', label: 'Follow-up call — Jordan Reyes', time: '11:30 AM' },
  { kind: 'exact', label: 'Policy review — the Okafor household', time: '2:00 PM' },
  // Two window commitments (reach the customer within a stated block).
  { kind: 'window', label: 'Return call — Priya Nair', block: '12-3' },
  { kind: 'window', label: 'Check in — the Delgado household', block: 'after-6' },
]

const EXACT_COUNT = FIXED_COMMITMENTS.filter((c) => c.kind === 'exact').length
const WINDOW_COUNT = FIXED_COMMITMENTS.filter((c) => c.kind === 'window').length

/**
 * Practice Direction sample: what the agency expects of this employee. This is
 * management direction and standing responsibility, NOT a restatement of the
 * work already shown in the other two columns. Each item helps the employee
 * decide what to do, rather than greeting them or narrating the obvious.
 */
interface DirectionItem {
  key: string
  label: string
  detail: string
  mentoring?: ReactNode
}

/** The employee's standing responsibilities (their capability-based remit).
 * Representative only; the real screen resolves these from the employee's work
 * functions / eligibility. */
const RESPONSIBILITIES: DirectionItem[] = [
  {
    key: 'intake',
    label: 'Referral intake',
    detail: 'Primary — you own first contact on new Allstate referrals.',
    mentoring: (
      <>
        As primary on intake, a referral sitting untouched reflects on you first.
        Aim to make first contact the same day it arrives.
      </>
    ),
  },
  {
    key: 'reviews',
    label: 'Policy reviews',
    detail: 'Support — help clear the review backlog when you have capacity.',
  },
]

/** Management direction / expectations for the period. Representative only. */
const EXPECTATIONS: DirectionItem[] = [
  {
    key: 'response',
    label: 'Same-day first contact',
    detail: 'Reach every new referral the day it arrives.',
  },
  {
    key: 'commitments',
    label: 'No missed callbacks',
    detail: 'Honor promised times, or reset them before they lapse.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Per-item Mentoring disclosure (purple graduation-cap, the Mentor identity).
//
// Collapsed by default. Clicking the cap HIDES it and expands the explanation
// directly beneath the item; closing restores the cap. Local state only.
// ─────────────────────────────────────────────────────────────────────────────

function MentorToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Show mentoring tip"
      aria-expanded={false}
      onClick={onOpen}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-purple-500 transition-colors hover:bg-purple-100 hover:text-purple-700"
    >
      <GraduationCap className="size-4" aria-hidden />
    </button>
  )
}

function MentorPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm leading-relaxed text-purple-800">
      <GraduationCap className="mt-0.5 size-4 shrink-0 text-purple-500" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        aria-label="Hide mentoring tip"
        aria-expanded
        onClick={onClose}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-purple-500 transition-colors hover:bg-purple-100 hover:text-purple-700"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact priority card — the whole card carries the tone.
// ─────────────────────────────────────────────────────────────────────────────

function PriorityCard({ item }: { item: PriorityItem }) {
  const Icon = item.icon
  const active = item.count > 0
  // Color is earned, not default: only a category that needs attention takes
  // its attention tone. A clear category collapses to the quiet neutral card.
  const t = toneStyle(active ? item.attentionTone : 'calm')
  const [open, setOpen] = useState(false)

  // Compact neutral empty state: label, a muted icon, and a short "clear" note
  // on one line so the employee reads it as resolved without it competing.
  if (!active) {
    return (
      <li className="rounded-xl border border-surface-border bg-surface-card p-3">
        <div className="flex items-center gap-2.5">
          <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <span className="font-semibold text-ink">{item.label}</span>
          <span className="ml-auto text-xs text-ink-supporting">{item.emptyNote}</span>
        </div>
      </li>
    )
  }

  return (
    <li className={cn('rounded-xl border p-3', t.card)}>
      <div className="flex items-start gap-3">
        <span
          className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', t.badge)}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn('font-semibold', t.label)}>{item.label}</p>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', t.chip)}>
              {item.count}
            </span>
            {item.mentoring && !open && (
              <span className="ml-auto">
                <MentorToggle onOpen={() => setOpen(true)} />
              </span>
            )}
          </div>

          <p className="mt-0.5 text-sm leading-snug text-ink-secondary">{item.steer}</p>

          {/* Inline Assistant note: only present when it genuinely adds value
              (e.g. why this is first). No permanent box, no greeting. */}
          {item.assistant && (
            <p className="mt-2 flex items-start gap-1.5 text-sm font-medium leading-snug text-ink">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-hover" aria-hidden />
              <span>{item.assistant}</span>
            </p>
          )}

          {item.mentoring && open && (
            <MentorPanel onClose={() => setOpen(false)}>{item.mentoring}</MentorPanel>
          )}
        </div>
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Small available-work card.
// ─────────────────────────────────────────────────────────────────────────────

function WorkMiniCard({ card, position }: { card: WorkCard; position: number }) {
  const Icon = card.channel === 'calls' ? Phone : card.channel === 'emails' ? Mail : FolderOpen
  const [open, setOpen] = useState(false)
  return (
    <article className="rounded-xl border border-surface-border bg-surface-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-ink">
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold tabular-nums text-ink-secondary"
            aria-hidden
          >
            {position}
          </span>
          <Icon className="size-4 shrink-0 text-ink-supporting" aria-hidden />
          <span className="truncate font-semibold">{card.label}</span>
          {card.mentoring && !open && <MentorToggle onOpen={() => setOpen(true)} />}
        </span>
        <span className="text-2xl font-semibold leading-none tabular-nums text-ink">{card.count}</span>
      </div>
      <div className="mt-1 pl-7">
        <p className="text-sm leading-snug text-ink-secondary">{card.note}</p>
        <p className="mt-0.5 text-xs font-medium text-ink-supporting">{card.orderNote}</p>
        {card.mentoring && open && (
          <MentorPanel onClose={() => setOpen(false)}>{card.mentoring}</MentorPanel>
        )}
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Column sections.
// ─────────────────────────────────────────────────────────────────────────────

/** A column header: a prominent teal column name, so each column reads as its
 * own distinct area. */
function ColumnHeader({ title }: { title: string }) {
  return (
    <h2 className="text-xl font-bold tracking-tight text-brand-hover">{title}</h2>
  )
}

/**
 * The lead of the priorities column: how many fixed commitments the employee
 * has today, split by the two kinds. Exact appointments carry a clock time;
 * window commitments carry their time block. This is the first thing the
 * employee sees because a fixed commitment outranks everything else.
 */
function FixedCommitmentsSummary() {
  // The commitments summary is an 'attention' surface, so it shares the amber
  // treatment with the Intake card (card tint, left bar, solid badge/chip),
  // keeping the priorities column coherent.
  const t = toneStyle('attention')
  const total = FIXED_COMMITMENTS.length
  const exact = FIXED_COMMITMENTS.filter((c) => c.kind === 'exact') as Extract<
    FixedCommitment,
    { kind: 'exact' }
  >[]
  const windows = FIXED_COMMITMENTS.filter((c) => c.kind === 'window') as Extract<
    FixedCommitment,
    { kind: 'window' }
  >[]

  return (
    <div className={cn('rounded-xl border p-3', t.card)}>
      <div className="flex items-center gap-2">
        <span
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', t.badge)}
          aria-hidden
        >
          <CalendarClock className="size-4" />
        </span>
        <p className={cn('font-semibold', t.label)}>
          {total} fixed {total === 1 ? 'commitment' : 'commitments'} today
        </p>
        <span className={cn('ml-auto text-xs font-medium', t.count)}>
          {EXACT_COUNT} timed · {WINDOW_COUNT} windowed
        </span>
      </div>

      <p className="mt-0.5 pl-10 text-sm leading-snug text-ink-secondary">
        These control your day. Work around them before picking up anything else.
      </p>

      <div className="mt-2.5 space-y-2.5 pl-10">
        {exact.length > 0 && (
          <div>
            <p className={cn('text-xs font-semibold uppercase tracking-wide', t.count)}>
              Exact appointments
            </p>
            <ul className="mt-1 space-y-1">
              {exact.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <span className={cn('mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', t.chip)}>
                    <Clock className="size-3" aria-hidden />
                    {c.time}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug text-ink">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {windows.length > 0 && (
          <div>
            <p className={cn('text-xs font-semibold uppercase tracking-wide', t.count)}>
              Within a time window
            </p>
            <ul className="mt-1 space-y-1">
              {windows.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <span className={cn('mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold', t.chip)}>
                    {TIME_BLOCK_LABEL[c.block]}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug text-ink">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function PrioritiesColumn() {
  return (
    <section aria-label="Priorities" className="space-y-2.5">
      <ColumnHeader title="Priorities" />
      <FixedCommitmentsSummary />
      <ul className="space-y-2.5">
        {PRIORITIES.map((p) => (
          <PriorityCard key={p.key} item={p} />
        ))}
      </ul>
    </section>
  )
}

function AvailableWorkColumn() {
  const ordered = [...AVAILABLE_WORK].sort((a, b) => a.rank - b.rank)
  return (
    <section aria-label="Available work" className="space-y-3">
      <ColumnHeader title="Available work" />
      <div className="space-y-2.5">
        {ordered.map((c, i) => (
          <WorkMiniCard key={c.label} card={c} position={i + 1} />
        ))}
      </div>
    </section>
  )
}

/** One Practice Direction item: a label, a decision-useful detail, and optional
 * mentoring. Compact and neutral — this column is standing direction, not an
 * attention alarm, so it does not use the critical/attention tones. */
function DirectionRow({ item }: { item: DirectionItem }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink">{item.label}</span>
            {item.mentoring && !open && <MentorToggle onOpen={() => setOpen(true)} />}
          </div>
          <p className="text-sm leading-snug text-ink-secondary">{item.detail}</p>
          {item.mentoring && open && (
            <MentorPanel onClose={() => setOpen(false)}>{item.mentoring}</MentorPanel>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * PRACTICE DIRECTION — what the agency expects of this employee. Replaces the
 * old "Your day" rail. It carries management direction, the active Today's
 * Focus, and the employee's standing responsibilities — each item chosen to
 * help the employee decide what to do, not to greet them or restate the work
 * already shown in the other two columns.
 */
function PracticeDirectionColumn() {
  // Today's Focus keeps the teal 'focus' surface — it is active management
  // direction, so it earns color here.
  const focus = toneStyle('focus')
  return (
    <section aria-label="Practice direction" className="space-y-3">
      <ColumnHeader title="Practice direction" />

      {/* Active Today's Focus — the live management steer. */}
      <div className={cn('rounded-xl border p-3', focus.card)}>
        <p className={cn('flex items-center gap-2 text-sm font-semibold', focus.label)}>
          <Sparkles className="size-4" aria-hidden /> Today&apos;s Focus
        </p>
        <p className="mt-1.5 text-sm leading-snug text-ink">
          <span className="font-semibold">Q4 placement push</span> — clear referral intakes
          toward placement.
        </p>
        <p className="mt-1 text-xs text-ink-supporting">Reorders your work until 5:00 PM.</p>
      </div>

      {/* Standing expectations for the period. */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Target className="size-4 shrink-0 text-ink-supporting" aria-hidden /> Expectations
        </p>
        <ul className="mt-2 space-y-2">
          {EXPECTATIONS.map((e) => (
            <DirectionRow key={e.key} item={e} />
          ))}
        </ul>
      </div>

      {/* The employee's capability-based responsibilities (primary / support). */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Briefcase className="size-4 shrink-0 text-ink-supporting" aria-hidden /> Your
          responsibilities
        </p>
        <ul className="mt-2 space-y-2">
          {RESPONSIBILITIES.map((r) => (
            <DirectionRow key={r.key} item={r} />
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout — Three columns (preferred). Uses the full width, no Assistant box.
// ─────────────────────────────────────────────────────────────────────────────

function ThreeColumnLayout() {
  return (
    <div className="space-y-6">
      <WorkflowPageHeader title="My Work" />
      <div className="grid gap-6 lg:grid-cols-3 xl:gap-8">
        <PrioritiesColumn />
        <AvailableWorkColumn />
        <PracticeDirectionColumn />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Storybook wiring.
// ─────────────────────────────────────────────────────────────────────────────

/** Render on the real workflow surface, inside the Mentoring provider so the
 * per-item graduation-cap coaching behaves as it does in the app chrome.
 *
 * Width (hybrid): the board occupies the middle ~80% of the SCREEN with ~10%
 * gutters on each side, but stops expanding at a 1760px cap so it does not
 * sprawl on an ultrawide monitor. We drop the surface's own horizontal padding
 * so `w-4/5` is measured against the full viewport; `max-w-[1760px]` then caps
 * it on very wide displays, and the percentage keeps it responsive on smaller
 * screens. The three columns split that width into roughly 25% each, with the
 * grid gap as the space between them. This width behavior is local to the
 * prototype; WorkflowPage and WORKFLOW_MAX_WIDTH are unchanged. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <MentoringProvider>
      <WorkflowSurface className="px-0 sm:px-0">
        <div className="mx-auto w-4/5 min-w-0 max-w-[1760px]">{children}</div>
      </WorkflowSurface>
    </MentoringProvider>
  )
}

const meta: Meta = {
  title: 'My Work/Redesign Prototype',
  parameters: {
    layout: 'fullscreen',
  },
}
export default meta

type Story = StoryObj

export const ThreeColumnLayout_: Story = {
  name: 'Three Column Layout',
  render: () => (
    <Frame>
      <ThreeColumnLayout />
    </Frame>
  ),
}
