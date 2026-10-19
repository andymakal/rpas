'use client'

/**
 * Servicing Access — the continuous direct-workflow client for the stage
 * between Outreach and Operations Preparation.
 *
 * It applies the established direct-working-screen pattern (Send Introductory
 * Emails / Call Reachable Customers) to the servicing-access population: the
 * customers whose signed servicing-agent authorization is in hand — the form
 * has come back (returned from the introductory email or any channel) and the
 * work is to save the signed form, prepare the carrier email, send + confirm,
 * run the seven-day carrier follow-up, and record the carrier's confirmation.
 *
 * It lands straight on the first eligible customer (no intermediate list),
 * works the EXISTING stewardship task driven into its servicing-access flow
 * (forceServicingAccess), and advances automatically to the next eligible
 * customer after each recorded step that removes the customer from the
 * population (a submission or a completed confirmation). It also offers a
 * customer search so an employee can open a specific customer the moment a
 * signed authorization arrives, without browsing a list.
 *
 * Project scope and employee eligibility are preserved by the server: the
 * population fetch carries the project id when scoped, and the stewardship API
 * returns exactly the customers this employee can act on (capability-eligible
 * and not claimed by someone else) — the same set My Work counted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, FileCheck2, CheckCircle2, ArrowLeft, RefreshCw, Search } from 'lucide-react'
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

export function ServicingAccessClient({
  projectId = null,
  actorTimeZone = null,
}: {
  /** When set, the session is scoped to this project's servicing-access
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

  // Temporary reservation coordination so two employees never land on the same
  // servicing-access item. Soft, self-expiring lease over the stewardship_outreach
  // row; it changes no business record.
  const { reserveNext, reserveOne, release } = useWorkReservation({
    activity: 'servicing_access',
    subjectType: 'stewardship_outreach',
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ population: 'servicing-access' })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Failed to load servicing access work.'); return }
      setItems((json.data.items ?? []) as PopulationItem[])
    } catch {
      setError('Network error loading servicing access work. Try again.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const remaining = useMemo(
    () => items.filter(it => !handled.has(it.id)),
    [items, handled],
  )

  // Land straight on the first available eligible item once loaded.
  const directOpenedRef = useRef(false)
  useEffect(() => {
    if (loading || error || directOpenedRef.current) return
    directOpenedRef.current = true
    const candidates = remaining.map(it => it.id)
    void reserveNext(candidates)
      .then(reserved => { if (reserved) setOpenId(reserved) })
      .catch(() => {
        directOpenedRef.current = false
        setError('Could not reserve a customer to work. Try again.')
      })
  }, [loading, error, remaining, reserveNext])

  // Advance to the next available item after a recorded step that removes this
  // customer from the servicing-access population (a submission, or a completed
  // confirmation). The just-handled item's reservation is released first.
  const advanceToNext = useCallback(() => {
    if (!openId) return
    const handledId = openId
    setHandled(prev => { const next = new Set(prev); next.add(handledId); return next })
    void release()
    const candidates = remaining.filter(it => it.id !== handledId).map(it => it.id)
    void reserveNext(candidates)
      .then(reserved => setOpenId(reserved))
      .catch(() => {
        setOpenId(null)
        setError('Could not advance to the next customer. Try again.')
      })
    void load()
  }, [openId, remaining, load, release, reserveNext])

  const handledCount = handled.size

  // ── Customer search: open a specific customer when an authorization arrives ─
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

  // Open a searched customer: materialize/find their servicing-access outreach
  // item, reserve it, and open it. The server ensures a durable row exists for
  // the customer (creating one only on this deliberate action).
  const [opening, setOpening] = useState(false)
  const openCustomer = useCallback(async (customerId: string) => {
    setOpening(true)
    setSearchError(null)
    try {
      const res = await fetch('/api/stewardship/servicing-access/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.item_id) {
        setSearchError(json?.error ?? 'Could not open this customer for servicing access.')
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
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading servicing access work…
      </div>
    )
  }

  if (error) {
    return (
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
    )
  }

  // The customer-search box, always available above the task so an employee can
  // jump straight to a customer when a signed authorization arrives.
  const searchBox = (
    <div className="space-y-2 rounded-2xl border border-surface-border bg-surface-card p-4">
      <label htmlFor="sa-search" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Search className="size-4 text-ink-supporting" aria-hidden />
        A signed authorization just arrived? Find the customer
      </label>
      <input
        id="sa-search"
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

  // ── Single-customer task ───────────────────────────────────────────────────
  if (openId) {
    const hasNext = remaining.some(it => it.id !== openId)
    return (
      <div className="space-y-4">
        {searchBox}
        <StewardshipTask
          key={openId}
          itemId={openId}
          forceServicingAccess
          hideBackHeader
          hasNextInActivity={hasNext}
          // A submission or a completed servicing request advances the sequence.
          onAdvanceToNext={advanceToNext}
          // A completed servicing request (all policies confirmed) deletes the
          // outreach row and the task calls onBack; treat that as advancing to
          // the next customer rather than leaving the screen.
          onBack={advanceToNext}
        />
      </div>
    )
  }

  // ── Completion state ───────────────────────────────────────────────────────
  return (
    <section className="space-y-5">
      {searchBox}

      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-ink">About servicing access</p>
        {!mentorOpen && (
          <MentorCapButton
            onOpen={() => setMentorOpen(true)}
            label="Show mentoring on servicing access"
          />
        )}
      </div>
      {mentorOpen && (
        <MentorCapPanel onClose={() => setMentorOpen(false)}>
          Servicing access is the step between outreach and operations preparation. When a signed
          servicing-agent authorization comes back, open the customer, save the signed form to their
          documents, then prepare the carrier email asking the carrier to process it. Attach the form,
          send it, and confirm Email Sent — that starts the seven-day carrier follow-up. Record each
          carrier confirmation as it arrives, or sooner if the carrier confirms early. Once every policy
          is confirmed, the customer moves into Operations Preparation automatically. Everything is saved
          once and recorded in the customer&apos;s history.
        </MentorCapPanel>
      )}

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-surface-border bg-surface-card p-10 text-center">
        <CheckCircle2 className="size-12 text-status-confirmed-strong" aria-hidden />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-ink">
            {handledCount > 0 ? 'Servicing access complete' : 'No servicing access work right now'}
          </p>
          <p className="text-lg text-ink-secondary">
            {handledCount > 0
              ? `You handled ${handledCount} ${handledCount === 1 ? 'customer' : 'customers'} this session. There is no more servicing access work waiting.`
              : 'No signed authorizations are waiting to be processed. When one arrives, find the customer above to start, or check back as forms come in.'}
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
          <FileCheck2 className="size-4" aria-hidden /> Servicing Access
        </p>
      </div>
    </section>
  )
}
