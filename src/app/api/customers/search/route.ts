import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/**
 * GET /api/customers/search?q=...&agency_id=...&exclude=...
 * Search customers by name for the household link flow.
 * Returns up to 10 matches.
 *
 * GET /api/customers/search?q=...&dedup=true
 * Deduplication search for the intake form — searches first+last name or phone,
 * returns extended fields (DOB, city, state, case count) for identity confirmation.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q         = searchParams.get('q')?.trim() ?? ''
  const agencyId  = searchParams.get('agency_id') ?? ''
  const excludeId = searchParams.get('exclude') ?? ''
  const isDedup   = searchParams.get('dedup') === 'true'

  if (q.length < 2) {
    return Response.json({ data: [] })
  }

  const supabase = createAdminClient()

  // ── Deduplication mode ────────────────────────────────────────────────────
  if (isDedup) {
    const digits = q.replace(/\D/g, '')
    const isPhoneSearch = digits.length >= 7

    let query = supabase
      .from('customers')
      .select('id, first_name, last_name, phone, date_of_birth, city, state, cases(id)')
      .eq('is_test', false)
      .limit(6)

    if (isPhoneSearch) {
      // Phone search: match digits anywhere in the stored phone
      query = query.ilike('phone', `%${digits.slice(0, 10)}%`)
    } else {
      // Name search: each space-separated word must appear in first or last name
      const words = q.split(/\s+/).filter(Boolean).slice(0, 2)
      for (const word of words) {
        query = query.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`)
      }
    }

    const { data, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const results = (data ?? []).map(c => ({
      id:            c.id,
      first_name:    c.first_name,
      last_name:     c.last_name,
      phone:         c.phone,
      date_of_birth: c.date_of_birth,
      city:          c.city,
      state:         c.state,
      case_count:    Array.isArray(c.cases) ? c.cases.length : 0,
    }))

    return Response.json({ data: results })
  }

  // ── Household link mode (original behaviour) ──────────────────────────────
  void agencyId  // received but not used; kept in signature for future use

  let query = supabase
    .from('customers')
    .select('id, first_name, last_name, phone, customer_group_id')
    .eq('is_test', false)
    .ilike('last_name', `%${q}%`)
    .order('last_name')
    .order('first_name')
    .limit(10)

  if (excludeId) query = query.neq('id', excludeId)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ data: data ?? [] })
}
