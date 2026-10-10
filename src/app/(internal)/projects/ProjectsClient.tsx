'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  FolderKanban,
  Plus,
  Loader2,
  CheckCircle2,
  Archive,
  MoreVertical,
  Pencil,
  CheckCheck,
  RotateCcw,
  ArchiveRestore,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { fmtDate } from '@/lib/fmt'
import { cn } from '@/lib/utils'
import type { ProjectRow } from './page'

export function ProjectsClient({
  current,
  completed,
  archived,
}: {
  current:   ProjectRow[]
  completed: ProjectRow[]
  archived:  ProjectRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // The project currently being edited (null = dialog closed).
  const [editing, setEditing] = useState<ProjectRow | null>(null)

  // Show the Archived Projects section only when asked, so the normal working
  // view stays uncluttered. The toggle is a lightweight view, not a new screen.
  const [showArchived, setShowArchived] = useState(false)

  // Optimistic local copies so a newly-created project appears without a full
  // reload; the server page is still the source of truth on next navigation.
  const [currentList, setCurrentList] = useState(current)

  // Keep local state in sync when the server component re-renders (e.g. after a
  // maintenance action calls router.refresh()).
  useEffect(() => { setCurrentList(current) }, [current])

  function handleCreated(project: ProjectRow) {
    setCurrentList(prev => [project, ...prev])
    setOpen(false)
    // Flow: Create Project -> Build Population. Go straight into the population
    // builder for the new project.
    router.push(`/projects/${project.id}/population`)
  }

  const archivedCount = archived.length

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
            <ProjectListRow
              key={p.id}
              project={p}
              onOpen={() => router.push(`/projects/${p.id}`)}
              onEdit={() => setEditing(p)}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </QueueSection>

      {/* Completed Projects */}
      <QueueSection label="Completed Projects">
        {completed.length === 0 ? (
          <EmptyRow>No completed projects yet.</EmptyRow>
        ) : (
          completed.map(p => (
            <ProjectListRow
              key={p.id}
              project={p}
              onOpen={() => router.push(`/projects/${p.id}`)}
              onEdit={() => setEditing(p)}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </QueueSection>

      {/* Archived Projects — a view, surfaced on demand. Archived projects stay
          available for viewing but take no new activity until restored. */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowArchived(v => !v)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-supporting transition-colors hover:text-ink"
        >
          <Archive className="size-4" aria-hidden />
          {showArchived ? 'Hide' : 'Show'} archived projects
          {archivedCount > 0 && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-secondary">
              {archivedCount}
            </span>
          )}
        </button>
      </div>

      {showArchived && (
        <QueueSection label="Archived Projects">
          {archived.length === 0 ? (
            <EmptyRow>No archived projects.</EmptyRow>
          ) : (
            archived.map(p => (
              <ProjectListRow
                key={p.id}
                project={p}
                onOpen={() => router.push(`/projects/${p.id}`)}
                onEdit={() => setEditing(p)}
                onChanged={() => router.refresh()}
              />
            ))
          )}
        </QueueSection>
      )}

      <NewProjectDialog open={open} onOpenChange={setOpen} onCreated={handleCreated} />
      <EditProjectDialog
        project={editing}
        onOpenChange={v => { if (!v) setEditing(null) }}
        onSaved={() => { setEditing(null); router.refresh() }}
      />
    </WorkflowPage>
  )
}

/** One project row inside a QueueSection: a clickable body plus a maintenance menu. */
function ProjectListRow({
  project,
  onOpen,
  onEdit,
  onChanged,
}: {
  project:   ProjectRow
  onOpen:    () => void
  onEdit:    () => void
  onChanged: () => void
}) {
  const isCompleted = project.status === 'completed'
  const isArchived  = project.status === 'archived'

  const tone: 'reason' | 'info' | 'blocked' =
    isArchived ? 'blocked' : isCompleted ? 'info' : 'reason'
  const label = isArchived ? 'Archived' : isCompleted ? 'Completed' : 'Active'

  // Subtitle: the second line reflects the project's lifecycle moment.
  const subtitle = isArchived
    ? `Archived ${fmtDate(project.archived_at)}`
    : isCompleted
      ? `Completed ${fmtDate(project.completed_at)}`
      : `Started ${fmtDate(project.created_at)}`

  return (
    <div className="group flex w-full items-center gap-4 pr-3 transition-colors hover:bg-brand-wash/50 focus-within:bg-brand-wash/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-4 px-5 py-5 text-left focus-visible:outline-none"
      >
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            isArchived
              ? 'bg-slate-100 text-slate-400'
              : isCompleted
                ? 'bg-slate-200 text-slate-500'
                : 'bg-brand-subtle text-brand-icon',
          )}
        >
          {isArchived ? (
            <Archive className="size-5" />
          ) : isCompleted ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <FolderKanban className="size-5" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold leading-tight text-ink">
            {project.name}
          </span>
          <span className="mt-1 block text-[15px] text-ink-supporting">
            {project.project_type}
            <span className="px-2 text-surface-border-strong">{'\u00b7'}</span>
            {subtitle}
          </span>
        </span>
      </button>

      <OperationalTag tone={tone}>{label}</OperationalTag>

      <ProjectActionsMenu project={project} onEdit={onEdit} onChanged={onChanged} />
    </div>
  )
}

/**
 * The three-dot maintenance menu. The actions shown depend on the project's
 * current state, so the menu never offers a transition that cannot happen:
 *   active    -> Edit, Mark Complete, Archive
 *   completed -> Edit, Reopen, Archive
 *   archived  -> Restore   (read-only until restored; no Edit)
 * Permanent deletion is intentionally never offered here.
 */
function ProjectActionsMenu({
  project,
  onEdit,
  onChanged,
}: {
  project:   ProjectRow
  onEdit:    () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const isArchived  = project.status === 'archived'
  const isActive    = project.status === 'active'
  const isCompleted = project.status === 'completed'

  async function run(action: 'complete' | 'reopen' | 'archive' | 'restore') {
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(json.error ?? 'That action could not be completed.')
        return
      }
      onChanged()
    } catch {
      alert('That action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Project actions"
        disabled={busy}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-supporting transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50 data-[state=open]:bg-surface-muted"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <MoreVertical className="size-5" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {!isArchived && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit
          </DropdownMenuItem>
        )}

        {isActive && (
          <DropdownMenuItem onSelect={() => run('complete')}>
            <CheckCheck />
            Mark Complete
          </DropdownMenuItem>
        )}

        {isCompleted && (
          <DropdownMenuItem onSelect={() => run('reopen')}>
            <RotateCcw />
            Reopen
          </DropdownMenuItem>
        )}

        {!isArchived && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run('archive')}>
              <Archive />
              Archive
            </DropdownMenuItem>
          </>
        )}

        {isArchived && (
          <DropdownMenuItem onSelect={() => run('restore')}>
            <ArchiveRestore />
            Restore
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * The Edit dialog: rename and/or re-describe an existing project. Clones the
 * New Project dialog's shape (shared tokens, inline error, Loader2 submit) but
 * does not touch project type or status — those have their own actions.
 */
function EditProjectDialog({
  project,
  onOpenChange,
  onSaved,
}: {
  project: ProjectRow | null
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const open = project !== null

  // Seed the fields each time a project is opened for editing.
  useEffect(() => {
    if (project) {
      setName(project.name)
      setDescription(project.description ?? '')
      setError(null)
      setSaving(false)
    }
  }, [project])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!project) return
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Enter a project name.'); return }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          name: trimmedName,
          description: description.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to save changes')
      onSaved()
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!saving) onOpenChange(v) }}>
      <DialogContent className="bg-surface-card text-ink-secondary sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-ink">Edit project</DialogTitle>
          <DialogDescription className="text-ink-supporting">
            Update the project name or description. Type and status are unchanged.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-1">
          <div className="space-y-1.5">
            <label htmlFor="edit-project-name" className="block text-sm font-semibold text-ink-secondary">
              Name
            </label>
            <input
              id="edit-project-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              className="h-11 w-full rounded-lg border border-surface-border-strong px-3 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-project-description" className="block text-sm font-semibold text-ink-secondary">
              Description <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="edit-project-description"
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
              onClick={() => { if (!saving) onOpenChange(false) }}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-supporting transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <WorkflowButton
              type="submit"
              selected
              disabled={saving}
              className="rounded-lg px-5 text-sm font-semibold"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {saving ? 'Saving...' : 'Save changes'}
            </WorkflowButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
