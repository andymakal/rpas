'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, Plus, X, ShieldAlert, ArrowUpDown } from 'lucide-react'
import { ROLE_OPTIONS, roleLabel } from '@/lib/projects/project-roles'

/** Mirrors ProjectPerson / RosterMember from '@/lib/projects/team' (serialized). */
type Person = {
  producerId: string
  name: string
  note: string | null
  role?: string | null
  isLifeLicensed?: boolean | null
  tier?: number
}
type RosterMember = { producerId: string; name: string; title: string | null }
type Team = { participants: Person[]; escalation: Person[] }

/**
 * Project TEAM section — add / edit / remove project participants, assign each
 * participant's project RESPONSIBILITY, and set the ordered OPERATIONS
 * ESCALATION path. Rendered on the project overview, read-only when the project
 * is archived.
 *
 * A project responsibility describes what a participant is responsible for on
 * this project. It is deliberately distinct from the producer's job title,
 * their licensing facts, and their capability / work-routing assignments — this
 * section changes none of those. Escalation is the ordered exception path
 * (tier 1 = first destination), not an approval step on routine work.
 */
export function ProjectTeamClient({
  projectId,
  readOnly,
}: {
  projectId: string
  readOnly: boolean
}) {
  const [team, setTeam] = useState<Team>({ participants: [], escalation: [] })
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Add-participant form state.
  const [addProducerId, setAddProducerId] = useState('')
  const [addRole, setAddRole] = useState('')

  // Add-escalation form state.
  const [escProducerId, setEscProducerId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/team`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok) {
        setTeam(json.data.team as Team)
        setRoster(json.data.roster as RosterMember[])
      } else {
        setMsg(json.error ?? 'Could not load the team.')
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const post = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setMsg(json.error ?? 'Could not update the team.'); return false }
      setTeam(json.data.team as Team)
      setRoster(json.data.roster as RosterMember[])
      return true
    } catch {
      setMsg('Network error.')
      return false
    } finally {
      setBusy(false)
    }
  }, [projectId])

  const onTeam = new Set(team.participants.map((p) => p.producerId))
  const addable = roster.filter((r) => !onTeam.has(r.producerId))
  const inEscalation = new Set(team.escalation.map((e) => e.producerId))
  // Escalation contacts are drawn from the team, not an outside directory.
  const escalatable = team.participants.filter((p) => !inEscalation.has(p.producerId))
  const nextTier = team.escalation.reduce((max, e) => Math.max(max, e.tier ?? 0), 0) + 1

  async function handleAddParticipant() {
    if (!addProducerId) return
    const ok = await post({
      action: 'upsert-participant',
      producer_id: addProducerId,
      role: addRole || null,
    })
    if (ok) { setAddProducerId(''); setAddRole('') }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-teal-700" aria-hidden />
        <h2 className="text-lg font-semibold text-ink">Team</h2>
      </div>
      <p className="max-w-3xl text-sm text-ink-secondary">
        Who is on this project and what they are responsible for. A project responsibility is
        separate from a person&apos;s job title, licensing, and work routing — adding someone here
        changes no work assignment. The escalation path is the ordered destination for operational
        exceptions, not an approval step on routine work.
      </p>

      {loading ? (
        <p className="text-sm text-ink-supporting">Loading team…</p>
      ) : (
        <>
          {/* Participants + responsibilities */}
          <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
            {team.participants.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-supporting">
                No team members yet.{readOnly ? '' : ' Add one below.'}
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {team.participants.map((p) => {
                  const licensing = licensingNote(p.role ?? null, p.isLifeLicensed ?? null)
                  return (
                    <li key={p.producerId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <span className="font-medium text-ink">{p.name}</span>
                        {p.role ? (
                          <span className="text-ink-supporting"> — {roleLabel(p.role)}</span>
                        ) : p.note ? (
                          <span className="text-ink-supporting"> — {p.note}</span>
                        ) : (
                          <span className="text-ink-muted"> — no responsibility set</span>
                        )}
                        {/* Licensing is a separate parenthetical, never folded into the responsibility. */}
                        {licensing && <span className="text-ink-muted"> ({licensing})</span>}
                      </div>

                      {!readOnly && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-ink-supporting">
                            Responsibility
                            <select
                              className="ml-2 rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-sm text-ink disabled:opacity-50"
                              value={p.role ?? ''}
                              disabled={busy}
                              onChange={(e) => void post({
                                action: 'upsert-participant',
                                producer_id: p.producerId,
                                role: e.target.value || null,
                              })}
                            >
                              <option value="">(none)</option>
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void post({ action: 'remove-participant', producer_id: p.producerId })}
                            className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-50"
                          >
                            <X className="size-3.5" aria-hidden /> Remove
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Add a team member */}
          {!readOnly && addable.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink"
                value={addProducerId}
                disabled={busy}
                onChange={(e) => setAddProducerId(e.target.value)}
              >
                <option value="">Add a team member…</option>
                {addable.map((r) => (
                  <option key={r.producerId} value={r.producerId}>
                    {r.name}{r.title ? ` — ${r.title}` : ''}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink"
                value={addRole}
                disabled={busy || !addProducerId}
                onChange={(e) => setAddRole(e.target.value)}
              >
                <option value="">Responsibility (optional)…</option>
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !addProducerId}
                onClick={() => void handleAddParticipant()}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-teal-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden /> Add
              </button>
            </div>
          )}

          {/* Operations escalation path */}
          <div className="pt-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-teal-700" aria-hidden />
              <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-supporting">
                Operations escalation path (exceptions only)
              </h3>
            </div>

            <div className="mt-2 overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
              {team.escalation.length === 0 ? (
                <p className="px-5 py-5 text-sm text-ink-supporting">
                  No escalation contact set.{readOnly ? '' : ' Choose a team member below as the first escalation contact.'}
                </p>
              ) : (
                <ol className="divide-y divide-surface-border">
                  {team.escalation.map((e) => (
                    <li key={e.producerId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <span className="flex items-center gap-3">
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-wash text-xs font-semibold text-brand-hover">
                          {e.tier}
                        </span>
                        <span className="font-medium text-ink">{e.name}</span>
                        {e.tier === 1 && (
                          <span className="rounded-full border border-surface-border px-2 py-0.5 text-xs text-ink-supporting">
                            First contact
                          </span>
                        )}
                      </span>

                      {!readOnly && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-ink-supporting">
                            Tier
                            <input
                              type="number"
                              min={1}
                              className="ml-2 w-16 rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-sm text-ink disabled:opacity-50"
                              defaultValue={e.tier}
                              disabled={busy}
                              onBlur={(ev) => {
                                const t = Number(ev.target.value)
                                if (Number.isInteger(t) && t >= 1 && t !== e.tier) {
                                  void post({ action: 'set-escalation', producer_id: e.producerId, tier: t })
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void post({ action: 'remove-escalation', producer_id: e.producerId })}
                            className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-50"
                          >
                            <X className="size-3.5" aria-hidden /> Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Add an escalation contact (from the team) */}
            {!readOnly && escalatable.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <select
                  className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink"
                  value={escProducerId}
                  disabled={busy}
                  onChange={(e) => setEscProducerId(e.target.value)}
                >
                  <option value="">Add an escalation contact…</option>
                  {escalatable.map((p) => (
                    <option key={p.producerId} value={p.producerId}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !escProducerId}
                  onClick={async () => {
                    const ok = await post({ action: 'set-escalation', producer_id: escProducerId, tier: nextTier })
                    if (ok) setEscProducerId('')
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  <ArrowUpDown className="size-4" aria-hidden /> Add at tier {nextTier}
                </button>
              </div>
            )}
          </div>

          {msg && <p className="text-sm font-medium text-amber-700">{msg}</p>}
        </>
      )}
    </section>
  )
}

/**
 * A small, derived licensing annotation shown beside a participant's
 * responsibility — a QUALIFICATION fact, kept distinct from the responsibility
 * label itself. Mirrors the My Projects treatment so the two surfaces read the
 * same.
 */
function licensingNote(role: string | null, isLifeLicensed: boolean | null): string | null {
  if (isLifeLicensed === true) return 'life licensed'
  if (role === 'underwriting_support') return 'licensing unconfirmed'
  return null
}
