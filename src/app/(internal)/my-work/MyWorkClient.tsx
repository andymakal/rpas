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
  NotebookPen, AlertCircle, ListChecks, ChevronRight, SlidersHorizontal,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useMentoring } from '@/lib/mentoring/MentoringProvider'
import { MentorNote } from '@/lib/mentoring/MentorUi'
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
import type { ActivityGroup, MyWorkState, PriorityBand, WorkSource } from '@/lib/my-work/types'
import {
  deriveMyWorkDirection,
  type MyWorkDirection,
  type WorkModeGroup,
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

      {/* Project + Activity filters. They narrow the work shown below; fixed-time
          commitments stay visible regardless, and every route/count/permission
          is unchanged. Rendered only when there is something to filter. */}
      {hasFilters && (
        <WorkFilters
          projectOptions={projectOptions}
          activityOptions={activityOptions}
          projectFilter={projectFilter}
          activityFilter={activityFilter}
          onProjectChange={setProjectFilter}
          onActivityChange={setActivityFilter}
          onClear={() => {
            setProjectFilter(ALL)
            setActivityFilter(ALL)
          }}
          active={filtersActive}
        />
      )}

      {/* The Assistant: on arrival it helps the worker START, not explains the
          system. It shows any genuine time-specific commitments first, then asks
          what to work on and offers two prominent choices. The full inventory
          is available on demand, not shown up front. */}
      <MyWorkAssistant state={filteredState} direction={direction} />

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

// ---------------------------------------------------------------------------
// Project + Activity filtering (client-side, over the already-resolved state).
//
// These narrow what My Work SHOWS. They never touch eligibility, claim state,
// routes, counts, or the ZEN ordering — the server composition owns all of
// that. A fixed-time commitment is exempt from the filters so a promised
// callback or scheduled appointment is never hidden.
// ---------------------------------------------------------------------------

/** Sentinel for an unfiltered selection ("all projects" / "all activities").
 * A Radix Select item value may not be empty, so a non-empty token is used. */
const ALL = '__all__'

interface FilterOption {
  id: string
  label: string
}

/**
 * The distinct projects present in the resolved work. A project surfaces two
 * ways: as a project-scoped source (kind 'project', whose label is the project
 * name) and as the per-project breakdown of a SHARED stewardship source
 * (projectScopes), whose customers belong to the project even though the source
 * itself is agency-wide. Both must make the project filterable, otherwise shared
 * outreach/research for a project would be invisible to the filter. The human
 * name comes from the project-kind source; a project seen only through a shared
 * scope falls back to a generic label (there is one active project today, and it
 * always has project-kind sources, so this fallback is not normally reached). */
function projectFilterOptions(state: MyWorkState): FilterOption[] {
  const names = new Map<string, string>()
  const ids = new Set<string>()
  for (const a of state.activities) {
    for (const s of a.sources) {
      if (s.projectId) { ids.add(s.projectId); if (s.kind === 'project') names.set(s.projectId, s.label) }
      if (s.projectScopes) for (const pid of Object.keys(s.projectScopes)) ids.add(pid)
    }
  }
  return [...ids]
    .map((id) => ({ id, label: names.get(id) ?? 'Project' }))
    .sort((x, y) => x.label.localeCompare(y.label))
}

/** The distinct activities present in the resolved work. Drives the Activity
 * filter options, in the ZEN rank order the activities already arrived in. */
function activityFilterOptions(state: MyWorkState): FilterOption[] {
  const seen = new Set<string>()
  const out: FilterOption[] = []
  for (const a of state.activities) {
    if (seen.has(a.workFunction)) continue
    seen.add(a.workFunction)
    out.push({ id: a.workFunction, label: a.label })
  }
  return out
}

/**
 * Narrow a single source to a selected project. A source belongs to the project
 * if it is that project's own scoped source (projectId match) OR it is a shared
 * source carrying a per-project breakdown for it (projectScopes[pid]). In the
 * shared case the returned source adopts the project-scoped counts and route, so
 * the filtered view shows exactly that project's slice with the right numbers
 * and a link that opens that slice. Returns null when the source has no work in
 * the project (so unrelated shared work is excluded).
 */
function sourceForProject(s: WorkSource, projectId: string): WorkSource | null {
  if (s.projectId === projectId) return s
  const scope = s.projectScopes?.[projectId]
  if (!scope) return null
  return {
    ...s,
    count: scope.count,
    route: scope.route,
    projectId,
    ownedByMe: scope.ownedByMe,
    availableToMe: scope.availableToMe,
    claimedByOthers: scope.claimedByOthers,
    notEligible: scope.notEligible,
    dueToMe: scope.dueToMe,
  }
}

/** Recompute an activity's aggregate counts from a narrowed set of sources, so
 * the activity-level numbers (and the derived Daily Direction) match exactly the
 * sources shown under the project filter. Mirrors how the composition aggregates
 * per-source tallies into the activity. Sources never overlap on a customer
 * within a project scope for these count fields, so a straight sum is correct. */
function reaggregate(a: ActivityGroup, sources: WorkSource[]): ActivityGroup {
  let total = 0, owned = 0, available = 0, claimed = 0, notEligible = 0, due = 0
  for (const s of sources) {
    // Informational sub-populations (Outreach Calls Due / Available to Call) are
    // already counted by another source, so they never add to the aggregate —
    // the same rule the composition applies when it builds the unfiltered total.
    if (s.informational) continue
    total += s.count
    owned += s.ownedByMe
    available += s.availableToMe
    claimed += s.claimedByOthers
    notEligible += s.notEligible
    due += s.dueToMe
  }
  return {
    ...a,
    sources,
    totalCount: total,
    ownedCount: owned,
    availableCount: available,
    claimedByOthersCount: claimed,
    notEligibleCount: notEligible,
    dueCount: due,
  }
}

/**
 * Apply the Project and Activity filters to the resolved state, returning a new
 * MyWorkState that renders exactly the selected work. Both filters combine (AND).
 *
 * A fixed-time commitment activity is always kept, whatever the filters, so a
 * genuine customer commitment is never hidden.
 *
 * When a project is selected, each kept activity's sources are narrowed to that
 * project — including SHARED stewardship outreach/research sources whose
 * customers belong to the project (via each source's projectScopes), not only
 * sources whose projectId already matches. Narrowed shared sources adopt the
 * project-scoped counts and route, and the activity's aggregate counts are
 * recomputed from the narrowed sources, so counts and links correspond to the
 * selected project and exclude unrelated work. ZEN ordering is untouched: this
 * removes activities/sources from view but never re-ranks what remains.
 */
function applyWorkFilters(
  state: MyWorkState,
  projectFilter: string,
  activityFilter: string,
): MyWorkState {
  if (projectFilter === ALL && activityFilter === ALL) return state

  const activities = state.activities.flatMap((a) => {
    const isCommitment = COMMITMENT_BANDS.has(a.band)
    // Commitments are exempt: always shown, with all sources intact.
    if (isCommitment) return [a]

    const matchesActivity = activityFilter === ALL || a.workFunction === activityFilter
    if (!matchesActivity) return []

    if (projectFilter === ALL) return [a]

    // Project selected: keep the sources that belong to the project (own scoped
    // source OR a shared source's per-project slice), adopting the project's
    // counts/route, then re-aggregate the activity from exactly those sources.
    const sources = a.sources
      .map((s) => sourceForProject(s, projectFilter))
      .filter((s): s is WorkSource => s !== null)
    if (sources.length === 0) return []
    return [reaggregate(a, sources)]
  })

  return { ...state, activities }
}

/** The filter bar: Project (all / one) and Activity (all / one), both combinable.
 * Compact, above the Assistant, with a Clear affordance when a filter is set. */
function WorkFilters({
  projectOptions,
  activityOptions,
  projectFilter,
  activityFilter,
  onProjectChange,
  onActivityChange,
  onClear,
  active,
}: {
  projectOptions: FilterOption[]
  activityOptions: FilterOption[]
  projectFilter: string
  activityFilter: string
  onProjectChange: (v: string) => void
  onActivityChange: (v: string) => void
  onClear: () => void
  active: boolean
}) {
  return (
    <section
      aria-label="Filter your work"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-surface-border bg-surface-card p-4"
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

/** The actionable items for a work mode, read from the already-derived
 * direction (ZEN order preserved). Returns the group or undefined when the mode
 * has no actionable work. */
function groupFor(direction: MyWorkDirection, mode: WorkMode): WorkModeGroup | undefined {
  return direction.workModeGroups.find((g) => g.mode === mode)
}

/** The call queue the Outbound Calls choice opens. Matches the composition's
 * ready-to-call source route; falls back to the shared board's call queue. */
const CALL_QUEUE_ROUTE = '/stewardship?queue=ready-to-call'

/**
 * The My Work Assistant: an action-first starting point, not a system readout.
 *
 * On arrival it shows (1) any genuine time-specific commitments that need
 * attention, then (2) asks "What would you like to work on?" and offers two
 * prominent choices — Quiet Work and Outbound Calls — with live totals. Picking
 * Quiet Work reveals its activities, counts, and direct actions; picking
 * Outbound Calls opens the call queue. The complete inventory is available via
 * "See All Available Work", not shown up front. GoRules still owns every count
 * and ordering; this only presents the already-derived direction.
 */
function MyWorkAssistant({
  state,
  direction,
}: {
  state: MyWorkState
  direction: MyWorkDirection
}) {
  // Which panel is expanded. 'choose' is the calm default: just the question
  // and the two choices. Quiet Work and the full inventory expand in place;
  // Outbound Calls is a direct link, so it needs no expanded state.
  const [view, setView] = useState<'choose' | 'quiet' | 'all'>('choose')

  // Mentoring (coaching on HOW to work) is a separate, app-wide on/off layer.
  // The toggle lives in the shared sidebar; here we only READ it to decide
  // whether to show coaching notes. It never changes the Assistant, the counts,
  // or the workflow.
  const { mentoring } = useMentoring()

  // Genuine time-specific commitments needing attention now (fixed appointments,
  // promised callbacks). These are the only things surfaced before the question.
  const commitments = state.activities.filter(
    (a) => COMMITMENT_BANDS.has(a.band) && a.ownedCount + a.availableCount > 0,
  )

  const quiet = groupFor(direction, 'quiet')
  const calls = groupFor(direction, 'calls')
  const quietTotal = quiet?.totalActionable ?? 0
  const callsTotal = calls?.totalActionable ?? 0
  const nothingToStart = quietTotal === 0 && callsTotal === 0

  return (
    <div className="[&>section]:gap-6 [&>section]:p-6 sm:[&>section]:p-7">
      <AssistantPanel heading={<span className="text-2xl">What would you like to work on?</span>}>
        {/* Mentoring is toggled app-wide from the sidebar; when on, the coaching
            notes below appear. The Assistant itself is unchanged either way. */}

        {/* 1. Commitments first — the only thing shown before the question. */}
        {commitments.length > 0 && <CommitmentsNotice commitments={commitments} />}

        {nothingToStart ? (
          <p className="-mt-2 flex items-center gap-2 text-lg leading-relaxed text-ink-secondary">
            <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
            Nothing is waiting for you to start right now. You have open capacity.
          </p>
        ) : (
          <>
            {/* 2. The two prominent choices. Outbound Calls is a direct link to
                the call queue; Quiet Work expands its activities in place. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <StartChoice
                kind="quiet"
                title="Quiet Work"
                subtitle="Emails, research, and preparation you can do heads-down."
                total={quietTotal}
                totalLabel="available items"
                selected={view === 'quiet'}
                onSelect={() => setView(view === 'quiet' ? 'choose' : 'quiet')}
                mentorNote={
                  mentoring
                    ? 'Quiet work is yours to pace: pick it up independently whenever time permits.'
                    : null
                }
              />
              <StartChoice
                kind="calls"
                title="Outbound Calls"
                subtitle="Customers ready for a call during appropriate calling hours."
                total={callsTotal}
                totalLabel="available calls"
                href={callsTotal > 0 ? (calls?.items[0]?.route ?? CALL_QUEUE_ROUTE) : undefined}
                mentorNote={
                  mentoring
                    ? 'Calls depend on the customer: reach out when they are most likely available, not just when you have a free moment.'
                    : null
                }
              />
            </div>

            {/* Quiet Work reveal: its activities, counts, and direct actions. */}
            {view === 'quiet' && quiet && (
              <div className="rounded-xl border border-surface-border bg-surface-muted p-4">
                <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
                  <NotebookPen className="size-4 text-ink-supporting" aria-hidden />
                  Quiet work available to you
                </p>
                <p className="mt-1 text-base leading-relaxed text-ink-supporting">
                  {WORK_MODE_NOTE.quiet}
                </p>
                <ul className="mt-3 space-y-1">
                  {quiet.items.map((item) => (
                    <WorkModeItemRow key={`${item.workFunction}-${item.label}`} item={item} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* 3. The complete inventory, on demand only. Removed from the initial
            view so the Assistant helps the worker start rather than displaying
            everything it knows. */}
        <div className="border-t border-surface-border pt-4">
          <button
            type="button"
            onClick={() => setView(view === 'all' ? 'choose' : 'all')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-hover hover:underline"
          >
            <ListChecks className="size-4" aria-hidden />
            {view === 'all' ? 'Hide full work list' : 'See All Available Work'}
            <ChevronRight className={cn('size-4 transition-transform', view === 'all' && 'rotate-90')} aria-hidden />
          </button>
        </div>
      </AssistantPanel>

      {/* The full inventory renders outside the Assistant panel, below it, only
          when expanded — the same band-grouped activity cards as before. */}
      {view === 'all' && <FullInventory state={state} />}
    </div>
  )
}

/** Time-specific commitments needing attention, shown before the question. Only
 * genuine commitment bands reach here, so this never invents urgency. */
function CommitmentsNotice({ commitments }: { commitments: ActivityGroup[] }) {
  return (
    <section
      aria-label="Commitments needing attention"
      className="-mt-2 rounded-xl border border-l-4 border-surface-border border-l-tag-exception-border bg-tag-exception-fill/50 p-4"
    >
      <p className="flex items-center gap-1.5 text-base font-semibold text-tag-exception-text">
        <AlertCircle className="size-5" aria-hidden />
        Needs attention now
      </p>
      <ul className="mt-2 space-y-1">
        {commitments.map((a) => {
          const route = a.sources.find((s) => s.ownedByMe + s.availableToMe > 0)?.route ?? a.sources[0]?.route
          const count = a.dueCount > 0 ? a.dueCount : a.ownedCount + a.availableCount
          const body = (
            <>
              <span className="truncate font-medium text-ink">{a.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-semibold text-tag-exception-text">{count}</span>
                {route && <ArrowRight className="size-4 text-ink-muted" aria-hidden />}
              </span>
            </>
          )
          return (
            <li key={a.workFunction}>
              {route ? (
                <Link
                  href={route}
                  className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-base hover:bg-tag-exception-fill"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-base">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * One of the two prominent start choices. 'quiet' is a toggle button that
 * expands its activities in place; 'calls' is a direct link to the call queue.
 * Both lead with a large count so the worker sees the volume at a glance.
 */
function StartChoice({
  kind, title, subtitle, total, totalLabel, selected, onSelect, href, mentorNote,
}: {
  kind: WorkMode
  title: string
  subtitle: string
  total: number
  totalLabel: string
  selected?: boolean
  onSelect?: () => void
  href?: string
  /** Mentor coaching on HOW to approach this work; null when Mentoring is off. */
  mentorNote?: string | null
}) {
  const isCalls = kind === 'calls'
  const Icon = isCalls ? Phone : NotebookPen
  const disabled = total === 0

  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full',
              isCalls ? 'bg-brand text-brand-foreground' : 'bg-surface-muted text-ink-secondary',
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          {title}
        </span>
        <span className="text-right leading-none">
          <span className="block text-3xl font-semibold text-ink">{total}</span>
          <span className="mt-1 block text-xs text-ink-supporting">{totalLabel}</span>
        </span>
      </div>
      {/* Assistant copy (WHAT this choice is). */}
      <p className="mt-3 text-base leading-relaxed text-ink-secondary">{subtitle}</p>
      {/* Mentor coaching (HOW to approach it) — purple, only when Mentoring is
          on. Kept visually and semantically distinct from the Assistant copy. */}
      {mentorNote && <MentorNote className="mt-2">{mentorNote}</MentorNote>}
      <span className="mt-3 inline-flex items-center gap-1.5 text-base font-medium text-brand-hover">
        {isCalls ? 'Open the call queue' : selected ? 'Hide quiet work' : 'Show quiet work'}
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </>
  )

  const base = cn(
    'block w-full rounded-2xl border p-5 text-left transition-colors',
    disabled
      ? 'cursor-not-allowed border-surface-border bg-surface-card opacity-60'
      : isCalls
        ? 'border-brand-subtle bg-surface-card hover:border-brand-ring hover:bg-brand-wash'
        : selected
          ? 'border-brand-ring bg-brand-wash'
          : 'border-surface-border bg-surface-card hover:border-brand-ring hover:bg-brand-wash',
  )

  if (disabled) {
    return (
      <div className={base} aria-disabled>
        {inner}
      </div>
    )
  }
  // Outbound Calls opens the queue directly; Quiet Work toggles its reveal.
  return href ? (
    <Link href={href} className={base}>{inner}</Link>
  ) : (
    <button type="button" onClick={onSelect} className={base} aria-pressed={selected}>
      {inner}
    </button>
  )
}

/** One quiet-work activity row with its count and a direct action link. */
function WorkModeItemRow({ item }: { item: WorkModeGroup['items'][number] }) {
  const isCommitment = COMMITMENT_BANDS.has(item.band)
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {isCommitment && <AlertCircle className="size-4 shrink-0 text-tag-exception-text" aria-hidden />}
        <span className={cn('truncate', isCommitment ? 'font-medium text-ink' : 'text-ink-secondary')}>
          {item.label}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={cn('font-semibold', isCommitment ? 'text-tag-exception-text' : 'text-ink')}>
          {item.actionableCount}
        </span>
        {item.route && <ArrowRight className="size-4 text-ink-muted" aria-hidden />}
      </span>
    </>
  )
  return (
    <li>
      {item.route ? (
        <Link
          href={item.route}
          className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-base transition-colors hover:bg-surface-card"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 px-2.5 py-2.5 text-base">{body}</div>
      )}
    </li>
  )
}

/** The complete work inventory: the band-grouped activity cards, shown only
 * when the worker asks for the full list. Preserves the GoRules band ordering. */
function FullInventory({ state }: { state: MyWorkState }) {
  const bands = groupByBand(state.activities)
  if (state.quiet && state.activities.every((a) => a.totalCount === 0)) {
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

        {/* Count summary: total, with owned/shared split so sharing is visible.
            The number is a strong neutral by default; it takes the brand accent
            only for a genuine commitment/exception, so teal signals emphasis
            rather than coating every card. */}
        <div className="shrink-0 text-right">
          <p className={cn(
            'text-3xl font-semibold leading-none',
            isCommitment ? 'text-tag-exception-text' : 'text-ink',
          )}>{activity.totalCount}</p>
          {/* Distinct claim states for THIS employee: never conflate another
              teammate's claimed work with free shared work. */}
          <p className="mt-1 text-xs text-ink-supporting">
            {activity.ownedCount > 0 && `${activity.ownedCount} yours · `}
            {activity.availableCount} available
            {activity.claimedByOthersCount > 0 && ` · ${activity.claimedByOthersCount} with teammates`}
            {activity.notEligibleCount > 0 && ` · ${activity.notEligibleCount} not yours`}
          </p>
        </div>
      </div>

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
