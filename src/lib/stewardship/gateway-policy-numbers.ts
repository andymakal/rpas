import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Gateway policy numbers — the single, shared gatherer of every Allstate policy
 * number reliably associated with a customer, for the Search Gateway look-up.
 *
 * A worker searches Gateway by last name + policy number, and the surest key is
 * ANY policy number already on file. This collects all of them from the two
 * places Right Path actually persists a customer-linked policy number, so the
 * Search Gateway component never needs page-specific wiring and there is no new
 * data entry and no second source of truth:
 *
 *   - service_policies — the per-customer in-force policy records
 *     (policy_number, scoped by customer_id, non-test). The customer's own
 *     policies and bulk-imported book policies that have been linked to the
 *     customer live here.
 *   - cases — the referral/intake + pipeline record (customer_id not null).
 *     Two distinct numbers can ride a case: `allstate_policy_number` (the
 *     existing Allstate P&C number captured on the referral/intake form) and
 *     `policy_number` (the placed life policy number). Both are collected.
 *
 * Deliberately NOT read, because none reliably ties a policy NUMBER to a
 * customer (reading them would invent a relationship or create a second source
 * of truth):
 *   - gdc_records.policy_number is agency-scoped with no customer_id.
 *   - intake_raw holds an unstructured JSONB payload with no policy column and
 *     no reliable customer id — the referral number is promoted onto cases.
 *   - project_customers / project_matches carry no policy number (at most a
 *     policy_id FK into service_policies, already covered above).
 *   - service_requests / policy_reviews reach the customer only through
 *     service_policies, so they add nothing beyond it.
 *
 * Numbers are de-duplicated per customer (case-insensitively, keeping the first
 * seen display form) and returned in a stable order so the look-up reads the
 * same every time.
 */

const usable = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim().length > 0

async function chunked<T>(
  items: readonly T[],
  size: number,
  run: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await run(items.slice(i, i + size))
  }
}

type ServicePolicyRow = { customer_id: string | null; policy_number: string | null }
type CaseRow = {
  customer_id: string | null
  policy_number: string | null
  allstate_policy_number: string | null
}

/**
 * Map each given customer to ALL distinct policy numbers on file, de-duplicated,
 * gathered from service_policies and cases in batched passes. Customers with no
 * policy number simply map to an empty array (surfaced as "no policy number" in
 * the UI). Read failures degrade to whatever was gathered rather than throwing,
 * so the look-up still shows the last name even if a source is unavailable.
 */
export async function loadGatewayPolicyNumbers(
  supabase: SupabaseClient,
  customerIds: readonly string[],
): Promise<Map<string, string[]>> {
  const unique = Array.from(new Set(customerIds.filter(Boolean)))
  const out = new Map<string, string[]>()
  // De-dupe helpers: a per-customer lowercase set guards against repeats across
  // both sources while preserving the first-seen display form and order.
  const seen = new Map<string, Set<string>>()
  if (unique.length === 0) return out
  for (const id of unique) {
    out.set(id, [])
    seen.set(id, new Set())
  }

  const add = (customerId: string | null, raw: string | null): void => {
    if (!customerId || !usable(raw)) return
    const list = out.get(customerId)
    const keys = seen.get(customerId)
    if (!list || !keys) return // not one of the requested customers
    const value = raw.trim()
    const key = value.toLowerCase()
    if (keys.has(key)) return
    keys.add(key)
    list.push(value)
  }

  await chunked(unique, 300, async (chunk) => {
    const { data } = await supabase
      .from('service_policies')
      .select('customer_id, policy_number')
      .in('customer_id', chunk)
      .eq('is_test', false)
    for (const p of (data ?? []) as ServicePolicyRow[]) {
      add(p.customer_id, p.policy_number)
    }
  })

  await chunked(unique, 300, async (chunk) => {
    const { data } = await supabase
      .from('cases')
      .select('customer_id, policy_number, allstate_policy_number')
      .in('customer_id', chunk)
      .eq('is_test', false)
    for (const c of (data ?? []) as CaseRow[]) {
      // allstate_policy_number (the referral/intake P&C number) first, then the
      // placed life policy number, so the referral key leads when both exist.
      add(c.customer_id, c.allstate_policy_number)
      add(c.customer_id, c.policy_number)
    }
  })

  return out
}

/**
 * Single-customer convenience over {@link loadGatewayPolicyNumbers}: the full
 * de-duplicated list of policy numbers for one customer (empty when none).
 */
export async function loadGatewayPolicyNumbersForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<string[]> {
  return (await loadGatewayPolicyNumbers(supabase, [customerId])).get(customerId) ?? []
}
