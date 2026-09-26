import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import ScorecardClient from './ScorecardClient'

export const metadata: Metadata = { title: 'Agency Scorecard' }
export const dynamic = 'force-dynamic'

export type ScorecardRow = {
  agency_id:        string
  name:             string
  display_name:     string | null
  slug:             string
  sml_team:         string | null

  // Referrals (portal-submitted, current year)
  referrals_total:     number
  referrals_portal:    number   // EFS-generated
  referrals_gifted:    number   // producer_credit + acom_gift

  // Pipeline (current year)
  pending_count:       number
  pending_premium:     number   // sum of annual_premium where pending

  // Placed (current year, from cases)
  placed_count:        number
  placed_premium:      number
  avg_days_to_place:   number | null

  // Placed (current quarter, from cases)
  placed_count_q:      number
  placed_premium_q:    number

  // GDC from Allstate compensation report (current year)
  gdc_ytd:             number
  allstate_policy_count: number  // Allstate's policy_count sum — source of truth for the 12-policy goal
}

export default async function ScorecardPage() {
  const supabase = createAdminClient()
  const now      = new Date()
  const year     = now.getFullYear()
  const yearStart = `${year}-01-01`

  // Quarter bounds
  const qIndex  = Math.floor(now.getMonth() / 3)
  const qStart  = new Date(year, qIndex * 3, 1).toISOString().split('T')[0]

  // ── 1. All active agencies with SML team ──────────────────────────────────
  const { data: agencyRows } = await supabase
    .from('agencies')
    .select('id, name, display_name, slug, sml_teams ( name )')
    .eq('is_test', false)
    .eq('is_active', true)
    .order('name')

  if (!agencyRows?.length) {
    return <div className="p-8 text-slate-400">No agencies found.</div>
  }

  // ── 2. Cases for current year (all statuses) ──────────────────────────────
  const { data: caseRows } = await supabase
    .from('cases')
    .select(`
      id, agency_id, internal_status, created_at, placed_at,
      annual_premium, referral_origin,
      stage_translations!inner ( is_won, is_active_case, tier )
    `)
    .eq('is_test', false)
    .gte('created_at', yearStart)

  // ── 3. GDC records for current year ──────────────────────────────────────
  const { data: gdcRows } = await supabase
    .from('gdc_records')
    .select('agency_id, production_credit, policy_count')
    .gte('process_date', yearStart)
    .not('agency_id', 'is', null)

  // ── Aggregate per agency ──────────────────────────────────────────────────
  type StageInfo = { is_won: boolean; is_active_case: boolean; tier: number }

  const rows: ScorecardRow[] = agencyRows.map(a => {
    const agencyCases = (caseRows ?? []).filter(c => c.agency_id === a.id)
    const agencyGdc   = (gdcRows  ?? []).filter(g => g.agency_id === a.id)

    // Referrals: any case created this year (portal = EFS-generated)
    const referrals_total  = agencyCases.length
    const referrals_portal = agencyCases.filter(c => c.referral_origin === 'portal').length
    const referrals_gifted = agencyCases.filter(
      c => c.referral_origin === 'producer_credit' || c.referral_origin === 'acom_gift'
    ).length

    // Pending: tier >= 2 and is_active_case = true
    const pendingCases = agencyCases.filter(c => {
      const st = c.stage_translations as unknown as StageInfo | null
      return st && st.tier >= 2 && st.is_active_case && !st.is_won
    })
    const pending_count   = pendingCases.length
    const pending_premium = pendingCases.reduce((s, c) => s + (c.annual_premium ?? 0), 0)

    // Placed (YTD)
    const placedYtd = agencyCases.filter(c => {
      const st = c.stage_translations as unknown as StageInfo | null
      return st?.is_won === true
    })
    const placed_count   = placedYtd.length
    const placed_premium = placedYtd.reduce((s, c) => s + (c.annual_premium ?? 0), 0)

    const daysToPlace = placedYtd
      .filter(c => c.placed_at && c.created_at)
      .map(c => {
        const ms = new Date(c.placed_at!).getTime() - new Date(c.created_at).getTime()
        return ms / 86_400_000
      })
    const avg_days_to_place = daysToPlace.length
      ? daysToPlace.reduce((s, d) => s + d, 0) / daysToPlace.length
      : null

    // Placed (current quarter)
    const placedQ = placedYtd.filter(c => c.placed_at && c.placed_at >= qStart)
    const placed_count_q   = placedQ.length
    const placed_premium_q = placedQ.reduce((s, c) => s + (c.annual_premium ?? 0), 0)

    // GDC
    const gdc_ytd             = agencyGdc.reduce((s, g) => s + (g.production_credit ?? 0), 0)
    const allstate_policy_count = agencyGdc.reduce((s, g) => s + (g.policy_count ?? 0), 0)

    return {
      agency_id:   a.id,
      name:        a.name,
      display_name: a.display_name ?? null,
      slug:        a.slug,
      sml_team:    (a.sml_teams as unknown as { name: string } | null)?.name ?? null,

      referrals_total,
      referrals_portal,
      referrals_gifted,

      pending_count,
      pending_premium,

      placed_count,
      placed_premium,
      avg_days_to_place,
      placed_count_q,
      placed_premium_q,

      gdc_ytd,
      allstate_policy_count,
    }
  })

  return (
    <div className="p-8">
      <div className="max-w-screen-2xl mx-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-white text-2xl font-semibold">Agency Scorecard</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {year} quarterly progress · 12-policy goal tracking
            </p>
          </div>
        </div>
        <ScorecardClient rows={rows} currentQuarter={qIndex + 1} year={year} />
      </div>
    </div>
  )
}
