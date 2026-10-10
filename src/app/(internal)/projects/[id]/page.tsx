import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Users, FolderPlus, Play } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  WorkflowPage,
  WorkflowHeader,
  OperationalTag,
} from '@/components/workflow'
import { fmtDate } from '@/lib/fmt'

export const metadata: Metadata = { title: 'Project' }

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('projects')
    .select('id, name, description, status, created_at, completed_at, archived_at, project_types ( name )')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  const { project_types, ...rest } = data as typeof data & { project_types: { name: string } | null }
  const project = { ...rest, project_type: project_types?.name ?? '' }

  const isCompleted = project.status === 'completed'
  const isArchived  = project.status === 'archived'
  const statusLabel = isArchived ? 'Archived' : isCompleted ? 'Completed' : 'Active'

  // The stewardship/capture flow is the 1035 working surface. Only 1035
  // projects get a "Work Project" action; other project types do not reuse this
  // flow. Matched on the type name (the seeded type is "1035 Exchange").
  const is1035 = /1035/.test(project.project_type)

  // Population summary: how many customers are in the project, and the runs so
  // far (each run is preserved separately).
  const [{ count: customerCount }, { data: runs }] = await Promise.all([
    supabase
      .from('project_customers')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id),
    supabase
      .from('project_runs')
      .select('id, run_number, criteria, created_at')
      .eq('project_id', id)
      .order('run_number', { ascending: false }),
  ])

  // Per-run customer counts (customers first added by that run).
  const runList = runs ?? []
  const runCounts = new Map<string, number>()
  if (runList.length > 0) {
    const { data: addedRows } = await supabase
      .from('project_customers')
      .select('added_by_run_id')
      .eq('project_id', id)
    for (const r of addedRows ?? []) {
      const rid = r.added_by_run_id as string | null
      if (rid) runCounts.set(rid, (runCounts.get(rid) ?? 0) + 1)
    }
  }

  return (
    <WorkflowPage>
        <Link
          href="/projects"
          className="-ml-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-supporting transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All projects
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <WorkflowHeader primary={project.name} secondary={project.project_type} />
          <div className="flex items-center gap-3">
            <OperationalTag tone={isArchived ? 'blocked' : isCompleted ? 'info' : 'reason'}>
              {statusLabel}
            </OperationalTag>
            {/* An archived project is kept for viewing but takes no new activity
                until it is restored, so its activity actions are withheld. */}
            {!isArchived && (
              <>
                {/* Work Project — opens the existing 1035 working interface
                    (Steps 2 & 3: Stewardship servicing access, policy documents,
                    and Bob's determinations) on its own route, keeping the
                    project overview uncluttered. 1035 projects only. */}
                {is1035 && (
                  <Link
                    href={`/projects/${project.id}/review`}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                  >
                    <Play className="size-4" aria-hidden />
                    Work Project
                  </Link>
                )}
                {/* Add Population — administrative action, authorized internal
                    staff only. Available on an existing project to add another run. */}
                <Link
                  href={`/projects/${project.id}/population`}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
                >
                  <FolderPlus className="size-4" aria-hidden />
                  Add Population
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Archived notice — explains why the activity actions are absent and
            how to bring the project back. */}
        {isArchived && (
          <p className="max-w-3xl rounded-xl border border-surface-border bg-surface-muted px-4 py-3 text-sm font-medium text-ink-secondary">
            This project is archived. Its records are preserved and viewable, but it takes no new activity until you restore it from the Projects list.
          </p>
        )}

        {project.description && (
          <p className="max-w-3xl text-lg leading-relaxed text-ink-secondary">{project.description}</p>
        )}

        <dl className="grid max-w-xl grid-cols-2 gap-x-8 gap-y-4 rounded-2xl border border-surface-border bg-surface-card p-6">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Type</dt>
            <dd className="mt-1 text-base text-ink">{project.project_type}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Status</dt>
            <dd className="mt-1 text-base text-ink">{statusLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Started</dt>
            <dd className="mt-1 text-base text-ink">{fmtDate(project.created_at)}</dd>
          </div>
          {isCompleted && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Completed</dt>
              <dd className="mt-1 text-base text-ink">{fmtDate(project.completed_at)}</dd>
            </div>
          )}
        </dl>

        {/* Population summary */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-teal-700" aria-hidden />
            <h2 className="text-lg font-semibold text-ink">
              Population
              <span className="ml-2 text-ink-supporting">
                {(customerCount ?? 0).toLocaleString()} customer{(customerCount ?? 0) === 1 ? '' : 's'}
              </span>
            </h2>
          </div>

          {runList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center">
              <p className="text-base text-ink-supporting">
                {isArchived
                  ? 'No population was built for this project.'
                  : <>No population yet. Use <span className="font-semibold text-ink">Add Population</span> to build the first run.</>}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-surface-border text-xs uppercase tracking-[0.06em] text-ink-supporting">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Run</th>
                    <th className="px-5 py-3 font-semibold">Added customers</th>
                    <th className="px-5 py-3 font-semibold">Built</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {runList.map(r => (
                    <tr key={r.id as string}>
                      <td className="px-5 py-3 font-medium text-ink">Run {r.run_number as number}</td>
                      <td className="px-5 py-3 tabular-nums text-ink">
                        {(runCounts.get(r.id as string) ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-ink-secondary">{fmtDate(r.created_at as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-supporting">
            Each run is preserved separately. Adding a new run never removes customers already in the project.
          </p>
        </section>
    </WorkflowPage>
  )
}
