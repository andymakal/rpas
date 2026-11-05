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
 * and/or phone they find (saved automatically as entered), and Next Customer —
 * or, if Gateway has nothing usable, Nothing Usable & Next. Either action
 * advances to the next customer in place;
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Loader2,
} from 'lucide-react'
import {
  TaskShell, ActionPanel,
  AssistantPanel,
  CustomerContactCard, type CustomerContact,
  CustomerHistoryCard, NextHistoryEntry,
  QueueEmptyState, OperationalTag, ContactSearch, DoneSkipActions,
} from '@/components/workflow'
import {
  describeContactResearchSelection,
  type HistoryEvent,
  type NextHistoryEntryPreview,
} from '@/lib/stewardship/customer-history'
import { type EmailAvailability } from '@/lib/email-availability'
import { familiarName } from '@/lib/person-name'
import { MentorGuidance } from '@/lib/mentoring/MentorUi'
import { useWorkReservation } from '@/lib/reservations/useWorkReservation'

type ContactReviewCustomer = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  /** The remaining recorded name parts, so every name on this screen renders
   * through the shared Person Name presentation (honoring Goes by and suffix)
   * rather than any page-local formatting. */
  middle_name: string | null
  suffix: string | null
  goes_by: string | null
  suffix_in_familiar: boolean | null
  /** Best-available-precision age (reused project age logic): exact DOB or the
   * masked policy fallback. Null when unknown (never guessed). Age only. */
  age: number | null
  /** True when the age came from the masked policy fallback, so it is shown as
   * approximate. */
  age_approximate: boolean
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
  email_availability: EmailAvailability | null
  contact_alert: string | null
  /** Do Not Text — the durable customer opt-out (customers.sms_opt_out). */
  sms_opt_out: boolean
  /** Text Undeliverable — a recorded text-delivery failure for the number on
   * file (value-scoped; restores on a number change). */
  text_undeliverable: boolean
  /** Every distinct policy number on file for the customer (service policies +
   * associated cases, de-duplicated), for the Search Gateway look-up. */
  policy_numbers: string[]
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

/** The customer's display name, rendered through the shared Person Name
 * presentation so this screen owns no name-formatting logic of its own: the
 * familiar name honors the "Goes by" name and the suffix preference exactly as
 * the shared card and editor do. */
function displayName(c: Pick<ContactReviewCustomer, 'first_name' | 'last_name' | 'middle_name' | 'suffix' | 'goes_by' | 'suffix_in_familiar'>): string {
  return familiarName({
    firstName: c.first_name,
    middleName: c.middle_name,
    lastName: c.last_name,
    suffix: c.suffix,
    goesBy: c.goes_by,
    suffixInFamiliar: c.suffix_in_familiar,
  }) || 'Unknown customer'
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
  // The ONE control: fold previously-unsuccessful research back into the
  // carousel (the escape hatch to re-work the set-aside population). Off by
  // default, so the carousel is the not-yet-researched customers only.
  const [includeUnsuccessful, setIncludeUnsuccessful] = useState(false)
  // True once the worker has deliberately returned to the list, so the direct-
  // open landing does not immediately re-open the first customer again.
  const [showingList, setShowingList] = useState(false)
  // Customers handled during THIS session (saved or skipped). They are not
  // presented again, so the worker moves forward continuously. Session-local by
  // design: the requirement is "not during the current review session", and the
  // durable truth is simply whether the customer still lacks contact info.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  // Temporary reservation coordination: opening and Next Customer / Nothing
  // Usable & Next ask the server for the next AVAILABLE customer, so two employees
  // working Contact Research on the same project never land on the same customer.
  // The reservation is a soft, self-expiring lease the hook heartbeats while the
  // screen is open and releases on save / skip / leave; it changes no customer
  // record. The subject is the customer.
  const { reserveNext, reserveOne, release } = useWorkReservation({
    activity: 'contact_research',
    subjectType: 'customer',
  })

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

  // Reload the project's customers and RETURN the fresh rows, used by the
  // end-of-pass loop-back so it can decide the next customer from current data
  // (after completions and researched-unsuccessfully drops) rather than stale
  // local state. Updates the rows/summary too; never throws (returns [] on
  // failure so the caller falls back to the all-caught-up state).
  const reload = useCallback(async (): Promise<ContactReviewCustomer[]> => {
    try {
      const res = await fetch(`/api/projects/${projectId}/contact-review`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) return []
      const fresh = json.data.customers as ContactReviewCustomer[]
      setRows(fresh)
      setSummary(json.data.summary as Summary)
      return fresh
    } catch {
      return []
    }
  }, [projectId])

  // Auto-open the deep-linked customer once loaded, so the research-again link
  // lands straight on their task. Applied once per reopened id.
  const openedReopenRef = useRef<string | null>(null)
  useEffect(() => {
    const target = reopened ?? rows.find(r => r.customer_id === initialCustomerId) ?? null
    if (!target) return
    if (openedReopenRef.current === target.customer_id) return
    openedReopenRef.current = target.customer_id
    // A deliberate reopen is coordination-tracked (reserved + heartbeated so a
    // teammate sees it busy, released on leave) but never BLOCKED by the lease:
    // open it regardless of whether the reservation was free.
    void reserveOne(target.customer_id)
    setOpenId(target.customer_id)
  }, [reopened, rows, initialCustomerId, reserveOne])

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
    () => remaining.filter(r => r.status === 'needs_research'),
    [remaining],
  )
  // The active (reachable) list split by research state, exactly as the No
  // Usable Contact exception is split. Previously-unsuccessful research is held
  // apart here too so the Next Customer sequence excludes it unless the worker
  // opts in — applied CONSISTENTLY to every incomplete customer, whatever field
  // they are missing, not only the no-usable-contact ones.
  const activeOutstanding = useMemo(
    () => activeRemaining.filter(r => !r.researched_unsuccessfully),
    [activeRemaining],
  )
  const activeUnsuccessful = useMemo(
    () => activeRemaining.filter(r => r.researched_unsuccessfully),
    [activeRemaining],
  )
  // The No Usable Contact Information section shows EVERY customer with no usable
  // email or phone, split by research state so outstanding research is distinct
  // from research already completed unsuccessfully (which is not re-recommended).
  const exceptionRemaining = useMemo(
    () => remaining.filter(r => r.status === 'no_usable_contact'),
    [remaining],
  )
  const exceptionOutstanding = useMemo(
    () => exceptionRemaining.filter(r => !r.researched_unsuccessfully),
    [exceptionRemaining],
  )
  const exceptionUnsuccessful = useMemo(
    () => exceptionRemaining.filter(r => r.researched_unsuccessfully),
    [exceptionRemaining],
  )

  // The ordered work queue the worker walks through with Next Customer / Nothing
  // Usable & Next. Unresearched customers come FIRST: the actively-recommended
  // reachable list, then the outstanding (never-researched) No Usable Contact
  // exceptions. Previously-unsuccessful research is a SEPARATE, OPT-IN pass —
  // included ONLY when the worker explicitly checks "Include previously
  // unsuccessful research" — so it is never recommended as fresh work and the
  // pass finishes when unresearched work is exhausted. This gate applies
  // CONSISTENTLY to every previously-unsuccessful customer regardless of which
  // field they are missing (reachable missing-one AND no-usable-contact).
  // Honors the current missing-method filter.
  // The two passes: never-researched work first, then (only when the box is
  // checked) previously-unsuccessful research. Each honors the missing-method
  // filter. workQueue is the checkbox-gated sequence both advancement buttons
  // and the direct open walk.
  const unresearchedQueue = useMemo(
    () => [...activeOutstanding, ...exceptionOutstanding],
    [activeOutstanding, exceptionOutstanding],
  )
  const previouslyUnsuccessfulQueue = useMemo(
    () => [...activeUnsuccessful, ...exceptionUnsuccessful],
    [activeUnsuccessful, exceptionUnsuccessful],
  )
  const workQueue = useMemo(
    () => includeUnsuccessful
      ? [...unresearchedQueue, ...previouslyUnsuccessfulQueue]
      : unresearchedQueue,
    [unresearchedQueue, previouslyUnsuccessfulQueue, includeUnsuccessful],
  )

  // Repeat research is OPT-IN only. When the never-researched queue is
  // exhausted, the pass is finished — the screen does not automatically enable
  // "Include previously unsuccessful research". Previously-unsuccessful
  // customers enter the automatic sequence only when the employee explicitly
  // checks that box, and both advancement buttons honor that choice. (No
  // auto-opt-in effect: that behavior was deliberately removed.)

  // Direct working workflow: when there is no deep-link, clicking "Find Missing
  // Contact Information" lands straight on the FIRST customer requiring research,
  // not an intermediate list. Applied once, after the first load, and only while
  // the worker has not deliberately opened the list. The list is still one click
  // away (the task's "Back to the list") and the filters live there.
  useEffect(() => {
    if (loading || initialCustomerId) return
    if (directOpenedRef.current) return
    directOpenedRef.current = true
    // Reserve and land on the first AVAILABLE customer (one a teammate is not
    // already working). reserveNext atomically skips reserved customers and
    // hands back the first free one; null means nothing available, so show the
    // list's done state.
    const candidates = workQueue.map(r => r.customer_id)
    void reserveNext(candidates).then(reserved => {
      if (reserved) setOpenId(reserved)
      else setShowingList(true)
    })
  }, [loading, initialCustomerId, workQueue, reserveNext])

  const openCustomer = useMemo(
    () =>
      rows.find(r => r.customer_id === openId) ??
      (reopened && reopened.customer_id === openId ? reopened : null),
    [rows, openId, reopened],
  )

  // Mark a customer handled for this session and advance to the next unhandled
  // customer. If none remain, return to the (now empty) list so the worker sees
  // the done state. Used by both Next Customer and Nothing Usable & Next.
  // Open a customer the worker picked deliberately (a list card, or the
  // Start/Continue button). Coordination-tracked like the continuous flow —
  // reserved and heartbeated so a teammate sees it busy, released on leave — but
  // never BLOCKED: a deliberate pick always opens. The continuous Next Customer
  // path uses reserveNext instead (it must skip a customer a teammate holds).
  const openWithReservation = useCallback((customerId: string) => {
    void reserveOne(customerId)
    setOpenId(customerId)
  }, [reserveOne])

  const markHandledAndAdvance = useCallback((customerId: string) => {
    setHandled(prev => {
      const next = new Set(prev)
      next.add(customerId)
      return next
    })
    // This customer is handled: release its reservation so a teammate is never
    // blocked by a finished item, then reserve and advance to the next AVAILABLE
    // customer. Advancing honors the "Include previously unsuccessful research"
    // choice: it walks the SAME checkbox-gated workQueue the list and the direct
    // open use. Unchecked, the sequence is never-researched work only and the
    // pass finishes when that is exhausted; checked, previously-unsuccessful
    // research joins the sequence. Both advancement buttons respect this.
    // `handled` updates on the next render, so exclude this id here.
    void release()
    const candidates = workQueue
      .filter(r => r.customer_id !== customerId && !handled.has(r.customer_id))
      .map(r => r.customer_id)
    void reserveNext(candidates).then(reserved => {
      if (reserved) {
        setOpenId(reserved)
        return
      }
      // End of the pass. This is a continuous carousel, not a list: instead of a
      // done screen, loop back to the START. Reload the project (so anyone
      // completed or marked researched-unsuccessfully has genuinely left) and
      // clear this session's handled set, so skipped-but-unresolved customers
      // come back around. Then reserve the first customer of the refreshed set;
      // only when the project truly has no not-yet-researched customers left
      // does nothing open (the screen then shows the all-caught-up state).
      void reload().then(fresh => {
        const next = (includeUnsuccessful ? fresh : fresh.filter(r => !r.researched_unsuccessfully))
          .filter(r => r.status === 'needs_research' || r.status === 'no_usable_contact')
        setHandled(new Set())
        if (next.length === 0) { setOpenId(null); setShowingList(true); return }
        void reserveNext(next.map(r => r.customer_id)).then(r => {
          if (r) setOpenId(r)
          else { setOpenId(null); setShowingList(true) }
        })
      })
    })
  }, [workQueue, handled, includeUnsuccessful, release, reserveNext, reload])

  // The compact, dynamically-updated filter summary, computed over the rows that
  // match the active missing-method filter so it tracks the checkboxes. Computed
  // up here (not only in the list branch) so the filter row can show the same
  // live counts while a customer is open. "To research" is outstanding work not
  // yet exhausted; "researched unsuccessfully" is the previously-unsuccessful
  // remainder kept visible but not re-recommended.
  const filterSummary = useMemo(() => ({
    total: rows.length,
    toResearch: rows.filter(r => !r.researched_unsuccessfully).length,
    unsuccessful: rows.filter(r => r.researched_unsuccessfully).length,
  }), [rows])

  // The shared filter row, rendered above BOTH the single-customer workbench and
  // the list so the Missing Fields checkboxes and the previously-unsuccessful
  // option are available while working a customer, not hidden on the list.
  const filterBar = (
    <ContactResearchFilters
      includeUnsuccessful={includeUnsuccessful}
      onIncludeUnsuccessful={setIncludeUnsuccessful}
      summary={filterSummary}
    />
  )

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
        filterBar={filterBar}
        onContactChange={(updated) => {
          // The shared card persisted a contact change for this customer. Fold
          // the authoritative record back into the local rows so the list and
          // summary stay accurate without a reload. This does NOT advance — the
          // worker advances deliberately with Next Customer.
          const addr = usableAddress(updated)
          setRows(prev => prev.map(r => r.customer_id === updated.id
            ? { ...r,
                first_name: updated.first_name, last_name: updated.last_name,
                middle_name: updated.middle_name ?? null, suffix: updated.suffix ?? null,
                goes_by: updated.goes_by ?? null, suffix_in_familiar: updated.suffix_in_familiar ?? null,
                email: updated.email, phone: updated.phone,
                has_email: usable(updated.email), has_phone: usable(updated.phone),
                has_address: addr,
                street: updated.street, address_line1: updated.address_line1 ?? r.address_line1,
                city: updated.city, state: updated.state, zip: updated.zip,
                email_verified_at: updated.email_verified_at,
                phone_verified_at: updated.phone_verified_at,
                address_verified_at: updated.address_verified_at,
                email_availability: updated.email_availability,
                contact_alert: updated.contact_alert ?? null }
            : r))
          setReopened(prev => prev && prev.customer_id === updated.id
            ? { ...prev,
                first_name: updated.first_name, last_name: updated.last_name,
                middle_name: updated.middle_name ?? null, suffix: updated.suffix ?? null,
                goes_by: updated.goes_by ?? null, suffix_in_familiar: updated.suffix_in_familiar ?? null,
                email: updated.email, phone: updated.phone,
                has_email: usable(updated.email), has_phone: usable(updated.phone),
                has_address: addr,
                street: updated.street, address_line1: updated.address_line1 ?? prev.address_line1,
                city: updated.city, state: updated.state, zip: updated.zip,
                email_verified_at: updated.email_verified_at,
                phone_verified_at: updated.phone_verified_at,
                address_verified_at: updated.address_verified_at,
                email_availability: updated.email_availability,
                contact_alert: updated.contact_alert ?? null }
            : prev)
        }}
        onDoneNext={() => {
          // Done & Next: research is complete for this customer. The card has
          // already written any found values straight to the customer record;
          // the task component additionally records unsuccessful research for
          // any field STILL missing (so the customer is not researched again on
          // a later pass) before calling this. A customer whose contact info is
          // now complete self-heals out of the list naturally. A reopened
          // customer is not in the list, so for them just clear the hold and
          // return to the list rather than advancing to a next row.
          if (isReopened) { setReopened(null); setOpenId(null); setShowingList(true) }
          else markHandledAndAdvance(openCustomer.customer_id)
        }}
        onSkipped={() => {
          // Skip This Customer: advance without recording any research outcome,
          // so the customer stays eligible for future research. Any edits the
          // card already saved as entered are kept; nothing else is written. The
          // reopened one returns to the list, the in-list one advances.
          if (isReopened) { setReopened(null); setOpenId(null); setShowingList(true) }
          else markHandledAndAdvance(openCustomer.customer_id)
        }}
      />
    )
  }

  // ── The list ─────────────────────────────────────────────────────────────
  // Contact Research is a continuous carousel: the branch above opens a customer
  // and, at the end of a pass, loops back to the first not-yet-researched one.
  // This return is reached only when the project genuinely has nobody left to
  // research — the done state. There is no list and no method filter. The
  // previously-unsuccessful set is folded back in by the one control in
  // filterBar; a customer whose details later turn up returns here automatically.
  return (
    <section className="space-y-5">
      {filterBar}
      <AssistantPanel heading="Contact research complete">
        <div className="space-y-3 text-lg leading-relaxed text-ink-secondary">
          <p>
            Every customer in this project has a usable email, phone, and mailing address, or has
            been researched. Nothing is waiting for contact research right now.
          </p>
        </div>
      </AssistantPanel>
      <QueueEmptyState>
        All caught up. Anyone whose details later turn up returns here automatically.
      </QueueEmptyState>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactResearchFilters — the compact filter row directly beneath the page
// title. Email, Phone, and Mailing Address checkboxes (all selected by default,
// any combination), the separate previously-unsuccessful pass option, and a
// compact, dynamically-updated summary of the filtered population. The checkbox
// selection controls both the lists and the entire Next Customer sequence.
// ─────────────────────────────────────────────────────────────────────────────

function ContactResearchFilters({
  includeUnsuccessful, onIncludeUnsuccessful, summary,
}: {
  includeUnsuccessful: boolean
  onIncludeUnsuccessful: (v: boolean) => void
  summary: { total: number; toResearch: number; unsuccessful: number }
}) {
  // No method filters: Contact Research is one carousel over everyone missing
  // something. The only control is the escape hatch to fold the previously-
  // unsuccessful population back in; the summary shows the research-history
  // breakdown read from existing customer history.
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-surface-border bg-surface-card p-4">
      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-base text-ink-secondary">
        <input
          type="checkbox"
          checked={includeUnsuccessful}
          onChange={(e) => onIncludeUnsuccessful(e.target.checked)}
          className="size-4 rounded border-surface-border-strong text-brand accent-brand focus:ring-brand-ring"
        />
        Include previously unsuccessful research
      </label>

      <p className="ml-auto text-base font-medium tabular-nums text-ink-supporting">
        {summary.total} total
        <span className="mx-1.5 text-surface-border-strong" aria-hidden>{'\u00B7'}</span>
        {summary.toResearch} not yet researched
        <span className="mx-1.5 text-surface-border-strong" aria-hidden>{'\u00B7'}</span>
        {summary.unsuccessful} previously researched unsuccessfully
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactReviewTask — one customer. The left ActionPanel carries the Mentoring,
// the shared Gateway look-up, and the Next Customer / Nothing Usable progression;
// the right column is the shared, editable CustomerContactCard, which owns the
// contact capture and writes straight to the customer record.
// ─────────────────────────────────────────────────────────────────────────────

function ContactReviewTask({
  projectId, customer, filterBar, onDoneNext, onSkipped, onContactChange,
}: {
  projectId: string
  customer: ContactReviewCustomer
  /** The Missing Fields filter row, shown above the workbench so the controls
   * are available while working a customer (they drive the counts and the
   * Next Customer progression upstream). */
  filterBar: ReactNode
  /** Done & Next — research is complete; the session advances. Called AFTER any
   * unsuccessful research for still-missing fields has been recorded durably. */
  onDoneNext: () => void
  /** Skip This Customer — advance without recording a research outcome; the
   * customer stays eligible for future research. Contact edits already saved by
   * the card are kept. */
  onSkipped: () => void
  /** The card persisted a contact change; keep the list/summary in sync. */
  onContactChange: (updated: CustomerContact) => void
}) {
  const name = displayName(customer)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Whether the Customer Contact Card has unsaved edits or a save in flight.
  // The card owns this determination and reports it; the advancing actions are
  // disabled while it is true so the worker cannot leave the customer with
  // unsaved contact changes, and both re-enable the moment Save or Cancel
  // settles.
  const [cardPending, setCardPending] = useState(false)

  // The open customer's grouped history for the right column: the Customer
  // History (with the Next History Entry preview). Loaded when the customer
  // opens, so the Contact Research LIST read stays thin while the opened
  // customer gets the same context the stewardship working screens have. The
  // available policy numbers are shown by Search Gateway, so this screen no
  // longer renders a separate Policies box. Display only.
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [historyTz, setHistoryTz] = useState<string | null>(null)
  // The live Next History Entry preview the shared contact card reports while
  // its unified editor is open: what the single Save will record. The card owns
  // the diff, so this screen carries no contact-change logic — it just shows the
  // card's preview when editing, falling back to the research preview otherwise.
  const [cardPreview, setCardPreview] = useState<NextHistoryEntryPreview | null>(null)

  // The method presence when this customer opened, captured once via a lazy
  // state initializer (so it is the first-render baseline and is safe to read
  // during render). The Next History Entry preview reflects the ACTUAL
  // selection by comparing the current presence against this baseline: once a
  // previously-missing method is filled, the preview reads "Contact Updated
  // (…)". The task remounts per customer (keyed by id), so the baseline is this
  // customer's state at open.
  const [initialPresence] = useState(() => ({
    hasEmail: customer.has_email,
    hasPhone: customer.has_phone,
    hasAddress: customer.has_address,
  }))
  const researchPreview = describeContactResearchSelection(
    initialPresence,
    { hasEmail: customer.has_email, hasPhone: customer.has_phone, hasAddress: customer.has_address },
  )

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/customers/${customer.customer_id}/contact-history`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok && json.data) {
        setHistory((json.data.customer_history ?? []) as HistoryEvent[])
        setHistoryTz((json.data.actor_time_zone ?? null) as string | null)
      }
    } catch {
      // History context is supplementary; a load failure leaves the column
      // empty rather than blocking the research work.
    }
  }, [customer.customer_id])

  useEffect(() => { void loadHistory() }, [loadHistory])

  // Done & Next records the unsuccessful research DURABLY, per STILL-MISSING
  // method, before advancing, so any field the worker could not find stops
  // coming back on later passes instead of only being hidden for this session.
  // The server records only methods that are still missing and not already
  // recorded; when every method is present (contact info complete) it is a
  // no-op and the customer self-heals out of the list. This is not a close: the
  // customer keeps everything, and a found value re-opens the recommendation. A
  // failure to record is surfaced and the worker is NOT advanced, so the outcome
  // is never silently lost. It records no contact attempt.
  const doneAndNext = useCallback(async () => {
    setBusy(true); setSaveError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/contact-review/${customer.customer_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ research_nothing_found: true }),
      })
      const json = await res.json()
      if (!res.ok) { setSaveError(json.error ?? 'Could not record'); return }
      onDoneNext()
    } catch {
      setSaveError('Network error')
    } finally {
      setBusy(false)
    }
  }, [projectId, customer.customer_id, onDoneNext])

  return (
    <TaskShell
      // Find Missing Contact Information: widen the CENTER column (the Customer
      // Contact card) where the left action is mostly click-through and the
      // right is reference history.
      columns="wide-context"
      header={filterBar}
      action={
        <ActionPanel>
          {/* No Usable Contact Information exception opened deliberately: say
              plainly that earlier research came up empty, so the worker knows
              this is a re-check, not fresh outstanding work. */}
          {customer.status === 'no_usable_contact' && customer.researched_unsuccessfully && (
            <OperationalTag tone="exception">
              Earlier research found no usable email or phone. This customer stays on the No Usable
              Contact Information list; look again only if you have a new lead.
            </OperationalTag>
          )}

          {/* The shared contact search Lego — Gateway (last name + policy
              numbers) and Fast People Search (name + city/state). The one search
              block used by every contact-research surface. */}
          <ContactSearch
            lastName={customer.last_name}
            firstName={customer.first_name}
            fallbackName={name}
            policyNumbers={customer.policy_numbers}
            city={customer.city}
            state={customer.state}
          />

          {saveError && (
            <p className="rounded-lg border border-tag-blocked-border bg-tag-blocked-fill px-3 py-2 text-base text-tag-blocked-text">
              {saveError}
            </p>
          )}

          {/* The two advancing actions, equal width and visually balanced. Done
              & Next is the primary teal action: research is complete for this
              customer. The card already saved any found values as entered; this
              additionally records unsuccessful research for every field STILL
              missing, so the customer is not researched again, then advances. A
              customer now complete simply leaves the queue. Skip This Customer
              advances WITHOUT recording any research outcome, keeping the
              customer eligible for future research. Both are the same structural
              control so they stay balanced, and both allow their label to WRAP
              to two lines (whitespace-normal + auto height) so neither truncates
              in the narrower equal-thirds column. */}
          <DoneSkipActions
            canComplete
            busy={busy || cardPending}
            doneLabel="Researched, Next"
            busyLabel="Saving…"
            skipLabel="Skip"
            onDone={doneAndNext}
            onSkip={onSkipped}
          />
        </ActionPanel>
      }
      context={
        // Center column: the self-contained Customer Contact card. It opens
        // collapsed (the Overview) like everywhere else in Right Path; the
        // worker clicks Edit to open the fields, and Save or Cancel returns it
        // to the Overview. The card fetches, displays, edits, and saves all of
        // the customer's contact information itself (name, calculated age,
        // email, phone, mailing address, verification, email availability, Do
        // Not Text / Text Undeliverable, and the alert); this screen no longer
        // assembles a contact object, a name/age header, or the texting facts.
        // `onContactChange` keeps the Missing Fields counts and the Next History
        // Entry preview in sync from the authoritative record the card returns.
        // The customer's available policy numbers are shown by Search Gateway in
        // the left panel, so this surface deliberately renders no separate
        // Policies box.
        <CustomerContactCard
          customerId={customer.customer_id}
          onChange={onContactChange}
          onPendingChange={setCardPreview}
          onPendingStateChange={setCardPending}
        />
      }
      history={
        // Right column: the Next History Entry preview (what completing this
        // work will record) above the Customer History. Contact Research records
        // a research outcome rather than a contact attempt, so the preview is
        // the research entry; the Customer History below shows the customer's
        // whole grouped contact history, display only. Each card owns its own
        // single heading.
        <>
          {/* Reflects the actual selection: "Contact Updated (…)" once a
              previously-missing method is filled; blank until there is something
              to record (a filled value, or the deliberate Nothing Usable action
              which records the research outcome). */}
          {/* While the contact card's unified editor has pending changes, show
              exactly what its single Save will record (the card owns that diff);
              otherwise fall back to the research-outcome preview. */}
          <NextHistoryEntry preview={cardPreview ?? researchPreview} />
          <CustomerHistoryCard events={history} actorTimeZone={historyTz} />
        </>
      }
    />
  )
}
