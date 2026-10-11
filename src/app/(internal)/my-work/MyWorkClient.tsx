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
  Sparkles, ArrowRight, Phone, Users, CheckCircle2, Lock, Star, HandHelping,
} from 'lucide-react'
import {
  WorkflowPage,
  WorkflowHeader,
  OperationalTag,
  AssistantPanel,
  type OperationalTone,
} from '@/components/workflow'
import { cn } from '@/lib/utils'
import { capabilityStatusLabel } from '@/lib/capabilities/explanations'
import type { ActivityGroup, MyWorkState, PriorityBand } from '@/lib/my-work/types'
import {
  deriveMyWorkDirection,
  type DirectionRow,
  type MyWorkDirection,
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

  // Derive the Daily Direction summary from the SAME ready state. This reads
  // ZEN's already-decided ordering; it does not re-rank or add a data source.
  const direction = deriveMyWorkDirection(state)

  return (
    <WorkflowPage>
      <WorkflowHeader
        primary="My Work"
        secondary={state.employeeName ?? undefined}
      />

      {/* The Daily Direction Assistant: a system-state explanation of what
          deserves attention next and why, with a direct link into the work.
          This is the ASSISTANT, not Mentoring (coaching) — it tells the worker
          what is next; it never teaches. The full activity inventory still
          renders below; this leads with the single next best action. */}
      <MyWorkAssistant direction={direction} />

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

/**
 * The Daily Direction Assistant for My Work. Built on the shared AssistantPanel
 * so it inherits the canonical teal Assistant identity (the treatment reserved
 * for the Assistant, distinct from Mentoring coaching). It leads with the single
 * Next Best Action and the deterministic reason, offers a direct link to the
 * work, and then separates the employee's Primary responsibilities from the
 * Support work they help with. It renders only the ready direction summary and
 * makes no business judgment of its own.
 */
function MyWorkAssistant({ direction }: { direction: MyWorkDirection }) {
  if (direction.quiet || !direction.nextAction) {
    return (
      <div className="[&>section]:gap-4 [&>section]:p-6 sm:[&>section]:p-7">
        <AssistantPanel heading={<span className="text-2xl">You have open capacity</span>}>
          <p className="-mt-2 flex items-center gap-2 text-sm leading-relaxed text-ink-secondary">
            <CheckCircle2 className="size-5 text-status-confirmed" aria-hidden />
            Nothing needs your attention right now. When work you are eligible for
            arrives, I&apos;ll point you to the next thing to do.
          </p>
        </AssistantPanel>
      </div>
    )
  }

  const { tied, options } = direction.nextAction
  // The single recommendation case: exactly one activity holds the top ZEN
  // rank. When several tie, no single heading can claim to be "the" next action
  // without inventing a ranking ZEN did not make, so a neutral heading
  // introduces the co-equal choices below.
  const single = !tied ? options[0] : null

  return (
    <div className="[&>section]:gap-4 [&>section]:p-6 sm:[&>section]:p-7">
      <AssistantPanel
        heading={
          <span className="text-2xl">
            {single
              ? single.heading
              : 'A few things are equally worth starting'}
          </span>
        }
      >
        {single ? (
          <>
            {/* Why this is next: reused verbatim from the activity's ZEN-derived
                reason, so the Assistant and the activity card never disagree. */}
            <p className="-mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
              {single.reason}
            </p>

            {/* Direct access to the recommended work. */}
            {single.route && (
              <Link
                href={single.route}
                className="inline-flex w-fit items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
              >
                {single.actionLabel}
                {single.actionableCount > 0 && (
                  <span className="rounded-full bg-brand-foreground/20 px-1.5 text-xs">
                    {single.actionableCount}
                  </span>
                )}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
          </>
        ) : (
          <>
            {/* Several activities share the top ZEN priority. They are presented
                as co-equal choices with NO ordering between them: ZEN ranked
                them the same, so the Assistant invents no winner. */}
            <p className="-mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
              These are at the same priority right now. Any one is a good place to
              start.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((o) => (
                <div
                  key={o.workFunction}
                  className="flex flex-col gap-2 rounded-xl border border-brand-subtle bg-brand-wash p-4"
                >
                  <p className="text-sm font-semibold text-ink">{o.heading}</p>
                  <p className="text-sm leading-relaxed text-ink-secondary">{o.reason}</p>
                  {o.route && (
                    <Link
                      href={o.route}
                      className="mt-auto inline-flex w-fit items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
                    >
                      {o.actionLabel}
                      {o.actionableCount > 0 && (
                        <span className="rounded-full bg-brand-foreground/20 px-1.5 text-xs">
                          {o.actionableCount}
                        </span>
                      )}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Primary responsibilities vs Support work: two distinct listings so
            the worker sees what is chiefly theirs apart from what they help
            with. Each row links straight into that activity's work. */}
        {(direction.primary.length > 0 || direction.support.length > 0) && (
          <div className="grid gap-4 border-t border-surface-border pt-4 sm:grid-cols-2">
            <DirectionColumn
              title="Your primary responsibilities"
              icon={Star}
              empty="No primary work needs you right now."
              rows={direction.primary}
            />
            <DirectionColumn
              title="Support you can help with"
              icon={HandHelping}
              empty="No support work right now."
              rows={direction.support}
            />
          </div>
        )}
      </AssistantPanel>
    </div>
  )
}

/** One Primary / Support listing column inside the Assistant. */
function DirectionColumn({
  title, icon: Icon, empty, rows,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  empty: string
  rows: DirectionRow[]
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-supporting">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((r) => {
            const body = (
              <>
                <span className="flex min-w-0 items-center gap-2 text-ink">
                  <span className="truncate">{r.label}</span>
                  {r.dueCount > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-status-missing-strong">
                      <Phone className="size-3" aria-hidden />
                      {r.dueCount} due
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold text-brand-hover">{r.actionableCount}</span>
                  {r.route && <ArrowRight className="size-4 text-ink-muted" aria-hidden />}
                </span>
              </>
            )
            return (
              <li key={r.workFunction}>
                {r.route ? (
                  <Link
                    href={r.route}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-wash"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The bands that are shown for awareness only — not routed and not actionable
 * by this employee. 'assist' is deliberately NOT here: it is pickable. */
const AWARENESS_BANDS = new Set<PriorityBand>(['unassigned', 'unlicensed'])

/** One activity group card: the activity, its counts, reason, sources, claim. */
function ActivityCard({ activity }: { activity: ActivityGroup }) {
  const awarenessOnly = AWARENESS_BANDS.has(activity.band)
  return (
    <article
      className={cn(
        'rounded-2xl border bg-surface-card p-5',
        awarenessOnly ? 'border-surface-border opacity-90' : 'border-brand-subtle',
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
