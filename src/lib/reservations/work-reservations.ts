/**
 * Work reservations (server-only) — the shared temporary-coordination primitive.
 *
 * One reusable mechanism so several employees can work the SAME shared activity
 * (Send Introductory Emails, Contact Research, and any future activity) without
 * two of them landing on the same customer. A reservation is a soft, self-
 * expiring lease — a coordination hint, never ownership, assignment, or a
 * workflow status. It changes no business record and always expires, so a closed
 * browser or an abandoned session can never leave a permanent hold.
 *
 * All concurrency safety lives in the SQL functions this module wraps
 * (20261106000001_work_reservations.sql): the subject is unique per
 * (activity, type, id) and every state change takes a row lock, so two employees
 * acting at the same instant can never both win the same subject. Expiry is
 * enforced at read time, so recovery is automatic with no background job.
 *
 * This module is the single TypeScript surface for that primitive; the activity
 * routes call it rather than hand-rolling claim logic, so the two activities
 * (and any later one) coordinate identically.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/** The kind of thing a reservation points at. An introductory-email reservation
 * holds a stewardship_outreach row; a contact-research reservation holds a
 * customer. Kept explicit so the same id space is never ambiguous. */
export type ReservationSubjectType = 'stewardship_outreach' | 'customer'

/** A stable activity key. Free-form by design (no schema change to add an
 * activity), but the known activities are named here so call sites share one
 * spelling. */
export type ReservationActivityKey = 'introductory_emails' | 'contact_research' | 'available_to_call' | 'servicing_access' | 'customer_interaction'

/**
 * How long a reservation lives without a heartbeat, in seconds. Short enough
 * that an abandoned subject frees quickly for a teammate, long enough to absorb
 * a slow page or a brief network blip while someone is genuinely working. The
 * client heartbeats on roughly a third of this, so a live worker always renews
 * well before expiry; a worker who stops heartbeating (closed tab, lost
 * connectivity) loses the subject within one TTL window.
 */
export const RESERVATION_TTL_SECONDS = 180

/**
 * Reserve ONE specific subject for a producer. Returns whether the caller now
 * holds it (`mine`) and who holds it (`heldBy`). `mine` is true when the subject
 * was free, already the caller's (the lease is refreshed), or held by someone
 * whose lease had lapsed (automatic takeover). `mine` is false only when a live
 * lease is held by a DIFFERENT producer — then `heldBy` is that producer.
 */
export async function reserveSubject(params: {
  activityKey: ReservationActivityKey
  subjectType: ReservationSubjectType
  subjectId: string
  producerId: string
  ttlSeconds?: number
}): Promise<{ mine: boolean; heldBy: string | null }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('reserve_work_subject', {
    p_activity_key: params.activityKey,
    p_subject_type: params.subjectType,
    p_subject_id: params.subjectId,
    p_producer_id: params.producerId,
    p_ttl_seconds: params.ttlSeconds ?? RESERVATION_TTL_SECONDS,
  })
  if (error) throw new Error(`reserve_work_subject failed: ${error.message}`)
  // The function returns a single row { held_by, is_mine }.
  const row = Array.isArray(data) ? data[0] : data
  return {
    mine: !!row?.is_mine,
    heldBy: (row?.held_by as string | null) ?? null,
  }
}

/**
 * The Save & Next / open primitive: given an ORDERED list of candidate subject
 * ids (the caller's eligible, in-scope, still-to-do work — ordering and
 * eligibility are the activity's own responsibility), atomically reserve the
 * FIRST candidate that is free or already the caller's, skipping any held live by
 * someone else. Returns the reserved subject id, or null when every candidate is
 * currently taken (the activity then shows "nothing available right now").
 */
export async function reserveNextSubject(params: {
  activityKey: ReservationActivityKey
  subjectType: ReservationSubjectType
  candidateIds: string[]
  producerId: string
  ttlSeconds?: number
}): Promise<string | null> {
  if (params.candidateIds.length === 0) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('reserve_next_work_subject', {
    p_activity_key: params.activityKey,
    p_subject_type: params.subjectType,
    p_candidate_ids: params.candidateIds,
    p_producer_id: params.producerId,
    p_ttl_seconds: params.ttlSeconds ?? RESERVATION_TTL_SECONDS,
  })
  if (error) throw new Error(`reserve_next_work_subject failed: ${error.message}`)
  return (data as string | null) ?? null
}

/**
 * Extend the caller's live lease on a subject (called periodically by the client
 * while the employee is actively working). Returns true when the lease was
 * extended. A lapsed or foreign lease is never resurrected by a heartbeat, so a
 * stale client can never steal a subject back.
 */
export async function heartbeatReservation(params: {
  activityKey: ReservationActivityKey
  subjectType: ReservationSubjectType
  subjectId: string
  producerId: string
  ttlSeconds?: number
}): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('heartbeat_work_reservation', {
    p_activity_key: params.activityKey,
    p_subject_type: params.subjectType,
    p_subject_id: params.subjectId,
    p_producer_id: params.producerId,
    p_ttl_seconds: params.ttlSeconds ?? RESERVATION_TTL_SECONDS,
  })
  if (error) throw new Error(`heartbeat_work_reservation failed: ${error.message}`)
  return !!data
}

/**
 * Release the caller's reservation on a subject (completing, skipping, or
 * leaving). Only the caller's own live row is removed; a subject the caller no
 * longer holds is left untouched, so a late release can never remove a
 * teammate's reservation. Returns true when a row was released.
 */
export async function releaseSubject(params: {
  activityKey: ReservationActivityKey
  subjectType: ReservationSubjectType
  subjectId: string
  producerId: string
}): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('release_work_subject', {
    p_activity_key: params.activityKey,
    p_subject_type: params.subjectType,
    p_subject_id: params.subjectId,
    p_producer_id: params.producerId,
  })
  if (error) throw new Error(`release_work_subject failed: ${error.message}`)
  return !!data
}

/**
 * The set of subject ids currently reserved by SOMEONE ELSE (a live lease held
 * by another producer), so an activity's list API can exclude them from the pool
 * it offers this caller. Expired leases are filtered out in SQL, so the exclusion
 * recovers automatically the moment a lease lapses.
 */
export async function reservedByOthers(params: {
  activityKey: ReservationActivityKey
  subjectType: ReservationSubjectType
  producerId: string
}): Promise<Set<string>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('reserved_subject_ids', {
    p_activity_key: params.activityKey,
    p_subject_type: params.subjectType,
    p_producer_id: params.producerId,
  })
  if (error) throw new Error(`reserved_subject_ids failed: ${error.message}`)
  const ids = (data as (string | { subject_id?: string })[] | null) ?? []
  const out = new Set<string>()
  for (const v of ids) {
    if (typeof v === 'string') out.add(v)
    else if (v && typeof v.subject_id === 'string') out.add(v.subject_id)
  }
  return out
}
