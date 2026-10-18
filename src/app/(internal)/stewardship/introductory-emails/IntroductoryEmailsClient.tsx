'use client'

/**
 * Send Introductory Emails — the continuous direct-workflow client.
 *
 * It applies the Contact Research working-screen pattern to the first-touch
 * introductory-email population of the shared Stewardship board: land straight
 * on the first eligible customer (no intermediate list), send the introductory
 * servicing-agent email (or the postal alternative), confirm it, and advance
 * automatically to the next eligible customer. When the population is exhausted
 * it shows a simple completion state with a way back to My Work.
 *
 * The task itself is the EXISTING stewardship task (reused, not reimplemented),
 * so every business rule is preserved unchanged: the filled authorization PDF,
 * the mailto prepared email with manual attachment, the send confirmation, the
 * outreach history and follow-up scheduling, the postal alternative, claims,
 * and the shared Customer Contact card. This component only owns the session
 * shape: which customer is open and advancing to the next after a send.
 *
 * Project scope and employee eligibility are preserved by the server: the
 * population fetch carries the project id when scoped, and the stewardship API
 * returns exactly the customers this employee can act on (capability-eligible
 * and not claimed by someone else) — the same set My Work counted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Mail, CheckCircle2, ArrowLeft, RefreshCw } from 'lucide-react'
import { PrimaryAction } from '@/components/workflow'
import {
  MentorCapButton, MentorCapPanel, useMentorDisclosure,
} from '@/lib/mentoring/MentorUi'
import { StewardshipTask } from '../StewardshipClient'

type PopulationCustomer = {
  id: string
  first_name: string | null
  last_name: string | null
}

type PopulationItem = {
  id: string
  customer: PopulationCustomer
}

function fullName(c: PopulationCustomer): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'this customer'
}

export function IntroductoryEmailsClient({
  projectId = null,
  actorTimeZone = null,
}: {
  /** When set, the session is scoped to this project's introductory-email
   * population (carried to the server fetch exactly as the board does). */
  projectId?: string | null
  /** The signed-in employee's detected timezone. Reserved for parity with the
   * board's population fetch; the server derives the actor calendar itself. */
  actorTimeZone?: string | null
}) {
  void actorTimeZone

  const [items, setItems] = useState<PopulationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The customer open right now. null while loading or on the completion state.
  const [openId, setOpenId] = useState<string | null>(null)
  // Customers sent this session, so a reload of the population (which the task
  // triggers after a send) does not re-present someone already handled and the
  // completion tally is accurate.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: 'introductory-emails' })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load introductory emails.'); return }
      setItems((json.data.items ?? []) as PopulationItem[])
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  // The still-to-do work: population items not yet handled this session. The
  // server already gated the population to this employee's actionable set; this
  // only removes the ones completed in the current pass.
  const remaining = useMemo(
    () => items.filter(it => !handled.has(it.id)),
    [items, handled],
  )

  // Direct working workflow: once loaded, land straight on the FIRST eligible
  // customer, never an intermediate list. Applied once per fresh landing; after
  // that the worker advances deliberately with each send. If the population is
  // empty from the start, go straight to the completion state.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || directOpenedRef.current) return
    directOpenedRef.current = true
    const first = remaining[0]
    if (first) setOpenId(first.id)
    // else: no first-touch customers — fall through to the completion state
    // (openId stays null).
  }, [loading, remaining])

  // Mark the open customer sent and advance to the next one. Called after the
  // task confirms a successful send. If none remain, show the completion state.
  const advanceAfterSend = useCallback(() => {
    if (!openId) return
    const sentId = openId
    setHandled(prev => {
      const next = new Set(prev)
      next.add(sentId)
      return next
    })
    // `handled` updates on the next render, so exclude the just-sent id here.
    const next = remaining.find(it => it.id !== sentId)
    if (next) setOpenId(next.id)
    else setOpenId(null) // nothing left: the completion state renders
    // Keep the local population in step with the server (the sent customer has
    // left Ready to Email); harmless if it is already gone.
    void load()
  }, [openId, remaining, load])

  const sentCount = handled.size

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading introductory emails…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
        {error}
      </div>
    )
  }

  // ── Single-customer task ───────────────────────────────────────────────────
  // The existing stewardship task, reused verbatim. `hasNextInActivity` controls
  // its confirm label ("… — Next customer" vs the plain completion wording), and
  // `onAdvanceToNext` fires after a confirmed send to move to the next customer.
  if (openId) {
    const hasNext = remaining.some(it => it.id !== openId)
    return (
      <StewardshipTask
        key={openId}
        itemId={openId}
        // Chromeless: the page already supplies WorkflowPage + the "Back to My
        // Work" link, so the task must NOT render its own "All queues" header.
        hideBackHeader
        hasNextInActivity={hasNext}
        // ONLY a confirmed send advances the sequence. Advancement is wired to
        // onAdvanceToNext, which the task fires solely after a successful send;
        // it marks this customer handled and opens the next eligible one.
        onAdvanceToNext={advanceAfterSend}
        // Leaving the screen must never mark a customer handled or advance the
        // sequence. The task only calls onBack on a non-send terminal path
        // (e.g. a carrier completion, not reachable in the intro-email flow);
        // if it ever fires, just refresh the population — do NOT advance.
        onBack={() => { void load() }}
      />
    )
  }

  // ── Completion state ───────────────────────────────────────────────────────
  // Simple, matching Contact Research's "all caught up": a clear done message
  // and a way back to My Work. Distinguishes "you finished a run" from "there
  // was nothing to do" by the session tally.
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-ink">About introductory emails</p>
        {!mentorOpen && (
          <MentorCapButton
            onOpen={() => setMentorOpen(true)}
            label="Show mentoring on introductory emails"
          />
        )}
      </div>
      {mentorOpen && (
        <MentorCapPanel onClose={() => setMentorOpen(false)}>
          The introductory email is the first touch for a customer we have not yet reached: it
          introduces the office as servicing agent and carries the authorization form. Open each
          customer, generate the filled form, attach it to the prepared email, and send it — or use
          the postal alternative when there is no usable email. Confirming the send records it in the
          customer&apos;s outreach history and schedules the follow-up, then moves you straight to the
          next customer, so a full run is one continuous pass.
        </MentorCapPanel>
      )}

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
        <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-ink">
            {sentCount > 0 ? 'Introductory emails complete' : 'No introductory emails right now'}
          </p>
          <p className="text-lg text-ink-secondary">
            {sentCount > 0
              ? `You sent ${sentCount} introductory ${sentCount === 1 ? 'email' : 'emails'} this session. There are no more eligible customers to introduce.`
              : 'There are no first-touch customers waiting for an introductory email. Check back as new customers become ready.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/my-work"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <ArrowLeft className="size-5" aria-hidden />
            Back to My Work
          </Link>
          <button
            type="button"
            onClick={() => {
              // Deliberately look again for newly-eligible customers without
              // leaving the screen: reset the session and re-run the direct open.
              setHandled(new Set())
              directOpenedRef.current = false
              setLoading(true)
              void load()
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong px-5 py-3 text-lg font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <RefreshCw className="size-5" aria-hidden />
            Check again
          </button>
        </div>
        {/* A quiet marker tying the completion to the activity, consistent with
            the light workflow look. */}
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
          <Mail className="size-4" aria-hidden />
          Send Introductory Emails
        </p>
      </div>
    </section>
  )
}
