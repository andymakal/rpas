'use client'

/**
 * Verify Servicing Agent — step 1 of servicing-agent capture.
 *
 * Works the project's Everlake-eligible policies one at a time. The operator
 * copies the policy number, pastes it into the Everlake Agent Portal Contract
 * Look-Up, searches, then records whether we are the servicing agent:
 *   - we are      -> sa_status 'confirmed'
 *   - we are not  -> sa_status 'not_on_file'
 *
 * The card is deliberately minimal. Yes/No are TOGGLES: clicking selects (and
 * clicking again clears), and the choice is switchable, so nothing commits on a
 * stray click. Only Done (grayed until a choice is made) records the answer, so
 * an accidental "No" on a policy we actually service can never be saved. The
 * how-to instructions live in the mentoring cap, not as always-on body text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Check, SkipForward, CircleCheck, CircleX, PenLine } from 'lucide-react'
import {
  WorkflowButton, ActionPanel, Divider, CallMentorCap,
} from '@/components/workflow'

type Policy = {
  id: string
  policy_number: string | null
  sa_status: string
}

type Summary = { total: number; verified: number; remaining: number }

type Choice = 'yes' | 'no' | null

export function VerifyServicingAgentClient({ projectId }: { projectId: string }) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, verified: 0, remaining: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The current policy index, and the operator's not-yet-committed choice for it.
  const [cursor, setCursor] = useState(0)
  const [choice, setChoice] = useState<Choice>(null)

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

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
      setSummary(json.data?.summary ?? { total: 0, verified: 0, remaining: 0 })
      const firstUnknown = list.findIndex((p) => p.sa_status === 'unknown')
      setCursor(firstUnknown >= 0 ? firstUnknown : 0)
      setChoice(null)
    } catch {
      setLoadError('Could not reach the server to load the policies.')
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const current = policies[cursor] ?? null
  const remainingUnknown = useMemo(
    () => policies.filter((p) => p.sa_status === 'unknown').length,
    [policies],
  )

  const copyNumber = useCallback((value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }, [])

  // Advance to the next still-unknown policy; wrap to an earlier unknown so a
  // skipped one resurfaces, and land past the end when all are done. Clears the
  // pending choice and the copied flag for the new policy.
  const advance = useCallback(() => {
    setCopied(false)
    setSaveError(null)
    setChoice(null)
    setPolicies((list) => {
      const after = list.findIndex((p, i) => i > cursor && p.sa_status === 'unknown')
      if (after >= 0) { setCursor(after); return list }
      const anyUnknown = list.findIndex((p) => p.sa_status === 'unknown')
      setCursor(anyUnknown >= 0 ? anyUnknown : list.length)
      return list
    })
  }, [cursor])

  // Commit the pending choice (only reachable via Done, which is disabled until
  // a choice exists). Records once, then advances.
  const commit = useCallback(async () => {
    if (!current || choice === null) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/verify-servicing-agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_id: current.id, is_servicing_agent: choice === 'yes' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json.error ?? 'Could not record the result.')
        setBusy(false)
        return
      }
      const nextStatus = json.data?.sa_status ?? (choice === 'yes' ? 'confirmed' : 'not_on_file')
      setPolicies((list) => list.map((p) => (p.id === current.id ? { ...p, sa_status: nextStatus } : p)))
      setSummary((s) => ({ ...s, verified: s.verified + 1, remaining: Math.max(0, s.remaining - 1) }))
      setBusy(false)
      advance()
    } catch {
      setSaveError('Could not reach the server to record the result.')
      setBusy(false)
    }
  }, [current, choice, projectId, advance])

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
  if (summary.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center">
        <p className="text-base text-ink-supporting">
          No policies to verify in this project.
        </p>
      </div>
    )
  }

  const allDone = remainingUnknown === 0

  return (
    <div className="max-w-2xl space-y-4">
      {allDone ? (
        <div className="rounded-2xl border border-status-confirmed-border bg-status-confirmed-soft p-8 text-center">
          <CircleCheck className="mx-auto mb-2 size-8 text-teal-700" aria-hidden />
          <p className="text-lg font-semibold text-ink">All policies verified.</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Every policy in this project has been checked.
          </p>
        </div>
      ) : current ? (
        <ActionPanel>
          {/* Title + mentoring. The how-to lives in the cap, opened on demand;
              progress sits on the heading line. */}
          <CallMentorCap heading="Verify servicing agent">
            Copy the policy number, search it in the Everlake Agent Portal Contract Look-Up, then
            record whether a contract was found. If a contract comes up we are the servicing agent;
            if Everlake can’t find it, we are not.
          </CallMentorCap>

          <p className="text-sm font-medium text-ink-secondary">
            <span className="tabular-nums font-semibold text-ink">{summary.verified}</span> of{' '}
            <span className="tabular-nums font-semibold text-ink">{summary.total}</span> verified
          </p>

          {/* Policy number + Copy. */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-muted/40 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-supporting">
                Policy number
              </p>
              <span className="font-mono text-2xl font-semibold text-ink">
                {current.policy_number ?? '—'}
              </span>
            </div>
            <WorkflowButton
              icon={copied ? Check : Copy}
              selected={copied}
              onClick={() => copyNumber(current.policy_number ?? '')}
              disabled={!current.policy_number}
            >
              {copied ? 'Copied' : 'Copy'}
            </WorkflowButton>
          </div>

          <Divider className="my-2" />

          {/* The question. Yes/No are toggles: click selects, click again clears,
              switchable. Nothing is recorded here — only Done commits. */}
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">
            Are we the servicing agent?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <WorkflowButton
              icon={CircleCheck}
              selected={choice === 'yes'}
              disabled={busy}
              className="w-full justify-center"
              onClick={() => setChoice((c) => (c === 'yes' ? null : 'yes'))}
            >
              Yes, we are
            </WorkflowButton>
            <WorkflowButton
              icon={CircleX}
              selected={choice === 'no'}
              disabled={busy}
              className="w-full justify-center"
              onClick={() => setChoice((c) => (c === 'no' ? null : 'no'))}
            >
              No, we are not
            </WorkflowButton>
          </div>

          {/* Done commits the selected answer (grayed until a choice is made);
              Skip for now leaves it unresolved and moves on. */}
          <div className="grid grid-cols-2 gap-2">
            <WorkflowButton
              icon={PenLine}
              selected
              disabled={busy || choice === null}
              className="w-full justify-center"
              onClick={() => void commit()}
            >
              {busy ? 'Saving…' : 'Done'}
            </WorkflowButton>
            <WorkflowButton
              icon={SkipForward}
              disabled={busy}
              className="w-full justify-center"
              onClick={advance}
            >
              Skip for now
            </WorkflowButton>
          </div>

          {saveError && <p className="text-sm text-status-missing-strong">{saveError}</p>}
        </ActionPanel>
      ) : null}
    </div>
  )
}
