'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FolderKanban, Plus, Loader2, CheckCircle2 } from 'lucide-react'
import {
  WorkflowPage,
  WorkflowHeader,
  QueueSection,
  OperationalTag,
  WorkflowButton,
} from '@/components/workflow'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { fmtDate } from '@/lib/fmt'
import { cn } from '@/lib/utils'
import type { ProjectRow } from './page'

export function ProjectsClient({
  current,
  completed,
}: {
  current:   ProjectRow[]
  completed: ProjectRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Optimistic local copies so a newly-created project appears without a full
  // reload; the server page is still the source of truth on next navigation.
  const [currentList, setCurrentList] = useState(current)

  function handleCreated(project: ProjectRow) {
    setCurrentList(prev => [project, ...prev])
    setOpen(false)
    // Flow: Create Project -> Build Population. Go straight into the population
    // builder for the new project.
    router.push(`/projects/${project.id}/population`)
  }

  return (
    <WorkflowPage>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <WorkflowHeader primary="Projects" />
        <WorkflowButton
          icon={Plus}
          selected
          size="lg"
          onClick={() => setOpen(true)}
          className="h-12 gap-2 rounded-xl px-5 text-base font-semibold"
        >
          Start New
        </WorkflowButton>
      </div>

      {/* Current Projects */}
      <QueueSection label="Current Projects">
        {currentList.length === 0 ? (
          <EmptyRow>
            No current projects yet. Use <span className="font-semibold text-ink-secondary">Start New</span> to begin one.
          </EmptyRow>
        ) : (
          currentList.map(p => (
            <ProjectListRow key={p.id} project={p} onOpen={() => router.push(`/projects/${p.id}`)} />
          ))
        )}
      </QueueSection>

      {/* Completed Projects */}
      <QueueSection label="Completed Projects">
        {completed.length === 0 ? (
          <EmptyRow>No completed projects yet.</EmptyRow>
        ) : (
          completed.map(p => (
            <ProjectListRow key={p.id} project={p} onOpen={() => router.push(`/projects/${p.id}`)} />
          ))
        )}
      </QueueSection>

      <NewProjectDialog open={open} onOpenChange={setOpen} onCreated={handleCreated} />
    </WorkflowPage>
  )
}

/** One clickable project row inside a QueueSection. */
function ProjectListRow({
  project,
  onOpen,
}: {
  project: ProjectRow
  onOpen: () => void
}) {
  const isCompleted = project.status === 'completed'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-brand-wash/50 focus-visible:bg-brand-wash/50 focus-visible:outline-none"
    >
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          isCompleted ? 'bg-slate-200 text-slate-500' : 'bg-brand-subtle text-brand-icon',
        )}
      >
        {isCompleted ? <CheckCircle2 className="size-5" /> : <FolderKanban className="size-5" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-semibold leading-tight text-ink">
          {project.name}
        </span>
        <span className="mt-1 block text-[15px] text-ink-supporting">
          {project.project_type}
          <span className="px-2 text-surface-border-strong">{'\u00b7'}</span>
          {isCompleted
            ? `Completed ${fmtDate(project.completed_at)}`
            : `Started ${fmtDate(project.created_at)}`}
        </span>
      </span>

      <OperationalTag tone={isCompleted ? 'info' : 'reason'}>
        {isCompleted ? 'Completed' : 'Active'}
      </OperationalTag>
    </button>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-base text-ink-supporting">{children}</p>
  )
}

type ProjectType = { id: string; name: string; description: string | null }

/** The Start New dialog: name, project type (from the durable catalog), optional description. */
function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (p: ProjectRow) => void
}) {
  const [name, setName]                 = useState('')
  const [projectTypeId, setProjectTypeId] = useState('')
  const [description, setDescription]   = useState('')
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const [types, setTypes]               = useState<ProjectType[]>([])
  const [typesLoading, setTypesLoading] = useState(false)
  const [typesError, setTypesError]     = useState<string | null>(null)

  // Load the active project types each time the dialog opens so the dropdown
  // reflects the current catalog (newly added / retired types).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setTypesLoading(true)
    setTypesError(null)
    fetch('/api/project-types')
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        if (json.error) { setTypesError(json.error); return }
        setTypes((json.data ?? []) as ProjectType[])
      })
      .catch(() => { if (!cancelled) setTypesError('Could not load project types.') })
      .finally(() => { if (!cancelled) setTypesLoading(false) })
    return () => { cancelled = true }
  }, [open])

  function reset() {
    setName(''); setProjectTypeId(''); setDescription(''); setError(null); setSaving(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Enter a project name.'); return }
    if (!projectTypeId) { setError('Choose a project type.'); return }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          project_type_id: projectTypeId,
          description: description.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create project')
      reset()
      onCreated(json.data as ProjectRow)
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : 'Failed to create project')
    }
  }

  const noTypes = !typesLoading && !typesError && types.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={v => { if (!saving) { onOpenChange(v); if (!v) reset() } }}
    >
      <DialogContent className="bg-surface-card text-ink-secondary sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-ink">Start a new project</DialogTitle>
          <DialogDescription className="text-ink-supporting">
            Create the project record. It starts active; you add population and runs later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-1">
          <div className="space-y-1.5">
            <label htmlFor="project-name" className="block text-sm font-semibold text-ink-secondary">
              Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="e.g. 2026 Term Conversion Sweep"
              className="h-11 w-full rounded-lg border border-surface-border-strong px-3 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="project-type" className="block text-sm font-semibold text-ink-secondary">
              Project type
            </label>
            <select
              id="project-type"
              value={projectTypeId}
              onChange={e => setProjectTypeId(e.target.value)}
              disabled={typesLoading || noTypes}
              className="h-11 w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted"
            >
              <option value="" disabled>
                {typesLoading ? 'Loading types...' : noTypes ? 'No project types available' : 'Select a project type'}
              </option>
              {types.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {typesError && (
              <p className="text-sm font-medium text-status-missing-foreground">{typesError}</p>
            )}
            {noTypes && !typesError && (
              <p className="text-sm text-slate-500">
                Add an active project type before creating a project.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="project-description" className="block text-sm font-semibold text-ink-secondary">
              Description <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="What this project is for."
              className="w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-sm font-medium text-status-missing-strong">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => { if (!saving) { onOpenChange(false); reset() } }}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-supporting transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <WorkflowButton
              type="submit"
              selected
              disabled={saving || noTypes}
              className="rounded-lg px-5 text-sm font-semibold"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {saving ? 'Creating...' : 'Create project'}
            </WorkflowButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
