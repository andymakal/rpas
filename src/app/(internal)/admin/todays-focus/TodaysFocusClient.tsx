'use client'

/**
 * Today's Focus management surface (Right Path, light workflow theme).
 *
 * Lets management elevate a project or a single activity for a bounded period.
 * A focus is temporary by construction: management picks how long it lasts from
 * a few plain durations (1 Day, 2 Days, 1 Week) and the end time is calculated
 * automatically — no date/time picker. The API still enforces the temporariness
 * invariants server-side (future, and within the max window). Active focus is
 * listed with its end time and can be ended early. Setting focus feeds the
 * GoRules decision; it never disables other work.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Trash2, Clock } from 'lucide-react'
import { WorkflowPage, WorkflowHeader, WorkflowButton } from '@/components/workflow'

export type FocusFormOption = { id: string; label: string }
export type ActiveFocusRow = {
  id: string
  scope: 'project' | 'activity'
  label: string
  note: string | null
  expiresAt: string
}

/**
 * The duration choices for a focus. The end time is computed from the chosen
 * duration at submit, so management never touches a date/time picker. 1 Day is
 * the default (a focus is usually "today's"); 1 Week is the longest and stays
 * well within the server's maximum window.
 */
const DURATION_OPTIONS: { days: number; label: string }[] = [
  { days: 1, label: '1 Day' },
  { days: 2, label: '2 Days' },
  { days: 7, label: '1 Week' },
]
const DEFAULT_DURATION_DAYS = 1
const MS_PER_DAY = 86_400_000

/** The absolute end instant for a focus of the given whole-day duration. */
function expiresAtFromDuration(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString()
}

/** A plain preview of when a focus of the given duration will end, so the
 * calculated end time is visible before saving. */
function describeDurationEnd(days: number): string {
  return formatEnds(expiresAtFromDuration(days))
}

export function TodaysFocusClient({
  projectOptions,
  activityOptions,
  activeFocus,
}: {
  projectOptions: FocusFormOption[]
  activityOptions: FocusFormOption[]
  activeFocus: ActiveFocusRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [scope, setScope] = useState<'project' | 'activity'>('project')
  const [projectId, setProjectId] = useState('')
  const [activityId, setActivityId] = useState('')
  const [scopeProjectId, setScopeProjectId] = useState('') // optional project scope for an activity focus
  const [note, setNote] = useState('')
  const [durationDays, setDurationDays] = useState(DEFAULT_DURATION_DAYS)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    setMsg(null)
    const body: Record<string, unknown> = {
      scope,
      note: note.trim() || null,
      // The end time is calculated from the chosen duration (TypeScript owns the
      // time math); the server still validates it is future and within range.
      expires_at: expiresAtFromDuration(durationDays),
    }
    if (scope === 'project') {
      if (!projectId) { setMsg({ ok: false, text: 'Choose a project to elevate.' }); return }
      body.project_id = projectId
    } else {
      if (!activityId) { setMsg({ ok: false, text: 'Choose an activity to elevate.' }); return }
      body.work_function_id = activityId
      body.project_id = scopeProjectId || null
    }

    const res = await fetch('/api/todays-focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) { setMsg({ ok: false, text: json.error ?? 'Could not set focus.' }); return }
    setMsg({ ok: true, text: 'Focus set. It will influence recommendations until it expires.' })
    setNote('')
    startTransition(() => router.refresh())
  }

  async function end(id: string) {
    const res = await fetch(`/api/todays-focus?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) startTransition(() => router.refresh())
  }

  return (
    <WorkflowPage heading={<WorkflowHeader primary="Today's Focus" secondary="Temporary management direction" />}>
      <p className="max-w-prose text-sm leading-relaxed text-ink-secondary">
        Elevate a project or a single activity so it is recommended more
        prominently. Focus influences recommendations for a limited time; it does
        not disable other work, and it never overrides a customer commitment or a
        team member&apos;s eligibility. Choose how long it lasts; the end time is
        set automatically.
      </p>

      {/* Set a focus */}
      <section className="rounded-2xl border border-brand-subtle bg-surface-card p-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="size-4 text-brand-hover" aria-hidden /> Set a focus
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <WorkflowButton selected={scope === 'project'} onClick={() => setScope('project')}>
            Elevate a project
          </WorkflowButton>
          <WorkflowButton selected={scope === 'activity'} onClick={() => setScope('activity')}>
            Elevate an activity
          </WorkflowButton>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {scope === 'project' ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Project</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-sm text-ink focus:border-brand-ring focus:outline-none"
              >
                <option value="">Select a project…</option>
                {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Activity</span>
                <select
                  value={activityId}
                  onChange={(e) => setActivityId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-sm text-ink focus:border-brand-ring focus:outline-none"
                >
                  <option value="">Select an activity…</option>
                  {activityOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Scope to a project (optional)</span>
                <select
                  value={scopeProjectId}
                  onChange={(e) => setScopeProjectId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-sm text-ink focus:border-brand-ring focus:outline-none"
                >
                  <option value="">All work (agency-wide)</option>
                  {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </>
          )}

          <div className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">How long</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((d) => (
                <WorkflowButton
                  key={d.days}
                  selected={durationDays === d.days}
                  onClick={() => setDurationDays(d.days)}
                >
                  {d.label}
                </WorkflowButton>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-supporting">
              Ends {describeDurationEnd(durationDays)}. The end time is set automatically.
            </p>
          </div>

          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-supporting">Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this is the focus right now"
              className="mt-1 w-full rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-brand-ring focus:outline-none"
            />
          </label>
        </div>

        {msg && (
          <p className={`mt-3 text-sm ${msg.ok ? 'text-status-confirmed-strong' : 'text-tag-exception-text'}`}>{msg.text}</p>
        )}

        <div className="mt-4">
          <WorkflowButton icon={Sparkles} selected disabled={pending} onClick={submit}>
            {pending ? 'Saving…' : 'Set focus'}
          </WorkflowButton>
        </div>
      </section>

      {/* Active focus */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-supporting">Active focus</h2>
        {activeFocus.length === 0 ? (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-5 text-sm text-ink-secondary">
            No focus is set. Recommendations use their ordinary ordering.
          </div>
        ) : (
          <ul className="space-y-2">
            {activeFocus.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-subtle bg-surface-card p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {f.scope === 'project' ? 'Project' : 'Activity'}: {f.label}
                  </p>
                  {f.note && <p className="text-sm text-ink-secondary">{f.note}</p>}
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-supporting">
                    <Clock className="size-3.5" aria-hidden /> Ends {formatEnds(f.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => end(f.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-tag-exception-border hover:text-tag-exception-text"
                >
                  <Trash2 className="size-3.5" aria-hidden /> End now
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkflowPage>
  )
}

function formatEnds(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'soon'
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `today at ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`
}
