'use client'

/**
 * Verify Servicing Agent — the HOST for the VerifyServicingAgentCard Lego.
 *
 * This thin host owns only the data wiring: it fetches the project's
 * Everlake-eligible policy worklist, tracks which policy is current, persists
 * each answer, and advances. All of the card behavior (copy, Yes/No toggles,
 * commit gating, mentoring, the count-down display) lives in the Lego, so the
 * same card can be reused on any other surface by giving it a different host.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { WorkflowButton, VerifyServicingAgentCard } from '@/components/workflow'

type Policy = { id: string; policy_number: string | null; sa_status: string }

export function VerifyServicingAgentClient({ projectId }: { projectId: string }) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/verify-servicing-agent`)
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json.error ?? 'Could not load the policies to verify.')
        setLoading(false)
        return
      }
      const list: Policy[] = (json.data?.policies ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        policy_number: (p.policy_number as string | null) ?? null,
        sa_status: (p.sa_status as string | null) ?? 'unknown',
      }))
      setPolicies(list)
      const firstUnknown = list.findIndex((p) => p.sa_status === 'unknown')
      setCursor(firstUnknown >= 0 ? firstUnknown : 0)
    } catch {
      setLoadError('Could not reach the server to load the policies.')
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const current = policies[cursor] ?? null
  const remaining = useMemo(
    () => policies.filter((p) => p.sa_status === 'unknown').length,
    [policies],
  )

  // Advance to the next still-unknown policy; wrap to an earlier one so a
  // skipped policy resurfaces, and land past the end when all are done.
  const advance = useCallback(() => {
    setSaveError(null)
    setPolicies((list) => {
      const after = list.findIndex((p, i) => i > cursor && p.sa_status === 'unknown')
      if (after >= 0) { setCursor(after); return list }
      const anyUnknown = list.findIndex((p) => p.sa_status === 'unknown')
      setCursor(anyUnknown >= 0 ? anyUnknown : list.length)
      return list
    })
  }, [cursor])

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
      const nextStatus = json.data?.sa_status ?? (isServicingAgent ? 'confirmed' : 'not_on_file')
      setPolicies((list) => list.map((p) => (p.id === current.id ? { ...p, sa_status: nextStatus } : p)))
      setBusy(false)
      advance()
    } catch {
      setSaveError('Could not reach the server to record the result.')
      setBusy(false)
    }
  }, [current, projectId, advance])

  if (loading) {
    return <p className="text-base text-ink-supporting">Loading policies…</p>
  }
  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-base text-status-missing-strong">{loadError}</p>
        <WorkflowButton onClick={() => void load()}>Try again</WorkflowButton>
      </div>
    )
  }

  const allDone = remaining === 0 && policies.length > 0
  const nothingToDo = policies.length === 0

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
          onSkip={advance}
        />
      ) : null}
    </div>
  )
}
