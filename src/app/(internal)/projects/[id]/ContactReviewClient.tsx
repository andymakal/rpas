'use client'

/**
 * Contact Research — the single consolidated contact-finding surface for a
 * project: a fast look-up-and-complete pass over every customer whose contact
 * information is incomplete (missing a usable email OR phone). This one screen
 * replaces the former two separate activities (a "research exception" board
 * surface for customers missing both methods, and a "contact review" project
 * surface for customers missing one). A customer appears here once regardless of
 * how many methods are missing.
 *
 * The worker works the list continuously: open a customer, search Gateway by
 * their last name and policy number, read what Gateway shows, type in the email
 * and/or phone they find, and Save & Next — or, if Gateway has nothing usable,
 * Nothing Usable & Next. Either action advances to the next customer in place;
 * the worker never returns to the queue between customers, and a customer
 * already handled this session is not presented again.
 *
 * Two surfaces, kept distinct per the business rule: the actively-recommended
 * "Needs contact information" list, and a visible "No Usable Contact
 * Information" exception for customers with no usable email or phone whose
 * research came up empty. The exception stays on screen (the agency must keep
 * sight of who it cannot reach) but is never re-recommended as fresh work; the
 * worker can still open one deliberately to look again.
 *
 * Reuses the shared light-theme workflow design system (the same look as the
 * Stewardship research task) and the Assistant panel. It writes only to the
 * customer record and never creates stewardship work, duplicate customers, or a
 * separate contact record.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Save, SkipForward, ClipboardCheck, UserRound, PhoneOff,
} from 'lucide-react'
import {
  TaskShell, ActionPanel, PrimaryAction, WorkflowButton, NextNote,
  SlimTaskHeader, AssistantPanel, GatewayLookup,
  CustomerContactCard, type CustomerContact,
  QueueListHeader, CustomerQueueCard, QueueEmptyState, OperationalTag,
} from '@/components/workflow'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'

type ContactReviewCustomer = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  has_email: boolean
  has_phone: boolean
  has_address: boolean
  street: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  policy_number: string | null
  /** Reachability. 'needs_research' = reachable (missing one method), routine
   * active list. 'no_usable_contact' = no usable email or phone at all, always
   * shown in the No Usable Contact Information section. researched_unsuccessfully
   * sub-labels outstanding vs previously-unsuccessful and gates recommendation. */
  status: 'needs_research' | 'no_usable_contact'
  researched_unsuccessfully: boolean
}

type Summary = {
  total: number
  missing_both: number
  one_usable: number
  needs_research: number
  no_usable_contact: number
  actionable: number
}

function fullName(c: Pick<ContactReviewCustomer, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

function usable(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0
}

/** A mailing address is usable only when all four parts are on file — the same
 * rule the shared CustomerContactCard and the read model apply. */
function usableAddress(c: {
  street: string | null; address_line1?: string | null
  city: string | null; state: string | null; zip: string | null
}): boolean {
  const hasStreet = usable(c.street) || usable(c.address_line1)
  return hasStreet && usable(c.city) && usable(c.state) && usable(c.zip)
}

/** Whether a customer matches the active missing-method filter. 'all' matches
 * any gap; a specific method matches only when THAT method is missing. */
function methodMatches(
  c: ContactReviewCustomer,
  filter: 'all' | 'email' | 'phone' | 'address',
): boolean {
  if (filter === 'all') return true
  if (filter === 'email') return !c.has_email
  if (filter === 'phone') return !c.has_phone
  return !c.has_address
}

/** Which contact methods a customer is missing. Email, phone, and mailing
 * address are the three independent methods Contact Research resolves. */
function missingMethods(c: ContactReviewCustomer): ('email' | 'phone' | 'address')[] {
  const out: ('email' | 'phone' | 'address')[] = []
  if (!c.has_email) out.push('email')
  if (!c.has_phone) out.push('phone')
  if (!c.has_address) out.push('address')
  return out
}

const METHOD_WORD: Record<'email' | 'phone' | 'address', string> = {
  email: 'email', phone: 'phone', address: 'mailing address',
}

/** The compact one-line summary of what the customer is missing. */
function gapDetail(c: ContactReviewCustomer): string {
  if (!c.has_email && !c.has_phone) {
    return c.has_address ? 'No email, no phone' : 'No email, no phone, no mailing address'
  }
  const missing = missingMethods(c)
  if (missing.length === 0) return 'Complete'
  const words = missing.map((m) => METHOD_WORD[m])
  const joined = words.length === 1
    ? words[0]
    : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]
  return `Missing ${joined}`
}

export function ContactReviewClient({
  projectId, initialCustomerId = null,
}: {
  projectId: string
  /** A deliberate deep-link (?customer_id=) to reopen ONE customer's task, even
   * when they have been researched-not-found and so are suppressed from the
   * routine list. The research-again path from the customer page. */
  initialCustomerId?: string | null
}) {
  // Mentoring is the app-wide "how to do it" coaching layer. The per-section
  // MentorGuidance controls below are always shown; the global toggle (in the
  // shared header) only sets their default open/closed state, so this component
  // no longer reads the global value directly.
  const [rows, setRows] = useState<ContactReviewCustomer[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // A customer reopened by deep-link that is NOT in the suppressed list. Held
  // separately so the task can open them without re-adding them to the routine
  // list. Cleared once their contact info is completed.
  const [reopened, setReopened] = useState<ContactReviewCustomer | null>(null)

  // The customer open right now. null means the list is showing.
  const [openId, setOpenId] = useState<string | null>(null)
  // Simple filters over the list. methodFilter narrows to one missing contact
  // method (email / phone / mailing address); 'all' shows every gap. The research
  // filter works UNRESEARCHED customers first and keeps previously-unsuccessful
  // research available as a separate pass without re-recommending it as new work.
  const [methodFilter, setMethodFilter] = useState<'all' | 'email' | 'phone' | 'address'>('all')
  const [includeUnsuccessful, setIncludeUnsuccessful] = useState(false)
  // True once the worker has deliberately returned to the list, so the direct-
  // open landing does not immediately re-open the first customer again.
  const [showingList, setShowingList] = useState(false)
  // Customers handled during THIS session (saved or skipped). They are not
  // presented again, so the worker moves forward continuously. Session-local by
  // design: the requirement is "not during the current review session", and the
  // durable truth is simply whether the customer still lacks contact info.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setError(null)
    try {
      const url = initialCustomerId
        ? `/api/projects/${projectId}/contact-review?customer_id=${encodeURIComponent(initialCustomerId)}`
        : `/api/projects/${projectId}/contact-review`
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load'); return }
      setRows(json.data.customers as ContactReviewCustomer[])
      setSummary(json.data.summary as Summary)
      // A deep-linked reopen that is not already in the list: hold it so the
      // task can open it directly. If it IS in the list (still outstanding),
      // the list card opens it normally and no separate hold is needed.
      const reopen = (json.data.reopen ?? null) as ContactReviewCustomer | null
      if (reopen && !(json.data.customers as ContactReviewCustomer[]).some(c => c.customer_id === reopen.customer_id)) {
        setReopened(reopen)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [projectId, initialCustomerId])

  useEffect(() => { void load() }, [load])

  // Auto-open the deep-linked customer once loaded, so the research-again link
  // lands straight on their task. Applied once per reopened id.
  const openedReopenRef = useRef<string | null>(null)
  useEffect(() => {
    const target = reopened ?? rows.find(r => r.customer_id === initialCustomerId) ?? null
    if (!target) return
    if (openedReopenRef.current === target.customer_id) return
    openedReopenRef.current = target.customer_id
    setOpenId(target.customer_id)
  }, [reopened, rows, initialCustomerId])

  const directOpenedRef = useRef(false)

  // The still-to-do list: project customers surfaced by Contact Research, minus
  // the ones handled this session. Saved-and-still-incomplete customers stay out
  // of the list for the session because they are in `handled`.
  const remaining = useMemo(
    () => rows.filter(r => !handled.has(r.customer_id)),
    [rows, handled],
  )

  // Split the still-to-do list into the two surfaces the business rule keeps
  // distinct: actively-recommended outstanding research, and the visible "No
  // Usable Contact Information" exception (customers with no usable email or
  // phone whose research came up empty). The exception stays on screen so the
  // agency keeps seeing who it cannot reach; it is not counted as outstanding
  // work and is presented separately, below the active list.
  const activeRemaining = useMemo(
    () => remaining.filter(r => r.status === 'needs_research' && methodMatches(r, methodFilter)),
    [remaining, methodFilter],
  )
  // The No Usable Contact Information section shows EVERY customer with no usable
  // email or phone, split by research state so outstanding research is distinct
  // from research already completed unsuccessfully (which is not re-recommended).
  const exceptionRemaining = useMemo(
    () => remaining.filter(r => r.status === 'no_usable_contact' && methodMatches(r, methodFilter)),
    [remaining, methodFilter],
  )
  const exceptionOutstanding = useMemo(
    () => exceptionRemaining.filter(r => !r.researched_unsuccessfully),
    [exceptionRemaining],
  )
  const exceptionUnsuccessful = useMemo(
    () => exceptionRemaining.filter(r => r.researched_unsuccessfully),
    [exceptionRemaining],
  )

  // The ordered work queue the worker walks through with Save & Next / Nothing
  // Usable & Next. Unresearched customers come FIRST: the actively-recommended
  // list, then the outstanding (never-researched) No Usable Contact exceptions.
  // Previously-unsuccessful research is a SEPARATE pass — only included when the
  // worker opts in via the research filter — so it is never repeatedly
  // recommended as fresh work. Honors the current missing-method filter.
  const workQueue = useMemo(() => {
    const unresearched = [...activeRemaining, ...exceptionOutstanding]
    return includeUnsuccessful ? [...unresearched, ...exceptionUnsuccessful] : unresearched
  }, [activeRemaining, exceptionOutstanding, exceptionUnsuccessful, includeUnsuccessful])

  // Direct working workflow: when there is no deep-link, clicking "Find Missing
  // Contact Information" lands straight on the FIRST customer requiring research,
  // not an intermediate list. Applied once, after the first load, and only while
  // the worker has not deliberately opened the list. The list is still one click
  // away (the task's "Back to the list") and the filters live there.
  useEffect(() => {
    if (loading || initialCustomerId) return
    if (directOpenedRef.current) return
    directOpenedRef.current = true
    const first = workQueue[0]
    if (first) setOpenId(first.customer_id)
    else setShowingList(true)
  }, [loading, initialCustomerId, workQueue])

  const openCustomer = useMemo(
    () =>
      rows.find(r => r.customer_id === openId) ??
      (reopened && reopened.customer_id === openId ? reopened : null),
    [rows, openId, reopened],
  )

  // Mark a customer handled for this session and advance to the next unhandled
  // customer. If none remain, return to the (now empty) list so the worker sees
  // the done state. Used by both Save & Next and Nothing Usable & Next.
  const markHandledAndAdvance = useCallback((customerId: string) => {
    setHandled(prev => {
      const next = new Set(prev)
      next.add(customerId)
      return next
    })
    // Advance to the next customer in the current work queue — unresearched
    // first, honoring the active missing-method filter, and only walking into
    // previously-unsuccessful research when the worker has opted into that pass.
    // `handled` updates on the next render, so exclude this id explicitly here.
    const next = workQueue.find(
      r => r.customer_id !== customerId && !handled.has(r.customer_id),
    )
    if (next) {
      setOpenId(next.customer_id)
    } else {
      // Nothing left to work: fall back to the list so the worker sees the
      // done state rather than a blank task.
      setOpenId(null)
      setShowingList(true)
    }
  }, [workQueue, handled])

  // Hold the spinner until the direct-open decision has run on a fresh landing
  // (no deep-link, not yet showing the list), so the intermediate list never
  // flashes before the first customer opens.
  const awaitingDirectOpen =
    !loading && !initialCustomerId && !directOpenedRef.current && openId === null && !showingList
  if (loading || awaitingDirectOpen) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-6 text-ink-supporting">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading contact research…
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
  if (openId && openCustomer) {
    // Whether this is the deep-linked reopen (not part of the routine list).
    const isReopened = !!reopened && reopened.customer_id === openCustomer.customer_id
    return (
      <ContactReviewTask
        key={openCustomer.customer_id}
        projectId={projectId}
        customer={openCustomer}
        remainingCount={workQueue.filter(r => r.customer_id !== openCustomer.customer_id).length}
        onBack={() => { setOpenId(null); setShowingList(true); if (isReopened) setReopened(null) }}
        onContactChange={(updated) => {
          // The shared card persisted a contact change for this customer. Fold
          // the authoritative record back into the local rows so the list and
          // summary stay accurate without a reload. This does NOT advance — the
          // worker advances deliberately with Save & Next.
          const addr = usableAddress(updated)
          setRows(prev => prev.map(r => r.customer_id === updated.id
            ? { ...r,
                email: updated.email, phone: updated.phone,
                has_email: usable(updated.email), has_phone: usable(updated.phone),
                has_address: addr,
                street: updated.street, address_line1: updated.address_line1 ?? r.address_line1,
                city: updated.city, state: updated.state, zip: updated.zip,
                email_verified_at: updated.email_verified_at,
                phone_verified_at: updated.phone_verified_at,
                address_verified_at: updated.address_verified_at }
            : r))
          setReopened(prev => prev && prev.customer_id === updated.id
            ? { ...prev,
                email: updated.email, phone: updated.phone,
                has_email: usable(updated.email), has_phone: usable(updated.phone),
                has_address: addr,
                street: updated.street, address_line1: updated.address_line1 ?? prev.address_line1,
                city: updated.city, state: updated.state, zip: updated.zip,
                email_verified_at: updated.email_verified_at,
                phone_verified_at: updated.phone_verified_at,
                address_verified_at: updated.address_verified_at }
            : prev)
        }}
        onSaved={() => {
          // Save & Next: the card has already written any edits to the customer
          // record; this advances the session. A reopened customer is not in the
          // list, so for them just clear the hold and return to the list rather
          // than advancing to a next row.
          if (isReopened) { setReopened(null); setOpenId(null); setShowingList(true) }
          else markHandledAndAdvance(openCustomer.customer_id)
        }}
        onSkipped={() => {
          // Recording another unsuccessful research keeps the customer settled;
          // the reopened one simply returns to the list, the in-list one
          // advances to the next.
          if (isReopened) { setReopened(null); setOpenId(null); setShowingList(true) }
          else markHandledAndAdvance(openCustomer.customer_id)
        }}
      />
    )
  }

  // ── The list ─────────────────────────────────────────────────────────────
  const total = summary?.total ?? rows.length
  const handledCount = total - remaining.length

  return (
    <section className="space-y-5">
      <AssistantPanel heading="Find the contact information Gateway is missing">
        {/* Mentoring (HOW), separate from the Assistant (WHAT), sits immediately
            ABOVE the instructions it explains — never at the bottom. Its own
            purple control is always shown; the global Mentoring toggle only sets
            its default open/closed state, and employees can toggle this section
            independently. */}
        <MentorGuidance label="How to find a match">
          Search Gateway with the customer&apos;s last name and policy number together — the policy
          number is the surest way to land on the right record. If the policy number finds nothing,
          try the last name alone, then confirm the date of birth before you copy any email or
          phone back here.
        </MentorGuidance>
        <div className="space-y-3 text-lg leading-relaxed text-ink-secondary">
          <p>
            The Cassidy import left these customers without a complete way to reach them — missing a
            usable email, phone, or mailing address. They are all the same research: open a customer,
            search Gateway by their last name and policy number, and fill in whatever email, phone, or
            mailing address Gateway shows. Email, phone, and postal mail are independent — any one you
            find is progress, and research never blocks outreach. Each save writes straight to the
            customer record.
          </p>
          <p className="text-base text-ink-supporting">
            Save &amp; Next moves you to the next customer; if Gateway has nothing usable, Nothing
            Usable &amp; Next records that research found nothing and keeps you moving. Unresearched
            customers come first; previously-unsuccessful research is a separate pass you opt into
            below. A customer you have handled will not keep coming back, and anyone whose details
            later turn up returns automatically. Customers with no usable contact at all stay visible
            below, so the agency keeps sight of who it cannot reach.
          </p>
        </div>
        {workQueue.length > 0 && (
          <PrimaryAction
            icon={ClipboardCheck}
            label={handledCount > 0 ? 'Continue where you left off' : 'Start the first customer'}
            onClick={() => setOpenId(workQueue[0].customer_id)}
          />
        )}
      </AssistantPanel>

      {/* Simple filters: narrow to one missing contact method, and choose
          whether the previously-unsuccessful pass is included. They shape both
          the lists below and the Save/Nothing-Usable & Next progression. */}
      <ContactResearchFilters
        methodFilter={methodFilter}
        onMethodFilter={setMethodFilter}
        includeUnsuccessful={includeUnsuccessful}
        onIncludeUnsuccessful={setIncludeUnsuccessful}
      />

      <QueueListHeader
        icon={UserRound}
        label="Needs contact information"
        count={activeRemaining.length}
        blurb="Reachable customers missing a method — fill in the missing email, phone, or mailing address"
      />

      {activeRemaining.length === 0 ? (
        <QueueEmptyState>
          {total === 0
            ? 'Every customer in this project has a usable email, phone, and mailing address, or has been researched.'
            : methodFilter !== 'all'
              ? 'No reachable customers match this filter. Clear it or change the missing-information type.'
              : exceptionRemaining.length > 0
                ? 'No reachable customers are missing a method. The customers below have no usable contact information at all — see the section beneath this one.'
                : 'All caught up. Every customer has been handled.'}
        </QueueEmptyState>
      ) : (
        <div className="space-y-3">
          {activeRemaining.map(c => (
            <CustomerQueueCard
              key={c.customer_id}
              name={fullName(c)}
              detail={gapDetail(c)}
              onOpen={() => setOpenId(c.customer_id)}
            />
          ))}
        </div>
      )}

      {/* No Usable Contact Information — EVERY customer with no usable email or
          phone, so the agency never loses sight of anyone it cannot reach. Split
          by research state: outstanding research still worth doing, and research
          already completed unsuccessfully (kept visible but NOT re-recommended).
          The worker can open any one to look again. */}
      {exceptionRemaining.length > 0 && (
        <section className="space-y-3">
          <QueueListHeader
            icon={PhoneOff}
            label="No Usable Contact Information"
            count={exceptionRemaining.length}
            blurb="No usable email or phone on file. Shown so the agency can see everyone it cannot reach; open one to research contact information."
          />
          {exceptionOutstanding.length > 0 && (
            <div className="space-y-3">
              <p className="text-base font-medium text-ink-secondary">Research outstanding</p>
              {exceptionOutstanding.map(c => (
                <CustomerQueueCard
                  key={c.customer_id}
                  name={fullName(c)}
                  detail="No email, no phone"
                  trailing={<OperationalTag tone="reason">Research needed</OperationalTag>}
                  onOpen={() => setOpenId(c.customer_id)}
                />
              ))}
            </div>
          )}
          {exceptionUnsuccessful.length > 0 && (
            <div className="space-y-3">
              <p className="text-base font-medium text-ink-secondary">Research completed — nothing found</p>
              {exceptionUnsuccessful.map(c => (
                <CustomerQueueCard
                  key={c.customer_id}
                  name={fullName(c)}
                  detail="No email, no phone"
                  trailing={<OperationalTag tone="exception">Research unsuccessful</OperationalTag>}
                  onOpen={() => setOpenId(c.customer_id)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactResearchFilters — simple, high-contrast filters over the list: narrow
// to one missing contact method, and opt the previously-unsuccessful pass in or
// out. Selectable controls use the shared WorkflowButton brand treatment rather
// than the near-black shadcn default, per the light-theme design system.
// ─────────────────────────────────────────────────────────────────────────────

function ContactResearchFilters({
  methodFilter, onMethodFilter, includeUnsuccessful, onIncludeUnsuccessful,
}: {
  methodFilter: 'all' | 'email' | 'phone' | 'address'
  onMethodFilter: (v: 'all' | 'email' | 'phone' | 'address') => void
  includeUnsuccessful: boolean
  onIncludeUnsuccessful: (v: boolean) => void
}) {
  const methodOptions: { value: 'all' | 'email' | 'phone' | 'address'; label: string }[] = [
    { value: 'all', label: 'All gaps' },
    { value: 'email', label: 'Missing email' },
    { value: 'phone', label: 'Missing phone' },
    { value: 'address', label: 'Missing address' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-surface-border bg-surface-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          Missing information
        </span>
        {methodOptions.map(o => (
          <WorkflowButton
            key={o.value}
            selected={methodFilter === o.value}
            onClick={() => onMethodFilter(o.value)}
          >
            {o.label}
          </WorkflowButton>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold uppercase tracking-wide text-ink-supporting">
          Research
        </span>
        <WorkflowButton
          selected={!includeUnsuccessful}
          onClick={() => onIncludeUnsuccessful(false)}
        >
          Unresearched first
        </WorkflowButton>
        <WorkflowButton
          selected={includeUnsuccessful}
          onClick={() => onIncludeUnsuccessful(true)}
        >
          Include previously unsuccessful
        </WorkflowButton>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactReviewTask — one customer. The left ActionPanel carries the Mentoring,
// the shared Gateway look-up, and the Save & Next / Nothing Usable progression;
// the right column is the shared, editable CustomerContactCard, which owns the
// contact capture and writes straight to the customer record.
// ─────────────────────────────────────────────────────────────────────────────

/** Map a Contact Research row onto the shared card's customer shape. Every field
 * already lives on the row; the card reads and corrects the customer record. */
function toCardCustomer(c: ContactReviewCustomer): CustomerContact {
  return {
    id: c.customer_id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    street: c.street,
    address_line1: c.address_line1,
    city: c.city,
    state: c.state,
    zip: c.zip,
    email_verified_at: c.email_verified_at,
    phone_verified_at: c.phone_verified_at,
    address_verified_at: c.address_verified_at,
  }
}

function ContactReviewTask({
  projectId, customer, remainingCount, onBack, onSaved, onSkipped, onContactChange,
}: {
  projectId: string
  customer: ContactReviewCustomer
  remainingCount: number
  onBack: () => void
  /** Save & Next — advance the session. The card has already persisted edits. */
  onSaved: () => void
  /** Nothing Usable & Next — the durable research record was written; advance. */
  onSkipped: () => void
  /** The card persisted a contact change; keep the list/summary in sync. */
  onContactChange: (updated: CustomerContact) => void
}) {
  const name = fullName(customer)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Nothing Usable & Next records the unsuccessful research DURABLY (per
  // still-missing method) before advancing, so the customer stops coming back on
  // later passes instead of only being hidden for this session. The record is
  // not a close: the customer keeps everything, and a found value re-opens them.
  // A failure to record is surfaced and the worker is NOT advanced, so the
  // outcome is never silently lost. It records no contact attempt.
  const nothingUsable = useCallback(async () => {
    setBusy(true); setSaveError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/contact-review/${customer.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ research_nothing_found: true }),
      })
      const json = await res.json()
      if (!res.ok) { setSaveError(json.error ?? 'Could not record'); return }
      onSkipped()
    } catch {
      setSaveError('Network error')
    } finally {
      setBusy(false)
    }
  }, [projectId, customer.customer_id, onSkipped])

  return (
    <TaskShell
      header={<SlimTaskHeader onBack={onBack} backLabel="Back to the list" />}
      action={
        <ActionPanel heading={`Complete contact for ${name}`}>
          {/* Mentoring (HOW) sits immediately ABOVE the instructions it explains
              — the Gateway look-up and contact capture below — never at the
              bottom. Its own purple control is always shown; the global toggle
              only sets the default open/closed state. */}
          <MentorGuidance label="How to fill contact info">
            Search Gateway with the last name and policy number together — the policy number lands
            you on the right record fastest. Enter one usable method and move on; you do not need
            both. A phone with no email is still progress. Only overwrite a value on the card to the
            right when you are confident Gateway is right.
          </MentorGuidance>

          {/* Why this is here — a prominent, high-contrast operational reason. */}
          <div className="flex items-center gap-2 rounded-xl border border-status-missing-border bg-status-missing-soft p-4 text-lg text-status-missing-strong">
            <UserRound className="size-5 shrink-0" aria-hidden /> {gapDetail(customer)}. Look this customer up in Gateway.
          </div>

          {/* No Usable Contact Information exception opened deliberately: say
              plainly that earlier research came up empty, so the worker knows
              this is a re-check, not fresh outstanding work. */}
          {customer.status === 'no_usable_contact' && customer.researched_unsuccessfully && (
            <OperationalTag tone="exception">
              Earlier research found no usable email or phone. This customer stays on the No Usable
              Contact Information list; look again only if you have a new lead.
            </OperationalTag>
          )}

          {/* Step 1: the shared Gateway look-up — last name + policy number with
              Copy buttons, identical to the Stewardship research task. */}
          <GatewayLookup
            lastName={customer.last_name}
            fallbackName={name}
            policyNumber={customer.policy_number}
          />

          {/* Step 2 is the editable Customer Contact card on the right: enter or
              correct email, phone, and mailing address there. It writes straight
              to the customer record and clears a value's verification when it
              changes. */}
          <div className="rounded-xl border border-surface-border bg-surface-muted/40 p-4 text-base text-ink-supporting">
            Enter what Gateway shows on the Customer Contact card to the right. Each field saves on
            its own; a phone with no email is still progress.
          </div>

          {saveError && (
            <p className="rounded-lg border border-tag-blocked-border bg-tag-blocked-fill px-3 py-2 text-base text-tag-blocked-text">
              {saveError}
            </p>
          )}

          {/* The two advancing actions. Save & Next advances to the next
              customer (edits are already persisted by the card); Nothing Usable
              & Next records the unsuccessful research durably and continues. */}
          <div className="space-y-3">
            <PrimaryAction
              icon={Save}
              label="Save & Next"
              onClick={onSaved}
              disabled={busy}
            />
            <WorkflowButton icon={SkipForward} onClick={nothingUsable} disabled={busy} className="w-full justify-start">
              Nothing Usable &amp; Next
            </WorkflowButton>
          </div>

          <NextNote>
            Edit email, phone, and address on the Customer Contact card to the right; each change
            saves on its own. Save &amp; Next opens the next customer. Nothing Usable &amp; Next
            records that research found nothing usable (so this customer will not keep coming back)
            and continues.
            {remainingCount > 0
              ? ` ${remainingCount} more after this one.`
              : ' This is the last one in the list.'}
          </NextNote>
        </ActionPanel>
      }
      context={
        <CustomerContactCard
          customer={toCardCustomer(customer)}
          onChange={onContactChange}
        />
      }
    />
  )
}
