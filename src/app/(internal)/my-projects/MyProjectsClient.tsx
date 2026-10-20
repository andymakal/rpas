'use client'

/**
 * MY PROJECTS client surface (Right Path, light workflow theme).
 *
 * Presents the projects the signed-in employee participates in. For each: the
 * progress across stages, the current bottleneck, the responsible people
 * (participants), and the ordered escalation path for operational exceptions.
 * Participation, ownership, and escalation are visibly distinct — a participant
 * is not implied to perform every activity, and escalation is the exception
 * path, not an approval step on routine work.
 *
 * Built on the shared workflow design system and tokens per the light-theme
 * workflow visual rules.
 */

import Link from 'next/link'
import { ArrowRight, Users, AlertTriangle, Play, FolderGit2 } from 'lucide-react'
import { WorkflowPage, WorkflowHeader, OperationalTag } from '@/components/workflow'
import { STAGE_LABEL } from '@/lib/my-work/project-labels'
import { roleLabel, OPERATIONS_ESCALATION_LABEL } from '@/lib/projects/project-roles'
import type { MyProjectCard, MyProjectsState } from '@/lib/my-work/projects'
import type { WorkflowStage } from '@/lib/projects/review-1035'

const PROGRESS_STAGES: WorkflowStage[] = [
  'stewardship',
  'operations_prep',
  'bob_evaluation',
  'ready_for_outreach',
  'complete',
]

export function MyProjectsClient({ state }: { state: MyProjectsState }) {
  if (state.noProfile) {
    return (
      <WorkflowPage>
        <WorkflowHeader primary="My Projects" />
        <p className="max-w-prose text-base text-ink-secondary">
          Your account does not have a team member profile yet, so there is no
          personal project view. Ask an administrator to add you on the Team page.
        </p>
      </WorkflowPage>
    )
  }

  return (
    <WorkflowPage>
      <WorkflowHeader primary="My Projects" secondary={state.employeeName ?? undefined} />

      {state.projects.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-base text-ink-secondary">
          <FolderGit2 className="size-5 text-ink-supporting" aria-hidden />
          You are not currently a participant in any project.
        </div>
      ) : (
        <div className="space-y-5">
          {state.projects.map((p) => (
            <ProjectCard key={p.projectId} project={p} />
          ))}
        </div>
      )}
    </WorkflowPage>
  )
}

function ProjectCard({ project }: { project: MyProjectCard }) {
  const statusTone = project.status === 'archived' ? 'blocked' : project.status === 'completed' ? 'info' : 'reason'
  const statusLabel = project.status.charAt(0).toUpperCase() + project.status.slice(1)

  return (
    <article className="rounded-2xl border border-brand-subtle bg-surface-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Link href={project.route} className="text-xl font-semibold tracking-tight text-ink hover:text-brand-hover">
              {project.name}
            </Link>
            <OperationalTag tone={statusTone}>{statusLabel}</OperationalTag>
          </div>
          <p className="mt-1 text-sm text-ink-supporting">
            {project.projectType}
            {project.owner ? <> · Owner / operations manager: {project.owner.name}</> : null}
            {project.myNote ? <> · You: {project.myNote}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {project.reviewRoute && (
            <Link
              href={`/my-work?project_id=${encodeURIComponent(project.projectId)}`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
            >
              <Play className="size-4" aria-hidden /> Work Project
            </Link>
          )}
          <Link
            href={project.route}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
          >
            Overview <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      {/* Progress across stages: the project moves even when nothing requires
          THIS employee, so the whole picture is always visible. */}
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">
          Progress · {project.totalCustomers.toLocaleString()} customer{project.totalCustomers === 1 ? '' : 's'}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PROGRESS_STAGES.map((stage) => (
            <div key={stage} className="rounded-xl border border-surface-border bg-surface-muted px-3 py-2">
              <p className="text-2xl font-semibold leading-none text-ink">{project.stageCounts[stage] ?? 0}</p>
              <p className="mt-1 text-[11px] leading-tight text-ink-supporting">{STAGE_LABEL[stage]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The current bottleneck: where the most customers are held right now. */}
      {project.bottleneck && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-tag-exception-border bg-tag-exception-fill px-4 py-2.5">
          <AlertTriangle className="size-4 text-tag-exception-text" aria-hidden />
          <p className="text-sm font-semibold text-tag-exception-text">
            Bottleneck: {project.bottleneck.count} held at {project.bottleneck.label.toLowerCase()}
          </p>
        </div>
      )}

      {/* Responsible people — participants (who works it), kept DISTINCT from the
          escalation path (who an exception goes to). */}
      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-surface-border pt-4 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">
            <Users className="size-3.5" aria-hidden /> Participants
          </p>
          <ul className="mt-2 space-y-1">
            {project.participants.length === 0 ? (
              <li className="text-sm text-ink-muted">No participants recorded.</li>
            ) : (
              project.participants.map((p) => {
                const roles = p.roles ?? []
                const licensing = licensingNote(roles, p.isLifeLicensed ?? null)
                const summary = responsibilitySummary(roles, p.escalationTier ?? null)
                return (
                  <li key={p.producerId} className="text-sm text-ink">
                    <span className="font-medium">{p.name}</span>
                    {summary ? (
                      <span className="text-ink-supporting"> — {summary}</span>
                    ) : p.note ? (
                      <span className="text-ink-supporting"> — {p.note}</span>
                    ) : null}
                    {/* The licensing fact is shown as a separate parenthetical,
                        never folded into the responsibility label. */}
                    {licensing && <span className="text-ink-muted"> ({licensing})</span>}
                  </li>
                )
              })
            )}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">
            Escalation path (exceptions only)
          </p>
          <ol className="mt-2 space-y-1">
            {project.escalation.length === 0 ? (
              <li className="text-sm text-ink-muted">No escalation path recorded.</li>
            ) : (
              project.escalation.map((e) => (
                <li key={e.producerId} className="flex items-baseline gap-2 text-sm text-ink">
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-wash text-[11px] font-semibold text-brand-hover">
                    {e.tier}
                  </span>
                  <span>
                    <span className="font-medium">{e.name}</span>
                    {e.note ? <span className="text-ink-supporting"> — {e.note}</span> : null}
                  </span>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </article>
  )
}

/**
 * The comma-joined responsibility labels for a participant, with the derived
 * "Operations escalation" badge appended (from the escalation path) so a person
 * holding several responsibilities reads completely.
 */
function responsibilitySummary(roles: string[], escalationTier: number | null): string {
  const labels = roles.map(roleLabel)
  if (escalationTier !== null) {
    labels.push(
      escalationTier === 1
        ? `${OPERATIONS_ESCALATION_LABEL} (first contact)`
        : `${OPERATIONS_ESCALATION_LABEL} (tier ${escalationTier})`,
    )
  }
  return labels.join(', ')
}

/**
 * A small, derived licensing annotation shown beside a participant's
 * responsibilities. This is a QUALIFICATION fact, kept distinct from the
 * responsibility labels themselves:
 *   - life licensed held        -> "life licensed"
 *   - underwriting support with licensing not established -> "licensing unconfirmed"
 * Everyone else gets no annotation.
 */
function licensingNote(roles: string[], isLifeLicensed: boolean | null): string | null {
  if (isLifeLicensed === true) return 'life licensed'
  if (roles.includes('underwriting_support')) return 'licensing unconfirmed'
  return null
}
