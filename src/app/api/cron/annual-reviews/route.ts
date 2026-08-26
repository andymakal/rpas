'use server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest }        from 'next/server'

// ── Helpers ────────────────────────────────────────────────────────────────────

function getReviewType(productType: string | null): 'term' | 'permanent_ul' | 'permanent_wl' {
  if (!productType) return 'permanent_wl'
  if (productType === 'Term') return 'term'
  if (['UL', 'VUL', 'IUL'].includes(productType)) return 'permanent_ul'
  return 'permanent_wl'
}

type PolicySnapshot = {
  product_type:          string | null
  rate_class:            string | null
  primary_beneficiary:   string | null
  cash_value_amount:     number | null
  cash_value_as_of_date: string | null
  term_length:           string | null
  issue_date:            string | null
}

function computeFlags(p: PolicySnapshot) {
  const productType = p.product_type ?? ''
  const isPermanent = ['UL', 'VUL', 'IUL', 'WL', 'FA', 'MVA'].includes(productType)
  const isTerm      = productType === 'Term'
  const rateClass   = (p.rate_class ?? '').toLowerCase()

  const isDecUl        = ['UL', 'VUL', 'IUL'].includes(productType)
  const tobaccoFlag    = rateClass.includes('tobacco') || rateClass.includes('smoker') || rateClass.includes('nicotine')
  const beneMissing    = !p.primary_beneficiary?.trim()
  const cashValue      = p.cash_value_amount ?? 0
  const is1035         = isPermanent && cashValue > 0

  let cashValueStale = false
  if (is1035) {
    if (!p.cash_value_as_of_date) {
      cashValueStale = true
    } else {
      const cvDate    = new Date(p.cash_value_as_of_date)
      const oneYrAgo  = new Date(); oneYrAgo.setFullYear(oneYrAgo.getFullYear() - 1)
      cashValueStale  = cvDate < oneYrAgo
    }
  }

  let termExpiryDate: string | null = null
  if (isTerm && p.issue_date && p.term_length) {
    const years = parseInt(p.term_length.match(/(\d+)/)?.[1] ?? '0', 10)
    if (years > 0) {
      const expiry = new Date(p.issue_date)
      expiry.setFullYear(expiry.getFullYear() + years)
      termExpiryDate = expiry.toISOString().slice(0, 10)
    }
  }

  return {
    is_declining_ul:      isDecUl,
    tobacco_reclass_flag: tobaccoFlag,
    beneficiary_missing:  beneMissing,
    is_1035_eligible:     is1035,
    cash_value_stale:     cashValueStale,
    term_expiry_date:     termExpiryDate,
  }
}

type Flags = ReturnType<typeof computeFlags>

function buildNotifBody(flags: Flags, extra?: { termExpiry?: string | null; cashValue?: number | null }): string {
  const pts: string[] = []
  if (flags.is_1035_eligible) {
    pts.push(extra?.cashValue ? `1035 eligible — $${extra.cashValue.toLocaleString()} CV` : '1035 eligible')
    if (flags.cash_value_stale) pts.push('CV data stale — request illustration')
  }
  if (flags.is_declining_ul)      pts.push('Declining UL')
  if (flags.term_expiry_date)     pts.push(`Term expires ${flags.term_expiry_date}`)
  if (flags.tobacco_reclass_flag) pts.push('Tobacco reclassification opportunity')
  if (flags.beneficiary_missing)  pts.push('No beneficiary on file')
  return pts.length > 0 ? pts.join(' · ') : 'Annual review queued'
}

// Returns how many days until the next anniversary of issueDate from today.
// Negative = anniversary already passed this year (within the look-back window).
function daysUntilAnniversary(issueDate: string, today: Date): number {
  const issue    = new Date(issueDate)
  const thisYear = new Date(issue)
  thisYear.setFullYear(today.getFullYear())

  let diff = Math.round((thisYear.getTime() - today.getTime()) / 86_400_000)

  // If this year's anniversary is more than 20 days in the past, check next year's
  if (diff < -20) {
    const nextYear = new Date(issue)
    nextYear.setFullYear(today.getFullYear() + 1)
    diff = Math.round((nextYear.getTime() - today.getTime()) / 86_400_000)
  }

  return diff
}

// ── Route ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/cron/annual-reviews
 *
 * Runs daily (vercel.json: 0 12 * * *).
 *
 * PATH A — Explorer/placed policies
 *   Finds placed cases where placed_at is 350–370 days ago, locates the
 *   linked service_policy, computes prep flags, auto-creates a policy_reviews
 *   row (status: prep) and a notification linking directly to it.
 *
 * PATH B — Wanderer policies
 *   Finds service_policies we did NOT write (source_case_id IS NULL) whose
 *   issue_date anniversary falls within ±15 days of today. Same flag
 *   computation, same review creation. These are legacy Everlake/LBL holders —
 *   the review is a genuine service check that may surface replacement or
 *   1035 opportunities organically.
 *
 * Both paths: dedup by skipping policies that already have a policy_reviews
 * row created in the current calendar year.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now      = new Date()
  const yearStart = `${now.getFullYear()}-01-01`

  let created  = 0
  let skipped  = 0
  const errors: string[] = []

  // ── PATH A: Explorer — placed_at 350–370 days ago ─────────────────────────

  const lo = new Date(now); lo.setDate(now.getDate() - 370)
  const hi = new Date(now); hi.setDate(now.getDate() - 350)

  const { data: placedCases, error: casesErr } = await supabase
    .from('cases')
    .select('id, placed_at, customer_id, customers!customer_id (first_name, last_name)')
    .eq('internal_status', 'placed')
    .eq('is_test', false)
    .gte('placed_at', lo.toISOString())
    .lte('placed_at', hi.toISOString())

  if (casesErr) {
    console.error('annual-reviews: placed cases query failed', casesErr)
    return Response.json({ error: casesErr.message }, { status: 500 })
  }

  const placedRows = (placedCases ?? []) as unknown as {
    id: string
    placed_at: string
    customer_id: string
    customers: { first_name: string; last_name: string } | null
  }[]

  if (placedRows.length > 0) {
    const caseIds = placedRows.map(r => r.id)

    // Fetch linked service_policies in one batch
    const { data: explorerPolicies } = await supabase
      .from('service_policies')
      .select(`
        id, source_case_id, product_type, rate_class, primary_beneficiary,
        cash_value_amount, cash_value_as_of_date, term_length, issue_date
      `)
      .in('source_case_id', caseIds)

    const policyByCaseId = new Map(
      ((explorerPolicies ?? []) as unknown as (PolicySnapshot & { id: string; source_case_id: string })[])
        .map(p => [p.source_case_id, p])
    )

    // Dedup: which policy_ids already have a review this year?
    const explorerPolicyIds = [...policyByCaseId.values()].map(p => p.id)
    const alreadyQueued = new Set<string>()
    if (explorerPolicyIds.length > 0) {
      const { data: existing } = await supabase
        .from('policy_reviews')
        .select('policy_id')
        .in('policy_id', explorerPolicyIds)
        .gte('created_at', yearStart)
      ;(existing ?? []).forEach((r: { policy_id: string }) => alreadyQueued.add(r.policy_id))
    }

    for (const c of placedRows) {
      const policy = policyByCaseId.get(c.id)
      if (!policy) continue
      if (alreadyQueued.has(policy.id)) { skipped++; continue }

      const flags         = computeFlags(policy)
      const placedAt      = new Date(c.placed_at)
      const scheduledDate = new Date(placedAt)
      scheduledDate.setFullYear(scheduledDate.getFullYear() + 1)

      const { data: review, error: revErr } = await supabase
        .from('policy_reviews')
        .insert({
          policy_id:      policy.id,
          customer_id:    c.customer_id,
          review_type:    getReviewType(policy.product_type),
          scheduled_date: scheduledDate.toISOString().slice(0, 10),
          status:         'prep',
          is_test:        false,
          ...flags,
        })
        .select('id')
        .single()

      if (revErr || !review) {
        errors.push(`Explorer case ${c.id}: ${revErr?.message ?? 'no data'}`)
        continue
      }

      const name = c.customers ? `${c.customers.first_name} ${c.customers.last_name}` : 'Unknown'
      await supabase.from('notifications').insert({
        type:  'annual_review',
        title: `Annual review ready: ${name}`,
        body:  buildNotifBody(flags, { cashValue: (policy as unknown as { cash_value_amount: number | null }).cash_value_amount }),
        link:  `/reviews/${review.id}`,
      })

      created++
    }
  }

  // ── PATH B: Wanderer — legacy policies by issue_date anniversary ───────────
  // Paginate in 1000-row chunks — PostgREST silently caps a bare select at
  // its max_rows setting (usually 1000), which would silently miss most of
  // a large imported book.

  const WANDERER_PAGE = 1000
  const wandererRows: (PolicySnapshot & { id: string; client_name: string | null; customer_id: string | null })[] = []
  let   wandPage = 0
  let   wandErr: { message: string } | null = null

  while (true) {
    const from = wandPage * WANDERER_PAGE
    const { data, error } = await supabase
      .from('service_policies')
      .select(`
        id, client_name, customer_id, product_type, rate_class, primary_beneficiary,
        cash_value_amount, cash_value_as_of_date, term_length, issue_date
      `)
      .is('source_case_id', null)
      .not('issue_date', 'is', null)
      .eq('is_test', false)
      .range(from, from + WANDERER_PAGE - 1)
      .order('id')

    if (error) { wandErr = error; break }
    if (!data?.length) break

    wandererRows.push(...(data as unknown as (PolicySnapshot & { id: string; client_name: string | null; customer_id: string | null })[]))
    if (data.length < WANDERER_PAGE) break
    wandPage++
  }

  if (wandErr) {
    console.error('annual-reviews: wanderer query failed', wandErr)
    errors.push(`Wanderer query: ${wandErr.message}`)
  }

  // Filter to anniversary window (±15 days) in JS — avoids raw SQL date math
  const anniversaryDue = wandererRows.filter(p => {
    if (!p.issue_date) return false
    const diff = daysUntilAnniversary(p.issue_date, now)
    return diff >= -15 && diff <= 5
  })

  if (anniversaryDue.length > 0) {
    // Dedup
    const wandererIds = anniversaryDue.map(p => p.id)
    const alreadyQueued = new Set<string>()
    const { data: existing } = await supabase
      .from('policy_reviews')
      .select('policy_id')
      .in('policy_id', wandererIds)
      .gte('created_at', yearStart)
    ;(existing ?? []).forEach((r: { policy_id: string }) => alreadyQueued.add(r.policy_id))

    for (const p of anniversaryDue) {
      if (alreadyQueued.has(p.id)) { skipped++; continue }

      const flags = computeFlags(p)

      // scheduled_date = this year's (or next year's) anniversary
      const diffDays      = daysUntilAnniversary(p.issue_date!, now)
      const scheduledDate = new Date(now)
      scheduledDate.setDate(scheduledDate.getDate() + diffDays)

      const { data: review, error: revErr } = await supabase
        .from('policy_reviews')
        .insert({
          policy_id:      p.id,
          customer_id:    p.customer_id ?? null,
          review_type:    getReviewType(p.product_type),
          scheduled_date: scheduledDate.toISOString().slice(0, 10),
          status:         'prep',
          is_test:        false,
          ...flags,
        })
        .select('id')
        .single()

      if (revErr || !review) {
        errors.push(`Wanderer policy ${p.id}: ${revErr?.message ?? 'no data'}`)
        continue
      }

      const name = p.client_name ?? 'Unknown'
      await supabase.from('notifications').insert({
        type:  'annual_review',
        title: `Review ready: ${name}`,
        body:  buildNotifBody(flags, { cashValue: p.cash_value_amount }),
        link:  `/reviews/${review.id}`,
      })

      created++
    }
  }

  return Response.json({
    ok:      errors.length === 0,
    created,
    skipped,
    errors:  errors.length > 0 ? errors : undefined,
  })
}
