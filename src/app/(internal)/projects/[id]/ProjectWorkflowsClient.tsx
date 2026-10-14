'use client'

import { useCallback, useEffect, useState } from 'react'
import { GitBranch, Plus, X, ArrowDown } from 'lucide-react'

/** Mirrors ProjectWorkflow from '@/lib/projects/workflows' (serialized). */
type ProjectWorkflow = {
  id: string
  workflowId: string
  key: string
  name: string
  completionMode: 'automatic' | 'manual'
  position: number
  gatedByProjectWorkflowId: string | null
}
type CatalogWorkflow = {
  id: string
  key: string
  name: string
  description: string | null
  completionMode: 'automatic' | 'manual'
}

/**
 * Project workflow configuration — the smallest sufficient interface to SELECT
 * reusable workflows for a project and wire which ones GATE others. Rendered on
 * the project detail page (reusing its surface), read-only when the project is
 * archived.
 *
 * A project's behavior comes from the workflows it contains and how they are
 * gated here — never from the project's name or type.
 */
export function ProjectWorkflowsClient({
  projectId,
  readOnly,
}: {
  projectId: string
  readOnly: boolean
}) {
  const [selected, setSelected] = useState<ProjectWorkflow[]>([])
  const [catalog, setCatalog] = useState<CatalogWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [addKey, setAddKey] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/workflows`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok) {
        setSelected(json.data.selected as ProjectWorkflow[])
        setCatalog(json.data.catalog as CatalogWorkflow[])
        // The catalog is empty only when the workflow tables are not present yet
        // (migration not applied). Surface that honestly rather than an empty UI.
        setUnavailable((json.data.catalog as CatalogWorkflow[]).length === 0 && (json.data.selected as ProjectWorkflow[]).length === 0)
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setMsg(json.error ?? 'Could not update workflows.'); return }
      setSelected(json.data.selected as ProjectWorkflow[])
      setCatalog(json.data.catalog as CatalogWorkflow[])
    } catch {
      setMsg('Network error.')
    } finally {
      setBusy(false)
    }
  }, [projectId])

  const selectedWorkflowIds = new Set(selected.map(w => w.workflowId))
  const addable = catalog.filter(c => !selectedWorkflowIds.has(c.id))
  const byId = new Map(selected.map(w => [w.id, w]))

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <GitBranch className="size-5 text-teal-700" aria-hidden />
        <h2 className="text-lg font-semibold text-ink">Workflows</h2>
      </div>
      <p className="max-w-3xl text-sm text-ink-secondary">
        A project groups reusable workflows. Each member is evaluated against every workflow the
        project contains; a workflow can gate another so its members only start the gated work once
        the gating workflow is complete. The project&apos;s behavior comes from these workflows, not
        its name or type.
      </p>

      {loading ? (
        <p className="text-sm text-ink-supporting">Loading workflows…</p>
      ) : unavailable ? (
        <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-6 text-sm text-ink-supporting">
          Workflow configuration is not available yet in this environment (the workflow catalog has
          not been set up). Once it is, you can select workflows and set their dependencies here.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
            {selected.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-supporting">
                No workflows selected yet. Add one below to define what this project does.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {selected.map(w => {
                  const gate = w.gatedByProjectWorkflowId ? byId.get(w.gatedByProjectWorkflowId) : null
                  // A workflow may be gated by any OTHER selected workflow.
                  const gateOptions = selected.filter(o => o.id !== w.id)
                  return (
                    <li key={w.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-ink">{w.name}</span>
                            <span className="rounded-full border border-surface-border px-2 py-0.5 text-xs text-ink-supporting">
                              {w.completionMode === 'automatic' ? 'Auto-completes from facts' : 'Manual determination'}
                            </span>
                          </div>
                          {gate && (
                            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-secondary">
                              <ArrowDown className="size-3.5" aria-hidden />
                              Gated by <span className="font-medium">{gate.name}</span>
                            </p>
                          )}
                        </div>
                        {!readOnly && (
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-ink-supporting">
                              Gated by
                              <select
                                className="ml-2 rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-sm text-ink"
                                value={w.gatedByProjectWorkflowId ?? ''}
                                disabled={busy}
                                onChange={e => void post({
                                  action: 'set-gate',
                                  project_workflow_id: w.id,
                                  gated_by_workflow_id: e.target.value || null,
                                })}
                              >
                                <option value="">(nothing)</option>
                                {gateOptions.map(o => (
                                  <option key={o.id} value={o.id}>{o.name}</option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void post({ action: 'remove', project_workflow_id: w.id })}
                              className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
                            >
                              <X className="size-3.5" aria-hidden /> Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {!readOnly && addable.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink"
                value={addKey}
                disabled={busy}
                onChange={e => setAddKey(e.target.value)}
              >
                <option value="">Select a workflow to add…</option>
                {addable.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !addKey}
                onClick={async () => { await post({ action: 'add', workflow_id: addKey }); setAddKey('') }}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-teal-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden /> Add workflow
              </button>
            </div>
          )}

          {msg && <p className="text-sm font-medium text-amber-700">{msg}</p>}
        </>
      )}
    </section>
  )
}
