import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { resolveCapabilityProfile, loadWorkFunctions } from '@/lib/capabilities/resolve'
import { canActOnItem, claimedByOther } from '@/lib/capabilities/work-functions'
import { QUEUE_META, deriveFollowUpRouting, deriveEmailRouting, isWaitingFollowUpDue, callPopulationOf, isIntroductoryEmail, type OutreachQueue, type CallReason, type ResearchReason, type CallOutcome } from '@/lib/stewardship/queues'
import { initialQueueFromOptions, resolveContactOptions } from '@/lib/stewardship/contact-options'
import { getProjectWorkflows, projectContainsWorkflow, onboardingCompleteForPolicies } from '@/lib/projects/workflows'
import { getActorTimeZone } from '@/lib/time/actor-timezone-server'
import { isCallbackDue } from '@/lib/daily-direction/business-calendar'

/**
 * A derived population a My Work count can open on the board: the two
 * callability-based call populations, plus the first-touch introductory-email
 * subset of Ready to Email. Each opens EXACTLY the customers My Work counted,
 * gated by the same capability + claim rules.
 */
type PopulationFilter = 'calls-due' | 'available-to-call' | 'introductory-emails'

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
  // A derived ACTION POPULATION to open (callability-based or first-touch, not a
  // stored queue), so a My Work population link opens exactly the customers it
  // counted. The two call populations are callability-based; 'introductory-emails'
  // is the first-touch subset of Ready to Email (shared isIntroductoryEmail
  // predicate). All three resolve the caller's capability profile below so the
  // opened set is gated identically to the My Work count.
  const populationParam = url.searchParams.get('population')?.trim() || null
  const populationFilter: PopulationFilter | null =
    populationParam === 'calls-due' ||
    populationParam === 'available-to-call' ||
    populationParam === 'introductory-emails'
      ? populationParam
      : null

  // Project scope: resolve the project's customer set up front. The board is
  // then filtered to these customers so counts and lists show only this
  // project's work. An empty project yields an empty board.
  let projectCustomerIds: Set<string> | null = null
  if (projectId) {
    // Servicing Agent Onboarding is objective-driven and evaluated from facts.
    // The board NEVER creates records on read: a member who needs access is
    // surfaced from membership + policy facts (see the derived population
    // below), and a durable stewardship_outreach row is created only when an
    // operator actually acts on the customer — not by opening this page.
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
  //
  // ready-to-email is special: an item's EFFECTIVE queue can be ready-to-email
  // even when it is STORED as the opening ready-to-call/research-needed, because
  // an email added after intake upgrades an untouched opening item live
  // (deriveEmailRouting), the same way follow-up routing promotes an overdue
  // waiting item. So a ready-to-email filter must be applied in-memory against
  // the effective queue below, never as a DB eq on the stored column (which
  // would miss exactly the upgraded items). Every other stored-queue filter is
  // unaffected by email routing and stays a DB eq for efficiency.
  const deriveEmailFilter = queueFilter === 'ready-to-email'
  if (!populationFilter && !deriveEmailFilter && queueFilter && queueFilter in QUEUE_META) {
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

  // When this project runs the Servicing Agent Onboarding workflow, onboarding
  // COMPLETION is a derived fact (applicable permanent access confirmed), not
  // the presence/absence of a record. So a member whose onboarding is already
  // complete has ADVANCED past onboarding and must not appear on the onboarding
  // board — even if a lingering outreach row exists for them (e.g. access was
  // confirmed outside the outreach flow). We compute that derived-complete set
  // once and use it to suppress such rows below and to skip them when surfacing
  // derived (virtual) items. No writes; purely a read-time derivation.
  const projectHasOnboarding = projectId
    ? projectContainsWorkflow(await getProjectWorkflows(supabase, projectId), 'servicing_agent_onboarding')
    : false
  const onboardingCompleteMemberIds = new Set<string>()
  if (projectId && projectCustomerIds && projectHasOnboarding) {
    const memberIdList = Array.from(projectCustomerIds)
    for (let i = 0; i < memberIdList.length; i += 300) {
      const chunk = memberIdList.slice(i, i + 300)
      const { data: pols } = await supabase
        .from('service_policies')
        .select('customer_id, product_type, sa_status, is_test')
        .in('customer_id', chunk)
        .eq('is_test', false)
      const byCust = new Map<string, { product_type: string | null; sa_status: string | null }[]>()
      for (const p of (pols ?? []) as { customer_id: string; product_type: string | null; sa_status: string | null }[]) {
        const list = byCust.get(p.customer_id) ?? []
        list.push({ product_type: p.product_type, sa_status: p.sa_status })
        byCust.set(p.customer_id, list)
      }
      for (const cid of chunk) {
        const policies = byCust.get(cid) ?? []
        // A member with no known policy has nothing to onboard; onboardingComplete
        // returns true for them, but they are not surfaced as work anyway. Only
        // members WITH policies that are all-confirmed count as "advanced".
        if (policies.length > 0 && onboardingCompleteForPolicies(policies)) {
          onboardingCompleteMemberIds.add(cid)
        }
      }
    }
  }

  // Only open items (decision still null) belong on the outreach board. A
  // decided pre-review is no longer stewardship/outreach work. A REFUSED item is
  // suppressed from the board until it is deliberately reopened (an explicit
  // refusal stops outreach). When a project scope is set, also drop any item
  // whose customer is not in the project, so both the list and the counts below
  // reflect only this project's work. Finally, drop any item whose customer's
  // onboarding is DERIVED-COMPLETE (they have advanced to review preparation),
  // so a lingering record never contradicts the authoritative servicing-access
  // fact.
  const rows = ((data ?? []) as unknown as Row[]).filter(r => {
    if (r.customer_prereviews?.decision != null) return false
    if (r.refused_at != null) return false
    const cid = r.customer_prereviews.customers.id
    if (projectCustomerIds && !projectCustomerIds.has(cid)) return false
    if (onboardingCompleteMemberIds.has(cid)) return false
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
    // The EFFECTIVE queue, re-derived live the same way My Work does: an
    // untouched opening item whose email became usable after intake is
    // ready-to-email now (deriveEmailRouting), so the board, its counts, and a
    // Ready-to-Email filter all reflect the newly-added email without a stored
    // backfill. (Follow-up promotion of overdue waiting-for-response items is
    // already persisted up front, so it is not re-derived here.) Only one of the
    // two routings can apply to a given item, so the email upgrade is a safe
    // overlay on the stored queue.
    const emailRouted = deriveEmailRouting({
      queue: r.queue,
      call_reason: r.call_reason as CallReason | null,
      research_reason: r.research_reason as ResearchReason | null,
      last_call_outcome: r.last_call_outcome as CallOutcome | null,
      email_sent_at: r.email_sent_at,
      callback_date: r.callback_date,
      refused_at: r.refused_at,
      has_usable_email: !!r.customer_prereviews.customers?.email?.trim(),
    })?.queue as OutreachQueue | undefined
    const effectiveQueue: OutreachQueue = emailRouted ?? r.queue
    // The derived call population this item belongs to (callability-based, not
    // its stored queue), using the SAME shared definition My Work counts with.
    // Due status reads from DURABLE row state (call_reason + a due callback),
    // so it survives refreshes and the waiting-to-response -> Ready to Call
    // promotion (which persisted call_reason = 'no-response').
    const population = callPopulationOf({
      effectiveQueue,
      callReason: r.call_reason as CallReason | null,
      hasUsablePhone: !!r.customer_prereviews.customers?.phone?.trim(),
      callbackDue: isCallbackDue(r.callback_date, actorTimeZone),
    })
    // First-touch introductory-email membership, via the SAME shared predicate
    // My Work counts with, so the opened introductory-email population equals the
    // counted one.
    const introEmail = isIntroductoryEmail({
      effectiveQueue,
      emailSentAt: r.email_sent_at,
      lastCallOutcome: r.last_call_outcome as CallOutcome | null,
      callbackDate: r.callback_date,
    })
    return {
      id: r.id,
      queue: effectiveQueue,
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
      // Whether this item is in the first-touch introductory-email population,
      // carried so the board can open that population exactly as counted.
      is_intro_email: introEmail,
      prereview_id: r.customer_prereviews.id,
      customer: r.customer_prereviews.customers,
      // Optional soft-lease claim (shared by default). is_mine lets the list mark
      // the caller's own commitments; the board is never filtered by this.
      claimed_by_producer_id: r.claimed_by_producer_id,
      claimed_by_name: r.claimed_by_producer_id ? (nameByProducerId.get(r.claimed_by_producer_id) ?? null) : null,
      is_mine: !!r.claimed_by_producer_id && r.claimed_by_producer_id === myProducerId,
      // Not a derived item: this is a real, recorded outreach row.
      virtual: false as boolean,
      customer_id: r.customer_prereviews.customers.id,
    }
  })

  // DERIVED (virtual) onboarding items — project-scoped only.
  //
  // Servicing Agent Onboarding is evaluated from facts: when the project
  // contains the onboarding workflow, EVERY member whose applicable servicing
  // access is not yet confirmed is actionable — even if no outreach record
  // exists yet. We surface those members here as DERIVED items (id: null,
  // virtual: true) computed purely from membership + policy facts. No record is
  // created by this read; the client materializes the durable row on first
  // action via /api/stewardship/ensure-one.
  //
  // This is what makes a member needing access actionable WITHOUT a manual
  // start, while still never writing on a page read. Members whose onboarding is
  // already COMPLETE (access confirmed) are not surfaced — they have advanced to
  // review preparation. Members who already have a recorded outreach row are
  // represented by that row above and are not duplicated here.
  const virtualItems: typeof items = []
  if (projectId && projectCustomerIds && projectCustomerIds.size > 0 && projectHasOnboarding) {
    {
      // Members needing access = project members minus those already represented
      // by a recorded (open, non-refused) outreach row, minus those whose
      // onboarding is derived-COMPLETE (already advanced). No duplication, and
      // completed members are never resurfaced.
      const recordedCustomerIds = new Set(items.map(it => it.customer_id))
      const memberIds = Array.from(projectCustomerIds).filter(
        id => !recordedCustomerIds.has(id) && !onboardingCompleteMemberIds.has(id),
      )
      if (memberIds.length > 0) {
        // Policy facts for onboarding completion + the derived opening action.
        const policiesByCustomer = new Map<string, { product_type: string | null; sa_status: string | null }[]>()
        const contactByCustomer = new Map<string, { email: string | null; phone: string | null; first_name: string; last_name: string }>()
        for (let i = 0; i < memberIds.length; i += 300) {
          const chunk = memberIds.slice(i, i + 300)
          const [{ data: pols }, { data: custs }] = await Promise.all([
            supabase
              .from('service_policies')
              .select('customer_id, product_type, sa_status, is_test')
              .in('customer_id', chunk)
              .eq('is_test', false),
            supabase
              .from('customers')
              .select('id, first_name, last_name, email, phone, is_test')
              .in('id', chunk)
              .eq('is_test', false),
          ])
          for (const p of (pols ?? []) as { customer_id: string; product_type: string | null; sa_status: string | null }[]) {
            const list = policiesByCustomer.get(p.customer_id) ?? []
            list.push({ product_type: p.product_type, sa_status: p.sa_status })
            policiesByCustomer.set(p.customer_id, list)
          }
          for (const c of (custs ?? []) as { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }[]) {
            contactByCustomer.set(c.id, { email: c.email, phone: c.phone, first_name: c.first_name, last_name: c.last_name })
          }
        }

        for (const cid of memberIds) {
          const contact = contactByCustomer.get(cid)
          if (!contact) continue // test record or missing — not surfaced
          const policies = policiesByCustomer.get(cid) ?? []
          if (policies.length === 0) continue // no known policy: nothing to pursue
          // Already complete (access confirmed): advanced past onboarding, not surfaced.
          if (onboardingCompleteForPolicies(policies)) continue

          // The recommended opening action, derived from live contact facts the
          // same way a created record would be.
          const options = await resolveContactOptions({ email: contact.email, phone: contact.phone })
          const route = initialQueueFromOptions(options)
          const effectiveQueue = route.queue as OutreachQueue
          const population = callPopulationOf({
            effectiveQueue,
            callReason: route.call_reason as CallReason | null,
            hasUsablePhone: !!contact.phone?.trim(),
            callbackDue: false,
          })
          virtualItems.push({
            id: null as unknown as string,
            queue: effectiveQueue,
            call_reason: route.call_reason,
            research_reason: route.research_reason,
            last_call_outcome: null,
            callback_date: null,
            email_sent_at: null,
            follow_up_due: null,
            form_received_at: null,
            submitted_at: null,
            carrier_correction: null,
            follow_up_due_now: false,
            call_population: population,
            // A derived onboarding item is untouched by construction (no email
            // sent, no call outcome, no callback), so it is an introductory email
            // exactly when its opening queue is ready-to-email.
            is_intro_email: isIntroductoryEmail({
              effectiveQueue,
              emailSentAt: null,
              lastCallOutcome: null,
              callbackDate: null,
            }),
            prereview_id: null as unknown as string,
            customer: { id: cid, first_name: contact.first_name, last_name: contact.last_name, email: contact.email, phone: contact.phone },
            claimed_by_producer_id: null,
            claimed_by_name: null,
            is_mine: false,
            virtual: true as boolean,
            customer_id: cid,
          })
        }
      }
    }
  }
  // Merge derived items into the working set so counts and the list include the
  // members who are actionable from facts alone.
  items.push(...virtualItems)

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

  // Whether an item belongs to the given derived population: the two call
  // populations read call_population; the introductory-email population reads the
  // first-touch flag. One place, so membership is defined identically for the
  // filter and the count.
  const inPopulation = (it: (typeof items)[number], pop: PopulationFilter): boolean =>
    pop === 'introductory-emails' ? it.is_intro_email === true : it.call_population === pop

  // The caller's actionable items for a requested population: in that population,
  // pickable by capability, and not claimed by another employee. Mirrors My Work
  // exactly, so the opened set equals the counted set.
  const isActionableToMe = (it: (typeof items)[number], pop: PopulationFilter): boolean => {
    if (!inPopulation(it, pop)) return false
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
    ? items.filter(it => isActionableToMe(it, populationFilter))
    : deriveEmailFilter
      ? // A Ready-to-Email filter lists items whose EFFECTIVE queue is
        // ready-to-email (stored ready-to-email plus the opening items upgraded
        // live by a newly-added email), which the DB eq could not express.
        items.filter(it => it.queue === 'ready-to-email')
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
        'calls-due': items.filter(it => isActionableToMe(it, 'calls-due')).length,
        'available-to-call': items.filter(it => isActionableToMe(it, 'available-to-call')).length,
        'introductory-emails': items.filter(it => isActionableToMe(it, 'introductory-emails')).length,
      }
    : {
        'calls-due': items.filter(it => it.call_population === 'calls-due').length,
        'available-to-call': items.filter(it => it.call_population === 'available-to-call').length,
        'introductory-emails': items.filter(it => it.is_intro_email === true).length,
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
