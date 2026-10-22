'use client'

/**
 * Customer Interaction — the continuous direct-workflow client for the step
 * between routine calling/outreach and Servicing Access.
 *
 * It applies the established direct-working-screen pattern (Call Reachable
 * Customers / Servicing Access) to the customer-interaction population: the
 * customers who have genuinely engaged (responded by email, phone, or text, or
 * been reached on a call) but have NOT yet returned the signed authorization. An
 * active conversation is live work — the employee records incoming responses,
 * outgoing replies, conversation notes, and follow-up commitments, all into the
 * customer's durable history.
 *
 * It lands straight on the first engaged customer (no intermediate list) and
 * works the EXISTING stewardship task driven into its guided conversation flow
 * (forceCall): the same record-attempt grouping, outcome vocabulary and
 * transitions, callback persistence, follow-up scheduling, shared Customer
 * Contact card, and authorization-form process — nothing re-implemented. A
 * recorded step that moves the customer on (the signed form sent/returned) or
 * out (a refusal) advances the sequence to the next engaged customer.
 *
 * It also offers a customer search so an employee can open a specific customer
 * the moment a response comes in, and a compact "record an incoming response"
 * control that logs the received communication in Customer History and marks the
 * customer engaged (the lightweight engagement signal, never a claim or a queue
 * change). When the signed authorization arrives the customer leaves this
 * population for the existing Servicing Access workflow.
 *
 * Project scope and employee eligibility are preserved by the server: the
 * population fetch carries the project id when scoped, and the stewardship API
 * returns exactly the customers this employee can act on (capability-eligible
 * and not claimed by someone else) — the same set My Work counted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, MessageSquare, CheckCircle2, ArrowLeft, RefreshCw, Search } from 'lucide-react'
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

type SearchResult = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
}

function fullName(c: PopulationCustomer | SearchResult): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'this customer'
}

export function CustomerInteractionClient({
  projectId = null,
  actorTimeZone = null,
}: {
  /** When set, the session is scoped to this project's customer-interaction
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
  // The outreach item open right now. null while loading or on completion.
  const [openId, setOpenId] = useState<string | null>(null)
  // Items handled this session, so a reload does not re-present someone already
  // handled and the completion tally stays accurate.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  const { open: mentorOpen, setOpen: setMentorOpen } = useMentorDisclosure()

  // Soft reservation coordination so two employees never land on the same
  // conversation. A self-expiring lease over the stewardship_outreach row; it
  // changes no business record and is never an assignment.
  const { reserveNext, reserveOne, release } = useWorkReservation({
    activity: 'customer_interaction',
    subjectType: 'stewardship_outreach',
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: 'customer-interaction' })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Failed to load customer interaction work.'); return }
      setItems((json.data.items ?? []) as PopulationItem[])
    } catch {
      setError('Network error loading customer interaction work. Try again.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const remaining = useMemo(
    () => items.filter(it => !handled.has(it.id)),
    [items, handled],
  )

  // Land straight on the first available engaged customer once loaded.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || error || directOpenedRef.current) return
    directOpenedRef.current = true
    const candidates = remaining.map(it => it.id)
    // An empty population is not a failure: fall through to the empty state
    // (openId stays null), keeping the search available. Only a genuine
    // reservation attempt can surface the reservation-failed error.
    if (candidates.length === 0) return
    void reserveNext(candidates)
      .then(reserved => { if (reserved) setOpenId(reserved) })
      .catch(() => {
        directOpenedRef.current = false
        setError('Could not reserve a conversation to work. Try again.')
      })
  }, [loading, error, remaining, reserveNext])

  // Advance to the next available conversation after a recorded step that
  // removes this customer from the population (the signed form sent/returned —
  // they move on to Servicing Access — or a refusal). The just-handled item's
  // reservation is released first.
  const advanceToNext = useCallback(() => {
    if (!openId) return
    const handledId = openId
    setHandled(prev => { const next = new Set(prev); next.add(handledId); return next })
    void release()
    const candidates = remaining.filter(it => it.id !== handledId).map(it => it.id)
    if (candidates.length === 0) {
      setOpenId(null)
      void load()
      return
    }
    void reserveNext(candidates)
      .then(reserved => setOpenId(reserved))
      .catch(() => {
        setOpenId(null)
        setError('Could not advance to the next customer. Try again.')
      })
    void load()
  }, [openId, remaining, load, release, reserveNext])

  const handledCount = handled.size

  // ── Customer search: open a specific customer when a response arrives ───────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearchError(null); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) { setSearchError(json?.error ?? 'Search failed.'); setResults([]); return }
        setSearchError(null)
        setResults((json.data ?? json.results ?? []) as SearchResult[])
      } catch {
        if (!cancelled) { setSearchError('Network error during search.'); setResults([]) }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  // Open a searched customer: materialize/find their outreach item, reserve it,
  // and open it. The server ensures a durable row exists for the customer
  // (creating one only on this deliberate action).
  const [opening, setOpening] = useState(false)
  const openCustomer = useCallback(async (customerId: string) => {
    setOpening(true)
    setSearchError(null)
    try {
      const res = await fetch('/api/stewardship/customer-interaction/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.item_id) {
        setSearchError(json?.error ?? 'Could not open this customer for interaction.')
        return
      }
      const itemId = json.data.item_id as string
      await reserveOne(itemId) // deliberate open; proceeds regardless of lease
      setQuery('')
      setResults([])
      setOpenId(itemId)
    } catch {
      setSearchError('Network error opening the customer.')
    } finally {
      setOpening(false)
    }
  }, [reserveOne])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading customer interaction work…
      </div>
    )
  }

  // The customer-search box, always available so an employee can jump straight
  // to a customer when a response arrives — INCLUDING when a reservation or load
  // failed. The search opens a specific customer directly (its own reserve path),
  // so a population reservation failure must never make it inaccessible.
  const searchBox = (
    <div className="space-y-2 rounded-2xl border border-surface-border bg-surface-card p-4">
      <label htmlFor="ci-search" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Search className="size-4 text-ink-supporting" aria-hidden />
        A customer just responded? Find them
      </label>
      <input
        id="ci-search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by name…"
        className="w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-wash"
      />
      {searching && (
        <p className="flex items-center gap-1.5 text-sm text-ink-supporting">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching…
        </p>
      )}
      {searchError && <p className="text-sm text-rose-700">{searchError}</p>}
      {results.length > 0 && (
        <ul className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border">
          {results.map(r => (
            <li key={r.id}>
              <button
                type="button"
                disabled={opening}
                onClick={() => void openCustomer(r.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-base text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
              >
                <span>{fullName(r)}</span>
                {r.phone && <span className="text-sm text-ink-supporting">{r.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {opening && (
        <p className="flex items-center gap-1.5 text-sm text-ink-supporting">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Opening…
        </p>
      )}
    </div>
  )

  // ── Error state ─────────────────────────────────────────────────────────────
  // A load or reservation failure is surfaced with a retry, but the customer
  // search stays ABOVE it so an employee can always open a specific customer who
  // just responded — a reservation failure never blocks the search.
  if (error) {
    return (
      <div className="space-y-4">
        {searchBox}
        <div className="space-y-4 rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null); setHandled(new Set()); directOpenedRef.current = false
              setLoading(true); void load()
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong bg-surface-card px-4 py-2 text-base font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
        </div>
      </div>
    )
  }

  // ── Single-customer task ───────────────────────────────────────────────────
  if (openId) {
    const hasNext = remaining.some(it => it.id !== openId)
    return (
      <div className="space-y-4">
        {searchBox}
        {/* The established three-column working layout: the dedicated Customer
            Interaction action column (record incoming/outgoing email, phone, or
            text, and set a follow-up — no telephone flow required) on the left,
            the customer contact card + policies in the center, and the
            communication history on the right. Contact context and history stay
            visible throughout, without opening any workbench. */}
        <StewardshipTask
          key={openId}
          itemId={openId}
          forceCustomerInteraction
          hideBackHeader
          hasNextInActivity={hasNext}
          // A recorded step that removes the customer from the interaction
          // population (signed form received, or a refusal) advances the
          // sequence to the next engaged customer.
          onAdvanceToNext={advanceToNext}
          // A non-advancing terminal path just refreshes the population; it
          // must never advance or leave the screen on its own.
          onBack={() => { void load() }}
        />
      </div>
    )
  }

  // ── Completion state ───────────────────────────────────────────────────────
  return (
    <section className="space-y-5">
      {searchBox}

      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-ink">About customer interaction</p>
        {!mentorOpen && (
          <MentorCapButton
            onOpen={() => setMentorOpen(true)}
            label="Show mentoring on customer interaction"
          />
        )}
      </div>
      {mentorOpen && (
        <MentorCapPanel onClose={() => setMentorOpen(false)}>
          Customer interaction is the step between routine calling and servicing access. A customer
          who has responded — by email, phone, or text — or who you reached on a call is in an active
          conversation, even if the signed authorization has not come back yet. Record what the
          customer said, your replies, any notes, and the next follow-up you promised. Keep working
          the conversation toward the signed servicing-agent authorization; when it comes back, the
          customer moves into Servicing Access automatically. An automated reply (out-of-office, a
          delivery receipt) is not a response, and a customer who declines stops outreach. Everything
          is saved once and recorded in the customer&apos;s history.
        </MentorCapPanel>
      )}

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
        <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-ink">
            {handledCount > 0 ? 'Customer interaction complete' : 'No active conversations right now'}
          </p>
          <p className="text-lg text-ink-secondary">
            {handledCount > 0
              ? `You worked ${handledCount} ${handledCount === 1 ? 'conversation' : 'conversations'} this session. There are no more active conversations waiting.`
              : 'No customers are in an active conversation right now. When one responds, find the customer above to start, or check back as responses come in.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/my-work"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <ArrowLeft className="size-5" aria-hidden /> Back to My Work
          </Link>
          <button
            type="button"
            onClick={() => {
              setHandled(new Set()); directOpenedRef.current = false
              setLoading(true); void load()
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong px-5 py-3 text-lg font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <RefreshCw className="size-5" aria-hidden /> Check again
          </button>
        </div>
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
          <MessageSquare className="size-4" aria-hidden /> Customer Interaction
        </p>
      </div>
    </section>
  )
}

// (The former inline EmailConversation panel is removed: the three-column
// StewardshipTask (forceCustomerInteraction) now owns conversation recording
// with the established working layout and the shared customer context/history.)
