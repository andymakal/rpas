import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import {
  AgencyPortal,
  type Case,
  type ServiceRequest,
  type PolicyReview,
  type SpiffRecord,
  type GdcRecord,
  type PortalContent,
  type ActivityEntry,
} from '@/components/portal/AgencyPortal'

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('agencies')
    .select('display_name, name')
    .eq('slug', slug)
    .single()
  const label = (data as { display_name: string | null; name: string } | null)
  return { title: label?.display_name ?? label?.name ?? 'Agency Dashboard' }
}

export default async function PortalPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = createAdminClient()

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, name, display_name, slug, contact_phone, contact_email, contact_street, contact_city, contact_state, contact_zip, agent_number, dashboard_token, owner_pin')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!agency) notFound()

  // Portal authentication — cookie must match the agency's dashboard_token
  const cookieStore = await cookies()
  const token = cookieStore.get(`rpas_portal_${slug}`)?.value
  if (!token || token !== agency.dashboard_token) {
    redirect(`/portal/${slug}/login`)
  }

  // Owner mode — separate cookie set by /api/portal/[slug]/owner-unlock
  const ownerToken = cookieStore.get(`rpas_portal_${slug}_owner`)?.value
  const isOwner    = !!(ownerToken && ownerToken === agency.dashboard_token)

  // Acquired books — child agencies whose data rolls up into this portal
  type ChildAgency = { id: string; name: string; display_name: string | null }
  const { data: childAgenciesRaw } = await supabase
    .from('agencies')
    .select('id, name, display_name')
    .eq('parent_agency_id', agency.id)
    .eq('is_active', true)
  const childAgencies = (childAgenciesRaw ?? []) as ChildAgency[]

  // All agency IDs whose data should appear on this portal
  const agencyIds = [agency.id, ...childAgencies.map(c => c.id)]

  // Book labels — shown on case cards when multiple books are rolled up
  const bookLabels = new Map<string, string>()
  if (agencyIds.length > 1) {
    const agencyTyped = agency as { display_name: string | null; name: string }
    bookLabels.set(agency.id, agencyTyped.display_name ?? agencyTyped.name)
    for (const c of childAgencies) {
      bookLabels.set(c.id, c.display_name ?? c.name)
    }
  }

  const year      = new Date().getFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd   = `${year}-12-31`

  const [casesResult, gdcResult, appResult, srResult, prResult, spiffResult, contentResult] =
    await Promise.all([
      supabase
        .from('cases')
        .select(`
          id,
          agency_id,
          internal_status,
          created_at,
          placed_at,
          face_amount,
          annual_premium,
          is_hot_lead,
          lead_source,
          touches,
          last_contact_at,
          customers!customer_id ( first_name, last_name ),
          agents ( first_name, last_name ),
          stage_translations ( agency_label, tier, is_active_case, is_won, is_lost, is_prospect ),
          products ( name, carriers ( short_name ) ),
          case_household_members!case_id ( first_name, last_name )
        `)
        .in('agency_id', agencyIds)
        .eq('is_test', false)
        .order('created_at', { ascending: false }),

      supabase
        .from('gdc_records')
        .select('production_credit')
        .in('agency_id', agencyIds)
        .gte('process_date', yearStart)
        .lte('process_date', yearEnd),

      supabase
        .from('gdc_records')
        .select('policy_number')
        .in('agency_id', agencyIds)
        .gte('process_date', yearStart)
        .lte('process_date', yearEnd)
        .eq('policy_count', 1),

      // Service requests — filter by agency via service_policies join
      supabase
        .from('service_requests')
        .select(`
          id, sr_number, request_type, workflow_status,
          date_received, date_resolved, created_at,
          service_policies!inner ( client_name, policy_number, agents ( first_name, last_name ) )
        `)
        .in('service_policies.agency_id', agencyIds)
        .eq('is_test', false)
        .order('created_at', { ascending: false })
        .limit(20),

      // Policy reviews — filter by agency via service_policies join
      supabase
        .from('policy_reviews')
        .select(`
          id, review_number, review_type, status,
          assigned_to, outcome, call_completed_at, created_at,
          service_policies!inner ( client_name, policy_number, agents ( first_name, last_name ) )
        `)
        .in('service_policies.agency_id', agencyIds)
        .eq('is_test', false)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('spiff_records')
        .select('id, earned_at, paid_at, amount, agents ( first_name, last_name )')
        .in('agency_id', agencyIds)
        .gte('earned_at', yearStart)
        .lte('earned_at', yearEnd)
        .order('earned_at', { ascending: false }),

      // Portal content: global (agency_id null) + primary agency-specific
      supabase
        .from('portal_content')
        .select('id, agency_id, content_type, title, body, link, link_label, sort_order, expires_at')
        .eq('is_active', true)
        .or(`agency_id.is.null,agency_id.eq.${agency.id}`)
        .order('sort_order'),
    ])

  // Filter out expired content in JS (avoids complex SQL OR on expires_at)
  type RawContent = PortalContent & { expires_at?: string | null }
  const now           = new Date()
  const portalContent: PortalContent[] = ((contentResult.data ?? []) as RawContent[])
    .filter(item => !item.expires_at || new Date(item.expires_at) > now)

  const gdcYtd = (gdcResult.data ?? []).reduce(
    (sum, r) => sum + Number(r.production_credit ?? 0), 0
  )
  const appCount = new Set(
    (appResult.data ?? []).map(r => r.policy_number).filter(Boolean)
  ).size

  // Recent activity feed — last 20 touches across all agencies on this portal
  const caseIds = (casesResult.data ?? []).map(c => c.id)
  let recentActivity: ActivityEntry[] = []
  if (caseIds.length > 0) {
    const { data: activityData } = await supabase
      .from('case_touches')
      .select('id, case_id, touch_type, touched_at, touched_by')
      .in('case_id', caseIds)
      .order('touched_at', { ascending: false })
      .limit(20)
    recentActivity = (activityData ?? []) as ActivityEntry[]
  }

  // Owner-only: full GDC transaction detail (including chargebacks), all books
  let gdcRecords: GdcRecord[] = []
  if (isOwner) {
    const { data } = await supabase
      .from('gdc_records')
      .select('id, policy_number, insured_name, product, production_credit, app_date, process_date, allstate_partner_number')
      .in('agency_id', agencyIds)
      .gte('process_date', yearStart)
      .lte('process_date', yearEnd)
      .order('process_date', { ascending: false })
    gdcRecords = (data ?? []) as GdcRecord[]
  }

  const agencyContact = agency as {
    display_name: string | null; name: string; slug: string
    contact_phone: string | null; contact_email: string | null
    contact_street: string | null; contact_city: string | null
    contact_state: string | null; contact_zip: string | null
  }

  return (
    <AgencyPortal
      agency={{
        name:   agencyContact.display_name ?? agencyContact.name,
        slug:   agencyContact.slug,
        phone:  agencyContact.contact_phone,
        email:  agencyContact.contact_email,
        street: agencyContact.contact_street,
        city:   agencyContact.contact_city,
        state:  agencyContact.contact_state,
        zip:    agencyContact.contact_zip,
      }}
      cases={(casesResult.data ?? []) as unknown as Case[]}
      gdcYtd={gdcYtd}
      appCount={appCount}
      serviceRequests={(srResult.data ?? []) as unknown as ServiceRequest[]}
      policyReviews={(prResult.data ?? []) as unknown as PolicyReview[]}
      spiffRecords={(spiffResult.data ?? []) as unknown as SpiffRecord[]}
      isOwner={isOwner}
      gdcRecords={gdcRecords}
      portalContent={portalContent}
      recentActivity={recentActivity}
      bookLabels={bookLabels}
    />
  )
}
