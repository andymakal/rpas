'use client'

/**
 * MY WORK client surface (Right Path, light workflow theme).
 *
 * Renders the ready MyWorkState the server composition resolved: activity
 * groups ordered by the GoRules ZEN priority band, each with its counts, its
 * sources, and (for eligible workers) a claim control. It does NO business
 * judgment and NO prioritization — ZEN owns the ordering; this presents it.
 *
 * LAYOUT: the approved three-column board (see the Storybook reference,
 * MyWorkRedesign.prototype.stories.tsx). Each column has a distinct purpose and
 * is populated ONLY from real resolved data:
 *
 *   1. Priorities        — what needs attention: genuine commitments (date-only
 *      promised callbacks that have come due, the `due_callback` band), plus the
 *      attention categories (overdue/commitments, intake first-touch, focus),
 *      each earning color only when it actually has work. Exact-time
 *      appointments and preferred calling windows are not yet captured, so they
 *      appear as a discreet "Coming soon" note — never as invented data and
 *      never implying there is no work.
 *   2. Available work    — the actionable activities in the ESTABLISHED ZEN +
 *      catalog order (deriveMyWorkDirection → workingPlan). No new ranking is
 *      introduced; this re-presents the same ordered plan as compact cards.
 *   3. Practice direction — the live Today's Focus, the employee's standing
 *      responsibilities derived from their capability routing (primary/support),
 *      and a discreet "Coming soon" for additional management expectations not
 *      yet modeled.
 *
 * The deferred capabilities behind the "Coming soon" markers (exact-time
 * appointments, preferred calling windows, standing practice expectations) are
 * recorded in /DEFERRED_CAPABILITIES.md.
 *
 * The full per-activity inventory (band-grouped cards with sources, counts,
 * claim-state, and per-item guidance) is preserved on demand under Available
 * work, so every existing route, count, eligibility distinction, and claim
 * breakdown remains reachable. The Project + Activity filters, the deep-link
 * project pre-select, and the Mentoring disclosures are unchanged.
 *
 * Built on the shared workflow design system (src/components/workflow) and the
 * design tokens, per the Right Path light-theme workflow visual rules.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'
import {
  Sparkles, ArrowRight, Phone, Mail, Users, CheckCircle2, Lock,
  ListChecks, ChevronRight, SlidersHorizontal,
  CalendarClock, Target, Briefcase, Hourglass,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useMentorDisclosure,
  MentorCapButton,
  MentorCapPanel,
} from '@/lib/mentoring/MentorUi'
import {
  WorkflowSurface,
  WorkflowHeader,
  OperationalTag,
  type OperationalTone,
} from '@/components/workflow'
import { cn } from '@/lib/utils'
import { capabilityStatusLabel } from '@/lib/capabilities/explanations'
import {
  activityGuidance,
  outreachChannelMode,
  WORK_MODE_NOTE,
  type WorkMode,
} from '@/lib/my-work/guidance'
import type { ActivityGroup, MyWorkState, PriorityBand } from '@/lib/my-work/types'
import {
  ALL,
  applyWorkFilters,
  activityFilterOptions,
  projectFilterOptions,
  type FilterOption,
} from '@/lib/my-work/filters'
import {
  deriveMyWorkDirection,
  type MyWorkDirection,
  type PlanStep,
} from '@/lib/my-work/direction'

// ─────────────────────────────────────────────────────────────────────────────
// Attention tone — the settled "Strong" (Level-4) treatment from the approved
// Storybook reference. Each tone drives the WHOLE card so importance reads from
// the overall presentation, not a tiny glyph. Color is EARNED: a category only
// takes an attention tone when it actually has work; otherwise it renders as a
// quiet neutral card. 'calm' stays on the quiet design tokens.
// ─────────────────────────────────────────────────────────────────────────────

type AttentionTone = 'critical' | 'attention' | 'focus'

const TONE: Record<AttentionTone, { card: string; badge: string; chip: string; label: string }> = {
  critical: {
    card: 'border-l-4 border-red-300 border-l-red-700 bg-red-100',
    badge: 'bg-red-700 text-white',
    chip: 'bg-red-700 text-white',
    label: 'text-red-900',
  },
  attention: {
    card: 'border-l-4 border-amber-300 border-l-amber-700 bg-amber-100',
    badge: 'bg-amber-700 text-white',
    chip: 'bg-amber-700 text-white',
    label: 'text-amber-900',
  },
  focus: {
    card: 'border-l-4 border-teal-300 border-l-teal-700 bg-teal-100',
    badge: 'bg-teal-700 text-white',
    chip: 'bg-teal-700 text-white',
    label: 'text-teal-900',
  },
}

/** The band's human section title and tag tone, driven by ZEN's band. The three
 * non-routable bands are deliberately distinct sections, each saying something
 * different: assist is actionable; unassigned and unlicensed are awareness-only
 * for different reasons. (Used by the on-demand full inventory.) */
const BAND_META: Record<PriorityBand, { title: string; tone: OperationalTone }> = {
  exact_time_commitment: { title: 'Fixed appointments now', tone: 'exception' },
  focus:                 { title: "Today's Focus", tone: 'reason' },
  due_callback:          { title: 'Promised callbacks due', tone: 'exception' },
  owned:                 { title: 'Your claimed work', tone: 'info' },
  shared:                { title: 'Shared work you can pick up', tone: 'info' },
  assist:                { title: 'You can assist (not routinely yours)', tone: 'info' },
  unassigned:            { title: 'Not assigned to you', tone: 'info' },
  unlicensed:            { title: 'Needs a license you have not established', tone: 'info' },
}

export function MyWorkClient({
  state,
  initialProjectId = null,
}: {
  state: MyWorkState
  /** Project pre-selected from a "Work Project" deep link (?project_id=…). */
  initialProjectId?: string | null
}) {
  // Two combinable filters over the SAME resolved work. They narrow what is
  // shown; they never change eligibility, routes, counts, or ZEN ordering — the
  // server composition already decided all of that. 'all' means no narrowing.
  const projectOptions = useMemo(() => projectFilterOptions(state), [state])
  const activityOptions = useMemo(() => activityFilterOptions(state), [state])

  const seededProject =
    initialProjectId && projectOptions.some((o) => o.id === initialProjectId)
      ? initialProjectId
      : ALL
  const [projectFilter, setProjectFilter] = useState<string>(seededProject)
  const [activityFilter, setActivityFilter] = useState<string>(ALL)

  // Live updates. When another employee completes or claims shared work, the
  // rows My Work reads change; this subscribes to those tables and refreshes the
  // current route's server render so the counts, the fixed workflow ordering,
  // and the GoRules (ZEN) priority bands all come back correct — recomputed on
  // the server, never on the client. router.refresh() keeps this component
  // mounted, so the Project/Activity filters and every open panel below survive
  // the update. Subscribed only for an employee with a work profile; a
  // no-profile view reads nothing and needs no subscription.
  const router = useRouter()
  useRealtimeRefresh({
    channelName: 'my-work',
    enabled: !state.noProfile,
    tables: [
      // The shared board: claim/release, queue transitions, refused, submitted —
      // the primary "work completed / picked up" signal.
      { table: 'stewardship_outreach' },
      // A customer advancing (decision set) suppresses their outreach row.
      { table: 'customer_prereviews' },
      // Project membership, which scopes the Project-filtered counts.
      { table: 'project_customers' },
      // A recorded interaction (incoming response, reply, note, follow-up) lands
      // in case_touches; a genuine incoming response also moves a customer into
      // Customer Interaction, so this keeps the step's count live as
      // conversations are worked.
      { table: 'case_touches' },
    ],
    onChange: () => router.refresh(),
  })

  // After a live refresh, a previously-selected project can drain to zero work
  // and drop out of the option list. Fall back to All so the filter never points
  // at an option that no longer exists (mirrors the deep-link seed guard).
  useEffect(() => {
    if (projectFilter !== ALL && !projectOptions.some((o) => o.id === projectFilter)) {
      setProjectFilter(ALL)
    }
  }, [projectOptions, projectFilter])

  // The filtered state the columns render. Commitments are exempt from the
  // filters upstream, so a promised callback stays visible regardless.
  const filteredState = useMemo(
    () => applyWorkFilters(state, projectFilter, activityFilter),
    [state, projectFilter, activityFilter],
  )

  const hasFilters = projectOptions.length > 0 || activityOptions.length > 1
  const filtersActive = projectFilter !== ALL || activityFilter !== ALL

  if (state.noProfile) {
    return (
      // Fixed title band + scrolling work area, same flex-fill model as
      // WorkflowPage's heading slot but with My Work's own wider column, gutter,
      // and rhythm so its appearance is unchanged.
      <WorkflowSurface className="flex h-full min-h-0 flex-col !px-0 !py-0">
        <div className="mx-auto w-4/5 min-w-0 max-w-[1760px] shrink-0 px-6 pt-8 sm:px-8">
          <WorkflowHeader primary="My Work" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6 sm:px-8">
          <div className="mx-auto w-4/5 min-w-0 max-w-[1760px] space-y-6">
            <p className="max-w-prose text-base text-ink-secondary">
              Your account does not have a team member profile yet, so there is no
              personal work view. Ask an administrator to add you on the Team page;
              the shared work is still visible on the Stewardship board.
            </p>
            <Link
              href="/stewardship"
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-hover"
            >
              Open the Stewardship board <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </WorkflowSurface>
    )
  }

  // Derive the Daily Direction from the FILTERED state. This reads ZEN's
  // already-decided ordering; it does not re-rank or add a data source.
  const direction = deriveMyWorkDirection(filteredState)

  const filters: WorkFiltersProps | null = hasFilters
    ? {
        projectOptions,
        activityOptions,
        projectFilter,
        activityFilter,
        onProjectChange: setProjectFilter,
        onActivityChange: setActivityFilter,
        onClear: () => {
          setProjectFilter(ALL)
          setActivityFilter(ALL)
        },
        active: filtersActive,
      }
    : null

  return (
    // Fixed title band + scrolling work area. The page title stays visible while
    // the filters and the three-column board scroll beneath it. Same flex-fill
    // model as WorkflowPage's heading slot (no viewport offset, adapts to any
    // app-header height), with My Work's own wider column and rhythm preserved.
    <WorkflowSurface className="flex h-full min-h-0 flex-col !px-0 !py-0">
      {/* The board fills the middle ~80% of the screen (balanced gutters),
          capped so it does not sprawl on an ultrawide monitor. */}
      <div className="mx-auto w-4/5 min-w-0 max-w-[1760px] shrink-0 px-6 pt-8 sm:px-8">
        <WorkflowHeader primary="My Work" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6 sm:px-8">
        <div className="mx-auto w-4/5 min-w-0 max-w-[1760px] space-y-6">
          {filters && <WorkFilters {...filters} />}

          <div className="grid gap-6 lg:grid-cols-3 xl:gap-8">
            <PrioritiesColumn state={filteredState} />
            <AvailableWorkColumn direction={direction} state={filteredState} />
            <PracticeDirectionColumn state={state} />
          </div>
        </div>
      </div>
    </WorkflowSurface>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared column header — prominent teal title (matches the approved reference).
// ─────────────────────────────────────────────────────────────────────────────

function ColumnHeader({ title }: { title: string }) {
  return <h2 className="text-xl font-bold tracking-tight text-brand-hover">{title}</h2>
}

/** A discreet, honest "coming soon" note for a capability the system does not
 * yet capture. It states the feature is planned and is explicit that it does
 * NOT mean there is no such work — only that Right Path does not record it yet. */
function ComingSoon({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-snug text-ink-muted">
      <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-ink-supporting">Coming soon:</span> {children}
      </span>
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The filter bar (Project + Activity). Unchanged behavior; moved above the
// columns so it governs all three. Fixed-time commitments stay visible.
// ─────────────────────────────────────────────────────────────────────────────

interface WorkFiltersProps {
  projectOptions: FilterOption[]
  activityOptions: FilterOption[]
  projectFilter: string
  activityFilter: string
  onProjectChange: (v: string) => void
  onActivityChange: (v: string) => void
  onClear: () => void
  active: boolean
}

function WorkFilters({
  projectOptions,
  activityOptions,
  projectFilter,
  activityFilter,
  onProjectChange,
  onActivityChange,
  onClear,
  active,
}: WorkFiltersProps) {
  // Mentoring for the filter bar now rides the same inline graduation-cap used
  // by the other My Work items: a purple cap that expands coaching directly
  // beneath the controls. Seeded from the global Mentoring toggle (and re-seeded
  // when it changes), so the global on/off behavior is preserved exactly.
  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  return (
    <section
      aria-label="Filter your work"
      className="rounded-xl border border-surface-border bg-surface-muted p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink-supporting">
          <SlidersHorizontal className="size-4" aria-hidden /> Filter
        </span>

        {projectOptions.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <span className="sr-only">Project</span>
            <Select value={projectFilter} onValueChange={onProjectChange}>
              <SelectTrigger className="h-9 min-w-44 font-workflow" aria-label="Project">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent className="font-workflow">
                <SelectItem value={ALL}>All projects</SelectItem>
                {projectOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        {activityOptions.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <span className="sr-only">Activity</span>
            <Select value={activityFilter} onValueChange={onActivityChange}>
              <SelectTrigger className="h-9 min-w-44 font-workflow" aria-label="Activity">
                <SelectValue placeholder="All activities" />
              </SelectTrigger>
              <SelectContent className="font-workflow">
                <SelectItem value={ALL}>All activities</SelectItem>
                {activityOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        {active && (
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-brand-hover hover:underline"
          >
            Clear
          </button>
        )}

        {!mentorOpen && <MentorCapButton onOpen={() => setMentorOpen(true)} />}
      </div>

      {mentorOpen && (
        <MentorCapPanel className="mt-2" onClose={() => setMentorOpen(false)}>
          <span className="block">
            <span className="font-semibold">By project:</span> concentrate on a
            particular objective, working everything one project needs.
          </span>
          <span className="mt-1 block">
            <span className="font-semibold">By activity:</span> work efficiently
            through similar tasks across projects.
          </span>
        </MentorCapPanel>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 1 — Priorities. What needs the employee's attention.
// ─────────────────────────────────────────────────────────────────────────────

function PrioritiesColumn({ state }: { state: MyWorkState }) {
  // Genuine commitments the system DOES record today: date-only promised
  // callbacks that have come due. Keyed off dueCount, NOT off the band: a due
  // callback on a focus-elevated activity is classified by ZEN into the `focus`
  // band (rank 2 outranks the due_callback band), so filtering by band would
  // miss it and show a false all-clear. Every activity carrying due work is a
  // commitment here, whatever band it landed in. (Filters never hide these
  // upstream.)
  const commitmentActivities = state.activities.filter((a) => a.dueCount > 0)
  const dueTotal = commitmentActivities.reduce((n, a) => n + a.dueCount, 0)

  // Focus-elevated activities with actionable work (management direction that
  // genuinely points at work the employee can do).
  const focusActivities = state.activities.filter(
    (a) => a.band === 'focus' && a.ownedCount + a.availableCount > 0,
  )

  return (
    <section aria-label="Priorities" className="space-y-2.5">
      <ColumnHeader title="Priorities" />

      {/* Commitments summary — real due callbacks, plus an honest Coming Soon
          for the kinds of commitment Right Path does not capture yet. */}
      <CommitmentsSummary dueTotal={dueTotal} items={commitmentActivities} />

      {/* Focus-elevated work, when management has directed attention at work the
          employee can actually do. */}
      {focusActivities.map((a) => (
        <PriorityCard
          key={`focus-${a.workFunction}`}
          tone="focus"
          icon={Sparkles}
          label={`Today's Focus: ${a.label}`}
          count={a.ownedCount + a.availableCount}
          steer={a.reason}
          route={primaryRoute(a)}
        />
      ))}

      {/* NOTE: routine intake / first-touch is NOT a priority — it is ordinary
          available work and is already represented in the Available Work column.
          Priorities shows only genuine exceptions, commitments, and
          management-directed focus, so it is intentionally absent here. */}

      {/* When nothing in this column needs attention, say so plainly without
          implying the system has established there is no OTHER work. Ordinary
          available work being present is NOT a reason to flag attention. */}
      {dueTotal === 0 && focusActivities.length === 0 && (
        <div className="rounded-xl border border-surface-border bg-surface-card p-3">
          <p className="flex items-center gap-2 text-sm text-ink-secondary">
            <CheckCircle2 className="size-4 shrink-0 text-status-confirmed" aria-hidden />
            Nothing is flagged for your attention right now.
          </p>
          <p className="mt-1 text-xs text-ink-supporting">
            Available work is in the next column.
          </p>
        </div>
      )}
    </section>
  )
}

/** The commitments summary: the count of due promised callbacks (a real,
 * date-only commitment), each linking to its work, plus a discreet Coming Soon
 * for exact-time appointments and preferred calling windows, which the system
 * does not record yet. */
function CommitmentsSummary({
  dueTotal,
  items,
}: {
  dueTotal: number
  items: ActivityGroup[]
}) {
  const active = dueTotal > 0
  const t = TONE.critical
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        active ? t.card : 'border-surface-border bg-surface-card',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            active ? t.badge : 'bg-surface-muted text-ink-supporting',
          )}
          aria-hidden
        >
          <CalendarClock className="size-4" />
        </span>
        <p className={cn('text-2xl font-semibold leading-tight tracking-tight', active ? t.label : 'text-ink')}>
          {active
            ? `${dueTotal} promised callback${dueTotal === 1 ? '' : 's'} due`
            : 'No promised callbacks due'}
        </p>
      </div>

      {active && (
        <ul className="mt-2.5 space-y-1 pl-10">
          {items.map((a) => (
            <li key={a.workFunction} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink">
                {a.label}
                <span className="ml-1.5 text-ink-supporting">
                  — {a.dueCount} due
                </span>
              </span>
              {primaryRoute(a) && (
                <Link
                  href={primaryRoute(a) as string}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-hover hover:underline"
                >
                  Open <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Capabilities not yet captured. Stated so a worker never reads this as
          "you have no appointments" — Right Path simply does not record them. */}
      <div className="mt-2.5 space-y-1 pl-10">
        <ComingSoon>
          exact-time appointments (a specific date and clock time) are not recorded
          yet, so none are shown here.
        </ComingSoon>
        <ComingSoon>
          preferred calling windows (9–12, 12–3, 3–6, after 6) are not captured yet.
        </ComingSoon>
      </div>
    </div>
  )
}

/** A compact priority card: the whole card carries the tone. Optional mentoring
 * is the inline graduation-cap: click the cap to expand coaching beneath the
 * item, close to restore the cap. */
function PriorityCard({
  tone,
  icon: Icon,
  label,
  count,
  steer,
  route,
  mentoring,
}: {
  tone: AttentionTone
  icon: typeof Phone
  label: string
  count: number
  steer: string
  route: string | null
  mentoring?: React.ReactNode
}) {
  const t = TONE[tone]
  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()
  return (
    <div className={cn('rounded-xl border p-3', t.card)}>
      <div className="flex items-start gap-3">
        <span
          className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', t.badge)}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn('text-2xl font-semibold leading-tight tracking-tight', t.label)}>{label}</p>
            <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums', t.chip)}>
              {count}
            </span>
            {mentoring && !mentorOpen && (
              <MentorCapButton onOpen={() => setMentorOpen(true)} />
            )}
            {route && (
              <Link
                href={route}
                className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-hover hover:underline"
              >
                Open <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
          <p className="mt-0.5 text-sm leading-snug text-ink-secondary">{steer}</p>
          {mentoring && mentorOpen && (
            <MentorCapPanel className="mt-2" onClose={() => setMentorOpen(false)}>{mentoring}</MentorCapPanel>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 2 — Available work. The established ZEN + catalog order (the working
// plan), as compact cards. Plus the on-demand full per-activity inventory,
// preserving every existing source route, count, claim-state, and guidance.
// ─────────────────────────────────────────────────────────────────────────────

function AvailableWorkColumn({
  direction,
  state,
}: {
  direction: MyWorkDirection
  state: MyWorkState
}) {
  const [showAll, setShowAll] = useState(false)
  const plan = direction.workingPlan

  return (
    <section aria-label="Available work" className="space-y-3">
      <ColumnHeader title="Available work" />

      {plan.length > 0 ? (
        <div className="space-y-2.5">
          {plan.map((step) => (
            <WorkStepCard key={step.key} step={step} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-surface-border bg-surface-card p-3">
          <p className="flex items-center gap-2 text-sm text-ink-secondary">
            <CheckCircle2 className="size-4 shrink-0 text-status-confirmed" aria-hidden />
            Nothing is waiting for you to start right now. You have open capacity.
          </p>
        </div>
      )}

      {/* The complete per-activity inventory, on demand — same band-grouped
          cards as before, preserving every source link, count, claim-state
          breakdown, and per-item guidance. */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-hover hover:underline"
        >
          <ListChecks className="size-4" aria-hidden />
          {showAll ? 'Hide full work list' : 'See all available work'}
          <ChevronRight className={cn('size-4 transition-transform', showAll && 'rotate-90')} aria-hidden />
        </button>
      </div>

      {showAll && <FullInventory state={state} />}
    </section>
  )
}

/** One Available-work card: a step from the established working plan. Compact
 * and easily scanned — a prominent teal TITLE (same size as the count) that
 * links straight to the work, the count, any operational breakdown kept in view,
 * and the explanatory description tucked into a collapsed mentoring disclosure.
 * Order comes from the plan; no new ranking here. */
function WorkStepCard({ step }: { step: PlanStep }) {
  const headline = step.unresolvedCount ?? step.count
  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()
  return (
    <article
      className={cn(
        'rounded-xl border bg-surface-card p-3',
        step.emphasis
          ? 'border-l-4 border-surface-border border-l-tag-exception-border'
          : 'border-surface-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* The title IS the action: teal, count-sized, links to the step's
              existing destination. No separate action link beneath. */}
          {step.route ? (
            <Link
              href={step.route}
              className="min-w-0 truncate text-2xl font-semibold leading-none tracking-tight text-brand-hover hover:underline"
            >
              {step.title}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-2xl font-semibold leading-none tracking-tight text-brand-hover">
              {step.title}
            </span>
          )}
          {/* Mentoring: the description lives here; default follows the global
              Mentoring toggle. */}
          {!mentorOpen && <MentorCapButton onOpen={() => setMentorOpen(true)} />}
        </div>
        <span className="shrink-0 text-2xl font-semibold leading-none tabular-nums text-ink">{headline}</span>
      </div>

      {/* Operational information stays OUTSIDE mentoring — always visible. */}
      {step.unresolvedCount != null && (step.unsuccessfulCount ?? 0) > 0 && (
        <p className="mt-1 text-xs text-ink-supporting">
          {step.unresolvedCount - (step.unsuccessfulCount ?? 0)} not yet researched
          {' · '}
          {step.unsuccessfulCount} researched unsuccessfully
        </p>
      )}

      {/* The explanatory description, available only when requested. */}
      {mentorOpen && (
        <MentorCapPanel className="mt-2" onClose={() => setMentorOpen(false)}>{step.reason}</MentorCapPanel>
      )}
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 3 — Practice direction. What the agency expects of this employee.
// Real Today's Focus + responsibilities derived from capability routing, plus a
// discreet Coming Soon for expectations not yet modeled.
// ─────────────────────────────────────────────────────────────────────────────

function PracticeDirectionColumn({ state }: { state: MyWorkState }) {
  const focus = TONE.focus

  // Standing responsibilities derived from REAL capability routing: the strongest
  // routable assignment the employee holds for each activity (primary/support),
  // from the composition's authoritative capability read — INCLUDING activities
  // that currently have no outstanding work. No invented content.
  const responsibilities = state.responsibilities

  return (
    <section aria-label="Practice direction" className="space-y-3">
      <ColumnHeader title="Practice direction" />

      {/* Live Today's Focus (real focusNotes). Shown unfiltered — it is agency
          direction, not the employee's filtered work. */}
      <div
        className={cn(
          'rounded-xl border p-3',
          state.focusNotes.length > 0 ? focus.card : 'border-surface-border bg-surface-card',
        )}
      >
        <p
          className={cn(
            'flex items-center gap-2 text-2xl font-semibold leading-tight tracking-tight',
            state.focusNotes.length > 0 ? focus.label : 'text-ink',
          )}
        >
          <Sparkles className="size-5" aria-hidden /> Today&apos;s Focus
        </p>
        {state.focusNotes.length > 0 ? (
          <>
            <ul className="mt-1.5 space-y-1.5">
              {state.focusNotes.map((f) => (
                <li key={f.id} className="text-sm leading-snug text-ink">
                  <span className="font-semibold">{f.label}</span>
                  {f.note ? <span className="text-ink-secondary">: {f.note}</span> : null}
                  <span className="ml-1.5 text-xs text-ink-supporting">
                    (until {formatExpiry(f.expiresAt)})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-ink-supporting">
              Focus reorders your work for a limited time. It never overrides a
              customer commitment and never hides other work.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm leading-snug text-ink-secondary">
            No focus is set right now. Your work uses its ordinary ordering.
          </p>
        )}
      </div>

      {/* Standing responsibilities — real capability routing (primary/support). */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-3">
        <p className="flex items-center gap-2 text-2xl font-semibold leading-tight tracking-tight text-ink">
          <Briefcase className="size-5 shrink-0 text-ink-supporting" aria-hidden /> Your
          responsibilities
        </p>
        {responsibilities.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {responsibilities.map((r) => (
              <li key={r.workFunction} className="text-sm leading-snug">
                <span className="font-semibold text-ink">{r.label}</span>
                <span className="text-ink-secondary">
                  {' '}
                  — {r.routedAs === 'primary' ? 'Primary' : 'Support'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm leading-snug text-ink-secondary">
            No activities are routed to you yet. An administrator can assign them
            on the Team page.
          </p>
        )}
      </div>

      {/* Management expectations beyond Today's Focus are not modeled yet. */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-3">
        <p className="flex items-center gap-2 text-2xl font-semibold leading-tight tracking-tight text-ink">
          <Target className="size-5 shrink-0 text-ink-supporting" aria-hidden /> Expectations
        </p>
        <div className="mt-1.5">
          <ComingSoon>
            standing agency expectations (beyond Today&apos;s Focus) are not captured
            yet, so none are shown here.
          </ComingSoon>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The full per-activity inventory (on demand) — preserved from the prior UI, so
// every source route, count, eligibility distinction, claim-state breakdown, and
// per-item guidance remains reachable.
// ─────────────────────────────────────────────────────────────────────────────

function FullInventory({ state }: { state: MyWorkState }) {
  const bands = groupByBand(state.activities)
  if (
    state.quiet &&
    state.activities.every((a) => a.totalCount === 0 && (a.unresolvedCount ?? 0) === 0)
  ) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card p-4 text-sm text-ink-secondary">
        <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
        Nothing needs your attention right now. You have open capacity.
      </div>
    )
  }
  return (
    <div className="mt-3 space-y-5">
      {bands.map(({ band, items }) => (
        <section key={band} aria-label={BAND_META[band].title} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-supporting">
            {BAND_META[band].title}
          </h3>
          <div className="space-y-2">
            {items.map((a) => (
              <ActivityCard key={a.workFunction} activity={a} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** The bands that represent a GENUINE customer commitment or exception. */
const COMMITMENT_BANDS = new Set<PriorityBand>(['exact_time_commitment', 'due_callback'])
/** Awareness-only bands: not routed, not actionable by this employee. */
const AWARENESS_BANDS = new Set<PriorityBand>(['unassigned', 'unlicensed'])

/** One activity group card: the activity, its counts, reason, sources, claim
 * breakdown, and per-item guidance. Unchanged from the prior inventory. */
function ActivityCard({ activity }: { activity: ActivityGroup }) {
  const awarenessOnly = AWARENESS_BANDS.has(activity.band)
  const guidance = activityGuidance(activity.workFunction)
  const isCommitment = COMMITMENT_BANDS.has(activity.band)
  return (
    <article
      className={cn(
        'rounded-xl border bg-surface-card p-4',
        isCommitment
          ? 'border-l-4 border-surface-border border-l-tag-exception-border'
          : awarenessOnly
            ? 'border-surface-border opacity-90'
            : 'border-surface-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h4 className="text-lg font-semibold tracking-tight text-ink">{activity.label}</h4>
            {activity.dueCount > 0 && (
              <OperationalTag tone="exception">
                <Phone className="mr-1.5 size-4" aria-hidden />
                {activity.dueCount} due
              </OperationalTag>
            )}
            {activity.isFocusElevated && !awarenessOnly && (
              <OperationalTag tone="reason">
                <Sparkles className="mr-1.5 size-4" aria-hidden /> Focus
              </OperationalTag>
            )}
            {activity.band === 'assist' && (
              <OperationalTag tone="info">You can assist</OperationalTag>
            )}
          </div>
          <p className="mt-1.5 max-w-prose text-base leading-relaxed text-ink-secondary">
            {activity.reason}
          </p>
          {guidance.whatItIs && (
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-supporting">
              {guidance.whatItIs}
            </p>
          )}
          {guidance.note && guidance.workMode && (
            <WorkModeNote mode={guidance.workMode} className="mt-2" />
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className={cn(
            'text-3xl font-semibold leading-none',
            isCommitment ? 'text-tag-exception-text' : 'text-ink',
          )}>{activity.unresolvedCount ?? activity.totalCount}</p>
          {activity.unresolvedCount != null && (activity.unsuccessfulCount ?? 0) > 0 && (
            <p className="mt-1 text-xs text-ink-supporting">
              {activity.unresolvedCount - (activity.unsuccessfulCount ?? 0)} not yet researched
              {' · '}
              {activity.unsuccessfulCount} researched unsuccessfully
            </p>
          )}
          <p className="mt-1 text-xs text-ink-supporting">
            {activity.ownedCount > 0 && `${activity.ownedCount} yours · `}
            {activity.availableCount} available
            {activity.claimedByOthersCount > 0 && ` · ${activity.claimedByOthersCount} with teammates`}
            {activity.notEligibleCount > 0 && ` · ${activity.notEligibleCount} not yours`}
          </p>
        </div>
      </div>

      {activity.sources.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-surface-border pt-3">
          {activity.sources.map((s, i) => {
            const actionable = s.ownedByMe + s.availableToMe
            const channelMode =
              activity.workFunction === 'outreach' ? outreachChannelMode(s.label) : null
            return (
              <li key={`${s.kind}-${s.projectId ?? 'shared'}-${i}`}>
                <Link
                  href={s.route}
                  className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-base hover:bg-brand-wash"
                >
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    {s.kind === 'stewardship' ? (
                      <Users className="size-4 shrink-0 text-ink-supporting" aria-hidden />
                    ) : (
                      <ArrowRight className="size-4 shrink-0 text-ink-supporting" aria-hidden />
                    )}
                    <span className="truncate">{s.label}</span>
                    {s.projectId && (
                      <span className="shrink-0 rounded-full bg-brand-wash px-2 py-0.5 text-xs font-medium text-brand-hover">
                        your project
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold text-ink-secondary">
                      {actionable > 0 ? actionable : s.count}
                      {actionable > 0 && actionable !== s.count && (
                        <span className="font-normal text-ink-muted"> / {s.count}</span>
                      )}
                    </span>
                    <ArrowRight className="size-4 text-ink-muted" aria-hidden />
                  </span>
                </Link>
                {channelMode && (
                  <p className="flex items-center gap-1.5 px-2 pb-0.5 text-xs text-ink-supporting">
                    {channelMode === 'calls' ? (
                      <Phone className="size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <Mail className="size-3.5 shrink-0" aria-hidden />
                    )}
                    {WORK_MODE_NOTE[channelMode]}
                  </p>
                )}
                {(s.ownedByMe > 0 || s.claimedByOthers > 0 || (s.notEligible > 0 && !awarenessOnly)) && (
                  <p className="px-2 pb-0.5 text-[11px] text-ink-muted">
                    {[
                      s.ownedByMe > 0 ? `${s.ownedByMe} yours` : null,
                      s.availableToMe > 0 ? `${s.availableToMe} available` : null,
                      s.claimedByOthers > 0 ? `${s.claimedByOthers} with teammates` : null,
                      s.notEligible > 0 && !awarenessOnly ? `${s.notEligible} not yours` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {awarenessOnly && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-supporting">
          <Lock className="size-3.5" aria-hidden />
          Shown for awareness · {capabilityStatusLabel(activity.band === 'unlicensed' ? 'unlicensed' : 'unassigned')}
        </p>
      )}
    </article>
  )
}

/** A compact work-mode cue: quiet focus work vs live phone-call work. */
function WorkModeNote({ mode, className }: { mode: WorkMode; className?: string }) {
  const Icon = mode === 'calls' ? Phone : CheckCircle2
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-ink-supporting', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {WORK_MODE_NOTE[mode]}
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────────────────

/** The single destination for an activity: the first source the employee can
 * act on (owned or available), falling back to the activity's first source.
 * Mirrors the working plan's own route choice; never invents a route. */
function primaryRoute(a: ActivityGroup): string | null {
  const actionable = a.sources.find((s) => s.ownedByMe + s.availableToMe > 0)
  return (actionable ?? a.sources[0])?.route ?? null
}

/** Preserve rank order while grouping activities under their ZEN band. */
function groupByBand(
  activities: ActivityGroup[],
): { band: PriorityBand; items: ActivityGroup[] }[] {
  const order: PriorityBand[] = [
    'exact_time_commitment', 'focus', 'due_callback', 'owned', 'shared',
    'assist', 'unassigned', 'unlicensed',
  ]
  const out: { band: PriorityBand; items: ActivityGroup[] }[] = []
  for (const band of order) {
    const items = activities.filter((a) => a.band === band)
    if (items.length > 0) out.push({ band, items })
  }
  return out
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'soon'
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return `today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
