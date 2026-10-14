'use client'

/**
 * MY WORK client surface (Right Path, light workflow theme).
 *
 * Renders the ready MyWorkState the server composition resolved: activity
 * groups ordered by the GoRules ZEN priority band, each with its counts, its
 * sources, and (for eligible workers) a claim control. It does NO business
 * judgment and NO prioritization — ZEN owns the ordering; this presents it.
 *
 * Built on the shared workflow design system (src/components/workflow) and the
 * design tokens, per the Right Path light-theme workflow visual rules. Clicking
 * a source opens the real customer work (the Stewardship queue or the 1035
 * review), so a recommendation is always directly reachable.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles, ArrowRight, Phone, Mail, Users, CheckCircle2, Lock,
  ListChecks, ChevronRight, SlidersHorizontal,
  CalendarClock, FolderOpen,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
import {
  WorkflowPage,
  WorkflowHeader,
  OperationalTag,
  AssistantPanel,
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

/** The band's human section title and tag tone, driven by ZEN's band. The three
 * non-routable bands are deliberately distinct sections, each saying something
 * different: assist is actionable; unassigned and unlicensed are awareness-only
 * for different reasons. */
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

  // Seed the project filter from the deep link, but only when that project is
  // actually present in the resolved work; otherwise fall back to 'all' so a
  // stale link never shows an empty view.
  const seededProject =
    initialProjectId && projectOptions.some((o) => o.id === initialProjectId)
      ? initialProjectId
      : ALL
  const [projectFilter, setProjectFilter] = useState<string>(seededProject)
  const [activityFilter, setActivityFilter] = useState<string>(ALL)

  // The filtered state the Assistant and the full inventory render. Fixed-time
  // commitments are exempt from the filters (a promised callback or scheduled
  // appointment stays visible regardless of what the worker is filtering to),
  // per the Right Path rule that a customer commitment is never hidden.
  const filteredState = useMemo(
    () => applyWorkFilters(state, projectFilter, activityFilter),
    [state, projectFilter, activityFilter],
  )

  const hasFilters = projectOptions.length > 0 || activityOptions.length > 1
  const filtersActive = projectFilter !== ALL || activityFilter !== ALL

  if (state.noProfile) {
    return (
      <WorkflowPage>
        <WorkflowHeader primary="My Work" />
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
      </WorkflowPage>
    )
  }

  // Derive the Daily Direction summary from the FILTERED ready state. This still
  // reads ZEN's already-decided ordering; it does not re-rank or add a data
  // source. Filtering only removes activities from view; the order among those
  // that remain is unchanged.
  const direction = deriveMyWorkDirection(filteredState)

  return (
    <WorkflowPage>
      <WorkflowHeader primary="My Work" />

      {/* The Assistant is the first thing an employee meets in My Work. The
          Project + Activity filters live INSIDE its panel, so changing a filter
          reshapes the same briefing the worker is reading. The Assistant leads
          with any genuine fixed-time commitments and the day's breadth, then
          asks what to work on and offers two prominent start choices. Fixed-time
          commitments stay visible regardless of the filters, and every route,
          count, and permission is unchanged. The full inventory is on demand. */}
      <MyWorkAssistant
        state={filteredState}
        direction={direction}
        filters={
          hasFilters
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
        }
      />

      {/* Today's Focus banner: temporary management direction, shown as a
          distinct notice below the chooser. It influences ordering; never hides
          work. Kept compact so it does not compete with the start choices. */}
      {state.focusNotes.length > 0 && (
        <section
          aria-label="Today's Focus"
          className="rounded-2xl border border-brand-subtle bg-brand-wash p-5"
        >
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-brand-hover">
            <Sparkles className="size-4" aria-hidden /> Today&apos;s Focus
          </p>
          <ul className="mt-2 space-y-1.5">
            {state.focusNotes.map((f) => (
              <li key={f.id} className="text-base text-ink">
                <span className="font-semibold">{f.label}</span>
                {f.note ? <span className="text-ink-secondary">: {f.note}</span> : null}
                <span className="ml-2 text-ink-supporting">
                  (until {formatExpiry(f.expiresAt)})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-supporting">
            Focus reorders your work for a limited time. It never overrides a
            customer commitment and never hides other work.
          </p>
        </section>
      )}
    </WorkflowPage>
  )
}

/** The props the filter bar needs. Shared so the Assistant can carry them in
 * and render the bar inside its own panel. */
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

/** The filter bar: Project (all / one) and Activity (all / one), both
 * combinable. Rendered INSIDE the Assistant panel, so it is a light inset row
 * rather than its own card, with a Clear affordance when a filter is set.
 * Changing a filter reshapes the Assistant's briefing above and the work below;
 * fixed-time commitments stay visible regardless. */
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
  return (
    <section
      aria-label="Filter your work"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-muted p-3"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-supporting">
        <SlidersHorizontal className="size-4" aria-hidden /> Filter
      </span>

      {projectOptions.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <span className="sr-only">Project</span>
          <Select value={projectFilter} onValueChange={onProjectChange}>
            <SelectTrigger className="h-9 min-w-44" aria-label="Project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
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
            <SelectTrigger className="h-9 min-w-44" aria-label="Activity">
              <SelectValue placeholder="All activities" />
            </SelectTrigger>
            <SelectContent>
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

      <p className="w-full text-xs text-ink-supporting">
        Filters narrow what you see. Fixed-time commitments stay visible, and
        every item still opens the same work.
      </p>
    </section>
  )
}

/**
 * The My Work Assistant: a practical working plan, not a system readout. In
 * order it shows (1) fixed-time commitments, (2) how many active projects have
 * work available, (3) the Project + Activity filters with a collapsed Mentoring
 * note on how to choose between them, and (4) the recommended working plan — an
 * ordered, advisory sequence of concrete steps (what, why, and a direct action).
 * The complete inventory is available on demand via "See all available work",
 * not shown up front, so the plan is never repeated by a second always-on list.
 * GoRules + the catalog working order own the ordering; this only presents the
 * already-derived direction, which re-derives when a filter changes.
 */
function MyWorkAssistant({
  state,
  direction,
  filters,
}: {
  state: MyWorkState
  direction: MyWorkDirection
  /** The in-panel Project + Activity filters, or null when there is nothing to
   * filter. Rendered inside the Assistant so a filter change reshapes the same
   * briefing the worker is reading. */
  filters: WorkFiltersProps | null
}) {
  // The complete work inventory is on demand only, so the Assistant leads with
  // the plan rather than a wall of every item. One boolean controls it.
  const [showAll, setShowAll] = useState(false)

  const plan = direction.workingPlan

  return (
    <div className="[&>section]:gap-6 [&>section]:p-6 sm:[&>section]:p-7">
      <AssistantPanel heading={<span className="text-2xl">Your working plan for today</span>}>
        {/* 1. Fixed-time commitments FIRST. Gray when none are on record (using
            the established wording); light amber when a real commitment needs
            attention. These are exempt from the filters upstream, so they stay
            visible regardless of the current selection. */}
        <FixedTimeCommitments summary={direction.fixedTimeCommitments} />

        {/* 2. Active projects with work available to this employee — the day's
            breadth at a glance, reflecting the current filter selection. */}
        <ActiveProjectsLine count={direction.projectsWithAvailableWork} />

        {/* 3. The Project + Activity filters, with a collapsed Mentoring note
            explaining how to choose between them. Changing a filter reshapes the
            plan below in place. */}
        {filters && (
          <div className="flex flex-col gap-3">
            <WorkFilters {...filters} />
            <MentorGuidance label="How to use these filters">
              <span className="block">
                <span className="font-semibold">By project:</span> concentrate on a
                particular objective, working everything one project needs.
              </span>
              <span className="mt-1 block">
                <span className="font-semibold">By activity:</span> work efficiently
                through similar tasks across projects.
              </span>
            </MentorGuidance>
          </div>
        )}

        {/* 4. The recommended working plan: an ordered, advisory sequence of
            concrete steps (what, why, and a direct action). It re-derives with
            the filters, so it tracks the current selection. */}
        {plan.length > 0 ? (
          <WorkingPlan steps={plan} />
        ) : (
          <p className="flex items-center gap-2 text-lg leading-relaxed text-ink-secondary">
            <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
            Nothing is waiting for you to start right now. You have open capacity.
          </p>
        )}

        {/* The complete inventory, on demand only, so the plan is not repeated by
            a second always-on list of the same work. */}
        <div className="border-t border-surface-border pt-4">
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
      </AssistantPanel>

      {/* The full inventory renders outside the Assistant panel, below it, only
          when expanded — the same band-grouped activity cards as before. */}
      {showAll && <FullInventory state={state} />}
    </div>
  )
}

/**
 * Fixed-time commitments, shown first in the plan. Right Path records no
 * exact-time (clock) commitments yet, so the common case is the honest "none"
 * line in calm gray — never a claim that the employee has no appointments. When
 * a genuine commitment IS on record it gets a light-amber attention treatment.
 */
function FixedTimeCommitments({ summary }: { summary: MyWorkDirection['fixedTimeCommitments'] }) {
  if (!summary.known) {
    return (
      <section
        aria-label="Fixed-time commitments"
        className="rounded-xl border border-surface-border bg-surface-muted p-4"
      >
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink-supporting">
          <CalendarClock className="size-4" aria-hidden /> Fixed-time commitments
        </p>
        <p className="mt-1 text-base leading-relaxed text-ink-secondary">
          Right Path does not show any fixed commitments for you today.
        </p>
      </section>
    )
  }
  return (
    <section
      aria-label="Fixed-time commitments"
      className="rounded-xl border border-l-4 border-surface-border border-l-tag-exception-border bg-tag-exception-fill/50 p-4"
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-tag-exception-text">
        <CalendarClock className="size-4" aria-hidden /> Fixed-time commitments
      </p>
      <ul className="mt-2 space-y-1">
        {summary.items.map((c) => (
          <li key={c.workFunction} className="flex items-center justify-between gap-3 text-base">
            <span className="truncate font-medium text-ink">{c.label}</span>
            {c.route && (
              <Link
                href={c.route}
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-hover hover:underline"
              >
                Open <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The active-project breadth line: how many distinct projects currently have
 * work available to this employee. Reflects the current filter selection. */
function ActiveProjectsLine({ count }: { count: number }) {
  return (
    <p className="flex items-baseline gap-2 text-base text-ink-secondary">
      <FolderOpen className="size-4 self-center text-ink-supporting" aria-hidden />
      <span className="text-xl font-semibold text-ink">{count}</span>
      <span>
        {count === 1
          ? 'active project has work available to you right now.'
          : 'active projects have work available to you right now.'}
      </span>
    </p>
  )
}

/**
 * The recommended working plan: an ordered, advisory list of concrete steps. It
 * tells the employee WHAT to do, WHY, and gives a direct action. The order is
 * the GoRules/ZEN priority plus the catalog working order; it does not re-rank.
 * The copy is explicitly advisory — the employee may work the steps in any
 * order — and carries no claim/pickup language.
 */
function WorkingPlan({ steps }: { steps: PlanStep[] }) {
  return (
    <section aria-label="Recommended working plan" className="flex flex-col gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.1em] text-brand-hover">
          <Sparkles className="size-4" aria-hidden /> Recommended working plan
        </p>
        <p className="mt-1 text-sm text-ink-supporting">
          A suggested order based on current priorities and Today&apos;s Focus. You
          can work these in any order.
        </p>
      </div>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, i) => (
          <PlanStepRow key={step.key} step={step} position={i + 1} />
        ))}
      </ol>
    </section>
  )
}

/** One plan step: an ordinal, the WHAT title, the WHY reason, a count, and a
 * single direct action link. The link is the only interactive element. */
function PlanStepRow({ step, position }: { step: PlanStep; position: number }) {
  return (
    <li
      className={cn(
        'rounded-xl border bg-surface-card p-4',
        step.emphasis
          ? 'border-l-4 border-surface-border border-l-tag-exception-border'
          : 'border-surface-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-ink-secondary"
            aria-hidden
          >
            {position}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight text-ink">
              {step.title}
              <span className="ml-2 text-base font-normal text-ink-supporting">
                {step.count} {step.count === 1 ? 'customer' : 'customers'}
              </span>
            </p>
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-secondary">
              {step.reason}
            </p>
            {/* Attempted-vs-unresolved breakdown — the SAME figures the full
                work list shows (Research today): how many are still not yet
                researched vs researched unsuccessfully, so the unresolved
                population reads clearly even when none are outstanding. */}
            {step.unresolvedCount != null && (step.unsuccessfulCount ?? 0) > 0 && (
              <p className="mt-1 text-sm text-ink-supporting">
                {step.unresolvedCount - (step.unsuccessfulCount ?? 0)} not yet researched
                {' · '}
                {step.unsuccessfulCount} researched unsuccessfully — may need an alternative approach
              </p>
            )}
          </div>
        </div>
        {step.route && (
          <Link
            href={step.route}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-hover"
          >
            {step.actionLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  )
}

/** The complete work inventory: the band-grouped activity cards, shown only
 * when the worker asks for the full list. Preserves the GoRules band ordering. */
function FullInventory({ state }: { state: MyWorkState }) {
  const bands = groupByBand(state.activities)
  if (state.quiet && state.activities.every((a) => a.totalCount === 0 && (a.unresolvedCount ?? 0) === 0)) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-base text-ink-secondary">
        <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
        Nothing needs your attention right now. You have open capacity.
      </div>
    )
  }
  return (
    <div className="space-y-8">
      {bands.map(({ band, items }) => (
        <section key={band} aria-label={BAND_META[band].title} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-supporting">
            {BAND_META[band].title}
          </h2>
          <div className="space-y-3">
            {items.map((a) => (
              <ActivityCard key={a.workFunction} activity={a} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** The bands that represent a GENUINE customer commitment or exception, which
 * must stand out. These are the only items the work-mode listing escalates
 * visually; everything else is routine work and stays calm, so emphasis never
 * implies urgency GoRules has not established. */
const COMMITMENT_BANDS = new Set<PriorityBand>(['exact_time_commitment', 'due_callback'])

/** The bands that are shown for awareness only — not routed and not actionable
 * by this employee. 'assist' is deliberately NOT here: it is pickable. */
const AWARENESS_BANDS = new Set<PriorityBand>(['unassigned', 'unlicensed'])

/** One activity group card: the activity, its counts, reason, sources, claim. */
function ActivityCard({ activity }: { activity: ActivityGroup }) {
  const awarenessOnly = AWARENESS_BANDS.has(activity.band)
  const guidance = activityGuidance(activity.workFunction)
  // Three visual tiers so emphasis matches meaning, never implying urgency ZEN
  // did not set: a genuine commitment/exception stands out (amber left-accent),
  // routine actionable work is a neutral card, and awareness-only work recedes.
  const isCommitment = COMMITMENT_BANDS.has(activity.band)
  return (
    <article
      className={cn(
        'rounded-2xl border bg-surface-card p-5',
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
            <h3 className="text-xl font-semibold tracking-tight text-ink">{activity.label}</h3>
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
          {/* What this kind of work is — descriptive guidance, always true,
              never a priority judgment (ZEN owns the band and the reason above).
              Helps the worker recognize what the activity actually involves.
              Omitted when an activity has no catalog guidance. */}
          {guidance.whatItIs && (
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-supporting">
              {guidance.whatItIs}
            </p>
          )}
          {/* Work-mode cue: for a single-mode activity (research, operations
              prep) say whether it suits quiet time or calling hours. Outreach
              spans both channels, so its cue is shown per source below. */}
          {guidance.note && guidance.workMode && (
            <WorkModeNote mode={guidance.workMode} className="mt-2" />
          )}
        </div>

        {/* Count summary. The headline is the full UNRESOLVED population the
            working queue shows (outstanding + attempted-but-unresolved), so the
            summary and the queue agree. When an activity distinguishes attempted
            from unresolved (unresolvedCount present — Research today), a
            breakdown line separates the two so they are not confused; the number
            otherwise falls back to the outstanding total. The number is a strong
            neutral by default; it takes the brand accent only for a genuine
            commitment/exception, so teal signals emphasis rather than coating
            every card. */}
        <div className="shrink-0 text-right">
          <p className={cn(
            'text-3xl font-semibold leading-none',
            isCommitment ? 'text-tag-exception-text' : 'text-ink',
          )}>{activity.unresolvedCount ?? activity.totalCount}</p>
          {/* Attempted-vs-unresolved breakdown: how many are still outstanding
              vs attempted but unresolved. Shown whenever the activity carries the
              distinction, so a zero-outstanding activity still reads clearly
              (e.g. "0 not yet researched · 3 researched unsuccessfully"). */}
          {activity.unresolvedCount != null && (activity.unsuccessfulCount ?? 0) > 0 && (
            <p className="mt-1 text-xs text-ink-supporting">
              {activity.unresolvedCount - (activity.unsuccessfulCount ?? 0)} not yet researched
              {' · '}
              {activity.unsuccessfulCount} researched unsuccessfully
            </p>
          )}
          {/* Distinct claim states for THIS employee: never conflate another
              teammate's claimed work with free shared work. Tied to the
              outstanding, actionable work (the recommended total). */}
          <p className="mt-1 text-xs text-ink-supporting">
            {activity.ownedCount > 0 && `${activity.ownedCount} yours · `}
            {activity.availableCount} available
            {activity.claimedByOthersCount > 0 && ` · ${activity.claimedByOthersCount} with teammates`}
            {activity.notEligibleCount > 0 && ` · ${activity.notEligibleCount} not yours`}
          </p>
        </div>
      </div>

      {/* When some work has been attempted but remains unresolved, explain that
          it may need a different approach — so the researched-unsuccessfully
          customers read as "try something else", not fresh outstanding work. */}
      {activity.unresolvedCount != null && (activity.unsuccessfulCount ?? 0) > 0 && (
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-supporting">
          {activity.unsuccessfulCount} researched unsuccessfully — nothing usable found yet. These
          may need an alternative approach; they stay in the queue so you can try again.
        </p>
      )}

      {/* Sources: each business activity appears once, with its sources listed
          beneath it, so the same activity across projects is not duplicated.
          A source link opens the employee's ELIGIBLE work in that source — the
          project-scoped subset when they are eligible for only part of a queue. */}
      {activity.sources.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-surface-border pt-3">
          {activity.sources.map((s, i) => {
            // What the worker can act on in this source right now.
            const actionable = s.ownedByMe + s.availableToMe
            // For Outreach, the two channels carry different work modes: emails
            // are quiet work, calls are live phone outreach. Shown per source so
            // the split the composition already makes (ready-to-email vs
            // ready-to-call) also reads as "quiet vs calling hours".
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
                    {/* Lead with what the worker can act on; show the full queue
                        count only as context so the shared board stays visible. */}
                    <span className="font-semibold text-ink-secondary">
                      {actionable > 0 ? actionable : s.count}
                      {actionable > 0 && actionable !== s.count && (
                        <span className="font-normal text-ink-muted"> / {s.count}</span>
                      )}
                    </span>
                    <ArrowRight className="size-4 text-ink-muted" aria-hidden />
                  </span>
                </Link>
                {/* Outreach channel cue: emails are quiet work, calls belong in
                    calling hours. Descriptive practice, not a schedule. */}
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
                {/* Per-source claim breakdown, only when there is something to
                    distinguish beyond the simple count. */}
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
          {/* A compact status cue; the full reason above (the SHARED capability
              explanation) says why unassigned and unlicensed differ. */}
          Shown for awareness · {capabilityStatusLabel(activity.band === 'unlicensed' ? 'unlicensed' : 'unassigned')}
        </p>
      )}
    </article>
  )
}

/** A compact work-mode cue: quiet focus work vs live phone-call work. Purely
 * descriptive practice guidance (no schedule, no deadline); it pairs an icon
 * with text so the mode never relies on color alone. */
function WorkModeNote({ mode, className }: { mode: WorkMode; className?: string }) {
  const Icon = mode === 'calls' ? Phone : CheckCircle2
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-ink-supporting', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {WORK_MODE_NOTE[mode]}
    </p>
  )
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
