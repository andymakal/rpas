'use client'

/**
 * Verify Servicing Agent — step 1 of servicing-agent capture.
 *
 * Works the project's Everlake-eligible policies one at a time with the same
 * copy -> search -> record rhythm operators already use in Contact Research. The
 * operator copies the policy number, pastes it into the Everlake Agent Portal
 * Contract Look-Up, hits Search, then records the answer here:
 *   - found a contract  -> Yes, we are the servicing agent   (sa_status confirmed)
 *   - "couldn't find a contract with that number" -> No, not  (sa_status not_on_file)
 * Skip leaves a policy unresolved and moves on. A progress line shows how many
 * of the project's eligible policies have been checked.
 *
 * Only Everlake carriers (Allstate family, Lincoln Benefit Life, Everlake)
 * appear; the server filters the worklist, so a non-Everlake policy is never
 * presented for an Everlake lookup. Nothing here is shown as the raw
 * "not_on_file" literal — the operator sees plain language.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy, Check, SkipForward, CircleCheck, CircleX, ExternalLink,
} from 'lucide-react'
import {
  WorkflowButton, ActionPanel, NextNote, Divider, OperationalTag,
} from '@/components/workflow'

type Policy = {
  id: string
  policy_number: string | null
  carrier: string | null
  product_type: string | null
  coverage_status: string | null
  insured_name: string | null
  customer_id: string
  customer_name: string | null
  sa_status: string
}

type Summary = { total: number; verified: number; remaining: number }

const EVERLAKE_PORTAL_URL = 'https://myaccount.everlake.com/'

export function VerifyServicingAgentClient({ projectId }: { projectId: string }) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, verified: 0, remaining: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The index of the policy currently being worked within the live list. The
  // list is ordered unchecked-first by the server, so we walk from the first
  // still-unknown policy forward.
  const [cursor, setCursor] = useState(0)

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
      const list: Policy[] = json.data?.policies ?? []
      setPolicies(list)
      setSummary(json.data?.summary ?? { total: 0, verified: 0, remaining: 0 })
      // Start on the first unchecked policy.
      const firstUnknown = list.findIndex((p) => p.sa_status === 'unknown')
      setCursor(firstUnknown >= 0 ? firstUnknown : 0)
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

  // Advance to the next still-unknown policy after the current one; wrap to any
  // earlier unknown so skipped items resurface, and land past the end when all
  // are done.
  const advance = useCallback(() => {
    setCopied(false)
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
      // Update the worked policy in place and bump the summary, then advance.
      setPolicies((list) => list.map((p) => (p.id === current.id ? { ...p, sa_status: nextStatus } : p)))
      setSummary((s) => ({ ...s, verified: s.verified + 1, remaining: Math.max(0, s.remaining - 1) }))
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
  if (summary.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-surface-border-strong bg-surface-card p-8 text-center">
        <p className="text-base text-ink-supporting">
          No Everlake policies to verify in this project. Only Allstate, Lincoln Benefit Life, and
          Everlake policies are checked in the Everlake portal.
        </p>
      </div>
    )
  }

  const allDone = remainingUnknown === 0

  return (
    <div className="max-w-2xl space-y-4">
      {/* Progress */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink-secondary">
          <span className="tabular-nums font-semibold text-ink">{summary.verified}</span> of{' '}
          <span className="tabular-nums font-semibold text-ink">{summary.total}</span> verified
          {summary.remaining > 0 && (
            <span className="text-ink-supporting"> · {summary.remaining} to go</span>
          )}
        </p>
        <a
          href={EVERLAKE_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
        >
          <ExternalLink className="size-4" aria-hidden /> Open Everlake portal
        </a>
      </div>

      {allDone ? (
        <div className="rounded-2xl border border-status-confirmed-border bg-status-confirmed-soft p-8 text-center">
          <CircleCheck className="mx-auto mb-2 size-8 text-teal-700" aria-hidden />
          <p className="text-lg font-semibold text-ink">All eligible policies verified.</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Every Everlake policy in this project has been checked. Policies where we are not the
            servicing agent are now ready for capture outreach.
          </p>
        </div>
      ) : current ? (
        <ActionPanel>
          {/* Whose policy, for context. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink">
              {current.customer_name ?? current.insured_name ?? 'Customer'}
            </span>
            {current.carrier && (
              <OperationalTag tone="info">{current.carrier}</OperationalTag>
            )}
            {current.product_type && (
              <span className="text-sm text-ink-supporting">{current.product_type}</span>
            )}
          </div>

          <p className="text-sm text-ink-supporting">
            Copy the policy number, search it in the Everlake portal Contract Look-Up, then record
            whether a contract was found.
          </p>

          {/* The policy number + Copy — the Search Gateway pattern. */}
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

          {/* The result: Are we the servicing agent? Yes / No, then Skip. */}
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-supporting">
            Are we the servicing agent?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <WorkflowButton
              icon={CircleCheck}
              disabled={busy}
              className="w-full justify-center"
              onClick={() => void record(true)}
            >
              Yes, we are
            </WorkflowButton>
            <WorkflowButton
              icon={CircleX}
              disabled={busy}
              className="w-full justify-center"
              onClick={() => void record(false)}
            >
              No, not on file
            </WorkflowButton>
          </div>

          <div className="flex justify-end">
            <WorkflowButton icon={SkipForward} disabled={busy} onClick={advance}>
              Skip for now
            </WorkflowButton>
          </div>

          {saveError && <p className="text-sm text-status-missing-strong">{saveError}</p>}

          <NextNote>
            “No” records that we are not the servicing agent and moves this policy into capture
            outreach. “Yes” records that we already have access, so no capture is needed.
          </NextNote>
        </ActionPanel>
      ) : null}
    </div>
  )
}
