'use client'

/**
 * Verify Servicing Agent — the HOST for the VerifyServicingAgentCard Lego.
 *
 * This thin host owns only the data wiring: it fetches the project's
 * Everlake-eligible policy worklist, tracks which policy is current, persists
 * each answer, and advances. All of the card behavior (copy, Yes/No toggles,
 * commit gating, mentoring, the count-down display) lives in the Lego, so the
 * same card can be reused on any other surface by giving it a different host.
 *
 * SHARED-WORKLIST FRESHNESS: the worklist is RE-FETCHED from the server after
 * every recorded answer and every skip, so two operators working the same
 * project (the normal case — a couple of people clearing a batch at project
 * start) always advance against the LIVE set. Without this, each client would
 * walk its own stale in-memory copy and re-check policies a teammate already
 * did. The write itself is a per-policy last-write-wins update, so a rare
 * same-instant collision is harmless (a factual lookup has one answer); the
 * re-fetch simply keeps the wasted-effort window down to effectively nothing.
 * We deliberately do NOT add a per-policy claim/lock: for a ~5-second factual
 * lookup done once at project start, a locking subsystem is not worth it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { WorkflowButton, VerifyServicingAgentCard } from '@/components/workflow'

type Policy = { id: string; policy_number: string | null; sa_status: string }

export function VerifyServicingAgentClient({ projectId }: { projectId: string }) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  // Policies this operator chose to Skip this session, so a re-fetch lands on
  // the NEXT unskipped policy rather than snapping back to a skipped one. Skips
  // are session-local (not persisted); a reload of the page clears them.
  const skipped = useRef<Set<string>>(new Set())

  // Fetch the live worklist. `quiet` re-fetches WITHOUT the full-screen loading
  // state (used between policies, so the card doesn't flash). It then points the
  // cursor at the first still-unknown, not-skipped policy — which reflects every
  // operator's saves, because the server returns live sa_status.
  const fetchList = useCallback(async (quiet: boolean) => {
    if (!quiet) setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/verify-servicing-agent`)
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json.error ?? 'Could not load the policies to verify.')
        if (!quiet) setLoading(false)
        return
      }
      const list: Policy[] = (json.data?.policies ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        policy_number: (p.policy_number as string | null) ?? null,
        sa_status: (p.sa_status as string | null) ?? 'unknown',
      }))
      setPolicies(list)
      // Land on the first unknown policy this operator hasn't skipped this
      // session; fall back to any unknown if every remaining one was skipped.
      const nextUnskipped = list.find((p) => p.sa_status === 'unknown' && !skipped.current.has(p.id))
      const anyUnknown = list.find((p) => p.sa_status === 'unknown')
      setCurrentId((nextUnskipped ?? anyUnknown)?.id ?? null)
    } catch {
      setLoadError('Could not reach the server to load the policies.')
    }
    if (!quiet) setLoading(false)
  }, [projectId])

  useEffect(() => { void fetchList(false) }, [fetchList])

  const current = useMemo(
    () => policies.find((p) => p.id === currentId) ?? null,
    [policies, currentId],
  )
  const remaining = useMemo(
    () => policies.filter((p) => p.sa_status === 'unknown').length,
    [policies],
  )

  // Skip: remember it for this session and re-fetch so the next policy reflects
  // the live set (a teammate may have cleared several since this list loaded).
  const skip = useCallback(() => {
    if (currentId) skipped.current.add(currentId)
    void fetchList(true)
  }, [currentId, fetchList])

  const record = useCallback(async (isServicingAgent: boolean) => {
    if (!current) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/verify-servicing-agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_id: current.id, is_servicing_agent: isServicingAgent }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json.error ?? 'Could not record the result.')
        setBusy(false)
        return
      }
      setBusy(false)
      // Re-fetch the LIVE worklist so the count and the next policy reflect this
      // save AND any a teammate recorded meanwhile. This is the shared-worklist
      // freshness guarantee: no stale in-memory walk.
      await fetchList(true)
    } catch {
      setSaveError('Could not reach the server to record the result.')
      setBusy(false)
    }
  }, [current, projectId, fetchList])

  if (loading) {
    return <p className="text-base text-ink-supporting">Loading policies…</p>
  }
  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-base text-status-missing-strong">{loadError}</p>
        <WorkflowButton onClick={() => void fetchList(false)}>Try again</WorkflowButton>
      </div>
    )
  }

  const nothingToDo = policies.length === 0
  const allDone = remaining === 0 && policies.length > 0

  return (
    <div className="max-w-2xl space-y-4">
      {nothingToDo ? (
        <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center">
          <p className="text-base text-ink-supporting">No policies to verify in this project.</p>
        </div>
      ) : allDone ? (
        <div className="rounded-2xl border border-status-confirmed-border bg-status-confirmed-soft p-8 text-center">
          <CircleCheck className="mx-auto mb-2 size-8 text-teal-700" aria-hidden />
          <p className="text-lg font-semibold text-ink">All policies verified.</p>
          <p className="mt-1 text-sm text-ink-secondary">Every policy in this project has been checked.</p>
        </div>
      ) : current ? (
        <VerifyServicingAgentCard
          policyNumber={current.policy_number}
          remaining={remaining}
          busy={busy}
          errorText={saveError}
          onRecord={(isSA) => void record(isSA)}
          onSkip={skip}
        />
      ) : null}
    </div>
  )
}
