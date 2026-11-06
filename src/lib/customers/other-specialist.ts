/**
 * Other-specialist restriction: the one place that decides whether a customer
 * is off limits because they already work with another active financial
 * specialist.
 *
 * Four states:
 *   unknown          never checked (the default for every customer)
 *   clear            checked, no other EFS ("No Other EFS")
 *   life_authorized  another EFS exists but life work is authorized (informational)
 *   hands_off        another EFS exists, do not touch
 *
 * ONLY hands_off restricts anything. unknown and life_authorized must stay
 * workable. life_authorized and hands_off always carry a named specialist
 * (customers.other_specialist_id), enforced by a database check constraint, so
 * nothing is flagged without a specific reason. unknown and clear carry none.
 *
 * Every consumer reads the restriction through these functions. Do not compare
 * the status string elsewhere.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const OTHER_SPECIALIST_STATUSES = ['unknown', 'clear', 'life_authorized', 'hands_off'] as const
export type OtherSpecialistStatus = (typeof OTHER_SPECIALIST_STATUSES)[number]

/** Operator-facing label for each selection. */
export const OTHER_SPECIALIST_LABELS: Record<OtherSpecialistStatus, string> = {
  unknown: 'Unknown',
  clear: 'No Other EFS',
  life_authorized: 'Other EFS \u2014 Life Authorized',
  hands_off: 'Other EFS \u2014 Hands Off',
}

/** True when the customer must be left alone. Only hands_off restricts. */
export function isHandsOff(status: string | null | undefined): boolean {
  return status === 'hands_off'
}

/** True when the status names another specialist (life_authorized, hands_off). */
export function requiresSpecialist(status: string | null | undefined): boolean {
  return status === 'life_authorized' || status === 'hands_off'
}

/**
 * Validate a status change before it is written. life_authorized and hands_off
 * need a named specialist; unknown and clear must not carry one (mirrors the
 * database constraint so the caller gets a readable reason instead of a
 * constraint error).
 */
export function validateOtherSpecialist(
  status: string,
  specialistId: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (!(OTHER_SPECIALIST_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, reason: 'Unrecognized status.' }
  }
  if (requiresSpecialist(status) && !specialistId) {
    return { ok: false, reason: 'This selection needs the named financial specialist.' }
  }
  if (!requiresSpecialist(status) && specialistId) {
    return { ok: false, reason: 'Only a life-authorized or hands-off customer is tied to a specialist.' }
  }
  return { ok: true }
}

/**
 * Ids of every hands-off customer. The set is small (a handful of books), so a
 * single read is cheaper than a per-population join. Pass `customerIds` to
 * narrow the read to a known population.
 */
export async function loadHandsOffCustomerIds(
  supabase: SupabaseClient,
  customerIds?: string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (customerIds) {
    for (let i = 0; i < customerIds.length; i += 300) {
      const chunk = customerIds.slice(i, i + 300)
      if (chunk.length === 0) continue
      const { data, error } = await supabase
        .from('customers')
        .select('id')
        .in('id', chunk)
        .eq('other_specialist_status', 'hands_off')
      // Fail loudly: a failed read must never let hands-off customers through.
      if (error) throw new Error(`Hands-off customer read failed: ${error.message}`)
      for (const r of (data ?? []) as { id: string }[]) out.add(r.id)
    }
    return out
  }
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('customers')
      .select('id')
      .eq('other_specialist_status', 'hands_off')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Hands-off customer read failed: ${error.message}`)
    const rows = (data ?? []) as { id: string }[]
    for (const r of rows) out.add(r.id)
    if (rows.length < pageSize) break
  }
  return out
}
