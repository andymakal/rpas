'use client'

/**
 * Stewardship / capture outreach — durable UI.
 *
 * Three views: a queue board, a queue list, and a task screen. Unlike the
 * servicing-recovery prototype (in-memory fixtures), this is wired to the
 * /api/stewardship routes, so queue placement and operational state survive a
 * refresh. The look reuses the shared workflow component layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Mail, Phone, Check, CircleAlert, Play, Hand, UserCheck,
} from 'lucide-react'
import {
  WorkflowPage, WorkflowPageHeader, WorkflowBackLink,
  QueueSection, QueueRow, QueueListHeader, CustomerQueueCard, QueueEmptyState,
  TaskShell, SlimTaskHeader,
  WorkflowButton, OperationalTag,
  CustomerContactCard,
  PolicySummaryList, type PolicySummary,
  CustomerHistoryCard, NextHistoryEntry, HistoryNotesField,
} from '@/components/workflow'
import { CustomerSearch } from '@/components/CustomerSearch'
import {
  QUEUE_META, OUTREACH_QUEUES,
  type OutreachQueue,
} from '@/lib/stewardship/queues'
import {
  describeNextHistoryEntry,
  describeCallSelection,
  describeIntroEmailSelection,
  describeInteractionSelection,
  type WorkflowActivity,
  type NextHistoryEntryPreview,
  type CallSelection,
  type InteractionSelection,
} from '@/lib/stewardship/customer-history'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'
import type { AgencyOption } from './page'
import {
  type BoardItem, type Holding, type Detail,
  type OpenPopulation, POPULATION_META, QUEUE_ICON, QUEUE_GROUPS,
} from './types'
import { fullName, shortDate } from './shared'
import { CallAction } from './call/CallAction'
import { NonresponsiveNotice } from './panels/NonresponsiveNotice'
import { ReadyToEmailAction } from './panels/ReadyToEmailAction'
import { RefusedAction } from './panels/RefusedAction'
import { WaitingForResponseAction } from './panels/WaitingForResponseAction'
import { CarrierAction } from './panels/CarrierAction'
import { ResearchAction } from './panels/ResearchAction'
import { FormAction } from './panels/FormAction'
import { ServicingAccessAction } from './panels/ServicingAccessAction'
import { CustomerInteractionAction } from './panels/CustomerInteractionAction'
import { UnableToCallAction } from './panels/UnableToCallAction'
import { RecordAttemptPanel } from './panels/RecordAttemptPanel'
import { HoldingsContext } from './panels/HoldingsContext'

/**
 * Rank for sorting a queue list: a customer with a due promised callback
 * (callback-due reason, date on/before today on the ACTOR's calendar) sorts to
 * the top (0) so a customer the Assistant recommends by callback is immediately
 * visible within the destination queue. Everything else keeps its existing
 * order (1). Presentation only; no workflow state changes. The actor zone comes
 * from the server (detected per employee); null falls back to the time module's
 * last resort.
 */
function dueCallbackRank(
  it: { call_reason: string | null; callback_date: string | null },
  actorTimeZone: string | null,
): number {
  return it.call_reason === 'callback-due' && isCallbackDue(it.callback_date, actorTimeZone) ? 0 : 1
}

export function StewardshipClient({
  agencies,
  project = null,
  initialQueue = null,
  initialCustomerId = null,
  initialItemId = null,
  actorTimeZone = null,
}: {
  agencies: AgencyOption[]
  /** When set, the whole screen is scoped to this project. */
  project?: { id: string; name: string } | null
  /** When set (via the ?queue= param, e.g. from the Assistant), the board opens
   * directly on this queue's list instead of the queue board. */
  initialQueue?: OutreachQueue | null
  /** When set (via the ?customer_id= param, e.g. from a project work view), the
   * board opens that one customer's outreach task directly once it loads, so a
   * per-customer link lands on the actual task rather than the whole board. */
  initialCustomerId?: string | null
  /** When set (via the ?item_id= param), open this exact outreach task directly.
   * Unlike customer_id this does not depend on the item appearing on the board,
   * so a suppressed (e.g. refused) item is still reachable to reopen. */
  initialItemId?: string | null
  /** The signed-in employee's detected IANA timezone, used to judge date-only
   * callback due on the actor's calendar for the queue-list sort. */
  actorTimeZone?: string | null
}) {
  const [items, setItems] = useState<BoardItem[]>([])
  const [counts, setCounts] = useState<Record<OutreachQueue, number>>(
    Object.fromEntries(OUTREACH_QUEUES.map(q => [q, 0])) as Record<OutreachQueue, number>,
  )
  // Research Needed split: outstanding (still to do, drives the tile count) and
  // unsuccessful (researched, nothing found — kept visible for a deliberate
  // retry). Reported by the board route so the two are never conflated.
  const [researchCounts, setResearchCounts] = useState<{ outstanding: number; unsuccessful: number }>(
    { outstanding: 0, unsuccessful: 0 },
  )
  // How many customers have explicitly declined (refused) — the size of the
  // declined basin, shown as its own board tile so "we offered, they said no" is
  // visible and countable rather than silently hidden. Project-scoped when the
  // screen is. Loaded alongside the board.
  const [declinedCount, setDeclinedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [openQueue, setOpenQueue] = useState<OutreachQueue | null>(initialQueue)
  const [openItemId, setOpenItemId] = useState<string | null>(initialItemId)
  // When materializing a derived (virtual) onboarding item on first action, the
  // customer id being materialized (so its card can show a brief busy state).
  const [materializingCustomerId, setMaterializingCustomerId] = useState<string | null>(null)
  // A derived call population view (opened from a My Work "Calls Due" /
  // link). When set, the board shows exactly that
  // population's customers, fetched from the server with the population filter.
  const [openPopulation, setOpenPopulation] = useState<OpenPopulation | null>(null)
  const [populationItems, setPopulationItems] = useState<BoardItem[]>([])
  const [populationLoading, setPopulationLoading] = useState(false)
  // Claiming (optional soft lease) is only shown on the actionable outreach
  // queues. claimBusy tracks the row currently being claimed/released; claimMsg
  // surfaces an eligibility/conflict message from the claim endpoint.
  const [claimBusy, setClaimBusy] = useState<string | null>(null)
  const [claimMsg, setClaimMsg] = useState<string | null>(null)

  // Respond to the ?queue= param changing WHILE on this page. The Assistant's
  // links (which share this page) are client-side navigations that do not
  // remount this component, so initialQueue alone would not react to them. We
  // watch the live param and open the matching queue list when it changes to a
  // valid queue. We track the last-applied value so this only fires on an
  // actual param change, never fighting the user's in-app queue navigation.
  const searchParams = useSearchParams()
  const queueParam = searchParams.get('queue')
  const lastAppliedQueueParam = useRef<string | null>(initialQueue)
  useEffect(() => {
    if (queueParam === lastAppliedQueueParam.current) return
    lastAppliedQueueParam.current = queueParam
    if (queueParam && (OUTREACH_QUEUES as readonly string[]).includes(queueParam)) {
      setOpenItemId(null)
      setOpenPopulation(null)
      setOpenQueue(queueParam as OutreachQueue)
    }
  }, [queueParam])

  // Respond to the ?population= param (a My Work Calls Due
  // link). Opens the derived population view, which lists exactly the customers
  // the population counted, fetched server-side with the population filter so
  // the counted and opened sets always match.
  const populationParam = searchParams.get('population')
  const lastAppliedPopulationParam = useRef<string | null>(null)
  useEffect(() => {
    if (populationParam === lastAppliedPopulationParam.current) return
    lastAppliedPopulationParam.current = populationParam
    if (
      populationParam === 'calls-due' ||
      populationParam === 'introductory-emails' ||
      populationParam === 'declined'
    ) {
      setOpenItemId(null)
      setOpenQueue(null)
      setOpenPopulation(populationParam)
    }
  }, [populationParam])

  // Per-customer deep link: when a ?customer_id= param is present (a project
  // work view opening a specific customer's task), open that customer's actual
  // outreach task once the board has loaded. The board item carries the
  // customer id, so we resolve the open stewardship_outreach row for that
  // customer and open its task directly. Applied once per customer-id value so
  // it never fights the worker's in-app navigation afterward.
  const customerParam = searchParams.get('customer_id') ?? initialCustomerId
  const lastAppliedCustomerParam = useRef<string | null>(null)
  useEffect(() => {
    if (!customerParam || items.length === 0) return
    if (customerParam === lastAppliedCustomerParam.current) return
    const match = items.find((it) => it.customer.id === customerParam)
    if (match) {
      lastAppliedCustomerParam.current = customerParam
      setOpenQueue(null)
      setOpenItemId(match.id)
    }
  }, [customerParam, items])

  const loadBoard = useCallback(async () => {
    setLoading(true)
    try {
      // In project scope, ask the board for only this project's work; counts
      // come back already scoped from the API.
      const url = project ? `/api/stewardship?project_id=${encodeURIComponent(project.id)}` : '/api/stewardship'
      // The declined basin count comes from the dedicated declined population
      // (the one read that returns refused items), fetched in parallel with the
      // board so the basin tile shows a live count. Both honor the same project
      // scope.
      const declinedParams = new URLSearchParams({ population: 'declined' })
      if (project) declinedParams.set('project_id', project.id)
      const [res, declinedRes] = await Promise.all([
        fetch(url, { cache: 'no-store' }),
        fetch(`/api/stewardship?${declinedParams.toString()}`, { cache: 'no-store' }),
      ])
      const json = await res.json()
      if (res.ok) {
        setItems(json.data.items as BoardItem[])
        setCounts(json.data.counts as Record<OutreachQueue, number>)
        if (json.data.research_counts) {
          setResearchCounts(json.data.research_counts as { outstanding: number; unsuccessful: number })
        }
      }
      const declinedJson = await declinedRes.json().catch(() => null)
      if (declinedRes.ok && declinedJson?.data) {
        setDeclinedCount((declinedJson.data.items as BoardItem[]).length)
      }
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => { void loadBoard() }, [loadBoard])

  // Fetch the opened call population from the server (which applies the SAME
  // callability + due derivation My Work counts with), so the list is exactly
  // the counted customers regardless of their stored queue.
  const loadPopulation = useCallback(async (population: OpenPopulation) => {
    setPopulationLoading(true)
    try {
      const params = new URLSearchParams({ population })
      if (project) params.set('project_id', project.id)
      const res = await fetch(`/api/stewardship?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (res.ok) setPopulationItems(json.data.items as BoardItem[])
    } finally {
      setPopulationLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (openPopulation) void loadPopulation(openPopulation)
  }, [openPopulation, loadPopulation])

  const claim = useCallback(async (outreachId: string, release: boolean) => {
    setClaimBusy(outreachId); setClaimMsg(null)
    try {
      const res = await fetch('/api/stewardship/claim', {
        method: release ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_id: outreachId }),
      })
      const json = await res.json()
      if (!res.ok) { setClaimMsg(json.error ?? 'Could not update the claim.'); return }
      await loadBoard()
      if (openPopulation) await loadPopulation(openPopulation)
    } catch {
      setClaimMsg('Network error.')
    } finally {
      setClaimBusy(null)
    }
  }, [loadBoard, openPopulation, loadPopulation])

  // Reopen a declined customer from the basin: clear the refusal and return them
  // to active outreach. This is the deliberate reversal of a decline, the same
  // { type: 'reopen' } action the per-customer Refused screen uses, run directly
  // from the basin list so a whole roster can be triaged in place. On success
  // the basin reloads (the reopened customer leaves it) and the board counts
  // refresh so active outreach reflects the return immediately.
  const [reopenBusy, setReopenBusy] = useState<string | null>(null)
  const reopenDeclined = useCallback(async (outreachId: string) => {
    setReopenBusy(outreachId); setClaimMsg(null)
    try {
      const res = await fetch(`/api/stewardship/${encodeURIComponent(outreachId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: { type: 'reopen' } }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setClaimMsg(json?.error ?? 'Could not reopen this customer.'); return }
      await loadBoard()
      if (openPopulation) await loadPopulation(openPopulation)
    } catch {
      setClaimMsg('Network error.')
    } finally {
      setReopenBusy(null)
    }
  }, [loadBoard, openPopulation, loadPopulation])

  // Materialize a DERIVED (virtual) onboarding item into a durable record on an
  // operator's FIRST action, then return its outreach id. This is the only
  // board path that creates a record, and it fires on an explicit action
  // (opening or claiming the item) — never on a page read.
  const materialize = useCallback(async (customerId: string): Promise<string | null> => {
    setMaterializingCustomerId(customerId); setClaimMsg(null)
    try {
      const res = await fetch('/api/stewardship/ensure-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      })
      const json = await res.json()
      if (!res.ok) { setClaimMsg(json.error ?? 'Could not start onboarding for this customer.'); return null }
      return json.data.outreach_id as string
    } catch {
      setClaimMsg('Network error.')
      return null
    } finally {
      setMaterializingCustomerId(null)
    }
  }, [])

  // Open an item's task screen. A real item opens directly; a derived (virtual)
  // item is first materialized (create-on-first-action), then opened.
  const openItem = useCallback(async (it: BoardItem) => {
    if (it.virtual) {
      const outreachId = it.customer_id ? await materialize(it.customer_id) : null
      if (!outreachId) return
      await loadBoard()
      setOpenItemId(outreachId)
      return
    }
    setOpenItemId(it.id)
  }, [materialize, loadBoard])

  // Claim an item. A derived (virtual) item is materialized first (claiming is a
  // real operator action and may create the record), then claimed.
  const claimItem = useCallback(async (it: BoardItem, release: boolean) => {
    let outreachId = it.id
    if (it.virtual) {
      const created = it.customer_id ? await materialize(it.customer_id) : null
      if (!created) return
      outreachId = created
    }
    await claim(outreachId, release)
  }, [claim, materialize])

  if (openItemId) {
    // The ordered list of OTHER customers in the same activity, so the task
    // screen can advance to the next one (used by Introductory Emails' fast
    // "Next customer" flow). Prefer the opened intro-email population; otherwise
    // fall back to the open Ready to Email queue list. Only real (non-virtual)
    // items can be opened directly, so virtuals are excluded here.
    const activitySource =
      openPopulation === 'introductory-emails'
        ? populationItems.slice().sort((a, b) => dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone))
        : openQueue === 'ready-to-email'
          ? items.filter(i => i.queue === 'ready-to-email').sort((a, b) => dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone))
          : []
    const siblingIds = activitySource
      .map(it => it.id)
      .filter((id): id is string => !!id && id !== openItemId)

    const advanceToNext = () => {
      const nextId = siblingIds[0] ?? null
      if (nextId) {
        setOpenItemId(nextId)
      } else {
        // Last customer in the activity: fall back to the activity list.
        setOpenItemId(null)
      }
      void loadBoard()
      if (openPopulation) void loadPopulation(openPopulation)
    }

    return (
      <StewardshipTask
        key={openItemId}
        itemId={openItemId}
        hasNextInActivity={siblingIds.length > 0}
        onAdvanceToNext={advanceToNext}
        onBack={() => {
          setOpenItemId(null)
          void loadBoard()
          if (openPopulation) void loadPopulation(openPopulation)
        }}
      />
    )
  }

  // DECLINED BASIN — the tracked roster of customers who explicitly said no.
  // Unlike every other list this surfaces REFUSED items (the one view that
  // does), and its action is Reopen, not open-a-call-task: a declined customer
  // has no next outreach step until someone deliberately re-engages. Each row
  // shows when they declined; Reopen clears the refusal and returns them to
  // active outreach. Nothing here is auto-closed, and the roster is project-
  // scoped when the screen is.
  if (openPopulation === 'declined') {
    const meta = POPULATION_META.declined
    return (
      <WorkflowPage
        heading={
          <QueueListHeader
            icon={Hand}
            label={meta.label}
            count={populationItems.length}
            blurb={meta.blurb}
            onBack={() => setOpenPopulation(null)}
          />
        }
      >
        {claimMsg && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="space-y-3">
          {populationLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : populationItems.length === 0 ? (
            <QueueEmptyState>
              No one has declined{project ? ' in this project' : ''}. Customers who decline a
              servicing-agent offer are tracked here so you can see who said no and reopen them if
              they re-engage.
            </QueueEmptyState>
          ) : (
            populationItems.map(it => (
              <div
                key={it.id}
                className="flex items-center gap-4 rounded-2xl border-2 border-surface-border bg-surface-card px-6 py-5"
              >
                <span className="min-w-0 truncate">
                  <span className="text-xl font-semibold text-ink">{fullName(it.customer)}</span>
                  <span className="px-2 text-ink-muted">{'\u00b7'}</span>
                  <span className="text-lg text-ink-supporting">
                    Declined{it.refused_at ? ` ${shortDate(it.refused_at)}` : ''}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  <OperationalTag tone="exception">Not interested</OperationalTag>
                  <WorkflowButton
                    icon={Play}
                    disabled={reopenBusy === it.id}
                    onClick={() => void reopenDeclined(it.id)}
                  >
                    {reopenBusy === it.id ? 'Reopening…' : 'Reopen'}
                  </WorkflowButton>
                </span>
              </div>
            ))
          )}
        </div>
      </WorkflowPage>
    )
  }

  // A derived call population view (Calls Due). Lists exactly
  // the customers the server derived for this population, so the counted and
  // opened sets match and a callable customer appears here even when their
  // stored queue is Ready to Email. Due items are shown first.
  if (openPopulation) {
    const meta = POPULATION_META[openPopulation]
    const popItems = populationItems
      .slice()
      .sort((a, b) => dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone))
    return (
      <WorkflowPage
        heading={
          <QueueListHeader
            icon={openPopulation === 'introductory-emails' ? Mail : Phone}
            label={meta.label}
            count={popItems.length}
            blurb={meta.blurb}
            onBack={() => setOpenPopulation(null)}
          />
        }
      >
        {claimMsg && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="space-y-3">
          {populationLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : popItems.length === 0 ? (
            <QueueEmptyState>No customers in this population right now.</QueueEmptyState>
          ) : (
            popItems.map(it => (
              <CustomerQueueCard
                key={it.id ?? `virtual:${it.customer_id}`}
                name={fullName(it.customer)}
                detail={queueDetail(it)}
                trailing={
                  <div className="flex items-center gap-2">
                    {queueTag(it)}
                    <ClaimControl
                      item={it}
                      busy={claimBusy === it.id || (it.virtual === true && materializingCustomerId === it.customer_id)}
                      onClaim={() => claimItem(it, false)}
                      onRelease={() => claimItem(it, true)}
                    />
                  </div>
                }
                onOpen={() => void openItem(it)}
              />
            ))
          )}
        </div>
      </WorkflowPage>
    )
  }

  if (openQueue) {
    const meta = QUEUE_META[openQueue]
    // Due callbacks (a customer we promised to call back on or before today)
    // are surfaced at the TOP of the list, so a customer the Assistant
    // recommends by callback is immediately visible and reachable within the
    // destination queue. This is a presentation sort only; it changes no
    // workflow state and no queue placement. "Today" is judged on the business
    // calendar, matching the Assistant.
    //
    // In Research Needed, outstanding research (still to do) sorts ABOVE research
    // that already came up empty ("Research unsuccessful — Try again"), so the
    // actionable work leads and the already-researched holdovers trail without
    // being removed from the queue.
    const queueItems = items
      .filter(i => i.queue === openQueue)
      .sort((a, b) => {
        if (openQueue === 'research-needed') {
          const ra = a.research_unsuccessful ? 1 : 0
          const rb = b.research_unsuccessful ? 1 : 0
          if (ra !== rb) return ra - rb
        }
        return dueCallbackRank(a, actorTimeZone) - dueCallbackRank(b, actorTimeZone)
      })
    // Research Needed carries a split count in its header so outstanding and
    // unsuccessful are distinguished at a glance; every other queue shows its
    // plain list length.
    const headerBlurb = openQueue === 'research-needed'
      ? `${researchCounts.outstanding} still to research${researchCounts.unsuccessful > 0 ? ` · ${researchCounts.unsuccessful} researched, nothing found` : ''}`
      : meta.blurb
    return (
      <WorkflowPage
        heading={
          <QueueListHeader
            icon={QUEUE_ICON[openQueue]}
            label={meta.label}
            count={queueItems.length}
            blurb={headerBlurb}
            onBack={() => setOpenQueue(null)}
          />
        }
      >
        {claimMsg && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {claimMsg}
          </p>
        )}
        <div className="space-y-3">
          {queueItems.length === 0 ? (
            <QueueEmptyState>No customers in this queue.</QueueEmptyState>
          ) : (
            queueItems.map(it => (
              <CustomerQueueCard
                key={it.id ?? `virtual:${it.customer_id}`}
                name={fullName(it.customer)}
                detail={queueDetail(it)}
                trailing={
                  <div className="flex items-center gap-2">
                    {queueTag(it)}
                    <ClaimControl
                      item={it}
                      busy={claimBusy === it.id || (it.virtual === true && materializingCustomerId === it.customer_id)}
                      onClaim={() => claimItem(it, false)}
                      onRelease={() => claimItem(it, true)}
                    />
                  </div>
                }
                onOpen={() => void openItem(it)}
              />
            ))
          )}
        </div>
      </WorkflowPage>
    )
  }

  return (
    <WorkflowPage
      heading={project ? (
        <WorkflowPageHeader
          title={`Stewardship — ${project.name}`}
          secondary="Capture outreach scoped to this project's population. Queues and lists below show only this project's work."
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      ) : (
        <WorkflowPageHeader
          title="Stewardship"
          secondary="Capture outreach — confirm servicing access on each customer's policies."
          back={<WorkflowBackLink href="/my-work">Back to My Work</WorkflowBackLink>}
        />
      )}
    >
      {project
        ? <ProjectOnboardingNote project={project} />
        : <StartCapture agencies={agencies} onStarted={loadBoard} />}

      <div className="mt-6 space-y-6">
        {QUEUE_GROUPS.map(group => (
          <QueueSection key={group.label} label={group.label}>
            {group.queues.map(q => (
              <QueueRow
                key={q}
                icon={QUEUE_ICON[q]}
                label={QUEUE_META[q].label}
                tag={QUEUE_META[q].blurb}
                count={counts[q] ?? 0}
                tone={QUEUE_META[q].kind}
                onOpen={() => setOpenQueue(q)}
              />
            ))}
          </QueueSection>
        ))}

        {/* The declined basin: the one roster that surfaces customers who said
            no, so they are tracked ("we offered, they declined") rather than
            silently dropped. Opening it lists each declined customer with a
            Reopen action. Shown as a waiting-tone tile — it is not active work,
            it is a record you consult and deliberately reopen from. */}
        <QueueSection label="Declined">
          <QueueRow
            icon={Hand}
            label={POPULATION_META.declined.label}
            tag="Customers who declined the offer. Outreach is stopped; reopen one to re-engage."
            count={declinedCount}
            tone="waiting"
            onOpen={() => setOpenPopulation('declined')}
          />
        </QueueSection>
      </div>

      {loading && <p className="mt-4 text-sm text-ink-supporting">Loading board…</p>}
    </WorkflowPage>
  )
}

function queueDetail(it: BoardItem): string {
  switch (it.queue) {
    case 'ready-to-call': return it.call_reason ? callReasonLabel(it.call_reason) : 'Ready to call'
    case 'research-needed': return it.research_unsuccessful ? 'Researched — nothing found yet' : 'Needs usable contact'
    case 'waiting-for-response': return it.follow_up_due ? `Follow-up ${shortDate(it.follow_up_due)}` : 'Awaiting reply'
    case 'waiting-for-form': return 'Form sent'
    case 'waiting-for-carrier': return it.carrier_correction ? 'Carrier correction needed' : 'Submitted to carrier'
    default: return 'Ready to email'
  }
}

function queueTag(it: BoardItem) {
  // A researched-not-found customer stays in Research Needed, flagged so the
  // worker sees it is a deliberate retry (not fresh outstanding work). Opening
  // it returns to the same research task.
  if (it.queue === 'research-needed' && it.research_unsuccessful) {
    return <OperationalTag tone="info">Research unsuccessful — Try again</OperationalTag>
  }
  if (it.queue === 'waiting-for-carrier' && it.carrier_correction) {
    return <OperationalTag tone="exception">Correction</OperationalTag>
  }
  // A lapsed signature/carrier follow-up is an actionable chase — flag it.
  if (it.follow_up_due_now) {
    return <OperationalTag tone="reason">Follow-up due</OperationalTag>
  }
  if (it.queue === 'ready-to-call' && it.call_reason === 'callback-due') {
    return <OperationalTag tone="reason">Callback due</OperationalTag>
  }
  return null
}

/**
 * The optional claim control for a shared outreach item (ported from the IPF
 * queue-owned-until-claimed model). Work is shared by default, so an unclaimed
 * item offers Claim; the holder sees "Yours" with a Release; another worker's
 * claim is shown read-only. Clicks do not open the item (stopPropagation), so
 * claiming is distinct from opening the customer work.
 */
function ClaimControl({
  item, busy, onClaim, onRelease,
}: {
  item: BoardItem
  busy: boolean
  onClaim: () => void
  onRelease: () => void
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  if (item.is_mine) {
    return (
      <span className="inline-flex items-center gap-2" onClick={stop}>
        <span className="inline-flex items-center gap-1 rounded-full border border-tag-info-border bg-tag-info-fill px-2.5 py-1 text-xs font-semibold text-tag-info-text">
          <UserCheck className="size-3.5" aria-hidden /> Yours
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onRelease}
          className="text-xs font-medium text-ink-supporting underline-offset-2 hover:text-ink-secondary hover:underline disabled:opacity-50"
        >
          {busy ? '…' : 'Release'}
        </button>
      </span>
    )
  }

  if (item.claimed_by_producer_id) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-muted px-2.5 py-1 text-xs text-ink-supporting"
        onClick={stop}
        title={`Claimed by ${item.claimed_by_name ?? 'another team member'}`}
      >
        <UserCheck className="size-3.5" aria-hidden />
        {item.claimed_by_name ?? 'Claimed'}
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { stop(e); onClaim() }}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-ring bg-brand-wash px-3 py-1 text-xs font-semibold text-brand-hover hover:bg-brand-subtle hover:text-brand-foreground disabled:opacity-50"
    >
      <Hand className="size-3.5" aria-hidden />
      {busy ? 'Claiming…' : 'Claim'}
    </button>
  )
}

function callReasonLabel(r: string): string {
  switch (r) {
    case 'no-email': return 'No email'
    case 'email-bounced': return 'Email bounced'
    case 'no-response': return 'No response'
    case 'callback-due': return 'Callback due'
    default: return 'Ready to call'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Start Capture — begin stewardship work for a selected agency book.
// ─────────────────────────────────────────────────────────────────────────────

type CustomerSearchResult = { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }

function StartCapture({ agencies, onStarted }: { agencies: AgencyOption[]; onStarted: () => void }) {
  const [agencyId, setAgencyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function start() {
    if (!agencyId) return
    setBusy(true); setResult(null)
    try {
      const res = await fetch('/api/stewardship/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_id: agencyId }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult(`Started ${json.data.started} customer${json.data.started === 1 ? '' : 's'}` +
          (json.data.skipped ? `, skipped ${json.data.skipped} already in progress.` : '.'))
        onStarted()
      } else {
        setResult(json.error ?? 'Could not start capture.')
      }
    } catch {
      setResult('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-brand-subtle bg-surface-card p-5">
      <h2 className="text-base font-semibold text-ink">Start capture for a book</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Creates a stewardship work item for each customer in the selected agency that is not already
        in progress. Each item routes to Ready to Email, Ready to Call, or Research Needed based on
        the contact information on file.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={agencyId}
          onChange={e => setAgencyId(e.target.value)}
          className="rounded-lg border border-surface-border-strong bg-surface-card px-3 py-2 text-sm text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/40"
        >
          <option value="">Select an agency / book…</option>
          {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <WorkflowButton icon={Play} selected disabled={!agencyId || busy} onClick={start}>
          {busy ? 'Starting…' : 'Start capture'}
        </WorkflowButton>
        {result && <span className="text-sm font-medium text-ink-secondary">{result}</span>}
      </div>

      <StartSingleCustomer onStarted={onStarted} />
    </section>
  )
}

/**
 * Start onboarding for ONE customer. Same capture flow as the book/project
 * paths, scoped to a single customer resolved by name search. Reuses the shared
 * /api/customers/search endpoint and the customer_id branch of
 * /api/stewardship/start.
 */
function StartSingleCustomer({ onStarted }: { onStarted: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function startOne(c: CustomerSearchResult) {
    setBusyId(c.id); setResult(null)
    try {
      const res = await fetch('/api/stewardship/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: c.id }),
      })
      const json = await res.json()
      if (res.ok) {
        const name = `${c.first_name} ${c.last_name}`.trim()
        if (json.data.started > 0) {
          setResult(`Started onboarding for ${name}.`)
        } else if (json.data.skipped > 0) {
          setResult(`${name} is already in progress.`)
        } else {
          setResult(`${name} has no known policy to onboard.`)
        }
        onStarted()
      } else {
        setResult(json.error ?? 'Could not start onboarding.')
      }
    } catch {
      setResult('Network error.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-5 border-t border-surface-border pt-5">
      <h3 className="text-sm font-semibold text-ink">Or start one customer</h3>
      <p className="mt-1 text-sm text-ink-secondary">
        Search by name or phone to begin onboarding a single customer. Every policy we know they hold
        goes into the servicing-agent request.
      </p>
      <div className="mt-3 max-w-md">
        <CustomerSearch<CustomerSearchResult>
          placeholder="Search customer…"
          ariaLabel="Search a customer to start onboarding"
          busyId={busyId}
          onSelect={startOne}
          renderRow={(c, { busy, select }) => (
            <button
              type="button"
              disabled={busy}
              onClick={select}
              className="flex w-full items-center justify-between gap-3 border-b border-surface-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-muted disabled:opacity-50"
            >
              <span className="text-sm font-medium text-ink">{c.first_name} {c.last_name}</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-hover">
                <Play className="size-3.5" aria-hidden /> {busy ? 'Starting…' : 'Start'}
              </span>
            </button>
          )}
        />
        {result && <p className="mt-2 text-sm font-medium text-ink-secondary">{result}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Work Project — begin stewardship work for a project's population. Reuses the
// same capture flow and the same /api/stewardship/start endpoint, scoped by
// project_id instead of an agency book. Customers already in open stewardship
// work are reused, not duplicated.
// ─────────────────────────────────────────────────────────────────────────────

// Servicing Agent Onboarding is objective-driven: every member of this project
// is accounted for automatically by MEMBERSHIP, so there is no manual "start"
// step. Opening this board ensures each member has an onboarding record (adding
// only the missing ones; existing work and history are preserved and never
// duplicated), then shows the work. This note replaces the former "Work
// project" button, which is obsolete.
function ProjectOnboardingNote({ project }: { project: { id: string; name: string } }) {
  return (
    <section className="rounded-2xl border border-brand-subtle bg-surface-card p-5">
      <h2 className="text-base font-semibold text-ink">Servicing Agent Onboarding</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Every customer in {project.name} is automatically in Servicing Agent Onboarding — no manual
        start is needed. Each customer&apos;s available work (call, email, text, research, follow-up)
        is surfaced from their current contact information, outreach history, and the applicable
        rules. Existing outreach is preserved; nothing is duplicated.
      </p>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Task screen — one outreach item, dispatched by queue.
// ─────────────────────────────────────────────────────────────────────────────

export function StewardshipTask({
  itemId, onBack, hasNextInActivity = false, onAdvanceToNext, onSkip, onComplete, hideBackHeader = false, forceCall = false,
  forceServicingAccess = false, forceCustomerInteraction = false, forceUnableToCall = false,
}: {
  itemId: string
  onBack: () => void
  /** Whether another customer remains in this activity to advance to. */
  hasNextInActivity?: boolean
  /** Open the next customer in this activity (Introductory Emails fast flow). */
  onAdvanceToNext?: () => void
  /** Skip the open customer WITHOUT sending or recording anything: move to the
   * next available customer and send this one to the back of the working
   * sequence (Send Introductory Emails fast flow). When supplied, the intro-
   * email send panel shows a "Skip for now" control beneath the confirm. The
   * skip never touches a business record — no history, no status change. */
  onSkip?: () => void
  /** Called when the whole servicing request COMPLETES (every request policy
   * confirmed): the outreach row is gone and the customer has advanced out of
   * outreach. Carries the customer id and, when the customer belongs to an
   * active review-preparation project, that project id — so the caller can open
   * the customer's determination immediately. When omitted the task
   * falls back to onBack (the board/default behavior is unchanged). */
  onComplete?: (info: { customerId: string | null; reviewProjectId: string | null }) => void
  /** Drive the SERVICING ACCESS working screen: the signed-authorization stage
   * of the workflow (upload the signed form, prepare the carrier email, send +
   * confirm, run the 7-day carrier follow-up, record carrier confirmation).
   * Renders the three-column working layout and the servicing-access action
   * column regardless of whether the item sits in waiting-for-form or
   * waiting-for-carrier. Every other caller leaves this false, so their behavior
   * is unchanged. A confirmed-and-complete servicing request advances the
   * customer on to determination via the existing handoff. */
  forceServicingAccess?: boolean
  /** Suppress the task's own "All queues" back header AND its outer page wrapper.
   * Used only by the dedicated Send Introductory Emails direct working screen,
   * which supplies its own WorkflowPage + "Back to My Work" navigation. Every
   * other Stewardship use leaves this false, keeping the original "All queues"
   * back button and page chrome unchanged. */
  hideBackHeader?: boolean
  /** Drive the guided CALL flow regardless of the item's stored queue. Used by
   * the Call Reachable Customers workbench: a callable customer may sit in Ready
   * to Email (callable but not yet emailed), so the workbench forces the call
   * flow rather than the stored-queue action. Also switches the right-side
   * context to the shared Customer Contact card (verify/correct inline) and
   * hides the separate record-an-attempt panel, since the guided flow IS the
   * recording. Every other caller leaves this false, so their behavior is
   * unchanged. */
  forceCall?: boolean
  /** Drive the CUSTOMER INTERACTION working screen: the active-conversation
   * stage between routine calling and Servicing Access. Renders the established
   * three-column working layout (customer contact + policies in the center,
   * communication history on the right) with a dedicated interaction action
   * column — record an incoming response or outgoing reply by email, phone, or
   * text, and set a follow-up commitment + date, all WITHOUT the guided
   * telephone-calling flow. Due follow-ups surface here as actionable. Every
   * other caller leaves this false, so their behavior is unchanged. */
  forceCustomerInteraction?: boolean
  /** Drive the People We Can't Call working screen: an active outreach customer
   * with no usable phone. Renders the research-for-a-phone + authorization
   * email/postal panel. If a phone is found and saved (so the customer becomes
   * callable), the screen hands off to the guided call flow right here. Every
   * other caller leaves this false. */
  forceUnableToCall?: boolean
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Live Next History Entry preview, built from the selections the worker is
  // making in the guided call flow. The action column owns the selections and
  // reports them up here; the history column renders the preview. null means
  // the worker has not yet chosen enough to record anything (no reach decision),
  // so the preview is hidden until the work can generate a history event.
  const [callSelection, setCallSelection] = useState<CallSelection | null>(null)
  // Reset the live preview whenever the open item changes, so a stale selection
  // from a prior customer never leaks onto the next one.
  useEffect(() => { setCallSelection(null) }, [itemId])

  // The optional Call Notes text, LIFTED to the task so it can live in the
  // history column (the HistoryNotesField Lego, where its output goes) while the
  // Outreach Call Panel in the action column still consumes it to fold into the
  // recorded interaction. One free-text field, saved WITH the completed outcome,
  // never a standalone history entry; nothing is recorded if no outcome is
  // completed. Reset on item change so a note never leaks to the next customer.
  const [callNote, setCallNote] = useState('')
  useEffect(() => { setCallNote('') }, [itemId])

  // The action column reports its live selection up through this callback on
  // every render (via an effect in OutreachCallPanel), each time with a FRESH
  // object literal. Writing that straight into state would re-render this task
  // on every report, which re-runs the action subtree and re-fires the report —
  // a churn loop that never lets the guided-call buttons settle, so clicks
  // appear dead. Gate the write to actual changes: compare the incoming
  // selection field-by-field against the current one and bail out (return the
  // same reference, so React skips the re-render) when nothing changed. Stable
  // identity (useCallback with no deps, functional update) so the child effect's
  // dependency on it never itself triggers churn.
  const reportCallSelection = useCallback((next: CallSelection | null) => {
    setCallSelection((prev) => (sameCallSelection(prev, next) ? prev : next))
  }, [])

  // The live Customer Interaction selection: the single action the worker is
  // preparing in the interaction action column (a communication being composed,
  // a follow-up date, or a staged authorization/refusal). Reported up the SAME
  // way the guided call flow reports its selection, and gated to real changes so
  // a fresh object literal on every render never churns the subtree.
  const [interactionSelection, setInteractionSelection] = useState<InteractionSelection | null>(null)
  useEffect(() => { setInteractionSelection(null) }, [itemId])
  const reportInteractionSelection = useCallback((next: InteractionSelection | null) => {
    setInteractionSelection((prev) => (sameInteractionSelection(prev, next) ? prev : next))
  }, [])

  // The live Next History Entry preview the shared contact card reports from its
  // unified editor (what its single Save will record). Lifted here so the center
  // column's card can drive the right column's history preview WITHOUT this
  // screen re-deriving any contact-change logic. null when the card is collapsed
  // or nothing has changed, in which case the column shows its workflow preview.
  const [contactPreview, setContactPreview] = useState<NextHistoryEntryPreview | null>(null)
  useEffect(() => { setContactPreview(null) }, [itemId])

  const load = useCallback(async () => {
    const res = await fetch(`/api/stewardship/${itemId}`, { cache: 'no-store' })
    const json = await res.json()
    if (res.ok) setDetail(json.data as Detail)
  }, [itemId])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (
    action: unknown,
    successNote?: string,
    opts?: { advanceToNext?: boolean },
  ) => {
    setBusy(true); setNote(null)
    try {
      const res = await fetch(`/api/stewardship/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) { setNote(json.error ?? 'Action failed.'); return }
      // A send must never be reported as complete (or advance the fast flow)
      // unless the server confirms the required history was recorded. The
      // email-sent path returns an explicit `recorded` flag; when it is present
      // and false, the send did not persist its history, so we surface the
      // server's message and stop here rather than claim success. Actions that
      // do not carry this flag are unaffected (recorded is undefined).
      if (json.recorded === false) {
        setNote(json.error ?? 'The send could not be recorded. Please try again.')
        return
      }
      if (json.completed_outreach) {
        // Every request policy is confirmed: the outreach row is gone and the
        // customer has advanced out of outreach. When a completion handler is
        // supplied (the servicing-access screen), hand it the customer and the
        // review project so it can open the customer's determination
        // immediately. Otherwise fall back to the default
        // back navigation (the board behavior is unchanged).
        if (onComplete) {
          onComplete({
            customerId: (json.customer_id as string | null) ?? null,
            reviewProjectId: (json.review_project_id as string | null) ?? null,
          })
        } else {
          onBack()
        }
        return
      }
      // Introductory Emails fast flow: a successful send removes this customer
      // from the activity, so instead of reloading the (now departed) item we
      // open the next customer in the activity. Falls back to the activity list
      // when this was the last one.
      if (opts?.advanceToNext) {
        if (onAdvanceToNext) onAdvanceToNext()
        else onBack()
        return
      }
      if (successNote) setNote(successNote)
      await load()
    } catch {
      setNote('Network error.')
    } finally {
      setBusy(false)
    }
  }, [itemId, load, onBack, onAdvanceToNext, onComplete])

  // The direct Send Introductory Emails screen hosts its own WorkflowPage and
  // "Back to My Work" nav, so there the task renders chromeless (no outer page
  // wrapper, no "All queues" header). Every other Stewardship caller gets the
  // original page chrome and the "All queues" back header, unchanged.
  //
  // Chrome is a STABLE module-level component chosen by a prop, never one
  // created during render. A component created inside render gets a fresh
  // identity each pass, so React would unmount and REMOUNT the whole task
  // subtree on every re-render — resetting the guided-call flow's state and
  // making the Reached/Didn't-Reach buttons lose what the worker just did. A
  // stable component keeps the subtree mounted across re-renders.

  if (!detail) {
    return (
      <TaskChrome chromeless={hideBackHeader}>
        {!hideBackHeader && <SlimTaskHeader onBack={onBack} />}
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      </TaskChrome>
    )
  }

  const request = detail.holdings.filter(h => h.in_request)
  const context = detail.holdings.filter(h => !h.in_request)

  // The three working screens (Send Introductory Emails, the guided Calling
  // workbench, and Contact Research) use the shared Customer Contact card, so
  // they also get the working-screen THREE-COLUMN layout: current work and
  // actions on the left, the customer context (contact card + policy summary)
  // in the center, and the customer history (with the Next History Entry
  // preview) on the right. Every other stewardship caller keeps the original
  // two-column action/context layout, so their behavior is unchanged.
  const introEmail = isIntroductoryEmailActivity(detail)
  const research = detail.queue === 'research-needed'
  const isWorkingScreen = introEmail || research || forceCall || forceServicingAccess || forceCustomerInteraction || forceUnableToCall
  // On the People We Can't Call screen, a phone found and saved during research
  // makes the customer callable: hand straight off to the guided call flow so
  // the worker calls now, instead of the no-phone email/postal panel.
  const unableToCallWithPhone = forceUnableToCall && !!detail.customer.phone?.trim()

  return (
    <TaskChrome chromeless={hideBackHeader}>
      <TaskShell
        // The outbound call workbench (forceCall) leads with the Outreach Call
        // Panel, so give the work column the weight (46/27/27); the customer
        // context and history each take a narrower track. Other working screens
        // keep equal thirds.
        columns={(forceCall || unableToCallWithPhone) ? 'wide-work' : 'even'}
        header={hideBackHeader ? null : <SlimTaskHeader onBack={onBack} backLabel="All queues" />}
        action={
          forceServicingAccess ? (
            <ServicingAccessAction
              detail={detail} request={request} busy={busy} note={note} act={act}
            />
          ) : forceCustomerInteraction ? (
            <CustomerInteractionAction
              detail={detail} request={request} busy={busy} note={note} act={act} reload={load}
              onAdvanceToNext={onAdvanceToNext}
              onSelectionChange={reportInteractionSelection}
            />
          ) : (
            <TaskAction
              detail={detail} request={request} busy={busy} note={note} act={act}
              hasNextInActivity={hasNextInActivity}
              // A phone found on the no-phone screen flips this into the guided
              // call flow right here.
              forceCall={forceCall || unableToCallWithPhone}
              forceUnableToCall={forceUnableToCall && !unableToCallWithPhone}
              onSkip={onSkip}
              onCallSelectionChange={reportCallSelection}
              callNote={callNote}
            />
          )
        }
        context={
          <StewardshipContextPanel
            detail={detail} request={request} context={context} busy={busy} act={act}
            setDetail={setDetail} reload={load} forceCall={forceCall || unableToCallWithPhone}
            forceCustomerInteraction={forceCustomerInteraction}
            withHistoryColumn={isWorkingScreen}
            // The guided call's live reach decision, lifted through the SAME
            // callSelection channel the history column already uses. Drives the
            // center column's Reached behavior: open the contact card in edit
            // mode and show the yellow verify-contact instruction above it.
            reached={callSelection?.reach === 'reached'}
            // The contact card reports its live unified-edit preview up here, so
            // the history column can show what its single Save will record.
            onContactPreviewChange={setContactPreview}
          />
        }
        history={isWorkingScreen
          ? <StewardshipHistoryColumn
              detail={detail} forceCall={forceCall || unableToCallWithPhone} callSelection={callSelection}
              interactionSelection={interactionSelection}
              forceServicingAccess={forceServicingAccess}
              forceCustomerInteraction={forceCustomerInteraction}
              contactPreview={contactPreview}
              callNote={callNote}
              onCallNoteChange={setCallNote}
            />
          : undefined}
      />
    </TaskChrome>
  )
}

/**
 * Stable page chrome for a Stewardship task. `chromeless` renders the children
 * bare (the direct working screens supply their own WorkflowPage + "Back to My
 * Work" nav); otherwise the original WorkflowPage wrapper is used. Declared once
 * at module level — NOT created inside StewardshipTask's render — so the task
 * subtree is never remounted (and its guided-call state never reset) just
 * because the parent re-rendered.
 */
function TaskChrome({ chromeless, children }: { chromeless: boolean; children: React.ReactNode }) {
  if (chromeless) return <>{children}</>
  return <WorkflowPage>{children}</WorkflowPage>
}

/**
 * The right-hand history column for the working screens: the Next History Entry
 * preview (what completing this work will record) above the Customer History.
 * Completing the work records the entry automatically, so the preview tells the
 * worker what will be logged rather than asking them to log it. History is the
 * grouped customer history supplied by the GET route (display only).
 */
/**
 * Field-by-field equality for the live call selection, so the parent only
 * re-renders when the worker's guided-call choices actually change rather than
 * on every render-phase report from the action column. Covers every field the
 * reporter sets; a null on either side only matches another null.
 */
function sameCallSelection(a: CallSelection | null, b: CallSelection | null): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return (
    a.reach === b.reach &&
    (a.notReachedFragments ?? []).join('\u241f') === (b.notReachedFragments ?? []).join('\u241f') &&
    a.badNumber === b.badNumber &&
    a.decision === b.decision &&
    a.callbackDate === b.callbackDate &&
    a.formSent === b.formSent &&
    a.formDeliveryMethod === b.formDeliveryMethod &&
    a.formAlreadyHeld === b.formAlreadyHeld &&
    a.note === b.note
  )
}

/**
 * Field-by-field equality for the live Customer Interaction selection, so the
 * task only re-renders when the prepared action actually changes rather than on
 * every render-phase report from the interaction action column. Different kinds
 * never match; within a kind every field is compared.
 */
function sameInteractionSelection(a: InteractionSelection | null, b: InteractionSelection | null): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'communication' && b.kind === 'communication') {
    return a.direction === b.direction && a.channel === b.channel && (a.note ?? null) === (b.note ?? null)
  }
  if (a.kind === 'follow-up' && b.kind === 'follow-up') {
    return (a.date ?? null) === (b.date ?? null)
  }
  if (a.kind === 'form' && b.kind === 'form') {
    return a.method === b.method && a.alreadyHeld === b.alreadyHeld && a.generated === b.generated
  }
  // 'authorization' and 'refusal' carry no fields.
  return true
}

function StewardshipHistoryColumn({
  detail, forceCall, callSelection, interactionSelection = null, forceServicingAccess = false, forceCustomerInteraction = false,
  contactPreview = null, callNote = '', onCallNoteChange,
}: {
  detail: Detail
  forceCall: boolean
  /** The live preview the shared contact card reports from its unified editor.
   * When present it is what the card's single Save will record, so it takes
   * precedence over the workflow preview; null when the card is not editing. */
  contactPreview?: NextHistoryEntryPreview | null
  /** The live call-flow selection, when a guided call is in progress. Drives the
   * dynamic preview; null on the other working screens or before a reach
   * decision. */
  callSelection: CallSelection | null
  /** The live Customer Interaction selection: the single action the worker is
   * preparing (a communication, a follow-up, or a staged authorization /
   * refusal). Drives the dynamic Next History Entry preview; null before the
   * worker prepares anything. */
  interactionSelection?: InteractionSelection | null
  /** The servicing-access working screen, so the preview names the servicing
   * step this work will record (receipt / submission / confirmation). */
  forceServicingAccess?: boolean
  /** The Customer Interaction working screen. It shows the shared Next History
   * Entry preview (built from the single prepared action) above the one shared
   * Customer History card. */
  forceCustomerInteraction?: boolean
  /** The optional Call Notes text + setter (task-owned). On the guided call
   * screen the HistoryNotesField for these renders here, between the Next
   * History Entry preview and the Customer History, once a reach outcome is
   * chosen. */
  callNote?: string
  onCallNoteChange?: (next: string) => void
}) {
  // Customer Interaction uses the ONE shared history presentation, the same
  // Next History Entry preview + Customer History card every other working
  // screen uses, over the SAME customer history. The preview is built from the
  // single action the worker is preparing (never a combination); until they
  // prepare something it is blank. Completing that action records exactly the
  // previewed entry.
  if (forceCustomerInteraction) {
    return (
      <>
        {/* The contact card's live unified-edit preview wins while it is open;
            otherwise the prepared interaction preview. */}
        <NextHistoryEntry preview={contactPreview ?? describeInteractionSelection(interactionSelection)} />
        <CustomerHistoryCard events={detail.customer_history ?? []} />
      </>
    )
  }
  const activity = resolveWorkflowActivity(detail, forceCall, forceServicingAccess)
  // The preview is built DYNAMICALLY from the live selection where the screen
  // makes one (the guided call flow, the intro email), so it reflects exactly
  // what completing the open work will record, combined into one concise entry.
  // The calling flow only generates an event once a reach decision is made, so
  // before that the preview is withheld.
  const preview: NextHistoryEntryPreview | null =
    activity === 'calling'
      ? (callSelection
          ? describeCallSelection(callSelection, { customerName: detail.customer.first_name })
          : null)
      : activity === 'introductory-email'
        ? describeIntroEmailSelection({ formIncluded: true })
        : activity === 'servicing-access'
          ? describeServicingAccessStep(detail)
          : describeNextHistoryEntry(activity, { customerName: detail.customer.first_name })
  return (
    <>
      {/* The card owns its single heading; blank until there is something to
          record (the calling flow before a reach decision passes null). The
          contact card's live unified-edit preview takes precedence while it is
          open, so editing contact facts previews exactly what Save will log. */}
      <NextHistoryEntry preview={contactPreview ?? preview} />
      {/* Optional notes for the history entry — on the guided call screen, shown
          BETWEEN the Next History Entry preview and the Customer History once a
          reach outcome is chosen (an outcome is being recorded, so the note has
          something to ride along with). The task owns the text; the Outreach
          Call Panel folds it into the recorded outcome. The generic
          HistoryNotesField Lego keeps the label and treatment consistent for
          any future surface that records a note. */}
      {activity === 'calling' && callSelection?.reach && onCallNoteChange && (
        <HistoryNotesField value={callNote} onChange={onCallNoteChange} />
      )}
      <CustomerHistoryCard events={detail.customer_history ?? []} />
    </>
  )
}

/** Resolve which workflow activity a working screen is performing, so the Next
 * History Entry preview describes the right recorded outcome. The guided call
 * workbench (forceCall) is calling; Research Needed is contact research; an
 * untouched Ready-to-Email first touch is the introductory email. */
function resolveWorkflowActivity(
  detail: Detail,
  forceCall: boolean,
  forceServicingAccess = false,
): WorkflowActivity {
  if (forceServicingAccess) return 'servicing-access'
  if (forceCall) return 'calling'
  if (detail.queue === 'research-needed') return 'contact-research'
  if (isIntroductoryEmailActivity(detail)) return 'introductory-email'
  return 'record-attempt'
}

/**
 * The Next History Entry preview for the servicing-access working screen, built
 * from where the servicing request currently stands: before carrier submission
 * the next recorded entry is the submission; in Waiting for Carrier it is the
 * carrier confirmation. Concise, matching the history vocabulary.
 */
function describeServicingAccessStep(detail: Detail): NextHistoryEntryPreview {
  if (detail.queue === 'waiting-for-carrier') {
    return { summary: 'Servicing Access Confirmed' }
  }
  if (detail.form_received_at) {
    return { summary: 'Submitted to Carrier' }
  }
  return { summary: 'Authorization Received' }
}

/** Map a holding onto the read-only Policy Summary shape. */
function holdingToPolicySummary(h: Holding): PolicySummary {
  return {
    id: h.id,
    policy_number: h.policy_number,
    product_type: h.product_type,
    face_amount: h.face_amount,
    issue_date: h.issue_date,
    cash_value_amount: h.cash_value_amount,
    carrier: h.carrier,
    coverage_status: h.coverage_status,
    annual_premium: h.annual_premium,
    rate_class: h.rate_class,
    insured_name: h.insured_name,
    sa_status: h.sa_status,
  }
}

/**
 * The Introductory Emails activity: a Ready to Email item the worker has NOT
 * reached by phone, so the next step is the first-touch introductory email that
 * carries the authorization form. This screen is streamlined for fast,
 * continuous processing (send, record, next customer), so the right-panel
 * verification and attempt-recording tools — which belong to the call/research
 * activities — are intentionally hidden here. They remain available on every
 * other activity.
 */
function isIntroductoryEmailActivity(detail: Detail): boolean {
  return detail.queue === 'ready-to-email' && detail.last_call_outcome !== 'reached'
}

/**
 * The right-side context panel for an outreach task. Always shows the customer
 * information and the servicing request/policy information. The customer-
 * verified contact box and the record-an-attempt panel are shown on every
 * activity EXCEPT Introductory Emails, which is streamlined for fast sending;
 * both capabilities stay fully available on the call and research activities.
 */
function StewardshipContextPanel({
  detail, request, context, busy, act, setDetail, reload, forceCall = false, forceCustomerInteraction = false, withHistoryColumn = false, reached = false,
  onContactPreviewChange,
}: {
  detail: Detail
  request: Holding[]
  context: Holding[]
  busy: boolean
  act: (action: unknown, successNote?: string) => void
  setDetail: React.Dispatch<React.SetStateAction<Detail | null>>
  /** Forward the shared contact card's live unified-edit preview up to the task
   * so the history column can show what the card's single Save will record. */
  onContactPreviewChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Reload the task detail from the server. The Customer Contact Card calls it
   * after a save so the authoritative contact_options (call / text / email /
   * postal) are recomputed from the saved facts via the one established
   * server path, keeping the workflow's available actions in step with the card
   * without a page refresh and without a second availability calculation. */
  reload: () => Promise<void> | void
  /** The Call Reachable Customers workbench: show the shared Customer Contact
   * card (verify/correct inline on the Reached path) and hide the separate
   * record-an-attempt panel, because the guided call flow IS the recording. */
  forceCall?: boolean
  /** The Customer Interaction working screen: show the shared Customer Contact
   * card so contact facts stay visible while handling the conversation, and hide
   * the generic record-an-attempt panel because the interaction action column
   * owns recording (incoming/outgoing email, phone, text, and follow-up). */
  forceCustomerInteraction?: boolean
  /** On the three working screens, history moves to its own third column, so
   * the center context column shows the contact card + the read-only Policy
   * Summary beneath it (replacing the raw holdings list). Every other caller
   * keeps the original holdings context. */
  withHistoryColumn?: boolean
  /** The guided call reached the customer. On the calling workbench this shows
   * a prominent verify-contact instruction above the contact card, so the
   * caller corrects/verifies phone, email, and mailing address during the live
   * conversation. (The card itself starts collapsed; the worker clicks Edit.) */
  reached?: boolean
}) {
  const introEmail = isIntroductoryEmailActivity(detail)
  // Research Needed is the second 1035 contact-gathering activity: like
  // Introductory Emails and project Contact Review, its contact surface is the
  // one shared editable Customer Contact card (identity, email, phone, mailing
  // address, each with status, edit, and customer-verified control), replacing
  // the former separate contact summary, mailing-address block, and verification
  // checkboxes. The research capture + routing stays in the left ActionPanel.
  const research = detail.queue === 'research-needed'
  // The shared Customer Contact card is the ONE standard contact surface across
  // every stewardship working screen (Introductory Emails, Make Due Calls, Call
  // Reachable Customers, Customer Interaction, Servicing Access, Research
  // Needed). It is the shared card everywhere, so contact information looks and
  // behaves identically. The card runs in the approved Overview/Edit presentation and
  // starts COLLAPSED (the compact Overview) on EVERY surface, matching the rest
  // of Right Path. The worker clicks Edit to open the fields; Save and Cancel
  // return it to the Overview. No surface forces it open.

  // Policy Summary on the working screens replaces the raw holdings list in the
  // center column. Summarize the servicing-request policies when the request
  // names them, otherwise all known holdings, so the worker still sees the
  // customer's policy facts. Existing policy data only; nothing invented.
  const summaryPolicies = (request.length > 0 ? request : context).map(holdingToPolicySummary)

  return (
    <>
      {/* On the calling workbench, once the customer is reached, a prominent
          yellow instruction sits directly above the contact card to draw the
          caller's attention to the contact facts to review during the live
          conversation. It replaces the former left-column note so the prompt
          lives next to the card it refers to. */}
      {forceCall && reached && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base font-medium text-amber-900">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>Confirm or correct the customer&apos;s phone number, email address, and mailing address.</span>
        </div>
      )}
      {/* The one standard contact surface on every stewardship working screen.
          Writes straight to the customer record via the shared route and keeps
          the surrounding task in sync through onChange. Approved Overview/Edit
          presentation; collapsed by default on every surface — the worker
          clicks Edit to open the fields. */}
      <StewardshipCustomerContact detail={detail} setDetail={setDetail} reload={reload} onContactPreviewChange={onContactPreviewChange} />

      {/* The record-an-attempt tool belongs to the general call/research view,
          not the fast-send Introductory Emails flow, the find-contact Research
          flow (which records no contact attempt), nor the guided calling
          workbench (whose Reached/Didn't Reach flow IS the single recording). */}
      {!introEmail && !research && !forceCall && !forceCustomerInteraction && <RecordAttemptPanel detail={detail} busy={busy} act={act} />}
      {withHistoryColumn ? (
        // Working-screen center column: the read-only Policies card beneath the
        // contact card (it owns its single "Policies" heading). Holdings-as-
        // context is replaced by it here; the request/other-holdings distinction
        // is preserved by summarizing the request policies first.
        <PolicySummaryList policies={summaryPolicies} />
      ) : (
        <HoldingsContext request={request} context={context} />
      )}
    </>
  )
}

/**
 * The Introductory Emails contact surface: the shared CustomerContactCard bound
 * to this outreach item's customer. Maps the stewardship Detail onto the card's
 * customer shape and folds any saved/verified change back into the task's Detail
 * so the rest of the screen (and the Introductory Emails fast flow) stays
 * consistent without a reload. The card itself persists to the shared
 * /api/customers/[id]/contact route.
 */
function StewardshipCustomerContact({
  detail, setDetail, reload, onContactPreviewChange,
}: {
  detail: Detail
  setDetail: React.Dispatch<React.SetStateAction<Detail | null>>
  /** Reload the task detail so the authoritative contact_options are recomputed
   * from the saved facts after a card edit (see StewardshipContextPanel). */
  reload: () => Promise<void> | void
  /** Forward the card's live unified-edit preview up so the history column can
   * show what its single Save will record. */
  onContactPreviewChange?: (preview: NextHistoryEntryPreview | null) => void
}) {
  // The screen invokes the self-contained card with ONLY the customer identity.
  // The card opens COLLAPSED (the compact Overview) on every surface, matching
  // the rest of Right Path; the worker clicks Edit to open the fields. The card
  // fetches, displays, edits, and saves
  // all of the customer's contact information itself (name, calculated age,
  // email, phone, mailing address, verification, email availability, Do Not Text
  // / Text Undeliverable, and the customer alert), so this screen no longer
  // assembles a contact object, a name/age header, or the texting facts.
  //
  // `onChange` keeps the surrounding task in step with a card save in two ways:
  //   1. It folds the authoritative customer facts the card returns back into
  //      Detail, so the name shown elsewhere and the contact values update
  //      immediately (no flicker while the reload is in flight).
  //   2. It reloads the task detail, so the AUTHORITATIVE contact_options
  //      (call / text / email / postal) are recomputed from the saved facts by
  //      the one established server path (ZEN over normalized phone identity +
  //      the value-scoped/legacy unusable history + Do Not Text). That single
  //      source of truth is what the channel actions read, so reformatting a
  //      number keeps a value-scoped restriction, replacing a genuinely unusable
  //      number restores eligible calling AND texting, and Do Not Text / Text
  //      Undeliverable restrict only texting — all without a page refresh and
  //      with no second availability calculation on the client.
  // A future change to the card needs no edit here.
  return (
    <CustomerContactCard
      customerId={detail.customer.id}
      onPendingChange={onContactPreviewChange}
      onChange={(u) => {
        setDetail(prev => prev ? {
          ...prev,
          email_verified_at: u.email_verified_at,
          phone_verified_at: u.phone_verified_at,
          address_verified_at: u.address_verified_at,
          customer: {
            ...prev.customer,
            // A corrected name updates everywhere the detail's customer name is
            // shown; fall back to the existing value if the record returns null.
            first_name: u.first_name ?? prev.customer.first_name,
            last_name: u.last_name ?? prev.customer.last_name,
            email: u.email,
            phone: u.phone,
            street: u.street,
            address_line1: u.address_line1 ?? prev.customer.address_line1,
            city: u.city,
            state: u.state,
            zip: u.zip,
            email_availability: u.email_availability,
            contact_alert: u.contact_alert ?? null,
            sms_opt_out: u.sms_opt_out ?? prev.customer.sms_opt_out,
            text_undeliverable: u.text_undeliverable ?? prev.customer.text_undeliverable,
          },
        } : prev)
        // Recompute the authoritative available actions from the saved facts.
        void reload()
      }}
    />
  )
}

/**
 * The per-queue task action. Dispatches to the queue-specific panel. Each panel
 * owns its own copy, controls, and transitions; the dispatcher only routes.
 */
function TaskAction({
  detail, request, busy, note, act, hasNextInActivity = false, forceCall = false,
  forceUnableToCall = false,
  onSkip, onCallSelectionChange, callNote = '',
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  note: string | null
  act: (action: unknown, successNote?: string, opts?: { advanceToNext?: boolean }) => void
  hasNextInActivity?: boolean
  /** The optional Call Notes text (owned by the task, edited in the history
   * column). The guided call panel reads it to fold into the recorded outcome. */
  callNote?: string
  /** Force the guided call flow regardless of the stored queue (the Call
   * Reachable Customers workbench). */
  forceCall?: boolean
  /** Force the People We Can't Call panel (no-phone research + email/postal).
   * Only set when the customer has NO phone; once a phone is found the parent
   * switches to forceCall instead. */
  forceUnableToCall?: boolean
  /** Skip the open intro-email customer without sending/recording (fast flow). */
  onSkip?: () => void
  /** Report the live guided-call selection up so the history column can preview
   * the entry that completing the call will record. */
  onCallSelectionChange?: (selection: CallSelection | null) => void
}) {
  const name = fullName(detail.customer)

  const noteBox = note && (
    <div className="flex items-center gap-2 rounded-xl border border-status-confirmed-border bg-status-confirmed-soft p-4 text-base text-status-confirmed-strong">
      <Check className="size-5" aria-hidden /> {note}
    </div>
  )

  // A refused item shows a stop state and a deliberate Reopen; outreach stays
  // suppressed everywhere else until it is reopened here.
  if (detail.refused_at) {
    return <RefusedAction detail={detail} busy={busy} noteBox={noteBox} act={act} />
  }

  // The Nonresponsive recommendation (ZEN-flagged after enough unsuccessful
  // outreach attempts) is shown ABOVE the normal action, never instead of it:
  // outreach is not stopped, the queue is unchanged, and the worker still acts.
  // It recommends reconsidering contact information, method, or timing, and
  // leaves the decision to the person.
  const banner = detail.nonresponsive ? (
    <NonresponsiveNotice nonresponsive={detail.nonresponsive} />
  ) : null

  const panel = (() => {
    // The Call Reachable Customers workbench forces the guided call flow for any
    // callable customer, regardless of their stored queue (a callable customer
    // may sit in Ready to Email, having never been emailed). The workbench owns
    // the whole guided flow INCLUDING the reached authorization-form step, so it
    // stays in control even after the reached call is recorded; it only hands
    // off by advancing to the next customer once the form is sent.
    if (forceCall) {
      return (
        <CallAction
          detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
          workbench hasNextInActivity={hasNextInActivity}
          onSkip={onSkip}
          onSelectionChange={onCallSelectionChange}
          callNote={callNote}
        />
      )
    }
    // People We Can't Call: no-phone research + authorization email/postal. Owns
    // the whole no-phone flow regardless of the stored queue; a phone found here
    // flips the parent to forceCall (handled above), so this only renders while
    // there is still no phone.
    if (forceUnableToCall) {
      return (
        <UnableToCallAction
          detail={detail} request={request} name={name} busy={busy} act={act}
          hasNextInActivity={hasNextInActivity} onSkip={onSkip}
        />
      )
    }
    switch (detail.queue) {
      case 'ready-to-email':
        return (
          <ReadyToEmailAction
            detail={detail} request={request} name={name} busy={busy} noteBox={noteBox} act={act}
            hasNextInActivity={hasNextInActivity} onSkip={onSkip}
          />
        )
      case 'ready-to-call':
        return (
          <CallAction
            detail={detail} request={request} busy={busy} noteBox={noteBox} act={act}
            workbench={forceCall} hasNextInActivity={hasNextInActivity}
            onSelectionChange={onCallSelectionChange}
            callNote={callNote}
          />
        )
      case 'research-needed':
        return <ResearchAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
      case 'waiting-for-response':
        return <WaitingForResponseAction detail={detail} busy={busy} noteBox={noteBox} act={act} />
      case 'waiting-for-form':
        return <FormAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
      case 'waiting-for-carrier':
        return <CarrierAction detail={detail} request={request} busy={busy} noteBox={noteBox} act={act} />
      default:
        return null
    }
  })()

  if (!banner) return panel
  return (
    <div className="space-y-4">
      {banner}
      {panel}
    </div>
  )
}
