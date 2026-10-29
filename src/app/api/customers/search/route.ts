import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getMyWorkCustomerIds, getMyWorkProjectMemberIds } from '@/lib/my-work/scope'
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

  // Pagination + ranking (default/household mode only; opt-in so the specialized
  // pickers keep their existing fixed-size, unranked behavior). A work-oriented
  // search screen passes rank=lastname and a page size/offset; a picker passes
  // neither and gets the historical top-10.
  const rankByLastName = searchParams.get('rank') === 'lastname'
  const rawLimit  = parseInt(searchParams.get('limit') ?? '', 10)
  const rawOffset = parseInt(searchParams.get('offset') ?? '', 10)
  const pageLimit  = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10
  const pageOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0

  if (q.length < 2) {
    return Response.json({ data: [] })
  }

  const supabase = createAdminClient()

  // ── Context scope ───────────────────────────────────────────────────────
  // Resolve the optional population the active screen represents. There are two
  // distinct enforcement mechanisms, chosen for RELIABILITY at any size:
  //
  //   projectScopeId — a project-membership scope is enforced ENTIRELY IN SQL by
  //     embedding project_customers!inner on the customers query and filtering it
  //     by project_id (project_customers.customer_id → customers.id FK). The
  //     database performs the intersection and the result limit together, so a
  //     project search is correct regardless of project size: no row cap on a
  //     membership read, and no large id list crosses the wire. null = not a
  //     project scope.
  //
  //   myWorkIds — the My Work population depends on per-item capability logic
  //     that lives in TypeScript, so it is resolved to a concrete id set. That
  //     set is the signed-in employee's own actionable workload (bounded by the
  //     work they can act on), so intersecting via .in() is safe. null = not a
  //     My Work scope; an empty set is a real scope that matches nobody.
  let projectScopeId: string | null = null
  let myWorkIds: Set<string> | null = null

  if (scope === 'project') {
    if (!scopeProjectId) {
      // A project scope with no project id has no population to search.
      return Response.json({ data: [] })
    }
    projectScopeId = scopeProjectId
  } else if (scope === 'mywork') {
    // The signed-in employee's My Work context. Resolved from the session, not
    // a param, so a worker can only scope to their own work.
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return Response.json({ data: [] })
    try {
      if (scopeProjectId) {
        // A single project in the My Work context: that project's membership.
        myWorkIds = await getMyWorkCustomerIds({ authUserId: user.id, projectId: scopeProjectId })
      } else {
        // All Projects: the COMBINED membership of every project in the worker's
        // My Work context — not the whole customer database. Agency-wide
        // customer lookup lives on other screens (no scope), unchanged.
        myWorkIds = await getMyWorkProjectMemberIds(user.id)
      }
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 })
    }
  }

  // A resolved-but-empty My Work scope matches nothing; short-circuit.
  if (myWorkIds && myWorkIds.size === 0) {
    return Response.json({ data: [] })
  }
  const myWorkIdList = myWorkIds ? Array.from(myWorkIds) : null

  // The scope is applied to each mode's customers query in two parts, kept
  // uniform across modes so matching + population filtering stay centralized:
  //
  //   scopedSelect(base) — the PostgREST select string. For a project scope it
  //     appends an embedded `project_customers!inner(project_id)` join so the
  //     membership constraint is enforced in SQL (see applyScopeFilters), with
  //     no row cap and no id list over the wire. Other scopes leave it as-is.
  //
  //   applyScopeFilters(q) — adds the scope's filter to a post-select query:
  //     the project-membership equality (pairs with the embedded join) or the
  //     bounded My Work id-set intersect. Exactly one, or neither, is active.
  const scopedSelect = (base: string): string =>
    projectScopeId ? `${base}, project_customers!inner(project_id)` : base

  function applyScopeFilters<Q extends {
    eq: (c: string, v: unknown) => Q
    in: (c: string, v: readonly string[]) => Q
  }>(query: Q): Q {
    if (projectScopeId) return query.eq('project_customers.project_id', projectScopeId)
    if (myWorkIdList) return query.in('id', myWorkIdList)
    return query
  }

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

    let listQuery = applyScopeFilters(
      supabase
        .from('customers')
        .select(scopedSelect('id, first_name, last_name, phone, email, city, state, segment, is_emoney_client, is_deceased, is_former_client, is_prospect, source_client_id, date_of_birth, created_at, service_policies(count)'))
        .eq('is_test', false),
    )
      .order('last_name')
      .order('first_name')
      .limit(100)

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

    // The select is composed dynamically (scopedSelect), so type the rows here.
    const listRows = (data ?? []) as unknown as Record<string, unknown>[]
    const rows = listRows.map((c) => {
      const sp = c.service_policies as { count: number }[] | null
      // Drop the embedded aggregate and the scope-only membership join; neither
      // is part of the CustomerRow shape callers consume.
      const { service_policies: _sp, project_customers: _pc, ...rest } = c
      return { ...rest, policy_count: sp?.[0]?.count ?? 0 }
    })

    return Response.json({ data: rows })
  }

  // ── Deduplication mode ────────────────────────────────────────────────────
  if (isDedup) {
    let query = applyScopeFilters(
      supabase
        .from('customers')
        .select(scopedSelect('id, first_name, last_name, phone, date_of_birth, city, state'))
        .eq('is_test', false),
    )
      .limit(6)

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

    // The select is composed dynamically (scopedSelect), so type the rows here.
    type DedupRow = {
      id: string
      first_name: string | null
      last_name: string | null
      phone: string | null
      date_of_birth: string | null
      city: string | null
      state: string | null
    }
    const dedupRows = (data ?? []) as unknown as DedupRow[]

    // Fetch case counts separately to avoid ambiguous FK on cases table
    const ids = dedupRows.map(c => c.id)
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

    const results = dedupRows.map(c => ({
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

  // ── Household / default mode ──────────────────────────────────────────────
  void agencyId  // received but not used; kept in signature for future use

  const householdSelect = 'id, first_name, last_name, phone, customer_group_id'
  const stripRow = (c: Record<string, unknown>) => {
    // Drop the scope-only embedded membership join; not part of the result shape.
    const { project_customers: _pc, ...rest } = c
    return rest
  }

  // A scoped base query over customers, with the standard filters (is_test,
  // scope, exclude). Each variant below adds its own name/phone match and
  // ordering. Centralizes scope so every path enforces it identically.
  const scopedBase = () => {
    let b = applyScopeFilters(
      supabase
        .from('customers')
        .select(scopedSelect(householdSelect))
        .eq('is_test', false),
    )
    if (excludeId) b = b.neq('id', excludeId)
    return b
  }

  // ── Phone search (single bucket) ──────────────────────────────────────────
  // Digit-to-digit match ids, then page in SQL. No last-name ranking applies.
  if (isPhoneSearch) {
    let ids: string[]
    try { ids = await phoneMatchIds() } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 })
    }
    if (ids.length === 0) {
      return Response.json(rankByLastName ? { data: [], has_more: false } : { data: [] })
    }
    // Unranked picker: historical top-10. Ranked: page in SQL (limit+1 probe
    // for has_more so there is no cap and no mis-report).
    const end = rankByLastName ? pageOffset + pageLimit : 10
    let pq = scopedBase().in('id', ids).order('last_name').order('first_name')
    pq = rankByLastName ? pq.range(pageOffset, end) : pq.limit(10) // range end is inclusive; +1 probe
    const { data, error } = await pq
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const all = ((data ?? []) as unknown as Record<string, unknown>[]).map(stripRow)
    if (!rankByLastName) return Response.json({ data: all })
    const page = all.slice(0, pageLimit)
    return Response.json({ data: page, has_more: all.length > pageLimit })
  }

  const words = q.split(/\s+/).filter(Boolean).slice(0, 3)
  const applyNameOr = <Q extends { or: (f: string) => Q }>(b: Q): Q => {
    // Each word must appear in first OR last name (chained .or ⇒ AND across words).
    for (const word of words) b = b.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`)
    return b
  }

  // ── Unranked picker path (historical top-10 by name, no ranking/paging) ────
  if (!rankByLastName) {
    const { data, error } = await applyNameOr(
      scopedBase().order('last_name').order('first_name').limit(10),
    )
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(stripRow)
    return Response.json({ data: rows })
  }

  // ── Ranked name search: exact last-name first, then partial ───────────────
  // Two SQL buckets paged independently, composed in order — exact matches
  // (last_name = the query's last token) before partial matches. Ranking and
  // pagination are done in the DATABASE over the complete matching population,
  // so broad searches are never silently truncated and has_more is exact (no
  // candidate cap). "smith" shows every Smith before Blacksmith/Goldsmith.
  const lastToken = words[words.length - 1] ?? q

  // A scoped count base (head request, exact count) mirroring scopedBase, so the
  // bucket sizes are read without fetching rows.
  const scopedCountBase = () => {
    let b = applyScopeFilters(
      supabase
        .from('customers')
        .select(scopedSelect(householdSelect), { count: 'exact', head: true })
        .eq('is_test', false),
    )
    if (excludeId) b = b.neq('id', excludeId)
    return b
  }

  try {
    // Bucket sizes over the COMPLETE match set (no candidate cap).
    //   exactCount  = customers whose last_name equals the query's last token.
    //   totalCount  = the full name match (first OR last contains each word).
    //   partial     = total − exact (disjoint; PostgREST ilike with no %/_ is a
    //                 case-insensitive equality, safe because a name has no
    //                 wildcard characters).
    // Exact bucket = the FULL query match AND an exact last name. Applying the
    // whole name criteria here is what keeps "James Smith" from matching every
    // Smith: the exact-surname group only reorders results that already satisfy
    // the complete multiword query.
    const { count: exactCountRaw, error: exactErr } =
      await applyNameOr(scopedCountBase()).ilike('last_name', lastToken)
    if (exactErr) return Response.json({ error: exactErr.message }, { status: 500 })
    const exactCount = exactCountRaw ?? 0

    const { count: totalCountRaw, error: totalErr } =
      await applyNameOr(scopedCountBase())
    if (totalErr) return Response.json({ error: totalErr.message }, { status: 500 })
    const totalCount = totalCountRaw ?? 0

    const windowStart = pageOffset
    const windowEnd = pageOffset + pageLimit // exclusive
    const out: Record<string, unknown>[] = []

    // The slice of the EXACT bucket that falls in this window (ordered by first
    // name within the exact last name).
    const exactFrom = Math.min(windowStart, exactCount)
    const exactTo = Math.min(windowEnd, exactCount)
    if (exactTo > exactFrom) {
      const { data, error } = await applyNameOr(scopedBase())
        .ilike('last_name', lastToken)
        .order('first_name')
        .range(exactFrom, exactTo - 1)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]).map(stripRow))
    }

    // Then the PARTIAL bucket (full match, excluding exact last-name) for the
    // remaining window beneath the exact bucket.
    const remaining = pageLimit - out.length
    if (remaining > 0) {
      const partialWindowStart = Math.max(0, windowStart - exactCount)
      // The complement of the exact bucket: everything in the full match whose
      // last name is NOT the exact token — INCLUDING a null last name (a
      // first-name-only match). `NOT (last_name ILIKE token)` is NULL for a null
      // last name and would drop it, so keep nulls explicitly.
      const { data, error } = await applyNameOr(scopedBase())
        .or(`last_name.not.ilike.${lastToken},last_name.is.null`)
        .order('last_name')
        .order('first_name')
        .range(partialWindowStart, partialWindowStart + remaining - 1)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]).map(stripRow))
    }

    // has_more from the complete population (exact + partial), so Show More is
    // offered exactly when more matches exist and never silently truncates.
    const hasMore = windowEnd < totalCount
    return Response.json({ data: out, has_more: hasMore })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
