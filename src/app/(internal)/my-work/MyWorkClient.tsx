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

import Link from 'next/link'
import {
  Sparkles, ArrowRight, Phone, Users, CheckCircle2, Lock,
} from 'lucide-react'
import {
  WorkflowPage,
  WorkflowHeader,
  OperationalTag,
  type OperationalTone,
} from '@/components/workflow'
import { cn } from '@/lib/utils'
import type { ActivityGroup, MyWorkState, PriorityBand } from '@/lib/my-work/types'

/** The band's human section title and tag tone, driven by ZEN's band. */
const BAND_META: Record<PriorityBand, { title: string; tone: OperationalTone }> = {
  exact_time_commitment: { title: 'Fixed appointments now', tone: 'exception' },
  focus:                 { title: "Today's Focus", tone: 'reason' },
  due_callback:          { title: 'Promised callbacks due', tone: 'exception' },
  owned:                 { title: 'Your claimed work', tone: 'info' },
  shared:                { title: 'Shared work you can pick up', tone: 'info' },
  ineligible:            { title: 'Elsewhere in the office', tone: 'info' },
}

export function MyWorkClient({ state }: { state: MyWorkState }) {
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

  // Group activities by ZEN band, preserving the rank order the composition set.
  const bands = groupByBand(state.activities)

  return (
    <WorkflowPage>
      <WorkflowHeader
        primary="My Work"
        secondary={state.employeeName ?? undefined}
      />

      {/* Today's Focus banner: temporary management direction, shown as a
          distinct notice. It influences ordering below; it never hides work. */}
      {state.focusNotes.length > 0 && (
        <section
          aria-label="Today's Focus"
          className="rounded-2xl border border-brand-subtle bg-brand-wash p-5"
        >
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-brand-hover">
            <Sparkles className="size-4" aria-hidden /> Today&apos;s Focus
          </p>
          <ul className="mt-2 space-y-1.5">
            {state.focusNotes.map((f) => (
              <li key={f.id} className="text-sm text-ink">
                <span className="font-semibold">{f.label}</span>
                {f.note ? <span className="text-ink-secondary"> — {f.note}</span> : null}
                <span className="ml-2 text-ink-supporting">
                  (until {formatExpiry(f.expiresAt)})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-supporting">
            Focus reorders your work for a limited time. It never overrides a
            customer commitment and never hides other work.
          </p>
        </section>
      )}

      {state.quiet && state.activities.every((a) => a.totalCount === 0) ? (
        <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-base text-ink-secondary">
          <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
          Nothing needs your attention right now. You have open capacity.
        </div>
      ) : (
        <div className="space-y-8">
          {bands.map(({ band, items }) => (
            <section key={band} aria-label={BAND_META[band].title} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-supporting">
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
      )}
    </WorkflowPage>
  )
}

/** One activity group card: the activity, its counts, reason, sources, claim. */
function ActivityCard({ activity }: { activity: ActivityGroup }) {
  const ineligible = activity.band === 'ineligible'
  return (
    <article
      className={cn(
        'rounded-2xl border bg-surface-card p-5',
        ineligible ? 'border-surface-border opacity-90' : 'border-brand-subtle',
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
            {activity.isFocusElevated && !ineligible && (
              <OperationalTag tone="reason">
                <Sparkles className="mr-1.5 size-4" aria-hidden /> Focus
              </OperationalTag>
            )}
          </div>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-secondary">
            {activity.reason}
          </p>
        </div>

        {/* Count summary: total, with owned/shared split so sharing is visible. */}
        <div className="shrink-0 text-right">
          <p className="text-3xl font-semibold leading-none text-brand-hover">{activity.totalCount}</p>
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
            return (
              <li key={`${s.kind}-${s.projectId ?? 'shared'}-${i}`}>
                <Link
                  href={s.route}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-wash"
                >
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    {s.kind === 'stewardship' ? (
                      <Users className="size-4 shrink-0 text-ink-supporting" aria-hidden />
                    ) : (
                      <ArrowRight className="size-4 shrink-0 text-ink-supporting" aria-hidden />
                    )}
                    <span className="truncate">{s.label}</span>
                    {s.projectId && (
                      <span className="shrink-0 rounded-full bg-brand-wash px-1.5 text-[11px] font-medium text-brand-hover">
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
                {/* Per-source claim breakdown, only when there is something to
                    distinguish beyond the simple count. */}
                {(s.ownedByMe > 0 || s.claimedByOthers > 0 || (s.notEligible > 0 && !ineligible)) && (
                  <p className="px-2 pb-0.5 text-[11px] text-ink-muted">
                    {[
                      s.ownedByMe > 0 ? `${s.ownedByMe} yours` : null,
                      s.availableToMe > 0 ? `${s.availableToMe} available` : null,
                      s.claimedByOthers > 0 ? `${s.claimedByOthers} with teammates` : null,
                      s.notEligible > 0 && !ineligible ? `${s.notEligible} not yours` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {ineligible && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-supporting">
          <Lock className="size-3.5" aria-hidden />
          Shown for awareness. This activity is not routed to you.
        </p>
      )}
    </article>
  )
}

/** Preserve rank order while grouping activities under their ZEN band. */
function groupByBand(
  activities: ActivityGroup[],
): { band: PriorityBand; items: ActivityGroup[] }[] {
  const order: PriorityBand[] = ['exact_time_commitment', 'focus', 'due_callback', 'owned', 'shared', 'ineligible']
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
