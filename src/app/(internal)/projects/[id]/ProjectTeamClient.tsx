'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, Plus, X, ShieldAlert } from 'lucide-react'
import {
  ROLE_OPTIONS,
  roleLabel,
  OPERATIONS_ESCALATION_LABEL,
  type ProjectRole,
} from '@/lib/projects/project-roles'

/** Mirrors ProjectPerson / RosterMember from '@/lib/projects/team' (serialized). */
type Person = {
  producerId: string
  name: string
  note: string | null
  roles: string[]
  isLifeLicensed?: boolean | null
  escalationTier?: number | null
  tier?: number
}
type RosterMember = { producerId: string; name: string; title: string | null }
type Team = { participants: Person[]; escalation: Person[] }

/**
 * Project TEAM section — add / edit / remove project participants, assign each
 * participant's project RESPONSIBILITIES (any combination), and set the ordered
 * OPERATIONS ESCALATION path. Rendered on the project overview, read-only when
 * the project is archived.
 *
 * Responsibilities are independent choices (checkboxes): a person can be both
 * Project owner AND Operations manager AND Producer. A project responsibility is
 * distinct from the producer's job title, licensing facts, and capability /
 * work-routing assignments — this section changes none of those.
 *
 * "Operations escalation" is NOT a plain checkbox-role: it is the escalation
 * path (project_escalation_contacts, tier 1 = first destination), the single
 * source of truth. The escalation checkbox adds/removes the person on that path;
 * the badge is derived from it.
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

  const [addProducerId, setAddProducerId] = useState('')

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
  const nextTier = team.escalation.reduce((max, e) => Math.max(max, e.tier ?? 0), 0) + 1

  /** Toggle one responsibility for a participant, saving the full new set. */
  async function toggleRole(p: Person, role: ProjectRole, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...p.roles, role]))
      : p.roles.filter((r) => r !== role)
    await post({ action: 'upsert-participant', producer_id: p.producerId, roles: next })
  }

  /** Toggle the person on the escalation path. On -> place at the first open
   * tier (tier 1 when the path is empty); off -> remove from the path. */
  async function toggleEscalation(p: Person, checked: boolean) {
    if (checked) {
      const tier = team.escalation.length === 0 ? 1 : nextTier
      await post({ action: 'set-escalation', producer_id: p.producerId, tier })
    } else {
      await post({ action: 'remove-escalation', producer_id: p.producerId })
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-teal-700" aria-hidden />
        <h2 className="text-lg font-semibold text-ink">Team</h2>
      </div>
      <p className="max-w-3xl text-sm text-ink-secondary">
        Who is on this project and what they are responsible for. A person can hold any combination
        of responsibilities. These are project responsibilities, separate from a person&apos;s job
        title, licensing, and work routing — editing the team changes no work assignment. The
        escalation path is the ordered destination for operational exceptions, not an approval step
        on routine work.
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
                  const licensing = licensingNote(p.roles, p.isLifeLicensed ?? null)
                  const onEscalation = (p.escalationTier ?? null) !== null
                  const summary = responsibilitySummary(p.roles, p.escalationTier ?? null)
                  return (
                    <li key={p.producerId} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-medium text-ink">{p.name}</span>
                          {summary ? (
                            <span className="text-ink-supporting"> — {summary}</span>
                          ) : (
                            <span className="text-ink-muted"> — no responsibilities set</span>
                          )}
                          {/* Licensing is a separate parenthetical, never folded in. */}
                          {licensing && <span className="text-ink-muted"> ({licensing})</span>}
                        </div>

                        {!readOnly && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void post({ action: 'remove-participant', producer_id: p.producerId })}
                            className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-50"
                          >
                            <X className="size-3.5" aria-hidden /> Remove
                          </button>
                        )}
                      </div>

                      {!readOnly && (
                        <fieldset className="mt-3" disabled={busy}>
                          <legend className="sr-only">Responsibilities for {p.name}</legend>
                          <div className="flex flex-wrap gap-x-5 gap-y-2">
                            {ROLE_OPTIONS.map((o) => (
                              <label key={o.value} className="inline-flex items-center gap-2 text-sm text-ink-secondary">
                                <input
                                  type="checkbox"
                                  className="size-4 rounded border-surface-border-strong text-brand focus:ring-brand/30 disabled:opacity-50"
                                  checked={p.roles.includes(o.value)}
                                  onChange={(e) => void toggleRole(p, o.value, e.target.checked)}
                                />
                                {o.label}
                              </label>
                            ))}
                            {/* Escalation is wired to the escalation path, not a stored role. */}
                            <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-secondary">
                              <input
                                type="checkbox"
                                className="size-4 rounded border-surface-border-strong text-brand focus:ring-brand/30 disabled:opacity-50"
                                checked={onEscalation}
                                onChange={(e) => void toggleEscalation(p, e.target.checked)}
                              />
                              Operations escalation
                              <span className="text-ink-muted">(exception path)</span>
                            </label>
                          </div>
                        </fieldset>
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
              <button
                type="button"
                disabled={busy || !addProducerId}
                onClick={async () => {
                  // Add with no responsibilities yet; they are chosen via the
                  // checkboxes on the new row.
                  const ok = await post({ action: 'upsert-participant', producer_id: addProducerId, roles: [] })
                  if (ok) setAddProducerId('')
                }}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-teal-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden /> Add
              </button>
            </div>
          )}

          {/* Operations escalation path (ordered, derived from the path rows) */}
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
                  No escalation contact set.{readOnly ? '' : ' Check “Operations escalation” on a team member above to set the first contact.'}
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
          </div>

          {msg && <p className="text-sm font-medium text-amber-700">{msg}</p>}
        </>
      )}
    </section>
  )
}

/**
 * The comma-joined responsibility labels for a participant, with the derived
 * "Operations escalation" badge appended (and tier when it is not the first
 * contact) so the escalation fact reads alongside the stored responsibilities.
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
 * responsibilities — a QUALIFICATION fact, kept distinct from the responsibility
 * labels. Mirrors the My Projects treatment.
 */
function licensingNote(roles: string[], isLifeLicensed: boolean | null): string | null {
  if (isLifeLicensed === true) return 'life licensed'
  if (roles.includes('underwriting_support')) return 'licensing unconfirmed'
  return null
}
