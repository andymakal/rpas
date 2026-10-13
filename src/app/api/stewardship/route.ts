import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { resolveCapabilityProfile, loadWorkFunctions } from '@/lib/capabilities/resolve'
import { canActOnItem, claimedByOther } from '@/lib/capabilities/work-functions'
import { QUEUE_META, deriveFollowUpRouting, isWaitingFollowUpDue, callPopulationOf, type OutreachQueue, type CallPopulation, type CallReason } from '@/lib/stewardship/queues'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'

/**
 * GET /api/stewardship
 *
 * Returns the outreach board: every open capture work item with its current
 * queue and the customer identity needed to render the queue list. Backed by
 * stewardship_outreach joined to customer_prereviews -> customers.
 *
 * Before building the board, overdue waiting-for-response items are moved to
 * Ready to Call (reason: no-response) by deterministic derived routing, so
 * overdue work surfaces in the right queue without manual housekeeping.
 *
 * Optional ?queue=<OutreachQueue> filters to one queue.
 *
 * Optional ?project_id=<uuid> scopes the board to a single project: only
 * outreach for customers in that project's project_customers is returned, and
 * the counts reflect only that scoped set. Without the param the board is the
 * normal unscoped view across all open outreach.
 */
export async function GET(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const supabase = createAdminClient()
  const url = new URL(request.url)
  const queueFilter = url.searchParams.get('queue')
  const projectId = url.searchParams.get('project_id')?.trim() || null
  // A derived ACTION POPULATION to open (callability-based, not a stored queue),
  // so a My Work population link opens exactly the customers it counted.
  const populationParam = url.searchParams.get('population')?.trim() || null
  const populationFilter: CallPopulation | null =
    populationParam === 'calls-due' || populationParam === 'available-to-call'
      ? populationParam
      : null

  // Project scope: resolve the project's customer set up front. The board is
  // then filtered to these customers so counts and lists show only this
  // project's work. An empty project yields an empty board.
  let projectCustomerIds: Set<string> | null = null
  if (projectId) {
    const { data: members, error: memberErr } = await supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', projectId)
    if (memberErr) {
      console.error('stewardship board: project membership query error', memberErr)
      return Response.json({ error: memberErr.message }, { status: 500 })
    }
    projectCustomerIds = new Set((members ?? []).map((m: { customer_id: string }) => m.customer_id))
    if (projectCustomerIds.size === 0) {
      const emptyCounts = Object.fromEntries(
        (Object.keys(QUEUE_META) as OutreachQueue[]).map(q => [q, 0]),
      ) as Record<OutreachQueue, number>
      return Response.json({ data: { items: [], counts: emptyCounts } })
    }
  }

  // Deterministic follow-up routing: promote overdue waiting-for-response items
  // to Ready to Call (no-response) up front, and persist the move so it is
  // durable rather than a per-render illusion.
  const now = new Date()
  const { data: waiting } = await supabase
    .from('stewardship_outreach')
    .select('id, follow_up_due')
    .eq('queue', 'waiting-for-response')
    .not('follow_up_due', 'is', null)
    .lte('follow_up_due', now.toISOString())
  // Promote overdue waiting-for-response items to Ready to Call and PERSIST the
  // move. The promotion durably stamps call_reason = 'no-response', which is the
  // signal the Calls Due derivation reads, so a cadence-due call stays Calls Due
  // across later reads without needing a one-pass in-memory flag.
  for (const w of (waiting ?? []) as { id: string; follow_up_due: string | null }[]) {
    const patch = deriveFollowUpRouting({ queue: 'waiting-for-response', follow_up_due: w.follow_up_due }, now)
    if (patch) {
      await supabase.from('stewardship_outreach').update(patch).eq('id', w.id)
    }
  }

  // Resolve the caller's producer so the board can mark which shared items are
  // theirs (is_mine) and surface who holds each optional claim. The UNSCOPED
  // board is never FILTERED by the claim — that is presentation only. A
  // POPULATION view (opened from a My Work count), however, must list exactly
  // the set My Work counted, so it also resolves the caller's capability profile
  // to apply the SAME eligibility + claim gate below.
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  const [myProfile, workFunctions] = await Promise.all([
    user ? resolveCapabilityProfile(user.id) : Promise.resolve(null),
    populationFilter ? loadWorkFunctions() : Promise.resolve([]),
  ])
  const myProducerId = myProfile?.producerId ?? null
  const outreachRequiredQual =
    workFunctions.find(w => w.canonicalKey === 'outreach')?.requiredQualification ?? null

  let query = supabase
    .from('stewardship_outreach')
    .select(`
      id, prereview_id, queue, call_reason, research_reason, last_call_outcome,
      callback_date, email_sent_at, follow_up_due, form_received_at, submitted_at, carrier_correction,
      refused_at, updated_at, claimed_by_producer_id,
      customer_prereviews!inner (
        id, customer_id, source_agency_id, decision,
        customers!inner ( id, first_name, last_name, email, phone )
      )
    `)
    .order('updated_at', { ascending: true })

  // A stored-queue filter narrows to one queue. A population filter spans
  // several stored queues (callable items in ready-to-call AND ready-to-email),
  // so it is applied AFTER the derivation below, not as a queue eq here.
  if (!populationFilter && queueFilter && queueFilter in QUEUE_META) {
    query = query.eq('queue', queueFilter)
  }

  const { data, error } = await query
  if (error) {
    console.error('stewardship board query error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  type Row = {
    id: string
    queue: OutreachQueue
    call_reason: string | null
    research_reason: string | null
    last_call_outcome: string | null
    callback_date: string | null
    email_sent_at: string | null
    follow_up_due: string | null
    form_received_at: string | null
    submitted_at: string | null
    carrier_correction: string | null
    refused_at: string | null
    claimed_by_producer_id: string | null
    customer_prereviews: {
      id: string
      decision: string | null
      customers: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }
    }
  }

  // Only open items (decision still null) belong on the outreach board. A
  // decided pre-review is no longer stewardship/outreach work. A REFUSED item is
  // suppressed from the board until it is deliberately reopened (an explicit
  // refusal stops outreach). When a project scope is set, also drop any item
  // whose customer is not in the project, so both the list and the counts below
  // reflect only this project's work.
  const rows = ((data ?? []) as unknown as Row[]).filter(r => {
    if (r.customer_prereviews?.decision != null) return false
    if (r.refused_at != null) return false
    if (projectCustomerIds && !projectCustomerIds.has(r.customer_prereviews.customers.id)) return false
    return true
  })

  // Resolve display names for any producers that hold a claim on these rows, so
  // the queue list can show "Claimed by <name>" without a per-row query.
  const claimantIds = Array.from(
    new Set(rows.map(r => r.claimed_by_producer_id).filter((v): v is string => !!v)),
  )
  const nameByProducerId = new Map<string, string>()
  if (claimantIds.length > 0) {
    const { data: claimants } = await supabase
      .from('producers')
      .select('id, first_name, last_name')
      .in('id', claimantIds)
    for (const p of (claimants ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      nameByProducerId.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim())
    }
  }

  // Actor calendar for the date-only callback-due test used by the call
  // population derivation (each employee's own "today").
  const actorTimeZone = await getActorTimeZone()

  const items = rows.map(r => {
    // The derived call population this item belongs to (callability-based, not
    // its stored queue), using the SAME shared definition My Work counts with.
    // Due status reads from DURABLE row state (call_reason + a due callback),
    // so it survives refreshes and the waiting-to-response -> Ready to Call
    // promotion (which persisted call_reason = 'no-response').
    const population = callPopulationOf({
      effectiveQueue: r.queue,
      callReason: r.call_reason as CallReason | null,
      hasUsablePhone: !!r.customer_prereviews.customers?.phone?.trim(),
      callbackDue: isCallbackDue(r.callback_date, actorTimeZone),
    })
    return {
      id: r.id,
      queue: r.queue,
      call_reason: r.call_reason,
      research_reason: r.research_reason,
      last_call_outcome: r.last_call_outcome,
      callback_date: r.callback_date,
      email_sent_at: r.email_sent_at,
      follow_up_due: r.follow_up_due,
      form_received_at: r.form_received_at,
      submitted_at: r.submitted_at,
      carrier_correction: r.carrier_correction,
      // Waiting-for-form / waiting-for-carrier items whose chase window has lapsed
      // are flagged follow-up-due so the list can surface them for a nudge without
      // changing their (legitimately waiting) queue.
      follow_up_due_now: isWaitingFollowUpDue({ queue: r.queue, follow_up_due: r.follow_up_due, refused_at: r.refused_at }, now),
      // The call action population (null when the item is not a call opportunity).
      // Carried so the board can open a population link exactly as counted.
      call_population: population,
      prereview_id: r.customer_prereviews.id,
      customer: r.customer_prereviews.customers,
      // Optional soft-lease claim (shared by default). is_mine lets the list mark
      // the caller's own commitments; the board is never filtered by this.
      claimed_by_producer_id: r.claimed_by_producer_id,
      claimed_by_name: r.claimed_by_producer_id ? (nameByProducerId.get(r.claimed_by_producer_id) ?? null) : null,
      is_mine: !!r.claimed_by_producer_id && r.claimed_by_producer_id === myProducerId,
    }
  })

  // A population view opened from a My Work count must list EXACTLY what My Work
  // counted: the callable items in that population that this employee can pick
  // up (eligible by capability for the item's projects) and that are not claimed
  // by someone else. My Work applies this same canActOnItem / claimedByOther
  // gate, so with the gate applied here the opened list and the count agree.
  // Resolve each board customer's project set once (only needed for a population
  // view's eligibility test).
  const projectsByCustomer = new Map<string, Set<string>>()
  if (populationFilter) {
    const boardCustomerIds = Array.from(new Set(items.map(it => it.customer?.id).filter((v): v is string => !!v)))
    if (boardCustomerIds.length > 0) {
      const { data: memberships } = await supabase
        .from('project_customers')
        .select('customer_id, project_id')
        .in('customer_id', boardCustomerIds)
      for (const m of (memberships ?? []) as { customer_id: string; project_id: string }[]) {
        const set = projectsByCustomer.get(m.customer_id) ?? new Set<string>()
        set.add(m.project_id)
        projectsByCustomer.set(m.customer_id, set)
      }
    }
  }

  // The caller's actionable call items: in a call population, pickable by
  // capability, and not claimed by another employee. Mirrors My Work exactly.
  const isActionableToMe = (it: (typeof items)[number]): boolean => {
    if (!it.call_population) return false
    const itemProjects = projectsByCustomer.get(it.customer?.id ?? '') ?? new Set<string>()
    if (!canActOnItem(myProfile, 'outreach', outreachRequiredQual, itemProjects)) return false
    if (claimedByOther(it.claimed_by_producer_id, myProducerId)) return false
    return true
  }

  // When a population is requested, return exactly that population's customers
  // this employee can act on — the SAME set My Work counted — regardless of each
  // item's stored queue. Without a population filter the board is the unscoped,
  // unfiltered view (presentation only; never filtered by claim/eligibility).
  const visibleItems = populationFilter
    ? items.filter(it => it.call_population === populationFilter && isActionableToMe(it))
    : items

  const counts = Object.fromEntries(
    (Object.keys(QUEUE_META) as OutreachQueue[]).map(q => [q, 0]),
  ) as Record<OutreachQueue, number>
  for (const it of items) counts[it.queue] += 1
  // Population counts for the board header. In a population view they reflect the
  // caller-actionable sets (eligible + unclaimed), matching My Work's counts and
  // the list length above. In the unscoped board they are the raw population
  // sizes (presentation only).
  const populationCounts = populationFilter
    ? {
        'calls-due': items.filter(it => it.call_population === 'calls-due' && isActionableToMe(it)).length,
        'available-to-call': items.filter(it => it.call_population === 'available-to-call' && isActionableToMe(it)).length,
      }
    : {
        'calls-due': items.filter(it => it.call_population === 'calls-due').length,
        'available-to-call': items.filter(it => it.call_population === 'available-to-call').length,
      }

  return Response.json({
    data: {
      items: visibleItems,
      counts,
      population_counts: populationCounts,
      my_producer_id: myProducerId,
    },
  })
}
