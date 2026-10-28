import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getMyWorkCustomerIds } from '@/lib/my-work/scope'
import { NextRequest } from 'next/server'

/**
 * Shared customer search. Every mode accepts either a name/email-style query or
 * a phone number. A query that reduces to 7+ digits is treated as a phone
 * search and matched digit-to-digit via the search_customer_ids_by_phone RPC,
 * so a number pasted from Hearsay in any common format (punctuation, spaces, a
 * leading US country code, or surrounding text) finds the customer regardless
 * of how the stored phone is formatted. All matching customers are returned, so
 * a shared number surfaces every match rather than a single assumed-unique row.
 *
 * CONTEXT SCOPING. The search optionally restricts results to the customer
 * population the calling screen represents, enforced here so no page implements
 * its own filtering:
 *   - scope=project&project_id=<uuid> — only customers in that project
 *     (project_customers membership). Used by individual project workflows.
 *   - scope=mywork[&project_id=<uuid>] — only customers in the signed-in
 *     employee's My Work population (open, actionable work they can act on);
 *     with project_id, that population narrowed to one project. Resolved by the
 *     authoritative My Work scope helper.
 *   - no scope — database-wide search, for general customer-lookup screens.
 * The name/phone match is intersected with the scope's customer-id set, so
 * scoping never changes HOW matching works, only WHICH customers are eligible.
 * When the active screen changes project or filters, the caller passes the new
 * context and results update accordingly.
 *
 * GET /api/customers/search?q=...&agency_id=...&exclude=...
 * Household link flow. Matches name (first/last) or phone. Returns up to 10.
 *
 * GET /api/customers/search?q=...&dedup=true
 * Deduplication search for the intake form — matches first+last name or phone,
 * returns extended fields (DOB, city, state, case count) for identity confirmation.
 *
 * GET /api/customers/search?q=...&mode=list
 * Customer list page search. Matches name, email, source_client_id, or phone.
 * Returns up to 100 CustomerRow-shaped results.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q         = searchParams.get('q')?.trim() ?? ''
  const agencyId  = searchParams.get('agency_id') ?? ''
  const excludeId = searchParams.get('exclude') ?? ''
  const isDedup   = searchParams.get('dedup') === 'true'
  const isList    = searchParams.get('mode') === 'list'
  const scope     = searchParams.get('scope')?.trim() ?? ''
  const scopeProjectId = searchParams.get('project_id')?.trim() || null

  if (q.length < 2) {
    return Response.json({ data: [] })
  }

  const supabase = createAdminClient()

  // ── Context scope ───────────────────────────────────────────────────────
  // Resolve the optional population the active screen represents into a set of
  // customer ids the match will be intersected with. null = no scope (search
  // the whole database). An empty set is a real, non-null scope that matches no
  // customer, so a scoped screen with no population returns nothing rather than
  // leaking the whole database.
  let scopedIds: Set<string> | null = null
  if (scope === 'project') {
    if (!scopeProjectId) {
      // A project scope with no project id has no population to search.
      return Response.json({ data: [] })
    }
    const { data: members, error } = await supabase
      .from('project_customers')
      .select('customer_id')
      .eq('project_id', scopeProjectId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    scopedIds = new Set((members ?? []).map((m: { customer_id: string }) => m.customer_id))
  } else if (scope === 'mywork') {
    // The signed-in employee's My Work population (all projects, or one project
    // when project_id is present). Resolved from the session, not a param, so a
    // worker can only scope to their own work.
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return Response.json({ data: [] })
    try {
      scopedIds = await getMyWorkCustomerIds({ authUserId: user.id, projectId: scopeProjectId })
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 })
    }
  }

  // A resolved-but-empty scope matches nothing; short-circuit before querying.
  if (scopedIds && scopedIds.size === 0) {
    return Response.json({ data: [] })
  }
  const scopeIdList = scopedIds ? Array.from(scopedIds) : null

  // A query is treated as a phone search once it reduces to 7+ digits. Matching
  // is digit-to-digit via the shared search_customer_ids_by_phone RPC, so a
  // pasted Hearsay number in any format (punctuation, spaces, a leading US
  // country code, or surrounding text) finds the customer regardless of how the
  // stored phone is formatted. Returns ALL matching ids, so duplicate numbers
  // surface every matching customer rather than a single assumed-unique row.
  const digits = q.replace(/\D/g, '')
  const isPhoneSearch = digits.length >= 7

  async function phoneMatchIds(): Promise<string[]> {
    const { data, error } = await supabase.rpc('search_customer_ids_by_phone', { p_raw: q })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: { id: string }) => r.id)
  }

  // ── List (Customers page) mode ────────────────────────────────────────────
  if (isList) {
    const words  = q.split(/\s+/).filter(Boolean).slice(0, 3)

    let listQuery = supabase
      .from('customers')
      .select('id, first_name, last_name, phone, email, city, state, segment, is_emoney_client, is_deceased, is_former_client, is_prospect, source_client_id, date_of_birth, created_at, service_policies(count)')
      .eq('is_test', false)
      .order('last_name')
      .order('first_name')
      .limit(100)

    // Context scope: intersect with the screen's population (AND with any phone
    // id set below).
    if (scopeIdList) listQuery = listQuery.in('id', scopeIdList)

    if (isPhoneSearch) {
      // Phone search: resolve matching ids digit-to-digit, then constrain.
      let ids: string[]
      try { ids = await phoneMatchIds() } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 })
      }
      if (ids.length === 0) return Response.json({ data: [] })
      listQuery = listQuery.in('id', ids)
    } else {
      // Name / email / source_client_id: each word must appear somewhere
      for (const word of words) {
        listQuery = listQuery.or(
          `first_name.ilike.%${word}%,last_name.ilike.%${word}%,email.ilike.%${word}%,source_client_id.ilike.%${word}%`
        )
      }
    }

    const { data, error } = await listQuery
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const rows = (data ?? []).map((c: Record<string, unknown>) => {
      const sp = c.service_policies as { count: number }[] | null
      const { service_policies: _, ...rest } = c
      return { ...rest, policy_count: sp?.[0]?.count ?? 0 }
    })

    return Response.json({ data: rows })
  }

  // ── Deduplication mode ────────────────────────────────────────────────────
  if (isDedup) {
    let query = supabase
      .from('customers')
      .select('id, first_name, last_name, phone, date_of_birth, city, state')
      .eq('is_test', false)
      .limit(6)

    // Context scope: intersect with the screen's population.
    if (scopeIdList) query = query.in('id', scopeIdList)

    if (isPhoneSearch) {
      // Phone search: resolve matching ids digit-to-digit, then constrain.
      let ids: string[]
      try { ids = await phoneMatchIds() } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 })
      }
      if (ids.length === 0) return Response.json({ data: [] })
      query = query.in('id', ids)
    } else {
      // Name search: each space-separated word must appear in first or last name
      const words = q.split(/\s+/).filter(Boolean).slice(0, 2)
      for (const word of words) {
        query = query.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`)
      }
    }

    const { data, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Fetch case counts separately to avoid ambiguous FK on cases table
    const ids = (data ?? []).map(c => c.id)
    const { data: caseCounts } = ids.length
      ? await supabase
          .from('cases')
          .select('customer_id')
          .in('customer_id', ids)
          .eq('is_test', false)
      : { data: [] }
    const countMap = new Map<string, number>()
    for (const row of (caseCounts ?? [])) {
      countMap.set(row.customer_id, (countMap.get(row.customer_id) ?? 0) + 1)
    }

    const results = (data ?? []).map(c => ({
      id:            c.id,
      first_name:    c.first_name,
      last_name:     c.last_name,
      phone:         c.phone,
      date_of_birth: c.date_of_birth,
      city:          c.city,
      state:         c.state,
      case_count:    countMap.get(c.id) ?? 0,
    }))

    return Response.json({ data: results })
  }

  // ── Household link mode ───────────────────────────────────────────────────
  void agencyId  // received but not used; kept in signature for future use

  let query = supabase
    .from('customers')
    .select('id, first_name, last_name, phone, customer_group_id')
    .eq('is_test', false)
    .order('last_name')
    .order('first_name')
    .limit(10)

  // Context scope: intersect with the screen's population.
  if (scopeIdList) query = query.in('id', scopeIdList)

  if (isPhoneSearch) {
    // Phone search: resolve matching ids digit-to-digit, then constrain.
    let ids: string[]
    try { ids = await phoneMatchIds() } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 })
    }
    if (ids.length === 0) return Response.json({ data: [] })
    query = query.in('id', ids)
  } else {
    // Split on whitespace; each word must appear in first_name OR last_name.
    // This allows searching "Miller", "Kathleen", "James Miller", etc.
    const words = q.split(/\s+/).filter(Boolean).slice(0, 3)
    for (const word of words) {
      query = query.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`)
    }
  }

  if (excludeId) query = query.neq('id', excludeId)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ data: data ?? [] })
}
