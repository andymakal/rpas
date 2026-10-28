'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquare, RefreshCw, Search, Clock, CalendarClock } from 'lucide-react'
import { OperationalTag } from '@/components/workflow'
import { useWorkReservation } from '@/lib/reservations/useWorkReservation'
import { StewardshipTask } from '../StewardshipClient'
import { CustomerSearch, type CustomerSearchHit } from '@/components/CustomerSearch'

type PopulationCustomer = {
  id: string
  first_name: string | null
  last_name: string | null
}

type PopulationItem = {
  id: string
  customer: PopulationCustomer
  /** Timestamp of the newest recorded interaction, or null. */
  last_touch_at?: string | null
  /** The event-specific type of the newest recorded interaction (e.g. "Email
   * Received", "Customer Reached"), from the shared history model. Null when no
   * interaction is recorded yet. */
  last_interaction_type?: string | null
  /** The promised callback / signature-chase date shown on the list, or null. */
  next_follow_up?: string | null
  /** Whether that follow-up is due on the actor's calendar. */
  interaction_follow_up_due?: boolean
}

type SearchResult = CustomerSearchHit

function fullName(c: PopulationCustomer): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'this customer'
}

/** A short, human date for a date-only (YYYY-MM-DD) or ISO value. Date only, no
 * clock time, so a promised follow-up date reads as the day it is owed. */
function formatDateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const d = value.length <= 10 ? new Date(`${value}T00:00:00`) : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A short date-and-time for the last recorded interaction. */
function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
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
  // The conversation open right now. null while on the relationship list.
  const [openId, setOpenId] = useState<string | null>(null)

  // Soft reservation coordination so two employees never land on the same
  // conversation. A self-expiring lease over the stewardship_outreach row; it
  // changes no business record and is never an assignment.
  const { reserveOne, release } = useWorkReservation({
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

  // The relationship list, overdue/due follow-ups first and everyone else after,
  // each group newest-interaction first so the most recently active conversation
  // leads. No customer is hidden — due work is simply surfaced at the top.
  const sortedItems = useMemo(() => {
    const byRecency = (a: PopulationItem, b: PopulationItem) => {
      const at = a.last_touch_at ? new Date(a.last_touch_at).getTime() : 0
      const bt = b.last_touch_at ? new Date(b.last_touch_at).getTime() : 0
      return bt - at
    }
    const due = items.filter(it => it.interaction_follow_up_due).sort(byRecency)
    const rest = items.filter(it => !it.interaction_follow_up_due).sort(byRecency)
    return [...due, ...rest]
  }, [items])

  // Open a specific conversation (a list card click or a searched customer):
  // reserve it (deliberate open proceeds regardless of lease) and open it.
  const openConversation = useCallback(async (itemId: string) => {
    await reserveOne(itemId)
    setOpenId(itemId)
  }, [reserveOne])

  // Return to the relationship list from an open conversation. Releases the
  // soft reservation and refreshes the population so a resolved customer (signed
  // authorization received, or a refusal) drops off and a new follow-up date
  // shows. This is the ONLY navigation out of a conversation: leaving records or
  // completes nothing, and it never auto-opens another customer.
  const backToConversations = useCallback(() => {
    void release()
    setOpenId(null)
    void load()
  }, [release, load])

  // ── Customer search: open a specific customer when a response arrives ───────
  const [searchError, setSearchError] = useState<string | null>(null)

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
      await openConversation(itemId)
    } catch {
      setSearchError('Network error opening the customer.')
    } finally {
      setOpening(false)
    }
  }, [openConversation])

  // The customer-search box, always available so an employee can jump straight
  // to a customer when a response arrives — INCLUDING when a load failed. The
  // search opens a specific customer directly (its own reserve path), so a
  // population load failure must never make it inaccessible.
  const searchBox = (
    <div className="space-y-2 rounded-2xl border border-surface-border bg-surface-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Search className="size-4 text-ink-supporting" aria-hidden />
        Find a customer
      </p>
      <CustomerSearch<SearchResult>
        scope={projectId ? { kind: 'project', projectId } : { kind: 'myWork' }}
        onSelect={r => { void openCustomer(r.id) }}
        placeholder="Search by name or phone…"
        ariaLabel="Find a customer by name or phone"
      />
      {searchError && <p className="text-sm text-rose-700">{searchError}</p>}
      {opening && (
        <p className="flex items-center gap-1.5 text-sm text-ink-supporting">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Opening…
        </p>
      )}
    </div>
  )

  // ── Open conversation ───────────────────────────────────────────────────────
  if (openId) {
    return (
      <div className="space-y-4">
        {/* The established three-column working layout: the dedicated Customer
            Interaction action column (record incoming/outgoing email, phone, or
            text, set a follow-up, resolve the conversation) on the left, the
            customer contact card + policies in the center, and the shared
            customer history on the right. Recording never advances; the only
            way out is Back to Conversations, which returns to the list. */}
        <StewardshipTask
          key={openId}
          itemId={openId}
          forceCustomerInteraction
          hideBackHeader
          // Both the left-column "Back to Conversations" control and a resolved
          // outcome (signed authorization received / refusal) return to the
          // relationship list. Nothing auto-opens another customer.
          onAdvanceToNext={backToConversations}
          onBack={backToConversations}
        />
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading conversations…
      </div>
    )
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  // A load failure is surfaced with a retry, but the customer search stays ABOVE
  // it so an employee can always open a specific customer who just responded.
  if (error) {
    return (
      <div className="space-y-4">
        {searchBox}
        <div className="space-y-4 rounded-2xl border border-tag-blocked-border bg-tag-blocked-fill p-6 text-tag-blocked-text">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); setLoading(true); void load() }}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-border-strong bg-surface-card px-4 py-2 text-base font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
        </div>
      </div>
    )
  }

  // ── Relationship list ────────────────────────────────────────────────────────
  return (
    <section>
      {/* Find a customer stays visible while browsing: sticky to the top of
          WorkflowPage's existing scrolling work area so the conversation list
          scrolls underneath it. The work area is the only scroller (no new
          scroll container), the layout stays single-column, and the search
          behavior is unchanged — only its position is pinned. The box carries a
          solid surface background and an opaque bottom gutter (pb-5) so the
          Conversations heading and cards begin below it with normal spacing and
          nothing shows between them as the list scrolls under. */}
      <div className="sticky top-0 z-10 bg-workflow-surface pb-5">
        {searchBox}
      </div>

      <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">
          Conversations{items.length > 0 ? ` (${items.length})` : ''}
        </h2>
        <button
          type="button"
          onClick={() => { setLoading(true); void load() }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-supporting transition-colors hover:text-ink"
        >
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </button>
      </div>

      {sortedItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-surface-border bg-surface-card p-10 text-center">
          <MessageSquare className="size-10 text-ink-muted" aria-hidden />
          <p className="text-lg font-semibold text-ink">No active conversations right now</p>
          <p className="text-base text-ink-secondary">
            No customers are in an active conversation. When one responds, find the customer above to
            start, or refresh as responses come in.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sortedItems.map(it => {
            const last = formatDateTime(it.last_touch_at)
            const lastType = it.last_interaction_type?.trim() || null
            const followUp = formatDateOnly(it.next_follow_up)
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => void openConversation(it.id)}
                  className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border-2 border-surface-border bg-surface-card px-6 py-5 text-left transition-colors hover:border-teal-400 hover:bg-brand-wash/50 focus-visible:border-teal-400 focus-visible:bg-brand-wash/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl font-semibold text-ink">{fullName(it.customer)}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-base text-ink-supporting">
                      <Clock className="size-4 shrink-0" aria-hidden />
                      {last
                        ? (lastType
                            ? `Last interaction: ${lastType} · ${last}`
                            : `Last interaction ${last}`)
                        : 'No interaction recorded yet'}
                    </span>
                  </span>

                  {followUp && (
                    it.interaction_follow_up_due ? (
                      <OperationalTag tone="exception">
                        <CalendarClock className="mr-1.5 size-4 shrink-0" aria-hidden />
                        Follow-up due {followUp}
                      </OperationalTag>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong px-3 py-1.5 text-base font-medium text-ink-secondary">
                        <CalendarClock className="size-4 shrink-0 text-ink-supporting" aria-hidden />
                        Follow-up {followUp}
                      </span>
                    )
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      </div>
    </section>
  )
}

// (The former auto-open, continuous one-customer-at-a-time flow is removed:
// Customer Interaction is now a searchable relationship list. Selecting a
// customer opens the shared three-column StewardshipTask (forceCustomerInteraction);
// leaving returns to the list and records nothing.)
