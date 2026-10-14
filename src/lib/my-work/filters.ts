/**
 * MY WORK — Project + Activity filtering (pure, client-safe).
 *
 * The two combinable filters narrow what My Work SHOWS over the already-resolved
 * MyWorkState. They never touch eligibility, claim state, routes, counts, or the
 * ZEN ordering — the server composition owns all of that. A fixed-time
 * commitment is exempt from the filters so a promised callback or scheduled
 * appointment is never hidden.
 *
 * This lives in src/lib (not the 'use client' component) so it is pure,
 * dependency-light, and unit-testable with the node:test runner. The client
 * imports these helpers; it adds only the React state and the select controls.
 *
 * The subtle correctness point lives in reaggregateForProject: an Outreach
 * activity's ready-to-call customers are counted in the activity aggregate but
 * are only DISPLAYED through the informational Calls Due / Available to Call
 * populations (the normal ready-to-call source is never emitted). So the
 * project-filtered headline total must come from the composition's authoritative
 * per-project aggregate (projectTotals), NOT from re-summing the shown sources —
 * otherwise ready-to-call customers would be dropped, or (if the informational
 * populations were summed in) a customer with multiple contact methods would be
 * double-counted.
 */

import type { ActivityGroup, MyWorkState, PriorityBand, WorkSource } from './types'

/** Sentinel for an unfiltered selection ("all projects" / "all activities").
 * A Radix Select item value may not be empty, so a non-empty token is used. */
export const ALL = '__all__'

/** The bands that represent a GENUINE customer commitment, which the filters
 * never hide. Kept in sync with the client's COMMITMENT_BANDS. */
const COMMITMENT_BANDS = new Set<PriorityBand>(['exact_time_commitment', 'due_callback'])

export interface FilterOption {
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
 * always has project-kind sources, so this fallback is not normally reached).
 */
export function projectFilterOptions(state: MyWorkState): FilterOption[] {
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
export function activityFilterOptions(state: MyWorkState): FilterOption[] {
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
export function sourceForProject(s: WorkSource, projectId: string): WorkSource | null {
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

/**
 * Set an activity's headline counts to a selected project's authoritative
 * aggregate, keeping the narrowed sources for display and links.
 *
 * The counts come from the composition's projectTotals[pid], NOT from summing
 * the narrowed sources. That matters because an Outreach activity's ready-to-call
 * customers are counted in the aggregate but are only DISPLAYED through the
 * informational Calls Due / Available to Call populations — the normal
 * ready-to-call source is never emitted. Re-summing sources would therefore drop
 * them (summing the informational populations instead would double-count a
 * customer who is both callable and emailable). projectTotals counts each
 * customer once across every queue, so the filtered total is both complete
 * (ready-to-call included) and free of double-counting.
 *
 * Fallback: when projectTotals has no entry for this project (e.g. an activity
 * whose project work predates this field), sum the non-informational narrowed
 * sources — the previous behavior — so counts are never left blank.
 */
export function reaggregateForProject(
  a: ActivityGroup,
  sources: WorkSource[],
  projectId: string,
): ActivityGroup {
  const authoritative = a.projectTotals?.[projectId]
  if (authoritative) {
    return {
      ...a,
      sources,
      totalCount: authoritative.totalCount,
      // Narrow the attempted-vs-unresolved figures to the project too, so a
      // project-filtered Research summary shows that project's population and
      // breakdown rather than the agency-wide one. Absent when the project
      // carries no such distinction.
      unresolvedCount: authoritative.unresolvedCount,
      unsuccessfulCount: authoritative.unsuccessfulCount,
      ownedCount: authoritative.ownedCount,
      availableCount: authoritative.availableCount,
      claimedByOthersCount: authoritative.claimedByOthersCount,
      notEligibleCount: authoritative.notEligibleCount,
      dueCount: authoritative.dueCount,
    }
  }
  let total = 0, owned = 0, available = 0, claimed = 0, notEligible = 0, due = 0
  for (const s of sources) {
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
 * project-scoped counts and route; the activity's headline counts come from the
 * authoritative per-project aggregate (projectTotals), so counts and links
 * correspond to the selected project, include ready-to-call customers, and
 * exclude unrelated work. ZEN ordering is untouched: this removes
 * activities/sources from view but never re-ranks what remains.
 */
export function applyWorkFilters(
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
    // counts/route, then set the activity's headline counts from the
    // authoritative per-project aggregate.
    const sources = a.sources
      .map((s) => sourceForProject(s, projectFilter))
      .filter((s): s is WorkSource => s !== null)
    if (sources.length === 0) return []
    return [reaggregateForProject(a, sources, projectFilter)]
  })

  return { ...state, activities }
}
