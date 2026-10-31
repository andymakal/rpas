import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import {
  interpretSourceDob,
  mergeImportDobIntoCustomer,
  reconcileSourceDobs,
  type SourceDob,
} from '@/lib/stewardship/dob'

/**
 * POST /api/admin/policy-import
 *
 * Accepts pre-parsed policy rows from the client (browser parses the Excel,
 * sends only structured JSON — avoids Turbopack dev server body size limits
 * and removes XLSX from the server bundle).
 *
 * Body: {
 *   policies:          PolicyRow[]
 *   file_name:         string
 *   master_sheet:      string | null
 *   sheet_stats:       SheetStat[]
 *   skipped_annuities: number
 *   skipped_no_id:     number
 * }
 */

type PolicyRow = {
  policy_number:        string
  client_name:          string
  carrier:              string
  product_type:         string | null
  issue_date:           string | null
  face_amount:          number | null
  death_benefit_amount: number | null
  cash_value_amount:    number | null
  annual_premium:       number | null
  rate_class:           string | null
  riders:               string | null
  insured_first_name:   string | null
  insured_last_name:    string | null
  insured_dob:          string | null   // full date, only when precision is 'exact'
  insured_dob_year:     number | null
  insured_dob_month:    number | null
  insured_dob_precision: 'exact' | 'month_year' | 'year_only' | 'missing'
  insured_state:        string | null
  policy_termination_date: string | null
  owner_phone:          string | null
  owner_dob_approx:     string | null
  writing_agent_name:   string | null
  coverage_status:      string
  sa_status:            'unknown'
  is_test:              false
  // Transient owner-enrichment fields (present in the request, NOT columns on
  // service_policies). Stripped before insert; used only to enrich the owner's
  // customer record with the owner's complete DOB.
  _owner_first_name?:   string | null
  _owner_last_name?:    string | null
  _owner_dob_source?:   string | null
}

export async function POST(req: NextRequest) {
  // This route is excluded from the proxy matcher (large request bodies), so it
  // must authorize the caller itself before any service-role work. It imports
  // policies AND writes authoritative customer DOBs, so being merely signed in
  // is not enough — require an INTERNAL ADMIN (no agency mapping), the same gate
  // the other stewardship write routes use. Agency/portal users are rejected.
  const auth = await requireInternalAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: {
    policies:          PolicyRow[]
    file_name:         string
    master_sheet:      string | null
    skipped_annuities: number
    skipped_no_id:     number
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { policies, file_name, skipped_annuities, skipped_no_id } = body

  if (!Array.isArray(policies)) {
    return NextResponse.json({ error: 'policies must be an array' }, { status: 400 })
  }

  // ── Check for existing policies — chunked to avoid URL length limits ─────────
  const supabase     = createAdminClient()
  const existingSet  = new Set<string>()
  const LOOKUP_CHUNK = 500

  const allNumbers = policies.map(p => p.policy_number)
  for (let i = 0; i < allNumbers.length; i += LOOKUP_CHUNK) {
    const chunk = allNumbers.slice(i, i + LOOKUP_CHUNK)
    const { data } = await supabase
      .from('service_policies')
      .select('policy_number')
      .in('policy_number', chunk)
    for (const r of data ?? []) existingSet.add(r.policy_number)
  }

  const toInsert = policies.filter(p => !existingSet.has(p.policy_number))
  const onFile   = policies.filter(p =>  existingSet.has(p.policy_number))

  // The transient owner-enrichment fields travel in the request body but are NOT
  // columns on service_policies, so strip them before inserting the policy row.
  // The owner's complete DOB they carry is applied to the owner's CUSTOMER
  // record below — the single source of truth for a person's DOB — never onto
  // the policy (which would duplicate it and blur owner vs insured).
  const stripOwnerEnrichment = (p: PolicyRow): Record<string, unknown> => {
    const { _owner_first_name, _owner_last_name, _owner_dob_source, ...policyColumns } = p
    void _owner_first_name; void _owner_last_name; void _owner_dob_source
    return policyColumns
  }

  // ── Chunked insert ────────────────────────────────────────────────────────────
  const INSERT_CHUNK = 200
  let   insertedCount = 0
  const errors: string[] = []

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK).map(stripOwnerEnrichment)
    const { error } = await supabase.from('service_policies').insert(chunk)
    if (error) {
      console.error(`Policy import chunk ${Math.floor(i / INSERT_CHUNK) + 1} error:`, error)
      errors.push(`Rows ${i + 1}–${i + chunk.length}: ${error.message}`)
    } else {
      insertedCount += chunk.length
    }
  }

  // ── Preserve the owner's COMPLETE DOB as source EVIDENCE ────────────────────
  // owner_dob_approx on the policy is day-less by design (PHI), and an owner is
  // not always reliably linked to a customer. So the complete owner DOB the
  // source stated is first preserved as EVIDENCE keyed to the policy (source
  // document) — never discarded, never a second authoritative DOB. This runs
  // for EVERY parsed policy that carries a usable owner DOB, linked or not.
  const ownerDobEvidence = await recordOwnerDobEvidence(supabase, policies, file_name)

  // ── Enrich the AUTHORITATIVE customer DOB — only on a confident match ────────
  // The owner's complete DOB is merged into the owner's customer (the single
  // source of truth) ONLY when the owner's identity is sufficiently established
  // (it resolves to exactly one existing customer) and the import carries no
  // conflicting owner DOB for that identity. A compatible merge adds precision
  // but never overwrites a contradictory or more-reliable existing value, and
  // the insured columns are untouched, so owner and insured stay distinct.
  const ownerDobEnriched = await enrichOwnerCustomerDobs(supabase, policies)

  return NextResponse.json({
    file_name,
    total_parsed:      policies.length,
    inserted:          insertedCount,
    already_on_file:   onFile.length,
    owner_dob_evidence: ownerDobEvidence,
    owner_dob_enriched: ownerDobEnriched,
    skipped_annuities,
    skipped_no_id,
    errors:            errors.length ? errors : undefined,
  })
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Enrich the owner's CUSTOMER record with the owner's complete date of birth
 * carried by the import, so an exact owner DOB (day included) is preserved even
 * when the policy's insured is a different person. This writes a person's DOB
 * only to the customer (the single source of truth), never onto the policy, and
 * only by a COMPATIBLE merge — a customer gains precision when the import adds
 * it, but a contradictory year/month/day or an existing more-reliable value is
 * never overwritten. The policy's insured columns are untouched.
 *
 * An owner is matched to an existing customer the same safe way the contact
 * dedup does: first name + last name + birth year, and ONLY when that key maps
 * to exactly one customer (ambiguous or unmatched owners are left alone — we do
 * not create customers here). Returns how many customers were enriched.
 */
async function enrichOwnerCustomerDobs(
  supabase: AdminClient,
  policies: PolicyRow[],
): Promise<number> {
  // Collect, per owner identity (firstName|lastName|birthYear — the 3-factor
  // identity the contact dedup uses), every DOB the import stated for that
  // owner. We then reconcile them: compatible values (one adds a month or day
  // the other lacked) fold into the most complete agreed DOB; genuinely
  // DISAGREEING values (a different month or day) are a conflict we refuse to
  // resolve, rather than arbitrarily picking one.
  const ownerSources = new Map<string, SourceDob[]>()
  for (const p of policies) {
    const first = (p._owner_first_name ?? '').trim().toLowerCase().split(/\s+/)[0]
    const last  = (p._owner_last_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    const raw   = p._owner_dob_source ?? null
    if (!first || !last || !raw) continue
    const src = interpretSourceDob(raw)
    if (src.year == null) continue
    const key = `${first}|${last}|${src.year}`
    const list = ownerSources.get(key) ?? []
    list.push(src)
    ownerSources.set(key, list)
  }
  // Keep only identities whose sources AGREE, carrying the reconciled (most
  // complete compatible) owner DOB. A conflict is skipped entirely.
  const owners = new Map<string, { dob: SourceDob }>()
  for (const [key, sources] of ownerSources) {
    const reconciled = reconcileSourceDobs(sources)
    if (reconciled.status === 'agreed' && reconciled.dob.year != null) {
      owners.set(key, { dob: reconciled.dob })
    }
  }
  if (owners.size === 0) return 0

  // Build a first|last|year -> customer id index over existing customers,
  // paginating to clear Supabase's 1000-row cap. A key shared by two customers
  // maps to null (ambiguous) so we never guess which to enrich.
  type Cust = { id: string; first_name: string | null; last_name: string | null; date_of_birth: string | null; date_of_birth_approx: string | null }
  const byKey = new Map<string, string | null>()
  const byId  = new Map<string, Cust>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, date_of_birth, date_of_birth_approx')
      .eq('is_test', false)
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const c of data as Cust[]) {
      const cf = (c.first_name ?? '').trim().toLowerCase().split(/\s+/)[0]
      const cl = (c.last_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
      const yr = birthYearOf(c.date_of_birth, c.date_of_birth_approx)
      if (cf && cl && yr != null) {
        const key = `${cf}|${cl}|${yr}`
        byKey.set(key, byKey.has(key) ? null : c.id)
      }
      byId.set(c.id, c)
    }
    if (data.length < PAGE) break
  }

  let enriched = 0
  for (const [key, owner] of owners) {
    const id = byKey.get(key)
    if (!id) continue // unmatched OR ambiguous -> leave the customer alone
    const cust = byId.get(id)
    if (!cust) continue
    const merged = mergeImportDobIntoCustomer(
      cust.date_of_birth, cust.date_of_birth_approx, owner.dob,
    )
    if (!merged) continue // no compatible precision to add; never overwrite
    const { error } = await supabase
      .from('customers')
      .update({ date_of_birth: merged.date_of_birth, date_of_birth_approx: merged.date_of_birth_approx })
      .eq('id', id)
    if (!error) enriched++
  }
  return enriched
}

/**
 * Preserve the complete owner DOB each policy stated as source EVIDENCE, keyed
 * to the policy (the source document) — never discarded, never a second
 * authoritative customer DOB. Upserts one current evidence row per policy, so a
 * re-import refreshes rather than duplicates. Only policies that actually carry
 * a usable owner DOB (a year at minimum) are recorded. Returns the row count
 * written. A failure here never blocks the import; evidence is best-effort.
 */
async function recordOwnerDobEvidence(
  supabase: AdminClient,
  policies: PolicyRow[],
  fileName: string | null,
): Promise<number> {
  // One current evidence row per policy_number; later rows for the same policy
  // in this batch win (same as a re-import would).
  const rows = new Map<string, Record<string, unknown>>()
  for (const p of policies) {
    if (!p.policy_number) continue
    const raw = p._owner_dob_source ?? null
    if (!raw) continue
    const src = interpretSourceDob(raw)
    if (src.year == null) continue // nothing usable to preserve
    const precision =
      src.precision === 'exact' ? 'exact'
      : src.precision === 'month-year' ? 'month_year'
      : 'year_only'
    rows.set(p.policy_number, {
      policy_number:    p.policy_number,
      owner_first_name: p._owner_first_name ?? null,
      owner_last_name:  p._owner_last_name ?? null,
      dob_year:         src.year,
      dob_month:        src.month,
      dob_day:          src.day,
      dob_precision:    precision,
      source_file:      fileName,
      observed_at:      new Date().toISOString(),
    })
  }
  if (rows.size === 0) return 0

  let written = 0
  const CHUNK = 500
  const all = [...rows.values()]
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('policy_owner_dob_evidence')
      .upsert(chunk, { onConflict: 'policy_number' })
    if (error) {
      console.error('owner DOB evidence upsert error:', error)
    } else {
      written += chunk.length
    }
  }
  return written
}

/** Birth year from either a customer's exact date or masked partial. */
function birthYearOf(exact: string | null, approx: string | null): number | null {
  if (exact) {
    const y = parseInt(exact.slice(0, 4), 10)
    if (!isNaN(y)) return y
  }
  if (approx) {
    const m = approx.match(/(\d{4})\s*$/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}
