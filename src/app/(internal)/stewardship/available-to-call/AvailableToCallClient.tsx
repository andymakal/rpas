'use client'

/**
 * Guided calling workbench — the continuous direct-workflow client shared by
 * BOTH calling activities.
 *
 * It applies the Send Introductory Emails / Contact Research working-screen
 * pattern to the shared Stewardship board's two callable populations:
 *   - 'available-to-call' (Call Other Reachable Customers): callable customers
 *     with no scheduled call time that has come due.
 *   - 'calls-due' (Make the Calls That Are Due): callable customers whose
 *     promised callback or automatic retry is due now.
 *
 * In either mode it lands straight on the first AVAILABLE customer (no
 * intermediate list and no separate Assistant panel), works the guided
 * single-page call flow, records the interaction once, and advances
 * automatically to the next available customer in the SAME population. When the
 * population is exhausted it shows a completion state; the due mode additionally
 * offers a way to continue with ordinary available calls, since clearing the due
 * work is the point of that activity.
 *
 * The task itself is the EXISTING stewardship task (reused, not reimplemented)
 * driven into its guided CALL flow via the `forceCall` prop, so every business
 * rule is preserved unchanged: the single record-attempt grouping, the outcome
 * vocabulary and transitions, callback persistence, follow-up scheduling, the
 * authorization-form process, claims, and the shared Customer Contact card. This
 * component only owns the session shape: which customer is open and advancing to
 * the next after each recorded interaction. The two populations differ ONLY in
 * which customers are fetched (the population filter), never in the call flow or
 * the follow-up timing — there is no separate calling workflow.
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
 *
 * Reservation/loading failures are NEVER shown as an empty population. A failed
 * population fetch or a failed reservation surfaces as an explicit error with a
 * retry, distinct from the legitimate "nobody left to call" completion state.
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

/** Which callable population this workbench session is working. Both are worked
 * with the identical guided call flow; only the fetched set differs. */
export type CallingPopulation = 'available-to-call' | 'calls-due'

/** Per-population copy. The call flow, reservation, and follow-up scheduling are
 * identical; only the wording of the loading/completion/mentoring text changes
 * so each activity reads naturally. */
const COPY: Record<CallingPopulation, {
  populationParam: string
  loading: string
  loadError: string
  mentorButton: string
  mentorHeading: string
  completeTitle: string
  completeBody: (n: number) => string
  emptyTitle: string
  emptyBody: string
  footer: string
}> = {
  'available-to-call': {
    populationParam: 'available-to-call',
    loading: 'Loading reachable customers…',
    loadError: 'Failed to load reachable customers.',
    mentorButton: 'Show mentoring on calling reachable customers',
    mentorHeading: 'About calling reachable customers',
    completeTitle: 'Calling complete',
    completeBody: n =>
      `You handled ${n} ${n === 1 ? 'customer' : 'customers'} this session. There are no more reachable customers to call right now.`,
    emptyTitle: 'No reachable customers right now',
    emptyBody:
      'There are no reachable customers waiting for a call. Due callbacks, if any, are handled from Make the Calls That Are Due. Check back as customers become callable.',
    footer: 'Call Other Reachable Customers',
  },
  'calls-due': {
    populationParam: 'calls-due',
    loading: 'Loading due calls…',
    loadError: 'Failed to load the calls that are due.',
    mentorButton: 'Show mentoring on the calls that are due',
    mentorHeading: 'About the calls that are due',
    completeTitle: 'Due calls complete',
    completeBody: n =>
      `You handled ${n} due ${n === 1 ? 'call' : 'calls'} this session. There are no more calls due right now.`,
    emptyTitle: 'No calls are due right now',
    emptyBody:
      'There are no promised callbacks or automatic retries due right now. You can continue with ordinary available calls or head back to My Work.',
    footer: 'Make the Calls That Are Due',
  },
}

export function AvailableToCallClient({
  population = 'available-to-call',
  projectId = null,
  actorTimeZone = null,
}: {
  /** Which callable population to work. Defaults to the Available to Call
   * population so existing links keep their behavior. */
  population?: CallingPopulation
  /** When set, the session is scoped to this project's population (carried to
   * the server fetch exactly as the board does). */
  projectId?: string | null
  /** The signed-in employee's detected timezone. Reserved for parity with the
   * board's population fetch; the server derives the actor calendar itself. */
  actorTimeZone?: string | null
}) {
  void actorTimeZone

  const copy = COPY[population]

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
  // server for the next AVAILABLE customer, so two employees calling never land
  // on the same one. The reservation is a soft, self-expiring lease the hook
  // heartbeats while the screen is open and releases on complete / skip / leave;
  // it changes no business record. The subject is the stewardship_outreach row
  // (item.id). BOTH calling activities share the one 'available_to_call' key on
  // purpose: a customer reserved while being called must appear busy to the
  // other activity too, since it is the same underlying call on the same row.
  const { reserveNext, release } = useWorkReservation({
    activity: 'available_to_call',
    subjectType: 'stewardship_outreach',
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: copy.populationParam })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? copy.loadError); return }
      setItems((json.data.items ?? []) as PopulationItem[])
    } catch {
      // A loading failure is an ERROR, never an empty population: surface it so
      // the worker retries rather than believing there is nothing to do.
      setError('Network error loading the population. Try again.')
    } finally {
      setLoading(false)
    }
  }, [projectId, copy.populationParam, copy.loadError])

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
  // advances deliberately with each recorded interaction. A reservation FAILURE
  // (not an empty result) surfaces as an error; only a successful empty result
  // falls through to the completion state.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || error || directOpenedRef.current) return
    directOpenedRef.current = true
    const candidates = remaining.map(it => it.id)
    void reserveNext(candidates)
      .then(reserved => {
        if (reserved) setOpenId(reserved)
        // else: a successful empty result — nobody available. Completion shows.
      })
      .catch(() => {
        // Reservation failure is NOT an empty population: show an error + retry.
        directOpenedRef.current = false
        setError('Could not reserve a customer to call. Try again.')
      })
  }, [loading, error, remaining, reserveNext])

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
    // The handled customer has left this population for the session; release its
    // reservation so a teammate is never blocked.
    void release()
    // `handled` updates on the next render, so exclude the just-handled id here.
    const candidates = remaining.filter(it => it.id !== handledId).map(it => it.id)
    void reserveNext(candidates)
      .then(reserved => {
        setOpenId(reserved) // reserved id, or null -> completion state renders
      })
      .catch(() => {
        // A failure advancing is an error, not "all done": keep the worker from
        // seeing a false completion. Clear the open customer and show the error.
        setOpenId(null)
        setError('Could not advance to the next customer. Try again.')
      })
    // Keep the local population in step with the server; harmless if already gone.
    void load()
  }, [openId, remaining, load, release, reserveNext])

  const handledCount = handled.size

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.loading}
      </div>
    )
  }

  // A loading OR reservation failure: an explicit, retryable error — deliberately
  // NOT the empty-population completion state.
  if (error) {
    return (
      <div className="space-y-4 rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setHandled(new Set())
            directOpenedRef.current = false
            setLoading(true)
            void load()
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong bg-surface-card px-4 py-2 text-base font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </button>
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
  // Matching Contact Research / Send Introductory Emails "all caught up": a clear
  // done message and a way back to My Work. Distinguishes "you finished a run"
  // from "there was nothing to do" by the session tally. In the due mode it also
  // offers continuing with ordinary available calls, since the point of the
  // activity is to clear the due work and then keep calling.
  const isDue = population === 'calls-due'
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-ink">{copy.mentorHeading}</p>
        {!mentorOpen && (
          <MentorCapButton
            onOpen={() => setMentorOpen(true)}
            label={copy.mentorButton}
          />
        )}
      </div>
      {mentorOpen && (
        <MentorCapPanel onClose={() => setMentorOpen(false)}>
          {isDue ? (
            <>
              These are customers whose promised callback or automatic retry is due now — the calls
              to make first. Open each customer, use the opening script, and choose Reached or
              Didn&apos;t Reach. If you don&apos;t reach them, read the voicemail script and record
              what you actually did — voicemail, a Hearsay text, a follow-up email — as one attempt.
              If you reach them, confirm their contact information, explain the servicing-agent
              authorization, and capture their decision. Everything saves once, updates the
              customer&apos;s history, schedules the right follow-up, and moves you to the next due
              customer.
            </>
          ) : (
            <>
              These are customers with a usable phone and no scheduled call time — good calling-hours
              work once any due callbacks are handled. Open each customer, use the opening script, and
              choose Reached or Didn&apos;t Reach. If you don&apos;t reach them, read the voicemail
              script and record what you actually did — voicemail, a Hearsay text, a follow-up email —
              as one attempt. If you reach them, confirm their contact information, explain the
              servicing-agent authorization, and capture their decision. Everything saves once,
              updates the customer&apos;s history, schedules the right follow-up, and moves you to the
              next customer.
            </>
          )}
        </MentorCapPanel>
      )}

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
        <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-ink">
            {handledCount > 0 ? copy.completeTitle : copy.emptyTitle}
          </p>
          <p className="text-lg text-ink-secondary">
            {handledCount > 0 ? copy.completeBody(handledCount) : copy.emptyBody}
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
          {/* Due mode: continue with ordinary available calls. Same guided
              workbench, the Available to Call population — not a separate
              workflow. Project scope is carried through so the follow-on run
              stays within the same project when scoped. */}
          {isDue && (
            <Link
              href={projectId
                ? `/stewardship/available-to-call?project_id=${encodeURIComponent(projectId)}`
                : '/stewardship/available-to-call'}
              className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong px-5 py-3 text-lg font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
            >
              <Phone className="size-5" aria-hidden />
              Continue with available calls
            </Link>
          )}
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
          {copy.footer}
        </p>
      </div>
    </section>
  )
}
