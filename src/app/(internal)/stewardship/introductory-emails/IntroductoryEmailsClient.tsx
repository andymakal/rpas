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

function fullName(c: PopulationCustomer): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'this customer'
}

/**
 * The single live count shown beneath the page title: how many eligible
 * customers still need an introductory email. It is derived from the same
 * eligible-work population the screen already holds, so it updates in step with
 * processing — a send removes a customer and lowers it; a skip leaves it
 * unchanged. Pluralized naturally.
 */
function EligibleCount({ count }: { count: number }) {
  return (
    <p className="text-lg text-ink-secondary" aria-live="polite">
      <span className="font-semibold text-ink">{count}</span>{' '}
      {count === 1 ? 'customer still needs' : 'customers still need'} introductory emails
    </p>
  )
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
  // Customers skipped this session, in skip order (most recently skipped last).
  // Skipping records nothing and changes no status; it only reorders the working
  // sequence so a skipped customer goes to the BACK and is cycled back to once
  // the un-skipped customers are exhausted. Keyed the same way as `handled`
  // (real outreach id, or `virtual:<customerId>` for a record-less item). A
  // customer that is later sent leaves the sequence entirely (it joins
  // `handled`), so a skip never keeps anyone in the count.
  const [skipOrder, setSkipOrder] = useState<string[]>([])

  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  // Temporary reservation coordination: opening and Save & Next both ask the
  // server for the next AVAILABLE introductory-email customer, so two employees
  // working this activity never land on the same one. The reservation is a soft,
  // self-expiring lease the hook heartbeats while the screen is open and releases
  // on complete / skip / leave; it changes no business record. The subject is the
  // stewardship_outreach row (item.id).
  const { reserveNext, release } = useWorkReservation({
    activity: 'introductory_emails',
    subjectType: 'stewardship_outreach',
  })

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

  // A stable per-candidate key for session handled-tracking. A recorded item is
  // keyed by its real outreach id; a record-less (virtual) item is keyed by its
  // customer id (it has no outreach id until it is materialized), so the
  // completion tally and the still-to-do set stay correct for both. When a
  // virtual item is materialized and sent, its NEW real id is also marked
  // handled, so a reloaded population (which then contains the real row) never
  // re-presents it.
  const candidateKey = useCallback(
    (it: PopulationItem): string => it.id ?? `virtual:${it.customer_id ?? ''}`,
    [],
  )

  // The still-to-do work: population items not yet handled this session. The
  // server already gated the population to this employee's actionable set; this
  // only removes the ones completed in the current pass. This is ALSO the live
  // count surfaced beneath the title: sending removes a customer (they join
  // `handled`), skipping does not, so the count drops on a send and holds on a
  // skip, refreshed from the same eligible-work data as customers are processed.
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
  // AVAILABLE eligible customer (one a teammate is not already working), never an
  // intermediate list. Applied once per fresh landing; after that the worker
  // advances deliberately with each send. If no customer is available, go
  // straight to the completion state.
  //
  // A record-less onboarding customer (virtual) has no outreach row yet, so the
  // shared helper materializes it into its durable record on this first action
  // (create-on-first-action, idempotent) before reserving — the same seam the
  // board queue list uses — so newly populated project customers work directly
  // here instead of falling through to an intermediate list.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || directOpenedRef.current) return
    directOpenedRef.current = true
    void reserveNextDirectCandidate(orderedCandidates, reserveNext).then(reserved => {
      if (reserved) setOpenId(reserved)
      // else: nothing available (empty or all reserved) — completion state shows
      // (openId stays null).
    })
  }, [loading, orderedCandidates, reserveNext])

  // Mark the open customer sent and advance to the next AVAILABLE one. Called
  // after the task confirms a successful send. The just-sent customer's
  // reservation is released, then the next free customer is reserved. If none
  // remain or all are reserved, show the completion state.
  const advanceAfterSend = useCallback(() => {
    if (!openId) return
    const sentId = openId
    // Mark handled by both keys that can identify this customer: the real id now
    // open (which also covers a materialized virtual item once reloaded) and, if
    // the open customer came from a still-virtual candidate, its virtual key.
    const sentVirtualKey = remaining.find(it => it.virtual && it.customer_id && it.id === null)
    setHandled(prev => {
      const next = new Set(prev)
      next.add(sentId)
      if (sentVirtualKey?.customer_id) next.add(`virtual:${sentVirtualKey.customer_id}`)
      return next
    })
    // The sent customer has left Ready to Email and is handled; release its
    // reservation so a teammate is never blocked by a finished item.
    void release()
    // `handled` updates on the next render, so exclude the just-sent customer
    // here (by real id and, for a materialized virtual one, its virtual key).
    // Walk the SEQUENCE order so a send still reaches un-skipped customers before
    // skipped ones.
    const candidates = orderedCandidates.filter(
      it => it.id !== sentId && candidateKey(it) !== (sentVirtualKey ? `virtual:${sentVirtualKey.customer_id}` : ''),
    )
    void reserveNextDirectCandidate(candidates, reserveNext).then(reserved => {
      setOpenId(reserved) // reserved id, or null -> completion state renders
    })
    // Keep the local population in step with the server (the sent customer has
    // left Ready to Email); harmless if it is already gone.
    void load()
  }, [openId, orderedCandidates, remaining, load, release, reserveNext, candidateKey])

  // Skip the open customer: move to the next AVAILABLE customer WITHOUT sending
  // or recording anything and WITHOUT changing their status. The just-skipped
  // customer is pushed to the BACK of the working sequence (via skipOrder), so
  // after the rest of the run is worked the sequence circles back to it; this
  // keeps cycling until no eligible customers remain. Skipping never adds to
  // `handled`, so the live count is unchanged by a skip.
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
    void reserveNextDirectCandidate(resequenced, reserveNext).then(reserved => {
      setOpenId(reserved) // reserved id, or null -> completion state renders
    })
  }, [openId, skipOrder, remaining, release, reserveNext, candidateKey])

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
    // Another customer remains when a still-to-do candidate is neither the open
    // real id nor the virtual candidate that was just materialized into it. A
    // virtual candidate (id === null) that is NOT the open one still counts as a
    // next customer; the open one is excluded by matching its real id or, for a
    // freshly materialized virtual, by it being the only remaining virtual.
    const otherRemaining = remaining.filter(it => it.id !== null && it.id !== openId)
    const remainingVirtuals = remaining.filter(it => it.id === null)
    // The open customer may itself be a just-materialized virtual whose row has
    // not reloaded yet, so one virtual in the list can be the current customer.
    const hasNext = otherRemaining.length > 0 || remainingVirtuals.length > 1
    return (
      <div className="space-y-5">
        {/* One live count beneath the page title. It counts the eligible
            customers still needing an introductory email (remaining = eligible
            population minus those sent this session). Sending removes a customer
            and drops the count; skipping leaves the count unchanged because the
            skipped customer still needs the email. It refreshes from the same
            eligible-work data as customers are processed. */}
        <EligibleCount count={remaining.length} />
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
          // Skip for now: advance to the next available customer without sending
          // or recording anything, sending this one to the back of the sequence.
          onSkip={advanceAfterSkip}
          // Leaving the screen must never mark a customer handled or advance the
          // sequence. The task only calls onBack on a non-send terminal path
          // (e.g. a carrier completion, not reachable in the intro-email flow);
          // if it ever fires, just refresh the population — do NOT advance.
          onBack={() => { void load() }}
        />
      </div>
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
