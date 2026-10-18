'use client'

/**
 * Call Reachable Customers — the continuous direct-workflow client.
 *
 * It applies the Send Introductory Emails / Contact Research working-screen
 * pattern to the Available to Call population of the shared Stewardship board:
 * land straight on the first available customer (no intermediate list and no
 * separate Assistant panel), work the guided single-page call flow, record the
 * interaction once, and advance automatically to the next available customer.
 * When the population is exhausted it shows a simple completion state with a way
 * back to My Work.
 *
 * The task itself is the EXISTING stewardship task (reused, not reimplemented)
 * driven into its guided CALL flow via the `forceCall` prop, so every business
 * rule is preserved unchanged: the single record-attempt grouping, the outcome
 * vocabulary and transitions, callback persistence, follow-up scheduling, the
 * authorization-form process, claims, and the shared Customer Contact card. This
 * component only owns the session shape: which customer is open and advancing to
 * the next after each recorded interaction.
 *
 * `forceCall` matters because callability is independent of the stored queue: a
 * customer with a usable phone is callable even while sitting in Ready to Email
 * awaiting a reply, so the workbench must present the call flow rather than the
 * stored-queue action.
 *
 * Project scope and employee eligibility are preserved by the server: the
 * population fetch carries the project id when scoped, and the stewardship API
 * returns exactly the customers this employee can act on (capability-eligible
 * and not claimed by someone else) — the same set My Work counted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Phone, CheckCircle2, ArrowLeft, RefreshCw } from 'lucide-react'
import {
  MentorCapButton, MentorCapPanel, useMentorDisclosure,
} from '@/lib/mentoring/MentorUi'
import { useWorkReservation } from '@/lib/reservations/useWorkReservation'
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

export function AvailableToCallClient({
  projectId = null,
  actorTimeZone = null,
}: {
  /** When set, the session is scoped to this project's Available to Call
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
  // Customers handled this session, so a reload of the population (which the
  // task triggers after a recorded interaction) does not re-present someone
  // already handled and the completion tally is accurate.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  // Temporary reservation coordination: opening and advancing both ask the
  // server for the next AVAILABLE customer, so two employees calling this
  // population never land on the same one. The reservation is a soft,
  // self-expiring lease the hook heartbeats while the screen is open and
  // releases on complete / skip / leave; it changes no business record. The
  // subject is the stewardship_outreach row (item.id).
  const { reserveNext, release } = useWorkReservation({
    activity: 'available_to_call',
    subjectType: 'stewardship_outreach',
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: 'available-to-call' })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load reachable customers.'); return }
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

  // Direct working workflow: once loaded, RESERVE and land straight on the first
  // AVAILABLE eligible customer (one a teammate is not already working), never
  // an intermediate list. Applied once per fresh landing; after that the worker
  // advances deliberately with each recorded interaction. If no customer is
  // available, go straight to the completion state.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || directOpenedRef.current) return
    directOpenedRef.current = true
    const candidates = remaining.map(it => it.id)
    void reserveNext(candidates).then(reserved => {
      if (reserved) setOpenId(reserved)
      // else: nothing available (empty or all reserved) — completion state shows
      // (openId stays null).
    })
  }, [loading, remaining, reserveNext])

  // Mark the open customer handled and advance to the next AVAILABLE one. Called
  // after the task records a terminal interaction for this customer (a recorded
  // no-reach attempt, a bad number, a promised callback, a declined outreach, or
  // a sent authorization form). The just-handled customer's reservation is
  // released, then the next free customer is reserved. If none remain or all are
  // reserved, show the completion state.
  const advanceAfterCall = useCallback(() => {
    if (!openId) return
    const handledId = openId
    setHandled(prev => {
      const next = new Set(prev)
      next.add(handledId)
      return next
    })
    // The handled customer has left the Available to Call population for this
    // session; release its reservation so a teammate is never blocked.
    void release()
    // `handled` updates on the next render, so exclude the just-handled id here.
    const candidates = remaining.filter(it => it.id !== handledId).map(it => it.id)
    void reserveNext(candidates).then(reserved => {
      setOpenId(reserved) // reserved id, or null -> completion state renders
    })
    // Keep the local population in step with the server; harmless if already gone.
    void load()
  }, [openId, remaining, load, release, reserveNext])

  const handledCount = handled.size

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading reachable customers…
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
  // The existing stewardship task, reused verbatim and driven into its guided
  // call flow (forceCall). `hasNextInActivity` tunes the confirmation wording,
  // and `onAdvanceToNext` fires after a recorded terminal interaction to move to
  // the next customer.
  if (openId) {
    const hasNext = remaining.some(it => it.id !== openId)
    return (
      <StewardshipTask
        key={openId}
        itemId={openId}
        forceCall
        // Chromeless: the page already supplies WorkflowPage + the "Back to My
        // Work" link, so the task must NOT render its own "All queues" header.
        hideBackHeader
        hasNextInActivity={hasNext}
        // A recorded terminal interaction advances the sequence; the guided call
        // flow fires onAdvanceToNext only after it records such an interaction.
        onAdvanceToNext={advanceAfterCall}
        // Leaving the screen must never mark a customer handled or advance. The
        // call flow only calls onBack on a non-advancing terminal path (e.g. a
        // carrier completion, not reachable here); if it ever fires, just refresh
        // the population — do NOT advance.
        onBack={() => { void load() }}
      />
    )
  }

  // ── Completion state ───────────────────────────────────────────────────────
  // Simple, matching Contact Research / Send Introductory Emails "all caught
  // up": a clear done message and a way back to My Work. Distinguishes "you
  // finished a run" from "there was nothing to do" by the session tally.
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-ink">About calling reachable customers</p>
        {!mentorOpen && (
          <MentorCapButton
            onOpen={() => setMentorOpen(true)}
            label="Show mentoring on calling reachable customers"
          />
        )}
      </div>
      {mentorOpen && (
        <MentorCapPanel onClose={() => setMentorOpen(false)}>
          These are customers with a usable phone and no scheduled call time — good calling-hours work
          once any due callbacks are handled. Open each customer, use the opening script, and choose
          Reached or Didn&apos;t Reach. If you don&apos;t reach them, read the voicemail script and
          record what you actually did — voicemail, a Hearsay text, a follow-up email — as one attempt.
          If you reach them, confirm their contact information, explain the servicing-agent
          authorization, and capture their decision. Everything saves once, updates the customer&apos;s
          history, schedules the right follow-up, and moves you to the next customer.
        </MentorCapPanel>
      )}

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
        <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-ink">
            {handledCount > 0 ? 'Calling complete' : 'No reachable customers right now'}
          </p>
          <p className="text-lg text-ink-secondary">
            {handledCount > 0
              ? `You handled ${handledCount} ${handledCount === 1 ? 'customer' : 'customers'} this session. There are no more reachable customers to call right now.`
              : 'There are no reachable customers waiting for a call. Due callbacks, if any, are handled from Calls Due. Check back as customers become callable.'}
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
              // Deliberately look again for newly-available customers without
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
        {/* A quiet marker tying the completion to the activity. */}
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
          <Phone className="size-4" aria-hidden />
          Call Reachable Customers
        </p>
      </div>
    </section>
  )
}
