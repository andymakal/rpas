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
import { reserveNextDirectCandidate } from '@/lib/reservations/reserveNextDirectCandidate'
import { StewardshipTask } from '../StewardshipClient'

type PopulationCustomer = {
  id: string
  first_name: string | null
  last_name: string | null
}

type PopulationItem = {
  // A recorded item carries its real stewardship_outreach id; a derived
  // (record-less) onboarding item carries a null id with virtual + customer_id,
  // so it is materialized into a real record on first action (reserve/open).
  id: string | null
  virtual?: boolean
  customer_id?: string | null
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
  // Customers skipped this session, in skip order (most recently skipped last).
  // Skipping records nothing and changes no status or follow-up date; it only
  // reorders the working sequence so a skipped customer goes to the BACK and is
  // cycled back to once the un-skipped customers are exhausted. Keyed the same
  // way as `handled` (real outreach id, or `virtual:<customerId>` for a
  // record-less item). A customer later handled leaves the sequence entirely
  // (it joins `handled`), so a skip never keeps anyone around permanently. This
  // mirrors the Send Introductory Emails skip behavior.
  const [skipOrder, setSkipOrder] = useState<string[]>([])

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

  // A stable per-candidate key for session handled-tracking. A recorded item is
  // keyed by its real outreach id; a record-less (virtual) item is keyed by its
  // customer id (it has no outreach id until it is materialized), so the
  // completion tally and the still-to-do set stay correct for both. When a
  // virtual item is materialized and worked, its NEW real id is also marked
  // handled, so a reloaded population (which then contains the real row) never
  // re-presents it.
  const candidateKey = useCallback(
    (it: PopulationItem): string => it.id ?? `virtual:${it.customer_id ?? ''}`,
    [],
  )

  // The still-to-do work: population items not yet handled this session. The
  // server already gated the population to this employee's actionable set; this
  // only removes the ones completed in the current pass.
  const remaining = useMemo(
    () => items.filter(it => !handled.has(candidateKey(it))),
    [items, handled, candidateKey],
  )

  // The working SEQUENCE: the same still-to-do customers, reordered so skipped
  // ones sit at the BACK in the order they were skipped. Reserving walks this
  // list and takes the first available, so an un-skipped customer is always
  // reached before a skipped one, and once the un-skipped run is exhausted the
  // sequence circles back to the first-skipped customer — continuing to cycle
  // until none remain. When nothing has been skipped it is exactly `remaining`.
  const orderedCandidates = useMemo(() => {
    if (skipOrder.length === 0) return remaining
    const skipIndex = new Map(skipOrder.map((key, i) => [key, i]))
    const notSkipped = remaining.filter(it => !skipIndex.has(candidateKey(it)))
    const skipped = remaining
      .filter(it => skipIndex.has(candidateKey(it)))
      .sort((a, b) => (skipIndex.get(candidateKey(a)) ?? 0) - (skipIndex.get(candidateKey(b)) ?? 0))
    return [...notSkipped, ...skipped]
  }, [remaining, skipOrder, candidateKey])

  // Direct working workflow: once loaded, RESERVE and land straight on the first
  // AVAILABLE eligible customer (one a teammate is not already working), never
  // an intermediate list. Applied once per fresh landing; after that the worker
  // advances deliberately with each recorded interaction. A reservation FAILURE
  // (not an empty result) surfaces as an error; only a successful empty result
  // falls through to the completion state.
  //
  // A record-less onboarding customer (virtual) has no outreach row yet, so the
  // shared helper materializes it into its durable record on this first action
  // (create-on-first-action, idempotent) before reserving — the same seam the
  // board queue list uses — so newly populated project customers are callable
  // directly here instead of falling through to an intermediate list.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || error || directOpenedRef.current) return
    directOpenedRef.current = true
    void reserveNextDirectCandidate(orderedCandidates, reserveNext)
      .then(reserved => {
        if (reserved) setOpenId(reserved)
        // else: a successful empty result — nobody available. Completion shows.
      })
      .catch(() => {
        // Reservation failure is NOT an empty population: show an error + retry.
        directOpenedRef.current = false
        setError('Could not reserve a customer to call. Try again.')
      })
  }, [loading, error, orderedCandidates, reserveNext])

  // Mark the open customer handled and advance to the next AVAILABLE one. Called
  // after the task records a terminal interaction for this customer (a recorded
  // no-reach attempt, a bad number, a promised callback, a declined outreach, or
  // a sent authorization form). The just-handled customer's reservation is
  // released, then the next free customer is reserved. If none remain or all are
  // reserved, show the completion state.
  const advanceAfterCall = useCallback(() => {
    if (!openId) return
    const handledId = openId
    // Mark handled by both keys that can identify this customer: the real id now
    // open (which also covers a materialized virtual item once reloaded) and, if
    // the open customer came from a still-virtual candidate, its virtual key.
    const handledVirtual = remaining.find(it => it.virtual && it.customer_id && it.id === null)
    setHandled(prev => {
      const next = new Set(prev)
      next.add(handledId)
      if (handledVirtual?.customer_id) next.add(`virtual:${handledVirtual.customer_id}`)
      return next
    })
    // The handled customer has left this population for the session; release its
    // reservation so a teammate is never blocked.
    void release()
    // `handled` updates on the next render, so exclude the just-handled customer
    // here (by real id and, for a materialized virtual one, its virtual key).
    // Walk the SEQUENCE order so advancing still reaches un-skipped customers
    // before skipped ones.
    const candidates = orderedCandidates.filter(
      it => it.id !== handledId && candidateKey(it) !== (handledVirtual ? `virtual:${handledVirtual.customer_id}` : ''),
    )
    void reserveNextDirectCandidate(candidates, reserveNext)
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
  }, [openId, orderedCandidates, remaining, load, release, reserveNext, candidateKey])

  // Skip the open customer: move to the next AVAILABLE customer WITHOUT recording
  // a call, changing status, or touching any follow-up date. The just-skipped
  // customer is pushed to the BACK of the working sequence (via skipOrder), so
  // after the rest of the run is worked the sequence circles back to it; this
  // keeps cycling until no eligible customers remain. Skipping never adds to
  // `handled`, so the session tally and the population are unchanged by a skip.
  // This is the same skip behavior as Send Introductory Emails.
  const advanceAfterSkip = useCallback(() => {
    if (!openId) return
    // Identify the skipped customer by the key that matches it in `remaining`:
    // its real outreach id (recorded or just-materialized and open).
    const skippedKey = openId
    // Push to the back of the skip order. If it was already skipped earlier,
    // move it to the very back (re-skipping sends it around again).
    setSkipOrder(prev => [...prev.filter(k => k !== skippedKey), skippedKey])
    // Free the lease so a teammate is not blocked by a customer this worker has
    // set aside; it stays in this worker's sequence and is re-reserved when it
    // cycles back (or immediately, if it is the only one left).
    void release()
    // Reserve the next customer in sequence order, with the just-skipped one
    // moved to the back. When it is the only remaining customer, the sequence
    // circles straight back to it (reserveNext treats a now-free subject as
    // reservable), so a one-customer queue simply re-presents that customer.
    const skipIndex = new Map(
      [...skipOrder.filter(k => k !== skippedKey), skippedKey].map((key, i) => [key, i]),
    )
    const resequenced = [
      ...remaining.filter(it => !skipIndex.has(candidateKey(it))),
      ...remaining
        .filter(it => skipIndex.has(candidateKey(it)))
        .sort((a, b) => (skipIndex.get(candidateKey(a)) ?? 0) - (skipIndex.get(candidateKey(b)) ?? 0)),
    ]
    void reserveNextDirectCandidate(resequenced, reserveNext)
      .then(reserved => {
        setOpenId(reserved) // reserved id, or null -> completion state renders
      })
      .catch(() => {
        setOpenId(null)
        setError('Could not advance to the next customer. Try again.')
      })
  }, [openId, skipOrder, remaining, release, reserveNext, candidateKey])

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
    // Another customer remains when a still-to-do candidate is neither the open
    // real id nor the virtual candidate that was just materialized into it. A
    // virtual candidate (id === null) that is NOT the open one still counts; the
    // open one is excluded by matching its real id or, for a freshly
    // materialized virtual, by it being the only remaining virtual.
    const otherRemaining = remaining.filter(it => it.id !== null && it.id !== openId)
    const remainingVirtuals = remaining.filter(it => it.id === null)
    const hasNext = otherRemaining.length > 0 || remainingVirtuals.length > 1
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
        // Skip for now: advance to the next available customer without recording
        // a call, changing status, or touching a follow-up date, sending this
        // one to the back of the working sequence.
        onSkip={advanceAfterSkip}
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
